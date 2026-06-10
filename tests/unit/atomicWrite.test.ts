import { copyFileSync, renameSync, unlinkSync } from "fs";
import { atomicWriteFileSync } from "../../src/utils/atomicWrite.js";
import { secureWriteFileSync } from "../../src/utils/secureWrite.js";

jest.mock("fs");
jest.mock("../../src/utils/secureWrite.js");

const mockedRenameSync = renameSync as jest.MockedFunction<typeof renameSync>;
const mockedCopyFileSync = copyFileSync as jest.MockedFunction<typeof copyFileSync>;
const mockedUnlinkSync = unlinkSync as jest.MockedFunction<typeof unlinkSync>;
const mockedSecureWriteFileSync = secureWriteFileSync as jest.MockedFunction<typeof secureWriteFileSync>;

function fsError(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe("atomicWriteFileSync", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("should write target tmp file when no errors occur", () => {
    atomicWriteFileSync("/state/servers.json", "[]", { encoding: "utf-8" });

    expect(mockedSecureWriteFileSync).toHaveBeenCalledWith(
      "/state/servers.json.tmp",
      "[]",
      { encoding: "utf-8" },
    );
  });

  it("should rename tmp file to target when no errors occur", () => {
    atomicWriteFileSync("/state/servers.json", "[]", { encoding: "utf-8" });

    expect(mockedRenameSync).toHaveBeenCalledWith(
      "/state/servers.json.tmp",
      "/state/servers.json",
    );
  });

  it("should skip copy fallback when rename succeeds", () => {
    atomicWriteFileSync("/state/servers.json", "[]", { encoding: "utf-8" });

    expect(mockedCopyFileSync).not.toHaveBeenCalled();
  });

  it("should leave temp cleanup to rename when rename succeeds", () => {
    atomicWriteFileSync("/state/servers.json", "[]", { encoding: "utf-8" });

    expect(mockedUnlinkSync).not.toHaveBeenCalled();
  });

  it("should retry renameSync when EPERM is thrown transiently", () => {
    mockedRenameSync
      .mockImplementationOnce(() => {
        throw fsError("EPERM");
      })
      .mockImplementationOnce(() => undefined);

    atomicWriteFileSync("/state/audit-history.json", "[]", {
      attempts: 2,
      delayMs: 0,
    });

    expect(mockedRenameSync).toHaveBeenCalledTimes(2);
    expect(mockedCopyFileSync).not.toHaveBeenCalled();
    expect(mockedUnlinkSync).not.toHaveBeenCalled();
  });

  it("should fall back to copy and unlink when renameSync keeps throwing EACCES", () => {
    mockedRenameSync.mockImplementation(() => {
      throw fsError("EACCES");
    });

    atomicWriteFileSync("/state/fix-history.json", "[]", {
      attempts: 2,
      delayMs: 0,
    });

    expect(mockedRenameSync).toHaveBeenCalledTimes(2);
    expect(mockedCopyFileSync).toHaveBeenCalledWith(
      "/state/fix-history.json.tmp",
      "/state/fix-history.json",
    );
    expect(mockedUnlinkSync).toHaveBeenCalledWith("/state/fix-history.json.tmp");
  });

  it("should rethrow non-permission errors and clean up tmp file when rename fails", () => {
    mockedRenameSync.mockImplementation(() => {
      throw fsError("ENOSPC");
    });

    expect(() =>
      atomicWriteFileSync("/state/regression.json", "{}", {
        attempts: 2,
        delayMs: 0,
      }),
    ).toThrow("ENOSPC");

    expect(mockedCopyFileSync).not.toHaveBeenCalled();
    expect(mockedUnlinkSync).toHaveBeenCalledWith("/state/regression.json.tmp");
  });

  it("should rethrow fallback copy errors after tmp cleanup attempt", () => {
    mockedRenameSync.mockImplementation(() => {
      throw fsError("EPERM");
    });
    mockedCopyFileSync.mockImplementation(() => {
      throw fsError("EIO");
    });

    expect(() =>
      atomicWriteFileSync("/state/snapshot.json", "{}", {
        attempts: 1,
        delayMs: 0,
      }),
    ).toThrow("EIO");

    expect(mockedUnlinkSync).toHaveBeenCalledWith("/state/snapshot.json.tmp");
  });

  it("should pass encoding option through when non-utf8 encoding is given", () => {
    atomicWriteFileSync("/state/custom.txt", "cafe", { encoding: "latin1" });

    expect(mockedSecureWriteFileSync).toHaveBeenCalledWith(
      "/state/custom.txt.tmp",
      "cafe",
      { encoding: "latin1" },
    );
  });
});
