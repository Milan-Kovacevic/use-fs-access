import { FileOrDirectoryInfo } from "src/core";

export type FileTreeNode = FileOrDirectoryInfo & {
  children: FileTreeNode[];
};

const buildFileTree = (
  map: Map<string, FileOrDirectoryInfo>,
  sort: boolean = true
): FileTreeNode | null => {
  const pathToTreeNode = new Map<string, FileTreeNode>();
  let root: FileTreeNode | null = null;

  // Step 1: Build initial nodes
  for (const [path, info] of map.entries()) {
    pathToTreeNode.set(path, { ...info, children: [] });
  }

  // Step 2: Link children to their parents
  for (const [path, dirNode] of pathToTreeNode.entries()) {
    const pathSegments = path.split("/");
    if (pathSegments.length <= 1) {
      root = dirNode;
    } else {
      const parentPath = pathSegments.slice(0, -1).join("/");
      const parentNode = pathToTreeNode.get(parentPath);
      if (parentNode) parentNode.children.push(dirNode);
    }
  }

  if (sort && root) {
    sortFileTree(root);
  }

  return root;
};

const sortFileTree = (dirNode: FileTreeNode) => {
  dirNode.children.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.handle.name.localeCompare(b.handle.name);
  });
  for (const child of dirNode.children) {
    sortFileTree(child);
  }
};

export { buildFileTree };
