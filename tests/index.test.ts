import { act, renderHook, waitFor } from "@testing-library/react";
import { useFileSystemAccess } from "../src";

describe("useFileSystemAccess - isSupported", () => {
  const originalShowDirectoryPicker = window.showDirectoryPicker;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterEach(() => {
    window.showDirectoryPicker = originalShowDirectoryPicker;
  });

  it("should detect unsupported browser", () => {
    delete (window as any).showDirectoryPicker;

    const { result } = renderHook(() => useFileSystemAccess());

    expect(result.current.isSupported).toBe(false);
  });
});

describe("useFileSystemAccess - openDirectory", () => {
  const originalShowDirectoryPicker = window.showDirectoryPicker;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterEach(() => {
    window.showDirectoryPicker = originalShowDirectoryPicker;
  });

  it("should call showDirectoryPicker and process files if supported", async () => {
    // ARRANGE
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
    window.showDirectoryPicker = jest.fn().mockResolvedValue(mockDirHandle);
    const { result } = renderHook(() =>
      useFileSystemAccess({ enableFileWatcher: false })
    );

    // ACT
    await act(async () => {
      await result.current.openDirectory({ save: false });
    });
    await waitFor(() => {
      expect(result.current.files.size).toBeGreaterThan(0);
    });

    // ASSERT
    const filePaths = Array.from(result.current.files?.keys() ?? []);
    expect(window.showDirectoryPicker).toHaveBeenCalled();
    expect(filePaths.length).toBe(2);
    expect(filePaths).toContain("mock-dir");
    expect(filePaths).toContain("mock-dir/test.txt");
  });

  it("should exit early if browser does not support", async () => {
    // ARRANGE
    delete (window as any).showDirectoryPicker;
    const { result } = renderHook(() =>
      useFileSystemAccess({ enableFileWatcher: false })
    );
    window.showDirectoryPicker = jest.fn();
    Object.defineProperty(result.current, "isSupported", {
      get: () => false,
    });

    // ACT
    await act(async () => {
      await result.current.openDirectory({ save: false, mode: "read" });
    });

    // ASSERT
    expect(window.showDirectoryPicker).not.toHaveBeenCalled();
    expect(result.current.files.size).toBe(0);
  });
});
