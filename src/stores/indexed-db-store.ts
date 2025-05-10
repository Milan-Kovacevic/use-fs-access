type IDirectoryData = {
  handle: FileSystemDirectoryHandle;
};
type IDirectoryStoreOptions = {};
interface IDirectoryStore<
  TData extends IDirectoryData,
  TOptions extends IDirectoryStoreOptions
> {
  getDirectories: (options?: TOptions) => Promise<Map<string, TData>>;
  saveDirectory: (
    key?: string,
    value?: TData,
    options?: TOptions
  ) => Promise<void>;
  clearDirectories: (options?: TOptions) => Promise<void>;
  removeDirectory: (key: string, options?: TOptions) => Promise<void>;
}

export interface DirectoryStoreOptions extends IDirectoryStoreOptions {
  storeName?: string;
}

interface DirectoryStoreProps {
  dbName?: string;
  storeName?: string;
  dbVersion?: number;
}

const DEFAULT_DB_NAME = "default-db";
const DEFAULT_STORE_NAME = "default-filehandles-store";
const DEFAULT_DB_VERSION = 1;

export const indexedDBDirectoryStore = <
  TData extends IDirectoryData,
  TOptions extends DirectoryStoreOptions
>(
  props?: DirectoryStoreProps
): IDirectoryStore<TData, TOptions> => {
  const {
    dbName = DEFAULT_DB_NAME,
    dbVersion = DEFAULT_DB_VERSION,
    storeName: dbStoreName = props?.storeName ?? DEFAULT_STORE_NAME,
  } = props || {};

  function openDB(storeName: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, dbVersion);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveDirectory(
    key?: string,
    value?: TData,
    options?: TOptions
  ): Promise<void> {
    if (!value || !key) return;
    const { storeName = dbStoreName } = options || {};
    const db = await openDB(storeName);
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);

    store.put(value, key);
    tx.commit();
  }

  async function getDirectories(
    options?: TOptions
  ): Promise<Map<string, TData>> {
    const { storeName = dbStoreName } = options || {};
    const db = await openDB(storeName);
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);

    const result = new Map<string, TData>();

    return new Promise((resolve, reject) => {
      const request = store.openCursor();

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          result.set(cursor.key.toString(), cursor.value);
          cursor.continue();
        } else {
          resolve(result);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  async function clearDirectories(options?: TOptions): Promise<void> {
    const { storeName = dbStoreName } = options || {};

    const db = await openDB(storeName);
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.clear();
    tx.commit();
  }

  async function removeDirectory(
    key: string,
    options?: TOptions
  ): Promise<void> {
    const { storeName = dbStoreName } = options || {};

    const db = await openDB(storeName);
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.delete(key);
    tx.commit();
  }

  return {
    saveDirectory,
    getDirectories,
    clearDirectories,
    removeDirectory,
  };
};
