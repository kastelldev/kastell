import { listCommand } from "../../src/commands/list";
import * as config from "../../src/utils/config";

jest.mock("../../src/utils/config");

const mockedConfig = config as jest.Mocked<typeof config>;

describe("listCommand", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should show info message when no servers exist", async () => {
    mockedConfig.getServers.mockReturnValue([]);

    await listCommand();

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("No servers found");
    expect(output).toContain("kastell init");
  });

  it("should display server table when servers exist", async () => {
    mockedConfig.getServers.mockReturnValue([
      {
        id: "123",
        name: "coolify-test",
        provider: "hetzner",
        ip: "1.2.3.4",
        region: "nbg1",
        size: "cax11",
        createdAt: "2026-02-20T10:00:00Z",
        mode: "coolify" as const,
      },
    ]);

    await listCommand();

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("123");
    expect(output).toContain("coolify-test");
    expect(output).toContain("hetzner");
    expect(output).toContain("1.2.3.4");
    expect(output).toContain("nbg1");
    expect(output).toContain("2026-02-20");
    expect(output).toContain("Total: 1 server(s)");
  });

  it("should display multiple servers", async () => {
    mockedConfig.getServers.mockReturnValue([
      {
        id: "1",
        name: "srv-a",
        provider: "hetzner",
        ip: "1.1.1.1",
        region: "nbg1",
        size: "cax11",
        createdAt: "2026-01-01T00:00:00Z",
        mode: "coolify" as const,
      },
      {
        id: "2",
        name: "srv-b",
        provider: "digitalocean",
        ip: "2.2.2.2",
        region: "nyc1",
        size: "s-2vcpu-2gb",
        createdAt: "2026-02-01T00:00:00Z",
        mode: "coolify" as const,
      },
    ]);

    await listCommand();

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("srv-a");
    expect(output).toContain("srv-b");
    expect(output).toContain("Total: 2 server(s)");
  });

  it("should include Mode column header in list output", async () => {
    mockedConfig.getServers.mockReturnValue([
      {
        id: "123",
        name: "coolify-test",
        provider: "hetzner",
        ip: "1.2.3.4",
        region: "nbg1",
        size: "cax11",
        createdAt: "2026-02-20T10:00:00Z",
        mode: "coolify" as const,
      },
    ]);

    await listCommand();

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Mode");
  });

  it("should show bare mode in Mode column", async () => {
    mockedConfig.getServers.mockReturnValue([
      {
        id: "bare-1",
        name: "bare-server",
        provider: "hetzner",
        ip: "9.9.9.9",
        region: "nbg1",
        size: "cax11",
        createdAt: "2026-02-20T10:00:00Z",
        mode: "bare" as const,
      },
    ]);

    await listCommand();

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("bare");
  });

  it("should show coolify mode for legacy servers (no mode field)", async () => {
    mockedConfig.getServers.mockReturnValue([
      {
        id: "123",
        name: "legacy-server",
        provider: "hetzner",
        ip: "1.2.3.4",
        region: "nbg1",
        size: "cax11",
        createdAt: "2026-02-20T10:00:00Z",
        mode: "coolify" as const,
      },
    ]);

    await listCommand();

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("coolify");
  });

  it("should handle missing createdAt gracefully", async () => {
    mockedConfig.getServers.mockReturnValue([
      {
        id: "1",
        name: "srv",
        provider: "hetzner",
        ip: "1.1.1.1",
        region: "nbg1",
        size: "cax11",
        createdAt: "",
        mode: "coolify" as const,
      },
    ]);

    await listCommand();

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("N/A");
  });
});
