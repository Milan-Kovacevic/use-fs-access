import { FileFilterFn } from "src/core";

export const distFilter: FileFilterFn = async () => {
  const isDist = (filePath: string) => {
    return (
      filePath.includes("/dist") ||
      filePath.includes("/out") ||
      filePath.includes("/build") ||
      filePath.includes("/vendor") ||
      filePath.includes("/node_modules") ||
      filePath.includes("/.next")
    );
  };
  return {
    ignore: async (
      filePath: string,
      _: FileSystemFileHandle | FileSystemDirectoryHandle
    ) => {
      return isDist(filePath);
    },
  };
};
