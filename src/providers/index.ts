import {
  indexedDBDirectoryStore,
  IndexedDBDirectoryStoreOptions,
} from "./indexed-db-provider";

export * from "./indexed-db-provider";

export const defaultDirectoryStore: IDirectoryStore<
  DirectoryData,
  IndexedDBDirectoryStoreOptions
> = indexedDBDirectoryStore();
