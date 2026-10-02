import type { LayoutDocument } from './types';

export interface DocumentStorageService {
  read(): Promise<LayoutDocument | null>;
  write(document: LayoutDocument): Promise<void>;
}

const STORAGE_KEY = 'exposketch.document.v1';

const canUseIndexedDb = () => typeof indexedDB !== 'undefined';

export class BrowserStorageService implements DocumentStorageService {
  async read(): Promise<LayoutDocument | null> {
    if (!canUseIndexedDb()) {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as LayoutDocument) : null;
    }
    return this.withDatabase((store) => new Promise<LayoutDocument | null>((resolve, reject) => {
      const request = store.get(STORAGE_KEY);
      request.onsuccess = () => resolve((request.result as LayoutDocument | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('读取布局失败'));
    }));
  }

  async write(document: LayoutDocument): Promise<void> {
    if (!canUseIndexedDb()) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
      return;
    }
    await this.withDatabase((store) => new Promise<void>((resolve, reject) => {
      const request = store.put(document, STORAGE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('保存布局失败'));
    }));
  }

  private withDatabase<T>(run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('exposketch-db', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents');
      request.onerror = () => reject(request.error ?? new Error('打开本地数据库失败'));
      request.onsuccess = () => {
        const transaction = request.result.transaction('documents', 'readwrite');
        run(transaction.objectStore('documents')).then(resolve).catch(reject);
        transaction.oncomplete = () => request.result.close();
      };
    });
  }
}
