import { gitFolderFilter, gitIgnoreFilter } from "./git-filter";

export * from "./dist-filter";
export * from "./git-filter";

export const defaultFilters = [gitFolderFilter, gitIgnoreFilter];
