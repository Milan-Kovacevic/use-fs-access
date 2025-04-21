import ignore from "ignore";
import { FileFilterFn } from "src/core";

export const gitIgnoreFilter: FileFilterFn = async () => {
  const ig = ignore({
    allowRelativePaths: true,
  });

  let isGitIgnoreLoaded = false;

  return {
    ignore: async (
      path: string,
      handle: FileSystemFileHandle | FileSystemDirectoryHandle
    ) => {
      if (
        path.endsWith(".gitignore") &&
        !isGitIgnoreLoaded &&
        handle.kind === "file"
      ) {
        const file = await handle.getFile();
        const text = await file.text();

        ig.add(text);
        isGitIgnoreLoaded = true;
        return false;
      }

      if (
        handle.kind === "directory" &&
        (path.endsWith(".git") || path.endsWith(".git/"))
      ) {
        return true;
      }

      const { ignored } = ig.test(path);
      return ignored;
    },
  };
};

export const gitFolderFilter: FileFilterFn = async () => {
  return {
    ignore: async (
      path: string,
      handle: FileSystemFileHandle | FileSystemDirectoryHandle
    ) => {
      if (
        handle.kind === "directory" &&
        (path.endsWith(".git") || path.endsWith(".git/"))
      ) {
        return true;
      }

      return false;
    },
  };
};
