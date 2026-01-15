import { getRuntimeConfig, setRuntimeConfig } from './config';

export function initialiseIndexDB(dbName: string, version: number, storeName?: string): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    if (!window.indexedDB) {
      resolve(undefined);
      return;
    }

    const dbRequest = indexedDB.open(dbName, version);
    dbRequest.onsuccess = (event) => {
      const db = (event.currentTarget as IDBOpenDBRequest).result;
      resolve(db);
    };
    dbRequest.onerror = () => resolve(undefined);
    dbRequest.onupgradeneeded = (event) => {
      const db = (event.currentTarget as IDBOpenDBRequest).result;
      if (!storeName) return;
      if (db.objectStoreNames.contains(storeName)) return;
      const store = db.createObjectStore(storeName, { autoIncrement: true });
      store.createIndex('url', 'url', { unique: true });
      store.createIndex('arraybuffer', 'arraybuffer');
    };
  });
}

export function setLive2dDB(db: IDBDatabase | null) {
  setRuntimeConfig({ Live2dDB: db });
}

export function selectItemIndexDB<T>(key: string, value: string, storeName = 'live2d'): Promise<T | undefined> {
  return new Promise((resolve) => {
    const db = getRuntimeConfig().Live2dDB;
    if (!db) {
      resolve(undefined);
      return;
    }

    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.index(key).get(value);
    request.onsuccess = (event) => {
      const result = (event.currentTarget as IDBRequest).result;
      resolve(result ? (result as T) : undefined);
    };
    request.onerror = () => resolve(undefined);
  });
}

export function createItemIndexDB<T>(value: T, storeName = 'live2d'): Promise<boolean> {
  return new Promise((resolve) => {
    const db = getRuntimeConfig().Live2dDB;
    if (!db) {
      resolve(false);
      return;
    }

    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.add(value);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
  });
}

