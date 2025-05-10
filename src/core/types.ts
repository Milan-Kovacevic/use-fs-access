type FileSystemFiles = Map<string, FileOrDirectoryInfo>;

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

export {
  FileSystemFiles,
  FileOrDirectoryInfo,
  FileInfo,
  DirectoryInfo,
  IFileFilter,
  FileFilterFn,
};
