# use-fs-access

> 🗂️ React hook library that builds on top of the File System Access API, offering a clean and simple way to interact with the user's local file system from within a React application.

This hook enables React developers to easily open directories, read and write files, create or delete files and directories, and build powerful file-based workflows directly in the browser — all without leaving the comfort of React's ecosystem.

Additional advanced features include lazy-loading directory structures, file watching with a polling mechanism, and batch file processing. The library also supports persisting access to previously opened directories via built-in IndexedDB storage, and offers customizable file and directory filtering (with default filters for node_modules, .git, and dist). These features make it ideal for a variety of use cases, including file managers, code editors, offline-first applications, and any other app that requires seamless local file access.

> ⚠️ Please note that the **File System Access API** is **not supported in all browsers**. It is currently supported in modern Chromium-based browsers (e.g., Google Chrome, Microsoft Edge) and a few others. Be sure to check [the compatibility table](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API#browser_compatibility) for the most up-to-date information on supported browsers.

---

## 📦 Installation

```bash
npm install use-fs-access
# or
yarn add use-fs-access
```

## ✨ Features

- Open, expand, create, or delete directories
- Create, read, write, and delete files
- Watch files and directories (via polling)
- Lazy-load directory contents
- Save and access previously opened directories
- Filter files and directories
- Fully extensible filter and storage mechanism
- Built-in TypeScript support

---

## 🚀 Quick Start

Here's a full demo component showcasing how to use `use-fs-access` to open directories, view and modify files, and interact with the file system.

> ✅ Make sure the browser supports the File System Access API.

```tsx
import { useState } from "react";
import useFileSystemAccess from "use-fs-access";
import { FileOrDirectoryInfo } from "use-fs-access/core";
import { buildFileTree, FileTreeNode } from "use-fs-access/extensions";
import { defaultDirectoryStore } from "use-fs-access/stores";

function FileSystemAccessDemo() {
  const {
    isSupported,
    files,
    pending,
    openDirectory,
    expandDirectory,
    openFile,
    closeFile,
    createDirectory,
    writeFile,
    deleteFile,
    deleteDirectory,
    directoryAccessor,
  } = useFileSystemAccess({
    enableFileWatcher: true,
    fileWatcherOptions: {
      debug: true,
      pollInterval: 250, // [ms]
      // batchSize: 50, [ms]
      // cacheTime: 5000, [ms]
    },
    filters: [
      // - gitIgnoreFilter, (apply .gitignore rules)
      // - gitFolderFilter, (excludes .git folder)
      // - distFilter       (excludes node_modules, dist, ...)
      // - defaultFilters,  (includes all the above by default)
    ],
    store: defaultDirectoryStore, // - use IndexedDb to store recently opened directories by default
    // FILE WATCHER
    onFilesAdded: (newFiles: Map<string, FileOrDirectoryInfo>) => {}, // - Track when new files are added
    onFilesDeleted: (deletedFiles: Map<string, FileOrDirectoryInfo>) => {}, // - Track when files are deleted
    onFilesModified: (modifiledFiles: Map<string, FileOrDirectoryInfo>) => {}, // - Track when opened files are modified
  });

  const welcomeMessage =
    "Hello from the demo!\nClick 'Open Directory' to choose a folder to explore.\n\n" +
    "Click 'Open' button on a file to view its contents, or 'Expand' on a folder to load more files.";
  const [newFolderPath, setNewFolderPath] = useState("");
  const [newFilePath, setNewFilePath] = useState("");
  const [fileContent, setFileContent] = useState(welcomeMessage);

  const fileTree: FileTreeNode = buildFileTree(files);

  const renderFileTree = (node: FileTreeNode, depth = 0) => {
    const isDir = node.kind === "directory";
    const indent = { paddingLeft: `${depth * 20}px` };

    return (
      <div key={node.path} style={indent}>
        <strong>
          {isDir ? "📁" : "📄"} {node.name} {node.opened && "(opened)"}
        </strong>
        <span style={{ marginLeft: "20px" }}>
          {isDir ? (
            <>
              {!node.loaded && (
                <button onClick={async () => await expandDirectory(node.path)}>
                  Expand
                </button>
              )}

              <button
                onClick={async () => {
                  const yes = confirm(
                    "Are you sure you want to delete this directory?\nAll files and subdirectories will be permanently removed."
                  );
                  if (yes) await deleteDirectory(node.path);
                }}
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                onClick={async () => {
                  if (node.opened) {
                    await closeFile(node.path);
                    setFileContent(welcomeMessage);
                  } else {
                    const file = await openFile(node.path);
                    setFileContent(file.content);
                  }
                }}
              >
                {node.opened ? "Close" : "Open"}
              </button>
              <button
                onClick={async () => {
                  const yes = confirm(
                    "Delete this file?\nThis cannot be undone."
                  );
                  if (yes) await deleteFile(node.path);
                }}
              >
                Delete
              </button>
            </>
          )}
        </span>

        {isDir &&
          node.children &&
          node.children.map((child) => renderFileTree(child, depth + 1))}
      </div>
    );
  };

  return (
    <div>
      <h1>File System Access API Demo</h1>
      <hr />
      {!isSupported ? (
        <p style={{ color: "red" }}>API not supported on this browser</p>
      ) : (
        <>
          <div style={{ marginBottom: "20px" }}>
            <button
              onClick={async () => await openDirectory({ save: true })}
              disabled={pending}
            >
              📂 Open Directory
            </button>
          </div>

          <>
            <div style={{ marginBottom: "10px" }}>
              <input
                placeholder="New folder path (ex. /{path-from-root}/dir1 )"
                value={newFolderPath}
                onChange={(e) => setNewFolderPath(e.target.value)}
                style={{ width: "300px", marginRight: "5px" }}
              />
              <button
                onClick={async () => {
                  if (newFolderPath) {
                    const name = newFolderPath.substring(
                      newFolderPath.lastIndexOf("/") + 1
                    );
                    const parentPath = newFolderPath.substring(
                      0,
                      newFolderPath.indexOf("/")
                    );
                    await createDirectory(name, parentPath);
                    setNewFolderPath("");
                  }
                }}
              >
                ➕ Create New Folder
              </button>
            </div>

            <div style={{ marginBottom: "10px" }}>
              <input
                placeholder="New file path (ex. /root/file.txt )"
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
                style={{ width: "300px", marginRight: "5px" }}
              />
              <button
                onClick={async () => {
                  if (newFilePath) {
                    await writeFile(newFilePath);
                    setNewFilePath("");
                  }
                }}
              >
                💾 Create New File
              </button>
            </div>
          </>

          <div style={{ marginTop: "20px" }}>
            <h2>File Tree:</h2>
            {files.size === 0 ? (
              <i>No directory opened yet.</i>
            ) : (
              <div>{renderFileTree(fileTree)}</div>
            )}
          </div>
          <hr />
          <div>
            {fileContent != undefined && (
              <textarea
                readOnly
                style={{ minWidth: "500px", minHeight: "300px" }}
                value={fileContent}
              ></textarea>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```
