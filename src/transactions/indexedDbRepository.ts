import type {
  EditTransactionV1,
  ListTransactionsV1,
  TransactionJournalEventV1,
} from './contracts';
import { TransactionError } from './contracts';

const DEFAULT_DATABASE_NAME = 'iris-edit-transactions';
const DATABASE_VERSION = 1;
const TRANSACTIONS_STORE = 'transactions';
const JOURNAL_STORE = 'journal';
const IDEMPOTENCY_STORE = 'idempotency';

type IdempotencyRecord = {
  key: string;
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

  constructor(options: { databaseName?: string } = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
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
          database.createObjectStore(IDEMPOTENCY_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
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

  private async getByIdempotencyKey(
    key: string
  ): Promise<EditTransactionV1 | null> {
    const database = await this.open();
    const idbTransaction = database.transaction(
      [TRANSACTIONS_STORE, IDEMPOTENCY_STORE],
      'readonly'
    );
    const idempotency = idbTransaction.objectStore(IDEMPOTENCY_STORE);
    const transactions = idbTransaction.objectStore(TRANSACTIONS_STORE);
    const existing = await requestResult(
      idempotency.get(key) as IDBRequest<IdempotencyRecord | undefined>
    );
    if (!existing) {
      await transactionDone(idbTransaction);
      return null;
    }
    const value = await requestResult(
      transactions.get(existing.transactionId) as IDBRequest<
        EditTransactionV1 | undefined
      >
    );
    await transactionDone(idbTransaction);
    return value ?? null;
  }

  async createOrGet(
    transaction: EditTransactionV1,
    event: TransactionJournalEventV1
  ): Promise<EditTransactionV1> {
    const raced = await this.getByIdempotencyKey(transaction.idempotencyKey);
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
        idempotency.get(transaction.idempotencyKey) as IDBRequest<
          IdempotencyRecord | undefined
        >
      );
      if (existing) {
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
        key: transaction.idempotencyKey,
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
      const recovered = await this.getByIdempotencyKey(
        transaction.idempotencyKey
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
    await requestResult(indexedDB.deleteDatabase(this.databaseName));
  }
}
