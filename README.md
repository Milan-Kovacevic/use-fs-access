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
import {
  FileOrDirectoryInfo,
  isApiSupported,
  showDirectoryPicker,
} from "use-fs-access/core";

function FileSystemAccessDemo() {
  const {
    files,
    openDirectory,
    expandDirectory,
    openFile,
    closeFile,
    deleteFile,
    writeFile,
    createDirectory,
    renameFile,
    copyFile,
  } = useFileSystemAccess({
    filters: [
      // - gitIgnoreFilter, (apply .gitignore rules)
      // - gitFolderFilter, (excludes .git folder)
      // - distFilter       (excludes node_modules, dist, ...)
      // - defaultFilters,  (includes .git folder and .gitignore filters by default)
    ],
    enableFileWatcher: true,
    fileWatcherOptions: {
      debug: true,
      pollInterval: 250, // [ms]
      // batchSize: 50, [ms]
      // cacheTime: 5000, [ms]
    },
    // FILE WATCHER CALLBACKS
    onFilesAdded: (newFiles: Map<string, FileOrDirectoryInfo>) => {}, // - Track when new files are added
    onFilesDeleted: (deletedFiles: Map<string, FileOrDirectoryInfo>) => {}, // - Track when files are deleted
    onFilesModified: (modifiledFiles: Map<string, FileOrDirectoryInfo>) => {}, // - Track when files are modified
  });

  const welcomeMessage =
    "Hello from the File System Access API Demo!\nClick 'Open Directory' to select a folder and start exploring its contents\n\n" +
    "Click on a file to view it, or on a folder to expand its content.";
  const [fileContent, setFileContent] = useState(welcomeMessage);

  const fileTree: FileTreeNode = buildFileTree(files);

  return (
    <div
      style={{
        height: "100vh",
        overflow: "hidden",
        padding: "10px",
        boxSizing: "border-box",
      }}
    >
      <h1>File System Access API Demo</h1>
      <hr />
      {!isApiSupported ? (
        <p style={{ color: "red" }}>API not supported on this browser</p>
      ) : (
        <>
          <div>
            <button
              onClick={async () => {
                const dir = await showDirectoryPicker();
                await openDirectory(dir);
              }}
            >
              📂 Open Directory
            </button>
          </div>
          <div
            style={{
              display: "flex",
              height: "90%",
              gap: "20px",
            }}
          >
            {fileContent != undefined && (
              <textarea
                readOnly
                style={{
                  border: "0",
                  flex: "1",
                  width: "100%",
                  height: "100%",
                  marginTop: "20px",
                }}
                value={fileContent}
              />
            )}
            <hr dir="vertical" />
            <div
              style={{
                overflowY: "hidden",
                display: "flex",
                flexDirection: "column",
                flex: "1",
              }}
            >
              <h2>File Tree:</h2>
              {files.size === 0 ? (
                <i>No directory opened yet.</i>
              ) : (
                <div
                  style={{
                    overflowY: "auto",
                    flex: "1",
                    paddingBottom: "20px",
                  }}
                >
                  <FileTreeContent
                    node={fileTree}
                    depth={0}
                    onDelete={async (node) => {
                      await deleteFile(node.path, node.kind == "directory");
                    }}
                    expandDirectory={async (path) => {
                      await expandDirectory(path);
                    }}
                    onCloseFile={async (node) => {
                      await closeFile(node.path);
                      setFileContent(welcomeMessage);
                    }}
                    onOpenFile={async (node) => {
                      const f = await openFile(node.path);
                      setFileContent(f.content);
                    }}
                    onCreate={async (path, isDir) => {
                      if (isDir) await createDirectory("New Folder", path);
                      else await writeFile(path + "/New File");
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default FileSystemAccessDemo;

type FileTreeNode = FileOrDirectoryInfo & {
  children: FileTreeNode[];
};

const FileTreeContent = ({
  node,
  depth,
  onOpenFile,
  onCloseFile,
  expandDirectory,
  onDelete,
  onCreate,
}: {
  node: FileTreeNode;
  depth: number;
  onOpenFile: (node) => Promise<void>;
  onCloseFile: (node) => Promise<void>;
  expandDirectory: (path: string) => Promise<void>;
  onDelete: (node) => Promise<void>;
  onCreate: (path, isDir) => Promise<void>;
}) => {
  const [expanded, setExpanded] = useState(false);
  const isDir = node.kind === "directory";
  const indent = { paddingLeft: `${depth * 10}px` };

  return (
    <div key={node.path} style={indent}>
      <strong
        style={{ cursor: "pointer" }}
        onClick={async () => {
          if (isDir) {
            setExpanded((prev) => !prev);
            if (!expanded) await expandDirectory(node.path);
          } else if (!isDir) {
            await onOpenFile(node);
          }
        }}
      >
        {isDir ? "📁" : "📄"} {node.name} {!isDir && node.opened && "(opened)"}
        {isDir && !node.loaded && "(not-loaded)"}
      </strong>
      <span style={{ marginLeft: "5px" }}>
        <>
          (
          {!isDir && node.opened && (
            <button
              onClick={async () => {
                if (node.opened) {
                  await onCloseFile(node);
                }
              }}
            >
              close
            </button>
          )}
          {isDir && (
            <>
              <button
                style={{ marginLeft: "3px" }}
                onClick={async () => {
                  await onCreate(node.path, true);
                }}
              >
                +d
              </button>
              <button
                style={{ marginLeft: "3px" }}
                onClick={async () => {
                  await onCreate(node.path, false);
                }}
              >
                +f
              </button>
            </>
          )}
          <button
            style={{ marginLeft: "3px" }}
            onClick={async () => {
              if (
                confirm(
                  "Are you sure you want to delete?\nThis cannot be undone."
                )
              )
                await onDelete(node);
            }}
          >
            x
          </button>
          )
        </>
      </span>

      {expanded &&
        isDir &&
        node.children?.map((child) => (
          <FileTreeContent
            node={child}
            depth={depth + 1}
            onCloseFile={onCloseFile}
            onOpenFile={onOpenFile}
            onDelete={onDelete}
            expandDirectory={expandDirectory}
            onCreate={onCreate}
          />
        ))}
    </div>
  );
};

const buildFileTree = (
  map: Map<string, FileOrDirectoryInfo>
): FileTreeNode | null => {
  const pathToTreeNode = new Map<string, FileTreeNode>();

  for (const [path, info] of map.entries()) {
    pathToTreeNode.set(path, { ...info, children: [] });
  }

  let root: FileTreeNode | null = null;
  for (const [path, dirNode] of pathToTreeNode.entries()) {
    if (!path.includes("/")) {
      root = dirNode;
    } else {
      const parentPath = path.split("/").slice(0, -1).join("/");
      const parentNode = pathToTreeNode.get(parentPath);
      if (parentNode) {
        parentNode.children.push(dirNode);
      }
    }
  }
  return root;
};
```
