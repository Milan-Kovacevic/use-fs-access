import { useCallback, useEffect, useRef, useState } from "react";
import { defaultFilters } from "../filters";
import { defaultDirectoryStore } from "../stores";
import {
  DirectoryInfo,
  FileFilterFn,
  FileInfo,
  FileOrDirectoryInfo,
  IDirectoryData,
  IDirectoryStore,
  IDirectoryStoreOptions,
  IFileFilter,
} from "./types";

interface FileSystemAccessProps {
  filters?: FileFilterFn[];
  store?: IDirectoryStore<IDirectoryData, IDirectoryStoreOptions>;
  enableFileWatcher?: boolean;
  fileWatcherOptions?: FileWatcherOptions;

  onFilesAdded?: (newEntries: Map<string, FileOrDirectoryInfo>) => void;
  onFilesDeleted?: (deletedEntries: Map<string, FileOrDirectoryInfo>) => void;
  onFilesModified?: (modifiedFiles: Map<string, FileInfo>) => void;
}

interface OpenDirectoryOptions extends DirectoryPickerOptions {
  save?: boolean;
  saveOptions?: IDirectoryStoreOptions;
  directory?: FileSystemDirectoryHandle;
}

interface WriteFileOptions {
  create?: boolean;
  open?: boolean;
  keepData?: boolean;
}

interface FileWatcherOptions {
  pollInterval?: number;
  cacheTime?: number;
  batchSize?: number;
  debug?: boolean;
}

const DEFAULT_OPEN_DIRECTORY_MODE = "readwrite";
const DEFAULT_DIRECTORY_STORE = defaultDirectoryStore;
const DEFAULT_FILTERS = defaultFilters;
const DEFAULT_POLL_INTERVAL = 1_000;
const DEFAULT_CACHE_TIME = 10_000;
const DEFAULT_BATCH_SIZE = 50;

export default function useFileSystemAccess(props: FileSystemAccessProps = {}) {
  const {
    store = DEFAULT_DIRECTORY_STORE,
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

  const isSupported = window !== undefined && "showDirectoryPicker" in window;

  const rootHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const filtersRef = useRef<IFileFilter[]>([]);
  const ignoredPathsRef = useRef<Set<string>>(new Set());
  const filesRef = useRef<Map<string, FileOrDirectoryInfo>>(new Map());
  const previousFilesRef = useRef<Map<string, FileOrDirectoryInfo>>(new Map());

  const fileWatchRef = useRef<number | null>(null);
  const watchedDirectoriesRef = useRef<Map<string, DirectoryNode>>(new Map());
  const fileCacheRef = useRef<Map<string, FileCacheEntry>>(new Map());

  const [pending, setPending] = useState(false);
  const [files, setFiles] = useState<Map<string, FileOrDirectoryInfo>>(
    new Map()
  );

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

  const openDirectory = async (options: OpenDirectoryOptions = {}) => {
    if (!isSupported) return;

    const {
      mode = DEFAULT_OPEN_DIRECTORY_MODE,
      saveOptions,
      save = true,
      directory,
    } = options;

    try {
      setPending(true);
      const dirHandle =
        directory ?? (await window.showDirectoryPicker({ ...options, mode }));

      const state = await dirHandle.requestPermission({ mode: mode });
      if (state == "denied") return;

      clearOpenedDirectory();
      rootHandleRef.current = dirHandle;
      const rootPath = dirHandle.name;

      if (enableFileWatcher) await registerFileWatcher();
      await initFileFilters();
      await expandFileTree(dirHandle, rootPath, 2);
      if (save) {
        await store.saveDirectory(dirHandle.name, dirHandle, saveOptions);
      }
    } catch (err) {
      console.warn("Directory opening failed:", err);
    } finally {
      setPending(false);
    }
  };

  const expandDirectory = async (path: string): Promise<void> => {
    const dirInfo = filesRef.current.get(path);
    if (dirInfo && dirInfo.kind == "directory" && !dirInfo.loaded)
      await expandFileTree(dirInfo.handle, path);
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

  const getSavedDirectories = async (
    providerOptions?: IDirectoryStoreOptions
  ): Promise<Map<string, FileSystemDirectoryHandle>> => {
    return await store.getDirectories(providerOptions);
  };

  const clearSavedDirectories = async (
    providerOptions?: IDirectoryStoreOptions
  ) => {
    await store.clearDirectories(providerOptions);
  };

  const removeSavedDirectory = async (
    directoryName: string,
    providerOptions?: IDirectoryStoreOptions
  ) => {
    await store.removeDirectory(directoryName, providerOptions);
  };

  const writeFile = async (
    path: string,
    options: WriteFileOptions = {},
    data?: string | Blob | ArrayBuffer
  ) => {
    // Validate path
    if (!path || typeof path !== "string" || isRootFilePath(path)) {
      throw new Error(`Invalid file path: ${path}`);
    }

    const name = path.substring(path.lastIndexOf("/") + 1);
    const dirPath = getParentFilePath(path);

    if (!name || name.length === 0)
      throw new Error(`Invalid file name: ${name}`);

    const parentDirInfo = filesRef.current.get(dirPath);
    if (!parentDirInfo || parentDirInfo.kind !== "directory")
      throw new Error(`Parent directory not found: ${dirPath}`);

    const { create = true, open, keepData = true } = options;
    if (create && filesRef.current.has(path))
      throw new Error(`File already exists: ${path}`);
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

      if (data != undefined) {
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

  const deleteFile = async (path: string) => {
    if (!path || typeof path !== "string") {
      throw new Error(`Invalid file path: ${path}`);
    }

    const fileInfo = filesRef.current.get(path);
    if (!fileInfo || fileInfo.kind !== "file") {
      throw new Error(`File not found: ${path}`);
    }

    const parentPath = getParentFilePath(path);
    const parentDir = filesRef.current.get(parentPath);

    if (!parentDir || parentDir.kind !== "directory") {
      throw new Error(`Parent directory not found: ${parentPath}`);
    }

    try {
      await parentDir.handle.removeEntry(fileInfo.name);

      filesRef.current.delete(fileInfo.path);
      previousFilesRef.current.delete(fileInfo.path);
      if (fileInfo.opened) fileCacheRef.current.delete(fileInfo.path);

      setFiles(new Map(filesRef.current));
    } catch (err) {
      console.error(err);
      throw new Error(`Unable to delete file: ${path}`);
    }
  };

  // Delete a directory (recursive by default)
  const deleteDirectory = async (path: string, recursive: boolean = true) => {
    if (!path || typeof path !== "string")
      throw new Error(`Invalid file path: ${path}`);

    const dirInfo = filesRef.current.get(path);

    if (!dirInfo || dirInfo.kind !== "directory")
      throw new Error(`Directory not found: ${path}`);

    if (isRootFilePath(path))
      throw new Error(`Root directory can't be deleted: ${path}`);

    const parentPath = getParentFilePath(path);

    const parentEntry = filesRef.current.get(parentPath);

    if (!parentEntry || parentEntry.kind != "directory")
      throw new Error(`Parent directory not found: ${parentPath}`);

    const entriesToDelete: {
      isFile: boolean;
      path: string;
      name: string;
      parentHandle: FileSystemDirectoryHandle;
    }[] = [];
    try {
      // Delete all subdirectories
      if (recursive) {
        await deleteSubDirectories(
          dirInfo.handle,
          entriesToDelete,
          dirInfo.path
        );
        for (const entry of entriesToDelete) {
          await entry.parentHandle.removeEntry(entry.name);
          filesRef.current.delete(entry.path);
          previousFilesRef.current.delete(entry.path);
          if (!entry.isFile) watchedDirectoriesRef.current.delete(entry.path);
        }
      }

      // Delete directory
      await parentEntry.handle.removeEntry(dirInfo.name);
      filesRef.current.delete(dirInfo.path);
      previousFilesRef.current.delete(dirInfo.path);
      if (dirInfo.loaded) watchedDirectoriesRef.current.delete(dirInfo.path);

      setFiles(new Map(filesRef.current));
    } catch {
      throw new Error(`Unable to delete directory: ${path}`);
    }
  };

  //#region Shared functions
  const expandFileTree = async (
    dirHandle: FileSystemDirectoryHandle,
    basePath: string,
    depth: number = 1
  ): Promise<void> => {
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
    } catch (err) {
      console.warn("Directory processing failed:", err);
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

  const deleteSubDirectories = async (
    dirHandle: FileSystemDirectoryHandle,
    entriesToDelete: {
      isFile: boolean;
      path: string;
      name: string;
      parentHandle: FileSystemDirectoryHandle;
    }[],
    path: string
  ) => {
    for await (const [name, handle] of dirHandle.entries()) {
      const fullPath = path ? `${path}/${name}` : name;

      if (handle.kind === "directory") {
        // Recursively collect inner entries
        await deleteSubDirectories(handle, entriesToDelete, fullPath);

        entriesToDelete.push({
          isFile: false,
          path: fullPath,
          name,
          parentHandle: dirHandle,
        });
      } else {
        entriesToDelete.push({
          isFile: true,
          path: fullPath,
          name,
          parentHandle: dirHandle,
        });
      }
    }
  };

  const registerFileWatcher = async () => {
    if (fileWatchRef.current || !rootHandleRef.current) return;
    let processingTask: Promise<void> | null = null;

    fileWatchRef.current = window.setInterval(() => {
      if (processingTask) return;

      processingTask = (async () => {
        try {
          const entries = await filterWatchedDirectories();
          await processFilteredEntries(entries);
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
      addedEntries: Map<string, FileOrDirectoryInfo>,
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

      // Check for content modifications only if file is opened
      if (isModified && isOpened) {
        modifiedEntries.set(path, fileInfo);
      }

      files.set(path, fileInfo);
    },
    [cacheTime]
  );

  const processFilteredEntries = useCallback(
    async (fileEntries: Map<string, VirtualFileEntry>) => {
      const addedEntries: Map<string, FileOrDirectoryInfo> = new Map();
      const deletedEntries: Map<string, FileOrDirectoryInfo> = new Map();
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

    const dirTasks: Promise<void>[] = [];
    for (const [dirPath, dirNode] of watchedDirectoriesRef.current.entries()) {
      await filterDirectory(
        dirPath,
        dirNode,
        filters,
        filteredNodes,
        ignoredEntries
      );
    }
    await Promise.all(dirTasks);

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
    isSupported,
    files: debouncedFiles,
    pending,
    openDirectory,
    expandDirectory,
    openFile,
    closeFile,
    writeFile,
    createDirectory,
    deleteFile,
    deleteDirectory,
    directoryAccessor: {
      getSavedDirectories,
      clearSavedDirectories,
      removeSavedDirectory,
    },
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
