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

type IFileFilter = {
  ignore: (
    path: string,
    handle: FileSystemFileHandle | FileSystemDirectoryHandle
  ) => Promise<boolean>;
};

type FileFilterFn = {
  (): Promise<IFileFilter>;
};

interface IDirectoryData extends FileSystemDirectoryHandle {}
interface IDirectoryStoreOptions {}
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

type FileTreeNode = FileOrDirectoryInfo & {
  children: FileTreeNode[];
};

export type {
  FileOrDirectoryInfo,
  FileInfo,
  DirectoryInfo,
  IFileFilter,
  FileFilterFn,
  IDirectoryData,
  IDirectoryStoreOptions,
  IDirectoryStore,
  FileTreeNode,
};
