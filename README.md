# use-fs-access

> 🗂️ React hook library that builds on top of the File System Access API, offering a clean and simple way to interact with the user's local file system from within a React application.

This hook enables React developers to easily open directories, read and write files, create or delete files and directories, and build powerful file-based workflows directly in the browser — all without leaving the comfort of React's ecosystem.

Additional advanced features include lazy-loading directory structures, file watching with a polling mechanism, and batch file processing. The library also supports persisting access to previously opened directories via built-in IndexedDB storage, and offers customizable file and directory filtering (with default filters for node_modules, .git, and dist). These features make it ideal for a variety of use cases, including file managers, code editors, offline-first applications, and any other app that requires seamless local file access.

> ⚠️ Please note that the **File System Access API** is **not supported in all browsers**. It is currently supported in modern Chromium-based browsers (e.g., Google Chrome, Microsoft Edge) and a few others. Be sure to check [the compatibility table](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API#browser_compatibility) for the most up-to-date information on supported browsers.

---

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

## 📦 Installation

```bash
npm install use-fs-access
# or
yarn add use-fs-access
