type FileOrDirectoryInfo = FileInfo | DirectoryInfo;

type FileInfo = {
  name: string;
  path: string;
  kind: "file";
  handle: FileSystemFileHandle;
  size: number;
  lastModified: number;
  type: string;
  content?: string;
  opened: boolean;
};

type DirectoryInfo = {
  name: string;
  path: string;
  kind: "directory";
  handle: FileSystemDirectoryHandle;
  loaded: boolean;
};

type FileFilter = {
  ignore: (
    path: string,
    handle: FileSystemFileHandle | FileSystemDirectoryHandle
  ) => Promise<boolean>;
};

type FileFilterFn = {
  (): Promise<FileFilter>;
};

type OpenDirectoryOptions = DirectoryPickerOptions & {
  save?: boolean;
  saveOptions?: DirectoryStoreOptions;
  directory?: FileSystemDirectoryHandle;
};

type WriteFileOptions = {
  create?: boolean;
  open?: boolean;
  keepData?: boolean;
};

type FileWatcherOptions = {
  pollInterval?: number;
  cacheTime?: number;
  batchSize?: number;
  debug?: boolean;
};

type DirectoryData = FileSystemDirectoryHandle;
type DirectoryStoreOptions = {};
type IDirectoryStore<
  TData extends DirectoryData,
  TOptions extends DirectoryStoreOptions
> = {
  getDirectories: (options?: TOptions) => Promise<Map<string, TData>>;
  saveDirectory: (
    key?: string,
    value?: TData,
    options?: TOptions
  ) => Promise<void>;
  clearDirectories: (options?: TOptions) => Promise<void>;
  removeDirectory: (key: string, options?: TOptions) => Promise<void>;
};

type FileEntryEventType =
  | "file-modified"
  | "file-added"
  | "file-removed"
  | "directory-added"
  | "directory-removed";

type DirectoryNode = {
  handle: FileSystemDirectoryHandle;
};

type VirtualFileEntry = VirtualDirectoryInfo | VirtualFileInfo;

type VirtualFileInfo = {
  kind: "file";
  handle: FileSystemFileHandle;
};

type VirtualDirectoryInfo = {
  kind: "directory";
  handle: FileSystemDirectoryHandle;
};

type FileCacheEntry = {
  content: string;
  timestamp: number;
};
