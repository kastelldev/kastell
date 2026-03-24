import { __NAME_CAMEL__Core } from "../../core/__NAME__.js";

jest.mock("../../utils/ssh.js");

describe("__NAME_CAMEL__Core", () => {
  beforeEach(() => jest.resetAllMocks());

  it("should TODO: describe expected behavior", async () => {
    const result = await __NAME_CAMEL__Core({ server: "test-server" });
    expect(result.success).toBe(true);
  });

  it("should handle missing server gracefully", async () => {
    const result = await __NAME_CAMEL__Core({});
    expect(result.success).toBe(false);
  });
});
