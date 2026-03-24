import { handle__NAME_PASCAL__ } from "../../mcp/tools/__NAME__.js";

// Mock the core dependency
// jest.mock("../../core/__NAME__.js");

describe("handle__NAME_PASCAL__", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns success response", async () => {
    const result = await handle__NAME_PASCAL__({
      server: "test-server",
      action: "TODO",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("success");
  });

  it("handles missing server gracefully", async () => {
    const result = await handle__NAME_PASCAL__({
      action: "TODO",
    });

    expect(result.content).toBeDefined();
  });

  it("returns error on failure", async () => {
    // TODO: mock core to reject, verify isError
  });
});
