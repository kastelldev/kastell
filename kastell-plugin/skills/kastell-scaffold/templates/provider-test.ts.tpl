import { __NAME_PASCAL__Provider } from "../../providers/__NAME__.js";

// Mock axios at module level
jest.mock("axios", () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  })),
}));

describe("__NAME_PASCAL__Provider", () => {
  let provider: __NAME_PASCAL__Provider;

  beforeEach(() => {
    jest.resetAllMocks();
    provider = new __NAME_PASCAL__Provider("test-token");
  });

  it("should create instance with correct base URL", () => {
    expect(provider).toBeDefined();
  });

  it("should list servers", async () => {
    // TODO: mock API response and verify
    await expect(provider.listServers()).resolves.toBeDefined();
  });

  it("should create server", async () => {
    // TODO: mock API response and verify
    const params = { name: "test", region: "us-east", size: "small" };
    await expect(provider.createServer(params)).resolves.toBeDefined();
  });
});
