import { useCallback, useEffect, useRef, useState } from "react";
import { defaultFilters } from "../filters";
import {
  DirectoryInfo,
  FileFilterFn,
  FileInfo,
  FileOrDirectoryInfo,
  FileSystemFiles,
  IFileFilter,
} from "./types";

interface FileSystemAccessProps {
  filters?: FileFilterFn[];
  enableFileWatcher?: boolean;
  fileWatcherOptions?: FileWatcherOptions;

  onFilesAdded?: (newEntries: FileSystemFiles) => void;
  onFilesDeleted?: (deletedEntries: FileSystemFiles) => void;
  onFilesModified?: (modifiedFiles: Map<string, FileInfo>) => void;
}

export interface FileSystemAccessApi {
  files: FileSystemFiles;
  openDirectory: (
    directory: FileSystemDirectoryHandle,
    depth?: number
  ) => Promise<FileSystemFiles | undefined>;
  expandDirectory: (path: string) => Promise<FileSystemFiles | undefined>;
  openFile: (path: string) => Promise<FileInfo>;
  closeFile: (path: string) => Promise<FileInfo>;
  writeFile: (
    path: string,
    options?: WriteFileOptions,
    data?: string | Blob | ArrayBuffer
  ) => Promise<FileInfo>;
  createDirectory: (name: string, parentPath: string) => Promise<DirectoryInfo>;
  deleteFile: (path: string, recursive?: boolean) => Promise<void>;
  renameFile: (path: string, newName: string) => Promise<FileOrDirectoryInfo>;
  copyFile: (
    path: string,
    destination: string,
    replace?: boolean
  ) => Promise<void>;
}

export interface WriteFileOptions {
  create?: boolean;
  open?: boolean;
  keepData?: boolean;
}

export interface FileWatcherOptions {
  pollInterval?: number;
  cacheTime?: number;
  batchSize?: number;
  debug?: boolean;
}

const DEFAULT_OPEN_DIRECTORY_MODE = "readwrite";
const DEFAULT_FILTERS = defaultFilters;
const DEFAULT_POLL_INTERVAL = 1_000;
const DEFAULT_CACHE_TIME = 10_000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_LOAD_DEPTH = 2;

export const isApiSupported =
  window !== undefined && "showDirectoryPicker" in window;

export const showDirectoryPicker = async (
  options: DirectoryPickerOptions = {}
): Promise<FileSystemDirectoryHandle | undefined> => {
  if (!isApiSupported) return;

  const { mode = DEFAULT_OPEN_DIRECTORY_MODE } = options;
  try {
    return await window.showDirectoryPicker({ ...options, mode });
  } catch (err) {
    console.warn("Unable to open directory:", err);
  }
};

export const requestDirectoryPermission = async (
  handle: FileSystemDirectoryHandle,
  mode: FileSystemPermissionMode = DEFAULT_OPEN_DIRECTORY_MODE
) => {
  return (await handle.requestPermission({ mode: mode })) === "granted";
};

export default function useFileSystemAccess(
  props: FileSystemAccessProps = {}
): FileSystemAccessApi {
  const {
    filters: filterFns = props?.filters ?? DEFAULT_FILTERS,
    onFilesAdded: onAddFiles,
    onFilesDeleted: onDeleteFiles,
    onFilesModified: onChangeFiles,
  } = props;
  const enableFileWatcher = props.enableFileWatcher ?? false;
  const batchSize = props.fileWatcherOptions?.batchSize ?? DEFAULT_BATCH_SIZE;
  const cacheTime = props.fileWatcherOptions?.cacheTime ?? DEFAULT_CACHE_TIME;
  const pollInterval =
    props.fileWatcherOptions?.pollInterval ?? DEFAULT_POLL_INTERVAL;
  const debugFileWatcher = props.fileWatcherOptions?.debug ?? true;

  const pauseFileWatcherRef = useRef<boolean>(false);
  const rootHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const filtersRef = useRef<IFileFilter[]>([]);
  const ignoredPathsRef = useRef<Set<string>>(new Set());
  const filesRef = useRef<FileSystemFiles>(new Map());
  const previousFilesRef = useRef<FileSystemFiles>(new Map());

  const fileWatchRef = useRef<number | null>(null);
  const watchedDirectoriesRef = useRef<Map<string, DirectoryNode>>(new Map());
  const fileCacheRef = useRef<Map<string, FileCacheEntry>>(new Map());
  const [files, setFiles] = useState<FileSystemFiles>(new Map());

  const memoFiltersRef = useRef<IFileFilter[]>([]);
  const memoIgnoredPathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      unregisterFileWatcher();
      clearOpenedDirectory();
    };
  }, []);

  const initFileFilters = useCallback(async () => {
    const filterPromises: Promise<IFileFilter>[] = [];
    for (const filterFn of filterFns) {
      filterPromises.push(filterFn());
    }
    filtersRef.current = await Promise.all(filterPromises);
  }, [filterFns]);

  const clearOpenedDirectory = () => {
    if (!rootHandleRef.current) return;

    rootHandleRef.current = null;

    filesRef.current.clear();
    previousFilesRef.current.clear();
    watchedDirectoriesRef.current.clear();
    ignoredPathsRef.current.clear();
    filtersRef.current = [];
    fileCacheRef.current.clear();
  };

  const openDirectory = async (
    directory: FileSystemDirectoryHandle,
    depth: number = DEFAULT_LOAD_DEPTH
  ): Promise<FileSystemFiles | undefined> => {
    if (!isApiSupported) return;

    if ((await directory.requestPermission({ mode: "read" })) == "denied")
      return;

    try {
      clearOpenedDirectory();
      rootHandleRef.current = directory;
      const rootPath = directory.name;

      if (enableFileWatcher) await registerFileWatcher();
      await initFileFilters();
      return await expandFileTree(directory, rootPath, depth);
    } catch (err) {
      console.warn("Directory opening failed:", err);
    }
  };

  const expandDirectory = async (
    path: string
  ): Promise<FileSystemFiles | undefined> => {
    const dirInfo = filesRef.current.get(path);
    if (dirInfo && dirInfo.kind == "directory" && !dirInfo.loaded) {
      return await expandFileTree(dirInfo.handle, path);
    }
  };

  const openFile = async (path: string): Promise<FileInfo> => {
    if (!path || typeof path !== "string")
      throw new Error(`Invalid file path: ${path}`);

    return await toggleFileOpened(path, true);
  };

  const closeFile = async (path: string): Promise<FileInfo> => {
    if (!path || typeof path !== "string")
      throw new Error(`Invalid file path: ${path}`);

    return await toggleFileOpened(path, false);
  };

  const writeFile = async (
    path: string,
    options: WriteFileOptions = {},
    data?: string | Blob | ArrayBuffer
  ): Promise<FileInfo> => {
    // Validate path
    if (!path || typeof path !== "string" || isRootFilePath(path)) {
      throw new Error(`Invalid file path: ${path}`);
    }
    const parentDirInfo = ensureGetParentDirInfo(path);

    let name = path.substring(path.lastIndexOf("/") + 1);
    if (!name || name.length === 0)
      throw new Error(`Invalid file name: ${name}`);

    const { create = true, open, keepData = true } = options;
    if (create) {
      name = getFileEntryName(path);
      path = `${parentDirInfo.path}/${name}`;
    }

    if (!create && !filesRef.current.has(path))
      throw new Error(`File not found: ${path}`);

    try {
      const fileHandle = await parentDirInfo.handle.getFileHandle(name, {
        create: create,
      });

      let fileInfo: FileInfo;
      if (create) {
        const file = await fileHandle.getFile();
        fileInfo = {
          name: name,
          path: path,
          handle: fileHandle,
          kind: "file",
          opened: open ?? false,
          lastModified: file.lastModified,
          size: file.size,
          type: file.type,
          content: undefined,
        };
      } else {
        fileInfo = filesRef.current.get(path) as FileInfo;
        if (open && fileInfo.opened !== open) fileInfo.opened = open;
      }

      if (data != null) {
        const writable = await fileHandle.createWritable({
          keepExistingData: keepData,
        });
        try {
          await writable.write(data);
          await writable.close();

          const content =
            typeof data === "string" ? data : await new Response(data).text();

          fileInfo.content = content;

          const file = await fileHandle.getFile();
          fileInfo.lastModified = file.lastModified;
          fileInfo.size = file.size;
          fileInfo.type = file.type;
          fileInfo.content = content;

          if (fileCacheRef.current.has(fileInfo.path))
            fileCacheRef.current.set(fileInfo.path, {
              content: fileInfo.content,
              timestamp: Date.now(),
            });
        } catch (err) {
          await writable.abort();
          throw err;
        }
      }

      if (parentDirInfo.loaded) {
        filesRef.current.set(path, fileInfo);
        previousFilesRef.current.set(path, fileInfo);
        setFiles(new Map(filesRef.current));
      }

      return fileInfo;
    } catch (err) {
      throw new Error(`Unable to create file: ${err}`);
    }
  };

  const createDirectory = async (
    name: string,
    parentPath: string
  ): Promise<DirectoryInfo> => {
    name = getFileEntryName(`${parentPath}/${name}`);
    const dirPath = `${parentPath}/${name}`;
    const parentInfo = filesRef.current.get(parentPath);

    if (!parentInfo || parentInfo.kind !== "directory") {
      throw new Error(`Parent directory not found: ${dirPath}`);
    }

    try {
      const fileHandle = await parentInfo.handle.getDirectoryHandle(name, {
        create: true,
      });
      const dirInfo: DirectoryInfo = {
        name: name,
        path: dirPath,
        handle: fileHandle,
        kind: "directory",
        loaded: false,
      };

      if (parentInfo.loaded) {
        filesRef.current.set(dirPath, dirInfo);
        previousFilesRef.current.set(dirPath, dirInfo);

        setFiles(new Map(filesRef.current));
      }

      return dirInfo;
    } catch (err) {
      throw new Error(`Unable to create directory: ${err}`);
    }
  };

  const deleteFile = async (path: string, recursive: boolean = false) => {
    if (!path || typeof path !== "string") {
      throw new Error(`Invalid path: ${path}`);
    }

    const entryInfo = filesRef.current.get(path);
    if (!entryInfo) throw new Error(`File or directory not found: ${path}`);
    if (isRootFilePath(path))
      throw new Error(`Root directory can't be deleted: ${path}`);

    const isRecursive = entryInfo.kind === "directory" && recursive;

    pauseFileWatcherRef.current = true;
    try {
      const parentDirInfo = ensureGetParentDirInfo(path);
      await parentDirInfo.handle.removeEntry(entryInfo.name, {
        recursive: isRecursive,
      });

      filesRef.current.delete(entryInfo.path);
      previousFilesRef.current.delete(entryInfo.path);

      if (entryInfo.kind === "file" && entryInfo.opened)
        fileCacheRef.current.delete(entryInfo.path);

      if (entryInfo.kind === "directory" && entryInfo.loaded)
        watchedDirectoriesRef.current.delete(entryInfo.path);

      if (isRecursive) await deleteSubDirectories(path);

      setFiles(new Map(filesRef.current));
    } catch {
      throw new Error(`Unable to delete ${entryInfo.kind}: ${path}`);
    } finally {
      pauseFileWatcherRef.current = false;
    }
  };

  //#region RENAME FILE AND DIRECTORY
  const renameFile = async (
    path: string,
    newName: string
  ): Promise<FileOrDirectoryInfo> => {
    if (!path || !path.includes("/")) throw new Error(`Invalid path: ${path}`);
    if (!newName) throw new Error(`Invalid name: ${newName}`);

    const oldEntryInfo = filesRef.current.get(path);
    if (!oldEntryInfo) throw new Error(`File or directory not found: ${path}`);

    const parentDirInfo = ensureGetParentDirInfo(path);

    newName = getFileEntryName(`${parentDirInfo.path}/${newName}`);
    const newPath = `${parentDirInfo.path}/${newName}`;
    if (filesRef.current.has(newPath))
      throw new Error(
        `File or directory with this name already exists: ${newName}`
      );

    const isDirectory = oldEntryInfo.kind === "directory";
    pauseFileWatcherRef.current = true;
    try {
      if (!isDirectory)
        return await doRenameFile(
          oldEntryInfo,
          parentDirInfo,
          newName,
          newPath
        );

      return await doRenameDirectory(
        oldEntryInfo,
        parentDirInfo,
        newName,
        newPath
      );
    } catch {
      throw new Error(`Unable to rename entry: ${path}`);
    } finally {
      pauseFileWatcherRef.current = false;
    }
  };

  const doRenameFile = async (
    oldFileInfo: FileInfo,
    parentDir: DirectoryInfo,
    name: string,
    path: string
  ): Promise<FileInfo> => {
    const file = await oldFileInfo.handle.getFile();
    const content = await file.text();
    const newFileHandle = await parentDir.handle.getFileHandle(name, {
      create: true,
    });
    const writable = await newFileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    const deleteFile = oldFileInfo.name.toLowerCase() != name.toLowerCase();
    if (deleteFile) await parentDir.handle.removeEntry(oldFileInfo.name);

    const newFile = await newFileHandle.getFile();
    const newFileInfo: FileInfo = {
      handle: newFileHandle,
      name: newFile.name,
      lastModified: newFile.lastModified,
      size: newFile.size,
      type: newFile.type,
      kind: "file",
      path: path,
      content: content,
      opened: false,
    };

    if (parentDir.loaded) {
      filesRef.current.delete(oldFileInfo.path);
      previousFilesRef.current.delete(oldFileInfo.path);
      filesRef.current.set(newFileInfo.path, newFileInfo);
      previousFilesRef.current.set(newFileInfo.path, newFileInfo);
    }

    setFiles(new Map(filesRef.current));
    return newFileInfo;
  };

  const doRenameDirectory = async (
    oldDirInfo: DirectoryInfo,
    parentDir: DirectoryInfo,
    name: string,
    path: string
  ): Promise<DirectoryInfo> => {
    try {
      const newDirHandle = await parentDir.handle.getDirectoryHandle(name, {
        create: true,
      });

      filesRef.current.delete(oldDirInfo.path);
      if (oldDirInfo.loaded)
        watchedDirectoriesRef.current.delete(oldDirInfo.path);

      const newFilesMap: FileSystemFiles = new Map(filesRef.current);
      const newWatchedDirectories: Map<string, DirectoryNode> = new Map(
        watchedDirectoriesRef.current
      );

      const newDirInfo: DirectoryInfo = {
        handle: newDirHandle,
        name: newDirHandle.name,
        path: path,
        kind: "directory",
        loaded: oldDirInfo.loaded,
      };

      newFilesMap.set(newDirInfo.path, newDirInfo);
      if (newDirInfo.loaded)
        newWatchedDirectories.set(newDirInfo.path, { handle: newDirHandle });

      await updateDirectoryContents(
        oldDirInfo.handle,
        newDirHandle,
        newFilesMap,
        newWatchedDirectories,
        oldDirInfo.path,
        path
      );

      const deleteDir = oldDirInfo.name.toLowerCase() != name.toLowerCase();
      if (deleteDir) {
        await parentDir.handle.removeEntry(oldDirInfo.name, {
          recursive: true,
        });
      }

      filesRef.current = new Map(newFilesMap);
      previousFilesRef.current = new Map(newFilesMap);
      watchedDirectoriesRef.current = new Map(newWatchedDirectories);
      setFiles(new Map(filesRef.current));
      return newDirInfo;
    } catch {
      await parentDir.handle.removeEntry(name, {
        recursive: true,
      });
      throw new Error(`Unable to rename directory: ${path}`);
    }
  };
  //#endregion

  //#region COPY FILE AND DIRECTORY
  const copyFile = async (
    path: string,
    destination: string,
    replace: boolean = false
  ): Promise<void> => {
    if (!path || !path.includes("/")) throw new Error(`Invalid path: ${path}`);

    if (destination.startsWith(path))
      throw new Error(
        `Destination directory is the subdirectory of the source: ${path}`
      );

    const destDirInfo = filesRef.current.get(destination);
    if (!destDirInfo || destDirInfo.kind !== "directory")
      throw new Error(`Destination directory not found: ${path}`);

    const oldEntryInfo = filesRef.current.get(path);
    if (!oldEntryInfo)
      throw new Error(`Source file or directory not found: ${path}`);

    const fileName = oldEntryInfo.name;
    const newName = getFileEntryName(`${destDirInfo.path}/${fileName}`);

    const newPath = `${destDirInfo.path}/${newName}`;

    if (
      oldEntryInfo.kind === "directory" &&
      destDirInfo.path.startsWith(oldEntryInfo.path)
    )
      throw new Error(
        "The destination folder is a subdirectory of the source directory."
      );

    const destHandle = destDirInfo.handle;
    const isDirectory = oldEntryInfo.kind === "directory";
    const parentDirInfo = ensureGetParentDirInfo(path);
    const parentDirHandle = parentDirInfo.handle;
    pauseFileWatcherRef.current = true;
    try {
      // File entry
      if (!isDirectory) {
        return await doCopyFile(
          oldEntryInfo,
          destHandle,
          parentDirHandle,
          newName,
          newPath,
          replace
        );
      }

      // Directory entry
      await doCopyDirectory(
        oldEntryInfo,
        destHandle,
        parentDirHandle,
        newName,
        newPath,
        replace
      );
    } catch {
      throw new Error(`Unable to copy ${oldEntryInfo.kind} to ${destination}`);
    } finally {
      pauseFileWatcherRef.current = false;
    }
  };

  const doCopyFile = async (
    source: FileInfo,
    destination: FileSystemDirectoryHandle,
    parentDirHandle: FileSystemDirectoryHandle,
    newName: string,
    newPath: string,
    replace: boolean
  ) => {
    const file = await source.handle.getFile();
    const content = await file.text();
    const newFileHandle = await destination.getFileHandle(newName, {
      create: true,
    });
    const writable = await newFileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    const newFile = await newFileHandle.getFile();
    const newFileInfo: FileInfo = {
      handle: newFileHandle,
      name: newFile.name,
      lastModified: newFile.lastModified,
      size: newFile.size,
      type: newFile.type,
      kind: "file",
      path: newPath,
      content: content,
      opened: false,
    };

    if (replace) {
      await parentDirHandle.removeEntry(source.name);
      filesRef.current.delete(source.path);
      previousFilesRef.current.delete(source.path);
      if (source.opened) fileCacheRef.current.delete(source.path);
    }

    filesRef.current.set(newFileInfo.path, newFileInfo);
    previousFilesRef.current.set(newFileInfo.path, newFileInfo);

    setFiles(new Map(filesRef.current));
    return;
  };

  const doCopyDirectory = async (
    source: DirectoryInfo,
    destination: FileSystemDirectoryHandle,
    parentDirHandle: FileSystemDirectoryHandle,
    newName: string,
    newPath: string,
    replace: boolean
  ) => {
    const newFilesMap: FileSystemFiles = new Map(filesRef.current);
    const newWatchedDirectories: Map<string, DirectoryNode> = new Map(
      watchedDirectoriesRef.current
    );
    const newDirHandle = await destination.getDirectoryHandle(newName, {
      create: true,
    });

    const newDirInfo: DirectoryInfo = {
      handle: newDirHandle,
      name: newDirHandle.name,
      path: newPath,
      kind: "directory",
      loaded: source.loaded,
    };

    newFilesMap.set(newDirInfo.path, newDirInfo);
    if (newDirInfo.loaded)
      newWatchedDirectories.set(newDirInfo.path, { handle: newDirHandle });

    await updateDirectoryContents(
      source.handle,
      newDirHandle,
      newFilesMap,
      newWatchedDirectories,
      source.path,
      newPath,
      replace
    );

    if (replace) {
      await parentDirHandle.removeEntry(source.name, {
        recursive: true,
      });
      filesRef.current.delete(source.path);
      previousFilesRef.current.delete(source.path);
      if (source.loaded) watchedDirectoriesRef.current.delete(source.path);
    }

    filesRef.current = new Map(newFilesMap);
    previousFilesRef.current = new Map(newFilesMap);
    watchedDirectoriesRef.current = new Map(newWatchedDirectories);
    setFiles(new Map(filesRef.current));
  };
  //#endregion

  //#region Shared functions
  const expandFileTree = async (
    dirHandle: FileSystemDirectoryHandle,
    basePath: string,
    depth: number = 1
  ): Promise<FileSystemFiles> => {
    try {
      await loadDirectories(dirHandle, basePath, depth);
      await loadDirectoryNodes(dirHandle, basePath, depth);

      // Filter loaded files and directories
      const filterTasks: Promise<void>[] = [];
      for (const entry of filesRef.current) {
        filterTasks.push(
          (async ([path, info]) => {
            if (await ignoreFilePath(filtersRef.current, path, info.handle)) {
              filesRef.current.delete(path);
            }
          })(entry)
        );
      }
      await Promise.all(filterTasks);

      previousFilesRef.current = filesRef.current;
      setFiles(new Map(filesRef.current));
      return filesRef.current;
    } catch (err) {
      console.warn("Directory processing failed:", err);
      return new Map();
    }
  };

  const loadDirectories = async (
    dirHandle: FileSystemDirectoryHandle,
    dirPath: string,
    depth: number = 1
  ): Promise<void> => {
    if (await ignoreFilePath(filtersRef.current, dirPath, dirHandle)) {
      ignoredPathsRef.current.add(dirPath);
      return;
    }

    const isNode = depth > 1; // Check if its node or leaf...
    const prevEntry = filesRef.current.get(dirPath);
    const entry: DirectoryInfo = (prevEntry as DirectoryInfo | undefined) ?? {
      name: dirHandle.name,
      handle: dirHandle,
      kind: dirHandle.kind,
      path: dirPath,
      loaded: !isNode,
    };
    filesRef.current.set(dirPath, entry);

    const dirEntries: [string, FileSystemDirectoryHandle][] = [];
    const fileEntries: [string, FileSystemFileHandle][] = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind == "directory") dirEntries.push([name, handle]);
      else fileEntries.push([name, handle]);
    }

    // Process files first (parallelly)
    const fileTasks = fileEntries.map(async ([name, handle]) => {
      const fullPath = `${dirPath}/${name}`;

      if (await ignoreFilePath(filtersRef.current, fullPath, handle)) {
        ignoredPathsRef.current.add(fullPath);
        return;
      }

      const file = await handle.getFile();
      filesRef.current.set(fullPath, {
        name: file.name,
        handle: handle,
        path: fullPath,
        kind: "file",
        lastModified: file.lastModified,
        size: file.size,
        type: file.type,
        opened: false,
      });
    });

    await Promise.all(fileTasks);

    // Process directories after (parallelly)
    const dirTasks = dirEntries.map(async ([name, handle]) => {
      const fullPath = `${dirPath}/${name}`;

      if (isNode) {
        await loadDirectories(
          handle as FileSystemDirectoryHandle,
          fullPath,
          depth - 1
        );
      } else {
        if (await ignoreFilePath(filtersRef.current, fullPath, handle)) {
          ignoredPathsRef.current.add(fullPath);
          return;
        }

        // Unloaded directory
        filesRef.current.set(fullPath, {
          name: handle.name,
          handle: handle,
          path: fullPath,
          kind: "directory",
          loaded: false,
        });
      }
    });

    await Promise.all(dirTasks);

    // All children loaded, so mark this directory entry as loaded
    entry.loaded = true;
  };

  const loadDirectoryNodes = async (
    dirHandle: FileSystemDirectoryHandle,
    dirPath: string,
    depth: number = 1
  ): Promise<void> => {
    const isNode = depth > 1;

    // Get or create the DirectoryNode for the current dir
    const directoryNode: DirectoryNode = watchedDirectoriesRef.current.get(
      dirPath
    ) ?? {
      handle: dirHandle,
    };

    // Store the current directory node
    watchedDirectoriesRef.current.set(dirPath, directoryNode);

    // Collect directory entries
    const subDirs: [string, FileSystemDirectoryHandle][] = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === "directory") {
        subDirs.push([name, handle]);
      }
    }

    // Recursively load child directories
    const dirTasks = subDirs.map(async ([name, handle]) => {
      const fullPath = `${dirPath}/${name}`;
      if (isNode) {
        await loadDirectoryNodes(handle, fullPath, depth - 1);
      }
    });

    await Promise.all(dirTasks);
  };

  const toggleFileOpened = async (
    path: string,
    open: boolean
  ): Promise<FileInfo> => {
    const fileInfo = filesRef.current.get(path);
    if (!fileInfo) throw new Error(`File not found: ${path}`);
    if (fileInfo.kind != "file")
      throw new Error(`Entry is not a file: ${path}`);

    const fileHandle = fileInfo.handle;
    try {
      if (open) {
        const file = await fileHandle.getFile();
        fileInfo.content = await file.text();
        fileInfo.lastModified = file.lastModified;
        fileInfo.size = file.size;
        fileInfo.type = file.type;
        fileInfo.name = file.name;
        fileInfo.opened = true;
      } else {
        fileInfo.content = undefined;
        if (fileInfo.opened) {
          fileCacheRef.current.delete(fileInfo.path);
          fileInfo.opened = false;
        }
      }

      setFiles(new Map(filesRef.current));
    } catch {
      throw new Error(`Unable to ${open ? "open" : "close"} file: ${path}`);
    }

    return fileInfo;
  };

  const updateDirectoryContents = async (
    src: FileSystemDirectoryHandle,
    dest: FileSystemDirectoryHandle,
    filesMap: FileSystemFiles,
    watchedDirectories: Map<string, DirectoryNode>,
    oldBasePath: string,
    newBasePath: string,
    replace: boolean = true
  ): Promise<void> => {
    for await (const [name, handle] of src.entries()) {
      const oldPath = `${oldBasePath}/${name}`;
      const newPath = `${newBasePath}/${name}`;

      if (handle.kind === "file") {
        const file = await handle.getFile();
        const newFileHandle = await dest.getFileHandle(name, { create: true });
        const writable = await newFileHandle.createWritable();
        const content = await file.text();
        await writable.write(content);
        await writable.close();

        const oldFileInfo = filesMap.get(oldPath);
        if (!oldFileInfo || oldFileInfo.kind !== "file") continue;

        const newFileInfo: FileInfo = {
          name,
          path: newPath,
          kind: "file",
          handle: newFileHandle,
          size: file.size,
          lastModified: file.lastModified,
          type: file.type,
          opened: oldFileInfo.opened,
          content: oldFileInfo.opened ? content : undefined,
        };

        if (replace) {
          filesMap.delete(oldPath);
          fileCacheRef.current.delete(oldPath);
        }

        filesMap.set(newPath, newFileInfo);
      } else if (handle.kind === "directory") {
        const newDirHandle = await dest.getDirectoryHandle(name, {
          create: true,
        });

        const oldDirInfo = filesMap.get(oldPath);
        if (oldDirInfo != null && oldDirInfo.kind === "directory") {
          const newDirInfo: DirectoryInfo = {
            name,
            path: newPath,
            kind: "directory",
            handle: newDirHandle,
            loaded: oldDirInfo.loaded,
          };

          if (replace) {
            filesMap.delete(oldPath);
            filesMap.set(newPath, newDirInfo);
            if (oldDirInfo.loaded) watchedDirectories.delete(oldDirInfo.path);
          }

          if (oldDirInfo.loaded) {
            watchedDirectories.set(newPath, { handle: newDirHandle });
          }
        }

        await updateDirectoryContents(
          handle,
          newDirHandle,
          filesMap,
          watchedDirectories,
          oldPath,
          newPath
        );
      }
    }
  };

  const deleteSubDirectories = async (path: string) => {
    for (const [key, entry] of filesRef.current.entries()) {
      if (key !== path && !key.startsWith(path)) continue;

      if (entry.kind == "directory" && entry.loaded)
        watchedDirectoriesRef.current.delete(key);
      filesRef.current.delete(key);
      previousFilesRef.current.delete(key);
    }
  };

  const ensureGetParentDirInfo = (path: string) => {
    const parentPath = getParentFilePath(path);
    const parentDirInfo = filesRef.current.get(parentPath);
    if (!parentDirInfo || parentDirInfo.kind !== "directory")
      throw new Error(`Parent directory not found: ${parentPath}`);

    return parentDirInfo;
  };

  const getFileEntryName = (path: string): string => {
    const filesMap = filesRef.current;

    const parentPath = path.substring(0, path.lastIndexOf("/") + 1);
    const fileName = path.substring(path.lastIndexOf("/") + 1);

    let base: string = fileName;
    let ext: string = "";
    const lastDotIndex = fileName.lastIndexOf(".");
    if (lastDotIndex !== -1) {
      base = fileName.slice(0, lastDotIndex);
      ext = fileName.slice(lastDotIndex);
    }

    let counter = 1;
    let candidate = fileName;
    let currentPath = path;

    const existingPaths = new Set(
      Array.from(filesMap.keys()).map((k) => k.toLowerCase())
    );

    while (existingPaths.has(currentPath.toLowerCase())) {
      counter++;
      const newFileName = `${base} (${counter})${ext}`;
      candidate = `${newFileName}`;
      currentPath = `${parentPath}${newFileName}`;
    }

    return candidate;
  };

  const registerFileWatcher = async () => {
    if (fileWatchRef.current || !rootHandleRef.current) return;
    let processingTask: Promise<void> | null = null;

    fileWatchRef.current = window.setInterval(() => {
      if (processingTask || pauseFileWatcherRef.current == true) return;

      processingTask = (async () => {
        try {
          const entries = await filterWatchedDirectories();
          await processFilteredEntries(entries);
        } catch (err) {
          if (debugFileWatcher) console.log("DEBUG(ERROR)", err);
        } finally {
          processingTask = null;
        }
      })();
    }, pollInterval);

    if (debugFileWatcher) console.log("DEBUG: File Watcher registered");
  };

  const unregisterFileWatcher = () => {
    if (!fileWatchRef.current) return;
    clearInterval(fileWatchRef.current);
    memoFiltersRef.current = [];
    memoIgnoredPathsRef.current.clear();
  };

  //#endregion

  //#region File Watcher

  const processFileNode = useCallback(
    async (
      path: string,
      node: VirtualFileEntry,
      files: Map<string, FileInfo | DirectoryInfo>,
      timestamp: number,
      addedEntries: FileSystemFiles,
      modifiedEntries: Map<string, FileInfo>
    ) => {
      const prevEntry = previousFilesRef.current.get(path);
      const isNew = !prevEntry;

      if (node.kind === "directory") {
        const prevDir = prevEntry?.kind == "directory" ? prevEntry : undefined;
        const isLoaded = prevDir?.kind === "directory" ? prevDir.loaded : false;

        const dirInfo: DirectoryInfo = {
          name: node.handle.name,
          path,
          kind: "directory",
          handle: node.handle,
          loaded: isLoaded,
        };

        if (isNew) addedEntries.set(path, dirInfo);

        files.set(path, dirInfo);
        return;
      }

      // File handling
      const fileHandle = node.handle;
      const file = await fileHandle.getFile();
      const cached = fileCacheRef.current.get(path);
      const isCached = cached && timestamp - cached.timestamp < cacheTime;
      const prevFile = prevEntry?.kind === "file" ? prevEntry : undefined;
      const isModified =
        prevFile && prevFile.lastModified !== file.lastModified;
      const isOpened = prevFile != undefined && prevFile.opened;

      const baseFileInfo: Omit<
        FileInfo,
        "lastModified" | "size" | "type" | "content"
      > = {
        name: file.name,
        path: path,
        kind: "file",
        handle: fileHandle,
        opened: isOpened,
      };

      let content: string | undefined;

      if (isOpened) {
        if (!isCached || isModified) {
          content = await file.text();
          fileCacheRef.current.set(path, {
            content,
            timestamp: timestamp,
          });
        } else {
          content = cached.content;
        }
      }

      const fileInfo: FileInfo = {
        ...baseFileInfo,
        lastModified: file.lastModified,
        size: file.size,
        type: file.type,
        content,
        opened: isOpened,
      };

      if (isNew) addedEntries.set(path, fileInfo);

      if (prevFile != null && isModified) {
        modifiedEntries.set(path, fileInfo);
      }

      files.set(path, fileInfo);
    },
    [cacheTime]
  );

  const processFilteredEntries = useCallback(
    async (fileEntries: Map<string, VirtualFileEntry>) => {
      const addedEntries: FileSystemFiles = new Map();
      const deletedEntries: FileSystemFiles = new Map();
      const modifiedEntries: Map<string, FileInfo> = new Map();
      const timestamp = Date.now();
      const seenEntries = new Set<string>();
      const files = new Map<string, FileInfo | DirectoryInfo>();

      const filteredEntries = Array.from(fileEntries.entries());

      for (let i = 0; i < filteredEntries.length; i += batchSize) {
        const batch = filteredEntries.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async ([path, node]) => {
            seenEntries.add(path);
            return processFileNode(
              path,
              node,
              files,
              timestamp,
              addedEntries,
              modifiedEntries
            );
          })
        );
      }

      // Check for removed directories and files
      for (const [path, info] of previousFilesRef.current) {
        if (!seenEntries.has(path)) {
          if (info.kind === "directory") {
            deletedEntries.set(path, info);

            // Remove directory from watching
            const prefix = path.endsWith("/") ? path : path + "/";
            for (const key of watchedDirectoriesRef.current.keys()) {
              if (key === path || key.startsWith(prefix)) {
                watchedDirectoriesRef.current.delete(key);
              }
            }
          } else {
            deletedEntries.set(path, info);
          }
        }
      }

      const hasChanges =
        addedEntries.size > 0 ||
        deletedEntries.size > 0 ||
        modifiedEntries.size > 0;

      if (hasChanges) {
        if (addedEntries.size > 0) {
          onAddFiles?.(addedEntries);
          if (debugFileWatcher)
            console.log("DEBUG: Added entries", addedEntries);
        }
        if (deletedEntries.size > 0) {
          onDeleteFiles?.(deletedEntries);
          if (debugFileWatcher)
            console.log("DEBUG: Deleted entries", deletedEntries);
        }
        if (modifiedEntries.size > 0) {
          onChangeFiles?.(modifiedEntries);
          if (debugFileWatcher)
            console.log("DEBUG: Modified entries", modifiedEntries);
        }

        previousFilesRef.current = filesRef.current;
        filesRef.current = files;
        filtersRef.current = memoFiltersRef.current;
        ignoredPathsRef.current = memoIgnoredPathsRef.current;
        setFiles(new Map(files));
      }
    },
    [
      processFileNode,
      onAddFiles,
      onDeleteFiles,
      onChangeFiles,
      batchSize,
      debugFileWatcher,
    ]
  );

  const filterDirectory = useCallback(
    async (
      dirPath: string,
      dirNode: DirectoryNode,
      filters: IFileFilter[],
      filteredNodes: Map<string, VirtualFileEntry>,
      ignoredEntries: Set<string>
    ): Promise<void> => {
      if (ignoredEntries.has(dirPath)) return;
      if (await ignoreFilePath(filters, dirPath, dirNode.handle)) {
        ignoredEntries.add(dirPath);
        return;
      }

      const dirHandles: FileSystemDirectoryHandle[] = [];
      const fileHandles: FileSystemFileHandle[] = [];
      try {
        for await (const handle of dirNode.handle.values()) {
          if (handle.kind == "directory") dirHandles.push(handle);
          else fileHandles.push(handle);
        }
      } catch (err) {
        console.warn(`Error reading directory ${dirPath}:`, err);
        return;
      }

      if (fileHandles.length > 1000) {
        return;
      }

      const fileTasks: Promise<void>[] = [];
      for (const handle of fileHandles) {
        fileTasks.push(
          (async () => {
            const fullPath = `${dirPath}/${handle.name}`;

            if (ignoredEntries.has(fullPath)) return;
            if (await ignoreFilePath(filters, fullPath, handle)) {
              ignoredEntries.add(fullPath);
              return;
            }

            filteredNodes.set(fullPath, {
              handle: handle,
              kind: "file",
            });
          })()
        );
      }
      await Promise.all(fileTasks);

      const dirTasks: Promise<void>[] = [];
      for (const handle of dirHandles) {
        dirTasks.push(
          (async () => {
            const fullPath = `${dirPath}/${handle.name}`;

            if (ignoredEntries.has(fullPath)) return;
            if (await ignoreFilePath(filters, fullPath, handle)) {
              ignoredEntries.add(fullPath);
              return;
            }
            filteredNodes.set(fullPath, { handle: handle, kind: "directory" });
          })()
        );
      }
      await Promise.all(dirTasks);
    },
    []
  );

  const filterWatchedDirectories = useCallback(async () => {
    const rootHandle = rootHandleRef.current!;
    const rootPath = rootHandle.name;

    const filteredNodes = new Map<string, VirtualFileEntry>();
    filteredNodes.set(rootPath, {
      handle: rootHandle,
      kind: "directory",
    });
    const ignoredEntries: Set<string> = new Set();

    const filters: IFileFilter[] = [];
    for (const filterFn of filterFns) {
      filters.push(await filterFn());
    }

    for (const [dirPath, dirNode] of watchedDirectoriesRef.current.entries()) {
      await filterDirectory(
        dirPath,
        dirNode,
        filters,
        filteredNodes,
        ignoredEntries
      );
    }

    // Ignore the remaining files that weren't affected by the filters
    const filterTasks: Promise<void>[] = [];
    for (const [path, node] of filteredNodes.entries()) {
      filterTasks.push(
        (async () => {
          if (await ignoreFilePath(filters, path, node.handle)) {
            filteredNodes.delete(path);
            ignoredEntries.add(path);
          }
        })()
      );
    }
    await Promise.all(filterTasks);

    if (ignoredEntries.size > 0) {
      filtersRef.current = filters;
      ignoredPathsRef.current = ignoredEntries;
    }

    memoFiltersRef.current = filters;
    memoIgnoredPathsRef.current = ignoredEntries;

    return filteredNodes;
  }, [filterDirectory, filterFns]);

  //#endregion

  // Debounce the files state update
  const debouncedFiles = useDebounce(files, 50);

  return {
    files: debouncedFiles,
    openDirectory,
    expandDirectory,
    openFile,
    closeFile,
    writeFile,
    createDirectory,
    deleteFile,
    renameFile,
    copyFile,
  };
}

//#region Helper functions
const ignoreFilePath = async (
  filters: IFileFilter[],
  path: string,
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
) => {
  for (const filter of filters) {
    if ((await filter.ignore(path, handle)) === true) {
      return true;
    }
  }

  return false;
};

const isRootFilePath = (path: string) => {
  return !path.includes("/");
};
const getParentFilePath = (path: string) => {
  return path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : path;
};
const useDebounce = <T>(value: T, delay: number): T => {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};
//#endregion

//#region Types
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

//#endregion
