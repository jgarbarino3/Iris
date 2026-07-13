import type {
  EditTransactionV1,
  ListTransactionsV1,
  TransactionJournalEventV1,
} from './contracts';
import {
  TRANSACTION_DATABASE_VERSION,
  TransactionError,
  composeIdempotencyKey,
  proposalFingerprintFromTransaction,
} from './contracts';

const DEFAULT_DATABASE_NAME = 'iris-edit-transactions';
const TRANSACTIONS_STORE = 'transactions';
const JOURNAL_STORE = 'journal';
const IDEMPOTENCY_STORE = 'idempotency_v2';
const LEGACY_IDEMPOTENCY_STORE = 'idempotency';

type IdempotencyRecord = {
  key: string;
  projectId: string;
  idempotencyKey: string;
  proposalFingerprint: string;
  transactionId: string;
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

  async deleteDatabase(): Promise<void> {
    if (this.databasePromise) {
      const database = await this.databasePromise;
      database.close();
      this.databasePromise = null;
    }
    this.idempotencyMigrated = false;
    await requestResult(indexedDB.deleteDatabase(this.databaseName));
  }
}
