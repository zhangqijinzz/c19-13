import type { LayoutDocument } from './types';

export interface StoredRecord {
  revision: string;
  updatedAt: number;
  document: LayoutDocument;
}

export interface SwapOutcome {
  ok: boolean;
  current: StoredRecord | null;
}

export interface DocumentStorageService {
  readRecord(): Promise<StoredRecord | null>;
  compareAndSwap(record: StoredRecord, expectedRevision: string | null): Promise<SwapOutcome>;
  forcePut(record: StoredRecord): Promise<void>;
  writeBackup(record: StoredRecord): Promise<void>;
  readBackup(): Promise<StoredRecord | null>;
}

const STORAGE_KEY = 'exposketch.document.v1';
const BACKUP_KEY = 'exposketch.document.backup.v1';
const DB_NAME = 'exposketch-db';
const STORE_NAME = 'documents';
const ENVELOPE_FORMAT = 'exposketch.record.v1';
export const LEGACY_REVISION = 'legacy';

const toEnvelope = (record: StoredRecord) => ({ format: ENVELOPE_FORMAT, ...record });

export const normalizeStored = (raw: unknown): StoredRecord | null => {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.format === ENVELOPE_FORMAT && typeof value.revision === 'string' && typeof value.updatedAt === 'number' && value.document && typeof value.document === 'object') {
    return { revision: value.revision, updatedAt: value.updatedAt, document: value.document as LayoutDocument };
  }
  if (value.version === 1) {
    return { revision: LEGACY_REVISION, updatedAt: 0, document: raw as LayoutDocument };
  }
  return null;
};

const canUseIndexedDb = () => typeof indexedDB !== 'undefined';

export class BrowserStorageService implements DocumentStorageService {
  async readRecord(): Promise<StoredRecord | null> {
    if (!canUseIndexedDb()) return this.readLocal(STORAGE_KEY);
    return this.withStore('readonly', (store) => this.requestTo(store.get(STORAGE_KEY), (result) => normalizeStored(result)));
  }

  async readBackup(): Promise<StoredRecord | null> {
    if (!canUseIndexedDb()) return this.readLocal(BACKUP_KEY);
    return this.withStore('readonly', (store) => this.requestTo(store.get(BACKUP_KEY), (result) => normalizeStored(result)));
  }

  async writeBackup(record: StoredRecord): Promise<void> {
    if (!canUseIndexedDb()) {
      this.writeLocal(BACKUP_KEY, record);
      return;
    }
    await this.withStore('readwrite', (store) => this.requestTo(store.put(toEnvelope(record), BACKUP_KEY), () => undefined));
  }

  async forcePut(record: StoredRecord): Promise<void> {
    if (!canUseIndexedDb()) {
      const current = this.readLocal(STORAGE_KEY);
      if (current) this.writeLocal(BACKUP_KEY, current);
      this.writeLocal(STORAGE_KEY, record);
      return;
    }
    await this.withStore('readwrite', (store) => new Promise<void>((resolve, reject) => {
      const getRequest = store.get(STORAGE_KEY);
      getRequest.onerror = () => reject(getRequest.error ?? new Error('读取布局失败'));
      getRequest.onsuccess = () => {
        const current = normalizeStored(getRequest.result);
        if (current) store.put(toEnvelope(current), BACKUP_KEY);
        const putRequest = store.put(toEnvelope(record), STORAGE_KEY);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error ?? new Error('保存布局失败'));
      };
    }));
  }

  async compareAndSwap(record: StoredRecord, expectedRevision: string | null): Promise<SwapOutcome> {
    if (!canUseIndexedDb()) {
      const current = this.readLocal(STORAGE_KEY);
      if ((current?.revision ?? null) !== expectedRevision) return { ok: false, current };
      if (current) this.writeLocal(BACKUP_KEY, current);
      this.writeLocal(STORAGE_KEY, record);
      return { ok: true, current };
    }
    return this.withStore('readwrite', (store) => new Promise<SwapOutcome>((resolve, reject) => {
      const getRequest = store.get(STORAGE_KEY);
      getRequest.onerror = () => reject(getRequest.error ?? new Error('读取布局失败'));
      getRequest.onsuccess = () => {
        const current = normalizeStored(getRequest.result);
        if ((current?.revision ?? null) !== expectedRevision) {
          resolve({ ok: false, current });
          return;
        }
        if (current) store.put(toEnvelope(current), BACKUP_KEY);
        const putRequest = store.put(toEnvelope(record), STORAGE_KEY);
        putRequest.onsuccess = () => resolve({ ok: true, current });
        putRequest.onerror = () => reject(putRequest.error ?? new Error('保存布局失败'));
      };
    }));
  }

  private readLocal(key: string): StoredRecord | null {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? normalizeStored(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  private writeLocal(key: string, record: StoredRecord) {
    window.localStorage.setItem(key, JSON.stringify(toEnvelope(record)));
  }

  private requestTo<T>(request: IDBRequest, map: (result: unknown) => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(map(request.result));
      request.onerror = () => reject(request.error ?? new Error('本地数据库操作失败'));
    });
  }

  private withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onerror = () => reject(request.error ?? new Error('打开本地数据库失败'));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(STORE_NAME, mode);
        run(transaction.objectStore(STORE_NAME)).then(resolve).catch(reject);
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => database.close();
      };
    });
  }
}
