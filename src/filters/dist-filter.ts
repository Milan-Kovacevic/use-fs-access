export const distFilter: FileFilterFn = async () => {
  const isDist = (filePath: string) => {
    if (filePath.includes("/dist")) {
      return true;
    }
    if (filePath.includes("/out")) {
      return true;
    }
    if (filePath.includes("/build")) {
      return true;
    }
    if (filePath.includes("/vendor")) {
      return true;
    }
    if (filePath.includes("/node_modules")) {
      return true;
    }
    if (filePath.includes("/.next")) {
      return true;
    }
    return false;
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
