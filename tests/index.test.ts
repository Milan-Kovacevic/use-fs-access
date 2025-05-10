import { act, renderHook, waitFor } from "@testing-library/react";
import useFileSystemAccess from "../src";
import {
  isApiSupported,
  showDirectoryPicker as api_ShowDirectoryPicker,
} from "../src/core/use-fs-access";

describe("useFileSystemAccess - isApiSupported", () => {
  const originalShowDirectoryPicker = window.showDirectoryPicker;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterEach(() => {
    window.showDirectoryPicker = originalShowDirectoryPicker;
  });

  it("should detect unsupported browser", () => {
    delete (window as any).showDirectoryPicker;
    expect(isApiSupported).toBe(false);
  });
});

describe("useFileSystemAccess - showDirectoryPicker", () => {
  const originalShowDirectoryPicker = window.showDirectoryPicker;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterEach(() => {
    window.showDirectoryPicker = originalShowDirectoryPicker;
  });

  it("should call showDirectoryPicker and process files if supported", async () => {
    const fakeFile: File = new File(["hello"], "test.txt", {
      type: "text/plain",
      lastModified: 1234567890,
    });

    const mockFileHandle: FileSystemFileHandle = {
      kind: "file",
      name: "test.txt",
      getFile: jest.fn().mockResolvedValue(fakeFile),
    } as any;

    const mockDirHandle: FileSystemDirectoryHandle = {
      kind: "directory",
      name: "mock-dir",
      requestPermission: jest.fn().mockResolvedValue("granted"),
      entries: async function* () {
        yield ["test.txt", mockFileHandle];
      },
    } as any;

    (window as any).showDirectoryPicker = jest
      .fn()
      .mockResolvedValue(mockDirHandle);

    let api_ShowDirectoryPicker: any;

    jest.isolateModules(() => {
      api_ShowDirectoryPicker =
        require("../src/core/use-fs-access").showDirectoryPicker;
    });

    let handle: FileSystemDirectoryHandle | undefined;
    await act(async () => {
      handle = await api_ShowDirectoryPicker();
    });

    expect(window.showDirectoryPicker).toHaveBeenCalled();
    expect(handle).not.toBeNull();
    expect(handle?.name).toBe("mock-dir");
    expect(Array.of(handle?.entries()).length).toBe(1);
  });
});
