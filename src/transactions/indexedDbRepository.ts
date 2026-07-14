import type {
  EditOperationV1,
  EditTransactionV1,
  ListTransactionsV1,
  OperationJournalEventV1,
  TransactionJournalEventV1,
} from './contracts';
import {
  TRANSACTION_DATABASE_VERSION,
  TransactionError,
  composeIdempotencyKey,
  proposalFingerprintFromTransaction,
} from './contracts';
import {
  planProjectHistoryPrune,
  type ProjectHistoryPrunePlanV1,
} from './retention';

const DEFAULT_DATABASE_NAME = 'iris-edit-transactions';
const TRANSACTIONS_STORE = 'transactions';
const JOURNAL_STORE = 'journal';
const IDEMPOTENCY_STORE = 'idempotency_v2';
const LEGACY_IDEMPOTENCY_STORE = 'idempotency';
const OPERATIONS_STORE = 'operations';
const OPERATION_JOURNAL_STORE = 'operation_journal';
const OPERATION_IDEMPOTENCY_STORE = 'operation_idempotency';

type IdempotencyRecord = {
  key: string;
  projectId: string;
  idempotencyKey: string;
  proposalFingerprint: string;
  transactionId: string;
};

type OperationIdempotencyRecord = {
  key: string;
  projectId: string;
  selectionId: string;
  fingerprint: string;
  operationId: string;
};

export type AtomicOperationUpdateV1 = {
  operation: EditOperationV1;
  operationEvent: OperationJournalEventV1;
  transactions: Array<{
    transaction: EditTransactionV1;
    event: TransactionJournalEventV1;
  }>;
};

export type AtomicSupersedeResultV1 = {
  original: EditTransactionV1;
  successor: EditTransactionV1;
};

export type AtomicRevertCreationResultV1 = {
  original: EditTransactionV1;
  inverse: EditTransactionV1;
  created: boolean;
};

export type AtomicTransactionUpdateV1 = {
  transactions: Array<{
    transaction: EditTransactionV1;
    event: TransactionJournalEventV1;
  }>;
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class IndexedDbTransactionRepository {
  private readonly databaseName: string;
  private databasePromise: Promise<IDBDatabase> | null = null;
  private idempotencyMigrated = false;

  constructor(options: { databaseName?: string } = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(
        this.databaseName,
        TRANSACTION_DATABASE_VERSION
      );
      request.onupgradeneeded = (event) => {
        const database = request.result;

        if (!database.objectStoreNames.contains(TRANSACTIONS_STORE)) {
          const store = database.createObjectStore(TRANSACTIONS_STORE, {
            keyPath: 'id',
          });
          store.createIndex('projectId', 'projectId', { unique: false });
          store.createIndex('state', 'state', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!database.objectStoreNames.contains(JOURNAL_STORE)) {
          const store = database.createObjectStore(JOURNAL_STORE, {
            keyPath: 'eventId',
          });
          store.createIndex('transactionId', 'transactionId', {
            unique: false,
          });
          store.createIndex('projectId', 'projectId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!database.objectStoreNames.contains(IDEMPOTENCY_STORE)) {
          const store = database.createObjectStore(IDEMPOTENCY_STORE, {
            keyPath: 'key',
          });
          store.createIndex('projectId', 'projectId', { unique: false });
        }
        if (!database.objectStoreNames.contains(OPERATIONS_STORE)) {
          const store = database.createObjectStore(OPERATIONS_STORE, {
            keyPath: 'id',
          });
          store.createIndex('projectId', 'projectId', { unique: false });
          store.createIndex('state', 'state', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!database.objectStoreNames.contains(OPERATION_JOURNAL_STORE)) {
          const store = database.createObjectStore(OPERATION_JOURNAL_STORE, {
            keyPath: 'eventId',
          });
          store.createIndex('operationId', 'operationId', { unique: false });
          store.createIndex('projectId', 'projectId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!database.objectStoreNames.contains(OPERATION_IDEMPOTENCY_STORE)) {
          const store = database.createObjectStore(
            OPERATION_IDEMPOTENCY_STORE,
            { keyPath: 'key' }
          );
          store.createIndex('projectId', 'projectId', { unique: false });
        }
        if (event.oldVersion > 0 && event.oldVersion < 2) {
          this.idempotencyMigrated = false;
        }
      };
      request.onsuccess = () => {
        void this.ensureIdempotencyMigrated(request.result)
          .then(() => resolve(request.result))
          .catch(reject);
      };
      request.onerror = () => {
        this.databasePromise = null;
        reject(
          request.error ?? new Error('Unable to open transaction database')
        );
      };
      request.onblocked = () => {
        this.databasePromise = null;
        reject(new Error('Transaction database upgrade blocked'));
      };
    });
    return this.databasePromise;
  }

  private async ensureIdempotencyMigrated(
    database: IDBDatabase
  ): Promise<void> {
    if (this.idempotencyMigrated) return;

    const readTransaction = database.transaction(
      [IDEMPOTENCY_STORE, TRANSACTIONS_STORE],
      'readonly'
    );
    const idempotencyCount = await requestResult(
      readTransaction.objectStore(IDEMPOTENCY_STORE).count()
    );
    const transactions = await requestResult(
      readTransaction.objectStore(TRANSACTIONS_STORE).getAll() as IDBRequest<
        EditTransactionV1[]
      >
    );
    await transactionDone(readTransaction);

    if (idempotencyCount > 0 || transactions.length === 0) {
      this.idempotencyMigrated = true;
      return;
    }

    const writeTransaction = database.transaction(
      [IDEMPOTENCY_STORE],
      'readwrite'
    );
    const idempotency = writeTransaction.objectStore(IDEMPOTENCY_STORE);
    for (const transaction of transactions) {
      idempotency.add({
        key: composeIdempotencyKey(
          transaction.projectId,
          transaction.idempotencyKey
        ),
        projectId: transaction.projectId,
        idempotencyKey: transaction.idempotencyKey,
        proposalFingerprint: proposalFingerprintFromTransaction(transaction),
        transactionId: transaction.id,
      } as IdempotencyRecord);
    }
    await transactionDone(writeTransaction);
    this.idempotencyMigrated = true;
  }

  private async getIdempotencyRecord(
    key: string
  ): Promise<IdempotencyRecord | null> {
    const database = await this.open();
    const idbTransaction = database.transaction(IDEMPOTENCY_STORE, 'readonly');
    const value = await requestResult(
      idbTransaction.objectStore(IDEMPOTENCY_STORE).get(key) as IDBRequest<
        IdempotencyRecord | undefined
      >
    );
    await transactionDone(idbTransaction);
    return value ?? null;
  }

  private async getByIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
    proposalFingerprint: string
  ): Promise<EditTransactionV1 | null> {
    const record = await this.getIdempotencyRecord(
      composeIdempotencyKey(projectId, idempotencyKey)
    );
    if (!record) return null;
    if (record.proposalFingerprint !== proposalFingerprint) {
      throw new TransactionError(
        'INVALID_REQUEST',
        'Idempotency key reused with different proposal content'
      );
    }
    return this.get(record.transactionId);
  }

  async createOrGet(
    transaction: EditTransactionV1,
    event: TransactionJournalEventV1,
    proposalFingerprint: string
  ): Promise<EditTransactionV1> {
    const compositeKey = composeIdempotencyKey(
      transaction.projectId,
      transaction.idempotencyKey
    );
    const raced = await this.getByIdempotencyKey(
      transaction.projectId,
      transaction.idempotencyKey,
      proposalFingerprint
    );
    if (raced) return raced;

    const database = await this.open();
    const idbTransaction = database.transaction(
      [TRANSACTIONS_STORE, JOURNAL_STORE, IDEMPOTENCY_STORE],
      'readwrite'
    );
    const idempotency = idbTransaction.objectStore(IDEMPOTENCY_STORE);
    const transactions = idbTransaction.objectStore(TRANSACTIONS_STORE);
    try {
      const existing = await requestResult(
        idempotency.get(compositeKey) as IDBRequest<
          IdempotencyRecord | undefined
        >
      );
      if (existing) {
        if (existing.proposalFingerprint !== proposalFingerprint) {
          idbTransaction.abort();
          throw new TransactionError(
            'INVALID_REQUEST',
            'Idempotency key reused with different proposal content'
          );
        }
        const value = await requestResult(
          transactions.get(existing.transactionId) as IDBRequest<
            EditTransactionV1 | undefined
          >
        );
        await transactionDone(idbTransaction);
        if (!value) {
          throw new Error(
            'Idempotency record references a missing transaction'
          );
        }
        return value;
      }
      transactions.add(transaction);
      idbTransaction.objectStore(JOURNAL_STORE).add(event);
      idempotency.add({
        key: compositeKey,
        projectId: transaction.projectId,
        idempotencyKey: transaction.idempotencyKey,
        proposalFingerprint,
        transactionId: transaction.id,
      } as IdempotencyRecord);
      await transactionDone(idbTransaction);
      return transaction;
    } catch (error) {
      try {
        await transactionDone(idbTransaction);
      } catch {
        // The write transaction may already be aborted after a constraint race.
      }
      if (
        error instanceof TransactionError &&
        error.code === 'INVALID_REQUEST'
      ) {
        throw error;
      }
      const recovered = await this.getByIdempotencyKey(
        transaction.projectId,
        transaction.idempotencyKey,
        proposalFingerprint
      );
      if (recovered) return recovered;
      throw error;
    }
  }

  async supersedeWithSuccessor(
    originalId: string,
    expectedOriginalRevision: number,
    successor: EditTransactionV1,
    successorEvent: TransactionJournalEventV1,
    originalEvent: TransactionJournalEventV1,
    proposalFingerprint: string,
    revertParent?: {
      id: string;
      expectedRevision: number;
      event: TransactionJournalEventV1;
    }
  ): Promise<AtomicSupersedeResultV1> {
    const compositeKey = composeIdempotencyKey(
      successor.projectId,
      successor.idempotencyKey
    );
    const database = await this.open();
    const idbTransaction = database.transaction(
      [TRANSACTIONS_STORE, JOURNAL_STORE, IDEMPOTENCY_STORE],
      'readwrite'
    );
    const transactions = idbTransaction.objectStore(TRANSACTIONS_STORE);
    const journal = idbTransaction.objectStore(JOURNAL_STORE);
    const idempotency = idbTransaction.objectStore(IDEMPOTENCY_STORE);
    try {
      const original = await requestResult(
        transactions.get(originalId) as IDBRequest<
          EditTransactionV1 | undefined
        >
      );
      if (!original) {
        idbTransaction.abort();
        throw new TransactionError(
          'INVALID_REQUEST',
          `Unknown transaction ${originalId}`
        );
      }
      if (original.projectId !== successor.projectId) {
        idbTransaction.abort();
        throw new TransactionError('WRONG_PROJECT', 'Project mismatch');
      }
      let parent: EditTransactionV1 | undefined;
      if (original.revertsTransactionId) {
        if (
          !revertParent ||
          revertParent.id !== original.revertsTransactionId ||
          successor.revertsTransactionId !== original.revertsTransactionId
        ) {
          idbTransaction.abort();
          throw new TransactionError(
            'INVALID_STATE',
            'Inverse successor relationship is incomplete'
          );
        }
        parent = await requestResult(
          transactions.get(revertParent.id) as IDBRequest<
            EditTransactionV1 | undefined
          >
        );
        if (
          !parent ||
          parent.projectId !== original.projectId ||
          parent.state !== 'applied'
        ) {
          idbTransaction.abort();
          throw new TransactionError(
            'INVALID_STATE',
            'Inverse parent is not actively applied'
          );
        }
      } else if (revertParent || successor.revertsTransactionId) {
        idbTransaction.abort();
        throw new TransactionError(
          'INVALID_STATE',
          'Unexpected inverse successor relationship'
        );
      }

      const relinkParent = (successorId: string): void => {
        if (!parent || !revertParent) return;
        if (parent.revertedByTransactionId === successorId) return;
        if (parent.revertedByTransactionId !== original.id) {
          throw new TransactionError(
            'RECOVERY_REQUIRED',
            'Inverse parent points to a competing transaction'
          );
        }
        if (parent.revision !== revertParent.expectedRevision) {
          throw new TransactionError(
            'STALE_REVISION',
            `Expected revision ${revertParent.expectedRevision}, found ${parent.revision}`
          );
        }
        const nextParent: EditTransactionV1 = {
          ...parent,
          revertedByTransactionId: successorId,
          revision: parent.revision + 1,
          updatedAt: revertParent.event.timestamp,
        };
        transactions.put(nextParent);
        journal.add({
          ...revertParent.event,
          transactionId: nextParent.id,
          projectId: nextParent.projectId,
          revision: nextParent.revision,
          fromState: parent.state,
          toState: parent.state,
          relationship: {
            kind: 'reverted-by',
            transactionId: successorId,
          },
        });
        parent = nextParent;
      };
      if (original.supersededByTransactionId) {
        const authoritative = await requestResult(
          transactions.get(original.supersededByTransactionId) as IDBRequest<
            EditTransactionV1 | undefined
          >
        );
        if (
          !authoritative ||
          authoritative.supersedesTransactionId !== original.id
        ) {
          throw new TransactionError(
            'RECOVERY_REQUIRED',
            'Supersede relationship is incomplete'
          );
        }
        relinkParent(authoritative.id);
        await transactionDone(idbTransaction);
        return { original, successor: authoritative };
      }
      if (original.revision !== expectedOriginalRevision) {
        idbTransaction.abort();
        throw new TransactionError(
          'STALE_REVISION',
          `Expected revision ${expectedOriginalRevision}, found ${original.revision}`
        );
      }
      if (!['proposed', 'conflicted', 'failed'].includes(original.state)) {
        idbTransaction.abort();
        throw new TransactionError(
          'INVALID_REQUEST',
          'Transaction cannot be superseded from its current state'
        );
      }

      const existingIdempotency = await requestResult(
        idempotency.get(compositeKey) as IDBRequest<
          IdempotencyRecord | undefined
        >
      );
      if (existingIdempotency) {
        if (existingIdempotency.proposalFingerprint !== proposalFingerprint) {
          idbTransaction.abort();
          throw new TransactionError(
            'INVALID_REQUEST',
            'Idempotency key reused with different proposal content'
          );
        }
        const existingSuccessor = await requestResult(
          transactions.get(existingIdempotency.transactionId) as IDBRequest<
            EditTransactionV1 | undefined
          >
        );
        if (
          !existingSuccessor ||
          existingSuccessor.supersedesTransactionId !== original.id
        ) {
          idbTransaction.abort();
          throw new TransactionError(
            'RECOVERY_REQUIRED',
            'Successor idempotency relationship is incomplete'
          );
        }
        const nextOriginal: EditTransactionV1 = {
          ...original,
          state: 'superseded',
          revision: original.revision + 1,
          updatedAt: originalEvent.timestamp,
          supersededByTransactionId: existingSuccessor.id,
          pendingApply: undefined,
          expectedPostApplySha256: undefined,
        };
        transactions.put(nextOriginal);
        journal.add({
          ...originalEvent,
          revision: nextOriginal.revision,
          fromState: original.state,
          toState: 'superseded',
          relationship: {
            kind: 'superseded-by',
            transactionId: existingSuccessor.id,
          },
        });
        relinkParent(existingSuccessor.id);
        await transactionDone(idbTransaction);
        return { original: nextOriginal, successor: existingSuccessor };
      }

      const nextOriginal: EditTransactionV1 = {
        ...original,
        state: 'superseded',
        revision: original.revision + 1,
        updatedAt: originalEvent.timestamp,
        supersededByTransactionId: successor.id,
        pendingApply: undefined,
        expectedPostApplySha256: undefined,
      };
      transactions.add(successor);
      journal.add(successorEvent);
      idempotency.add({
        key: compositeKey,
        projectId: successor.projectId,
        idempotencyKey: successor.idempotencyKey,
        proposalFingerprint,
        transactionId: successor.id,
      } as IdempotencyRecord);
      transactions.put(nextOriginal);
      journal.add({
        ...originalEvent,
        revision: nextOriginal.revision,
        fromState: original.state,
        toState: 'superseded',
        relationship: {
          kind: 'superseded-by',
          transactionId: successor.id,
        },
      });
      relinkParent(successor.id);
      await transactionDone(idbTransaction);
      return { original: nextOriginal, successor };
    } catch (error) {
      try {
        await transactionDone(idbTransaction);
      } catch {
        // Constraint races are resolved by reading the authoritative original.
      }
      if (error instanceof TransactionError) throw error;
      const recoveredOriginal = await this.get(originalId);
      if (recoveredOriginal?.supersededByTransactionId) {
        const recoveredSuccessor = await this.get(
          recoveredOriginal.supersededByTransactionId
        );
        if (
          recoveredSuccessor?.supersedesTransactionId === recoveredOriginal.id
        ) {
          return {
            original: recoveredOriginal,
            successor: recoveredSuccessor,
          };
        }
      }
      throw error;
    }
  }

  async createOrGetRevert(
    originalId: string,
    expectedOriginalRevision: number,
    inverse: EditTransactionV1,
    inverseEvent: TransactionJournalEventV1,
    originalEvent: TransactionJournalEventV1,
    proposalFingerprint: string
  ): Promise<AtomicRevertCreationResultV1> {
    const compositeKey = composeIdempotencyKey(
      inverse.projectId,
      inverse.idempotencyKey
    );
    const database = await this.open();
    const idbTransaction = database.transaction(
      [TRANSACTIONS_STORE, JOURNAL_STORE, IDEMPOTENCY_STORE],
      'readwrite'
    );
    const transactions = idbTransaction.objectStore(TRANSACTIONS_STORE);
    const journal = idbTransaction.objectStore(JOURNAL_STORE);
    const idempotency = idbTransaction.objectStore(IDEMPOTENCY_STORE);
    try {
      const original = await requestResult(
        transactions.get(originalId) as IDBRequest<
          EditTransactionV1 | undefined
        >
      );
      if (!original) {
        idbTransaction.abort();
        throw new TransactionError(
          'INVALID_REQUEST',
          `Unknown transaction ${originalId}`
        );
      }
      if (
        original.projectId !== inverse.projectId ||
        inverse.revertsTransactionId !== original.id
      ) {
        idbTransaction.abort();
        throw new TransactionError(
          original.projectId !== inverse.projectId
            ? 'WRONG_PROJECT'
            : 'INVALID_REQUEST',
          'Inverse relationship is invalid'
        );
      }
      if (
        original.id === inverse.id ||
        original.revertsTransactionId ||
        inverse.revertedByTransactionId
      ) {
        idbTransaction.abort();
        throw new TransactionError(
          'INVALID_STATE',
          'Revert relationship would create a cycle'
        );
      }
      if (original.revertedByTransactionId) {
        const authoritative = await requestResult(
          transactions.get(original.revertedByTransactionId) as IDBRequest<
            EditTransactionV1 | undefined
          >
        );
        await transactionDone(idbTransaction);
        if (
          !authoritative ||
          authoritative.projectId !== original.projectId ||
          authoritative.revertsTransactionId !== original.id
        ) {
          throw new TransactionError(
            'RECOVERY_REQUIRED',
            'Revert relationship is incomplete'
          );
        }
        return { original, inverse: authoritative, created: false };
      }
      if (original.revision !== expectedOriginalRevision) {
        idbTransaction.abort();
        throw new TransactionError(
          'STALE_REVISION',
          `Expected revision ${expectedOriginalRevision}, found ${original.revision}`
        );
      }
      if (original.state !== 'applied') {
        idbTransaction.abort();
        throw new TransactionError(
          'INVALID_STATE',
          'Only an applied transaction can create an inverse'
        );
      }

      const existingIdempotency = await requestResult(
        idempotency.get(compositeKey) as IDBRequest<
          IdempotencyRecord | undefined
        >
      );
      if (existingIdempotency) {
        if (existingIdempotency.proposalFingerprint !== proposalFingerprint) {
          idbTransaction.abort();
          throw new TransactionError(
            'INVALID_REQUEST',
            'Idempotency key reused with different inverse content'
          );
        }
        const existingInverse = await requestResult(
          transactions.get(existingIdempotency.transactionId) as IDBRequest<
            EditTransactionV1 | undefined
          >
        );
        if (
          !existingInverse ||
          existingInverse.projectId !== original.projectId ||
          existingInverse.revertsTransactionId !== original.id
        ) {
          idbTransaction.abort();
          throw new TransactionError(
            'RECOVERY_REQUIRED',
            'Inverse idempotency relationship is incomplete'
          );
        }
        const timestamp = originalEvent.timestamp;
        const nextOriginal: EditTransactionV1 = {
          ...original,
          revertedByTransactionId: existingInverse.id,
          revision: original.revision + 1,
          updatedAt: timestamp,
        };
        transactions.put(nextOriginal);
        journal.add({
          ...originalEvent,
          revision: nextOriginal.revision,
          fromState: original.state,
          toState: original.state,
          relationship: {
            kind: 'reverted-by',
            transactionId: existingInverse.id,
          },
        });
        await transactionDone(idbTransaction);
        return {
          original: nextOriginal,
          inverse: existingInverse,
          created: false,
        };
      }

      const nextOriginal: EditTransactionV1 = {
        ...original,
        revertedByTransactionId: inverse.id,
        revision: original.revision + 1,
        updatedAt: originalEvent.timestamp,
      };
      transactions.add(inverse);
      journal.add(inverseEvent);
      idempotency.add({
        key: compositeKey,
        projectId: inverse.projectId,
        idempotencyKey: inverse.idempotencyKey,
        proposalFingerprint,
        transactionId: inverse.id,
      } as IdempotencyRecord);
      transactions.put(nextOriginal);
      journal.add({
        ...originalEvent,
        revision: nextOriginal.revision,
        fromState: original.state,
        toState: original.state,
        relationship: {
          kind: 'reverted-by',
          transactionId: inverse.id,
        },
      });
      await transactionDone(idbTransaction);
      return { original: nextOriginal, inverse, created: true };
    } catch (error) {
      try {
        await transactionDone(idbTransaction);
      } catch {
        // Constraint races are resolved from the authoritative original link.
      }
      if (error instanceof TransactionError) throw error;
      const recoveredOriginal = await this.get(originalId);
      if (recoveredOriginal?.revertedByTransactionId) {
        const recoveredInverse = await this.get(
          recoveredOriginal.revertedByTransactionId
        );
        if (recoveredInverse?.revertsTransactionId === recoveredOriginal.id) {
          return {
            original: recoveredOriginal,
            inverse: recoveredInverse,
            created: false,
          };
        }
      }
      throw error;
    }
  }

  async get(id: string): Promise<EditTransactionV1 | null> {
    const database = await this.open();
    const transaction = database.transaction(TRANSACTIONS_STORE, 'readonly');
    const value = await requestResult(
      transaction.objectStore(TRANSACTIONS_STORE).get(id) as IDBRequest<
        EditTransactionV1 | undefined
      >
    );
    await transactionDone(transaction);
    return value ?? null;
  }

  async createOperationOrGet(
    operation: EditOperationV1,
    event: OperationJournalEventV1,
    fingerprint: string
  ): Promise<EditOperationV1> {
    const key = composeIdempotencyKey(
      operation.projectId,
      operation.selectionId
    );
    const database = await this.open();
    const idbTransaction = database.transaction(
      [OPERATIONS_STORE, OPERATION_JOURNAL_STORE, OPERATION_IDEMPOTENCY_STORE],
      'readwrite'
    );
    const operations = idbTransaction.objectStore(OPERATIONS_STORE);
    const idempotency = idbTransaction.objectStore(OPERATION_IDEMPOTENCY_STORE);
    const existing = await requestResult(
      idempotency.get(key) as IDBRequest<OperationIdempotencyRecord | undefined>
    );
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        idbTransaction.abort();
        throw new TransactionError(
          'INVALID_REQUEST',
          'Selection identity reused with a different transaction subset'
        );
      }
      const stored = await requestResult(
        operations.get(existing.operationId) as IDBRequest<
          EditOperationV1 | undefined
        >
      );
      await transactionDone(idbTransaction);
      if (!stored) {
        throw new Error('Selection identity references a missing operation');
      }
      return stored;
    }
    operations.add(operation);
    idbTransaction.objectStore(OPERATION_JOURNAL_STORE).add(event);
    idempotency.add({
      key,
      projectId: operation.projectId,
      selectionId: operation.selectionId,
      fingerprint,
      operationId: operation.id,
    } as OperationIdempotencyRecord);
    await transactionDone(idbTransaction);
    return operation;
  }

  async getOperation(id: string): Promise<EditOperationV1 | null> {
    const database = await this.open();
    const transaction = database.transaction(OPERATIONS_STORE, 'readonly');
    const value = await requestResult(
      transaction.objectStore(OPERATIONS_STORE).get(id) as IDBRequest<
        EditOperationV1 | undefined
      >
    );
    await transactionDone(transaction);
    return value ?? null;
  }

  async listOperations(projectId: string): Promise<EditOperationV1[]> {
    const database = await this.open();
    const transaction = database.transaction(OPERATIONS_STORE, 'readonly');
    const values = await requestResult(
      transaction
        .objectStore(OPERATIONS_STORE)
        .index('projectId')
        .getAll(projectId) as IDBRequest<EditOperationV1[]>
    );
    await transactionDone(transaction);
    return values.sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
    );
  }

  async getOperationJournal(
    operationId: string
  ): Promise<OperationJournalEventV1[]> {
    const database = await this.open();
    const transaction = database.transaction(
      OPERATION_JOURNAL_STORE,
      'readonly'
    );
    const values = await requestResult(
      transaction
        .objectStore(OPERATION_JOURNAL_STORE)
        .index('operationId')
        .getAll(operationId) as IDBRequest<OperationJournalEventV1[]>
    );
    await transactionDone(transaction);
    return values.sort((left, right) => left.revision - right.revision);
  }

  async compareAndSwapOperation(
    operationId: string,
    expectedOperationRevision: number,
    expectedTransactionRevisions: Map<string, number>,
    update: (
      operation: EditOperationV1,
      transactions: EditTransactionV1[]
    ) => AtomicOperationUpdateV1
  ): Promise<EditOperationV1> {
    const database = await this.open();
    const idbTransaction = database.transaction(
      [
        OPERATIONS_STORE,
        OPERATION_JOURNAL_STORE,
        TRANSACTIONS_STORE,
        JOURNAL_STORE,
      ],
      'readwrite'
    );
    const operationStore = idbTransaction.objectStore(OPERATIONS_STORE);
    const transactionStore = idbTransaction.objectStore(TRANSACTIONS_STORE);
    const operation = await requestResult(
      operationStore.get(operationId) as IDBRequest<EditOperationV1 | undefined>
    );
    if (!operation) {
      idbTransaction.abort();
      throw new TransactionError(
        'INVALID_REQUEST',
        `Unknown operation ${operationId}`
      );
    }
    if (operation.revision !== expectedOperationRevision) {
      idbTransaction.abort();
      throw new TransactionError(
        'STALE_REVISION',
        `Expected operation revision ${expectedOperationRevision}, found ${operation.revision}`
      );
    }
    const transactions: EditTransactionV1[] = [];
    for (const [
      transactionId,
      expectedRevision,
    ] of expectedTransactionRevisions) {
      const transaction = await requestResult(
        transactionStore.get(transactionId) as IDBRequest<
          EditTransactionV1 | undefined
        >
      );
      if (!transaction) {
        idbTransaction.abort();
        throw new TransactionError(
          'INVALID_REQUEST',
          `Unknown transaction ${transactionId}`
        );
      }
      if (transaction.revision !== expectedRevision) {
        idbTransaction.abort();
        throw new TransactionError(
          'STALE_REVISION',
          `Expected revision ${expectedRevision}, found ${transaction.revision}`
        );
      }
      transactions.push(transaction);
    }

    const next = update(operation, transactions);
    if (next.operation.revision !== operation.revision + 1) {
      idbTransaction.abort();
      throw new Error('Operation revision must increment exactly once');
    }
    operationStore.put(next.operation);
    idbTransaction
      .objectStore(OPERATION_JOURNAL_STORE)
      .add(next.operationEvent);
    for (const entry of next.transactions) {
      transactionStore.put(entry.transaction);
      idbTransaction.objectStore(JOURNAL_STORE).add(entry.event);
    }
    await transactionDone(idbTransaction);
    return next.operation;
  }

  async list(query: ListTransactionsV1): Promise<EditTransactionV1[]> {
    const database = await this.open();
    const transaction = database.transaction(TRANSACTIONS_STORE, 'readonly');
    const values = await requestResult(
      transaction
        .objectStore(TRANSACTIONS_STORE)
        .index('projectId')
        .getAll(query.projectId) as IDBRequest<EditTransactionV1[]>
    );
    await transactionDone(transaction);
    const states = query.states ? new Set(query.states) : null;
    return values
      .filter((value) => !states || states.has(value.state))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .slice(0, query.limit ?? values.length);
  }

  async getJournal(
    transactionId: string
  ): Promise<TransactionJournalEventV1[]> {
    const database = await this.open();
    const transaction = database.transaction(JOURNAL_STORE, 'readonly');
    const values = await requestResult(
      transaction
        .objectStore(JOURNAL_STORE)
        .index('transactionId')
        .getAll(transactionId) as IDBRequest<TransactionJournalEventV1[]>
    );
    await transactionDone(transaction);
    return values.sort((a, b) => a.revision - b.revision);
  }

  async listProjectJournal(
    projectId: string
  ): Promise<TransactionJournalEventV1[]> {
    const database = await this.open();
    const transaction = database.transaction(JOURNAL_STORE, 'readonly');
    const values = await requestResult(
      transaction
        .objectStore(JOURNAL_STORE)
        .index('projectId')
        .getAll(projectId) as IDBRequest<TransactionJournalEventV1[]>
    );
    await transactionDone(transaction);
    return values.sort(
      (left, right) =>
        left.timestamp - right.timestamp ||
        left.revision - right.revision ||
        left.eventId.localeCompare(right.eventId)
    );
  }

  async listProjectOperationJournal(
    projectId: string
  ): Promise<OperationJournalEventV1[]> {
    const database = await this.open();
    const transaction = database.transaction(
      OPERATION_JOURNAL_STORE,
      'readonly'
    );
    const values = await requestResult(
      transaction
        .objectStore(OPERATION_JOURNAL_STORE)
        .index('projectId')
        .getAll(projectId) as IDBRequest<OperationJournalEventV1[]>
    );
    await transactionDone(transaction);
    return values.sort(
      (left, right) =>
        left.timestamp - right.timestamp ||
        left.revision - right.revision ||
        left.eventId.localeCompare(right.eventId)
    );
  }

  async compareAndSwap(
    id: string,
    expectedRevision: number,
    update: (current: EditTransactionV1) => {
      transaction: EditTransactionV1;
      event: TransactionJournalEventV1;
    }
  ): Promise<EditTransactionV1> {
    const database = await this.open();
    const idbTransaction = database.transaction(
      [TRANSACTIONS_STORE, JOURNAL_STORE],
      'readwrite'
    );
    const store = idbTransaction.objectStore(TRANSACTIONS_STORE);
    const current = await requestResult(
      store.get(id) as IDBRequest<EditTransactionV1 | undefined>
    );
    if (!current) {
      idbTransaction.abort();
      throw new TransactionError(
        'INVALID_REQUEST',
        `Unknown transaction ${id}`
      );
    }
    if (current.revision !== expectedRevision) {
      idbTransaction.abort();
      throw new TransactionError(
        'STALE_REVISION',
        `Expected revision ${expectedRevision}, found ${current.revision}`
      );
    }
    const next = update(current);
    if (next.transaction.revision !== current.revision + 1) {
      idbTransaction.abort();
      throw new Error('Transaction revision must increment exactly once');
    }
    store.put(next.transaction);
    idbTransaction.objectStore(JOURNAL_STORE).add(next.event);
    await transactionDone(idbTransaction);
    return next.transaction;
  }

  async compareAndSwapTransactions(
    expectedRevisions: Map<string, number>,
    update: (transactions: EditTransactionV1[]) => AtomicTransactionUpdateV1
  ): Promise<EditTransactionV1[]> {
    if (expectedRevisions.size === 0) {
      throw new TransactionError(
        'INVALID_REQUEST',
        'Atomic transaction update cannot be empty'
      );
    }
    const database = await this.open();
    const idbTransaction = database.transaction(
      [TRANSACTIONS_STORE, JOURNAL_STORE],
      'readwrite'
    );
    const store = idbTransaction.objectStore(TRANSACTIONS_STORE);
    const current: EditTransactionV1[] = [];
    for (const [id, expectedRevision] of expectedRevisions) {
      const transaction = await requestResult(
        store.get(id) as IDBRequest<EditTransactionV1 | undefined>
      );
      if (!transaction) {
        idbTransaction.abort();
        throw new TransactionError(
          'INVALID_REQUEST',
          `Unknown transaction ${id}`
        );
      }
      if (transaction.revision !== expectedRevision) {
        idbTransaction.abort();
        throw new TransactionError(
          'STALE_REVISION',
          `Expected revision ${expectedRevision}, found ${transaction.revision}`
        );
      }
      current.push(transaction);
    }
    const next = update(current);
    const expectedIds = new Set(expectedRevisions.keys());
    if (
      next.transactions.length !== expectedIds.size ||
      new Set(next.transactions.map((entry) => entry.transaction.id)).size !==
        expectedIds.size
    ) {
      idbTransaction.abort();
      throw new Error('Atomic transaction update membership mismatch');
    }
    const currentById = new Map(
      current.map((transaction) => [transaction.id, transaction])
    );
    for (const entry of next.transactions) {
      const previous = currentById.get(entry.transaction.id);
      if (
        !previous ||
        !expectedIds.has(entry.transaction.id) ||
        entry.transaction.revision !== previous.revision + 1 ||
        entry.event.transactionId !== entry.transaction.id ||
        entry.event.revision !== entry.transaction.revision
      ) {
        idbTransaction.abort();
        throw new Error('Atomic transaction revision or event mismatch');
      }
      store.put(entry.transaction);
      idbTransaction.objectStore(JOURNAL_STORE).add(entry.event);
    }
    await transactionDone(idbTransaction);
    return next.transactions.map((entry) => entry.transaction);
  }

  async pruneProjectHistory(
    projectId: string,
    evaluatedAt: number
  ): Promise<ProjectHistoryPrunePlanV1> {
    const database = await this.open();
    const idbTransaction = database.transaction(
      [
        TRANSACTIONS_STORE,
        JOURNAL_STORE,
        IDEMPOTENCY_STORE,
        OPERATIONS_STORE,
        OPERATION_JOURNAL_STORE,
        OPERATION_IDEMPOTENCY_STORE,
      ],
      'readwrite'
    );
    const transactionStore = idbTransaction.objectStore(TRANSACTIONS_STORE);
    const journalStore = idbTransaction.objectStore(JOURNAL_STORE);
    const idempotencyStore = idbTransaction.objectStore(IDEMPOTENCY_STORE);
    const operationStore = idbTransaction.objectStore(OPERATIONS_STORE);
    const operationJournalStore = idbTransaction.objectStore(
      OPERATION_JOURNAL_STORE
    );
    const operationIdempotencyStore = idbTransaction.objectStore(
      OPERATION_IDEMPOTENCY_STORE
    );
    try {
      const transactions = await requestResult(
        transactionStore.index('projectId').getAll(projectId) as IDBRequest<
          EditTransactionV1[]
        >
      );
      const operations = await requestResult(
        operationStore.index('projectId').getAll(projectId) as IDBRequest<
          EditOperationV1[]
        >
      );
      const plan = planProjectHistoryPrune({
        projectId,
        transactions,
        operations,
        now: evaluatedAt,
      });
      const transactionIds = new Set(plan.prunedTransactionIds);
      const operationIds = new Set(plan.prunedOperationIds);

      if (transactionIds.size > 0) {
        const journalEvents = await requestResult(
          journalStore.index('projectId').getAll(projectId) as IDBRequest<
            TransactionJournalEventV1[]
          >
        );
        const idempotencyRecords = await requestResult(
          idempotencyStore.index('projectId').getAll(projectId) as IDBRequest<
            IdempotencyRecord[]
          >
        );
        for (const id of transactionIds) transactionStore.delete(id);
        for (const event of journalEvents) {
          if (transactionIds.has(event.transactionId)) {
            journalStore.delete(event.eventId);
          }
        }
        for (const record of idempotencyRecords) {
          if (transactionIds.has(record.transactionId)) {
            idempotencyStore.delete(record.key);
          }
        }
      }

      if (operationIds.size > 0) {
        const journalEvents = await requestResult(
          operationJournalStore
            .index('projectId')
            .getAll(projectId) as IDBRequest<OperationJournalEventV1[]>
        );
        const idempotencyRecords = await requestResult(
          operationIdempotencyStore
            .index('projectId')
            .getAll(projectId) as IDBRequest<OperationIdempotencyRecord[]>
        );
        for (const id of operationIds) operationStore.delete(id);
        for (const event of journalEvents) {
          if (operationIds.has(event.operationId)) {
            operationJournalStore.delete(event.eventId);
          }
        }
        for (const record of idempotencyRecords) {
          if (operationIds.has(record.operationId)) {
            operationIdempotencyStore.delete(record.key);
          }
        }
      }

      await transactionDone(idbTransaction);
      return plan;
    } catch (error) {
      try {
        idbTransaction.abort();
      } catch {
        // The transaction may already have aborted.
      }
      try {
        await transactionDone(idbTransaction);
      } catch {
        // Preserve the original failure; IndexedDB abort keeps the delete set atomic.
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.databasePromise) {
      const database = await this.databasePromise;
      database.close();
      this.databasePromise = null;
    }
    this.idempotencyMigrated = false;
  }

  async deleteDatabase(): Promise<void> {
    await this.close();
    await requestResult(indexedDB.deleteDatabase(this.databaseName));
  }
}
