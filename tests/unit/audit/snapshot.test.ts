import * as fs from "fs";
import * as snapshotModule from "../../../src/core/audit/snapshot.js";

jest.mock("fs");

const mockedFs = fs as jest.Mocked<typeof fs>;

describe("loadSnapshot", () => {
  it("returns null for path-traversal filename", async () => {
    const result = await snapshotModule.loadSnapshot("192.168.1.1", "../../etc/passwd");
    expect(result).toBeNull();
  });
});