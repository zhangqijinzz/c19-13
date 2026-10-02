import type { LayoutDocument } from './types';

export interface StoredLayoutRecord {
  document: LayoutDocument;
  revision: string;
  updatedAt: number;
}

export type CompareSaveResult = { status: 'saved'; revision: string } | { status: 'conflict'; current: StoredLayoutRecord };

export interface DocumentStorageService {
  read(): Promise<StoredLayoutRecord | null>;
  compareAndSave(record: StoredLayoutRecord, expectedRevision: string | null): Promise<CompareSaveResult>;
}

const STORAGE_KEY = 'exposketch.document.v1';
const DATABASE_NAME = 'exposketch-db';
const STORE_NAME = 'documents';

const canUseIndexedDb = () => typeof indexedDB !== 'undefined';

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';

const normalizeRevision = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const revision = value.trim();
  return /^[a-z0-9-]{8,64}$/i.test(revision) ? revision : null;
};

export const isStorageEnvelope = (value: unknown): value is { document: unknown; revision: string; updatedAt: number } => {
  if (!isObject(value)) return false;
  return 'document' in value && normalizeRevision(value.revision) !== null && typeof value.updatedAt === 'number';
};

export const normalizeStoredRecord = (value: unknown): StoredLayoutRecord | null => {
  if (!isObject(value)) return null;
  if (isStorageEnvelope(value)) {
    return { document: value.document as unknown as LayoutDocument, revision: value.revision, updatedAt: value.updatedAt };
  }
  if ('version' in value) {
    return { document: value as unknown as LayoutDocument, revision: 'legacy', updatedAt: 0 };
  }
  return null;
};

const createRevision = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

const withRevision = (record: StoredLayoutRecord): StoredLayoutRecord => ({
  document: record.document,
  revision: normalizeRevision(record.revision) ?? createRevision(),
  updatedAt: record.updatedAt || Date.now(),
});

export class BrowserStorageService implements DocumentStorageService {
  async read(): Promise<StoredLayoutRecord | null> {
    if (!canUseIndexedDb()) return this.readLocalStorage();
    return this.withDatabase('readonly', (store) => new Promise<StoredLayoutRecord | null>((resolve, reject) => {
      const request = store.get(STORAGE_KEY);
      request.onsuccess = () => resolve(normalizeStoredRecord(request.result));
      request.onerror = () => reject(request.error ?? new Error('读取布局失败'));
    }));
  }

  async compareAndSave(record: StoredLayoutRecord, expectedRevision: string | null): Promise<CompareSaveResult> {
    const next = withRevision(record);
    if (!canUseIndexedDb()) return this.compareAndSaveLocalStorage(next, expectedRevision);
    return this.withDatabase('readwrite', (store) => new Promise<CompareSaveResult>((resolve, reject) => {
      const getRequest = store.get(STORAGE_KEY);
      getRequest.onsuccess = () => {
        const current = normalizeStoredRecord(getRequest.result);
        if ((current?.revision ?? null) !== expectedRevision) {
          if (!current && expectedRevision === null) {
            const putRequest = store.put(next, STORAGE_KEY);
            putRequest.onsuccess = () => resolve({ status: 'saved', revision: next.revision });
            putRequest.onerror = () => reject(putRequest.error ?? new Error('保存布局失败'));
            return;
          }
          if (!current) {
            reject(new Error('当前布局版本不存在，请刷新后重试'));
            return;
          }
          resolve({ status: 'conflict', current });
          return;
        }

        const putRequest = store.put(next, STORAGE_KEY);
        putRequest.onsuccess = () => resolve({ status: 'saved', revision: next.revision });
        putRequest.onerror = () => reject(putRequest.error ?? new Error('保存布局失败'));
      };
      getRequest.onerror = () => reject(getRequest.error ?? new Error('保存布局失败'));
    }));
  }

  private readLocalStorage(): StoredLayoutRecord | null {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return normalizeStoredRecord(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  private compareAndSaveLocalStorage(record: StoredLayoutRecord, expectedRevision: string | null): CompareSaveResult {
    const current = this.readLocalStorage();
    if ((current?.revision ?? null) !== expectedRevision) {
      if (!current && expectedRevision !== null) return { status: 'conflict', current: { document: record.document, revision: 'missing', updatedAt: 0 } };
      if (!current) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
        return { status: 'saved', revision: record.revision };
      }
      return { status: 'conflict', current };
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    return { status: 'saved', revision: record.revision };
  }

  private withDatabase<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onerror = () => reject(request.error ?? new Error('打开本地数据库失败'));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(STORE_NAME, mode);
        run(transaction.objectStore(STORE_NAME)).then(resolve).catch(reject);
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => reject(transaction.error ?? new Error('本地数据库事务失败'));
        transaction.onabort = () => reject(transaction.error ?? new Error('本地数据库事务已取消'));
      };
    });
  }
}
