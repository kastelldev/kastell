import { execFile } from "child_process";
import { isValidBrowserUrl, canOpenBrowser, openBrowser } from "../../src/utils/openBrowser";

jest.mock("child_process", () => ({
  execFile: jest.fn((_bin: string, _args: string[], _opts: object, _cb: () => void) => {}),
}));

const mockedExecFile = execFile as unknown as jest.MockedFunction<typeof execFile>;

describe("openBrowser", () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  describe("isValidBrowserUrl", () => {
    it("should accept http://1.2.3.4:8000", () => {
      expect(isValidBrowserUrl("http://1.2.3.4:8000")).toBe(true);
    });

    it("should accept http://10.0.0.1:8000/", () => {
      expect(isValidBrowserUrl("http://10.0.0.1:8000/")).toBe(true);
    });

    it("should accept https://1.2.3.4:443", () => {
      expect(isValidBrowserUrl("https://1.2.3.4:443")).toBe(true);
    });

    it("should accept http://1.2.3.4", () => {
      expect(isValidBrowserUrl("http://1.2.3.4")).toBe(true);
    });

    it("should reject javascript: URLs", () => {
      expect(isValidBrowserUrl("javascript:alert(1)")).toBe(false);
    });

    it("should reject file: URLs", () => {
      expect(isValidBrowserUrl("file:///etc/passwd")).toBe(false);
    });

    it("should reject URLs with domain names", () => {
      expect(isValidBrowserUrl("http://example.com")).toBe(false);
    });

    it("should reject empty string", () => {
      expect(isValidBrowserUrl("")).toBe(false);
    });

    it("should reject http://0.0.0.0:8000 (unassigned IP)", () => {
      expect(isValidBrowserUrl("http://0.0.0.0:8000")).toBe(false);
    });

    it("should reject http://0.0.0.0 (unassigned IP without port)", () => {
      expect(isValidBrowserUrl("http://0.0.0.0")).toBe(false);
    });

    it("should reject URLs with query params", () => {
      expect(isValidBrowserUrl("http://1.2.3.4:8000?cmd=ls")).toBe(false);
    });
  });

  describe("canOpenBrowser", () => {
    it("should return false in CI environment", () => {
      process.env.CI = "true";
      expect(canOpenBrowser()).toBe(false);
    });

    it("should return false in GitHub Actions", () => {
      delete process.env.CI;
      process.env.GITHUB_ACTIONS = "true";
      expect(canOpenBrowser()).toBe(false);
    });

    it("should return false in Docker container", () => {
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      process.env.DOCKER_CONTAINER = "true";
      expect(canOpenBrowser()).toBe(false);
    });

    it("should return false in SSH session", () => {
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      delete process.env.DOCKER_CONTAINER;
      process.env.SSH_CONNECTION = "1.2.3.4 22";
      expect(canOpenBrowser()).toBe(false);
    });

    it("should return false on Linux without DISPLAY", () => {
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      delete process.env.DOCKER_CONTAINER;
      delete process.env.SSH_CONNECTION;
      delete process.env.SSH_TTY;
      delete process.env.container;
      delete process.env.DISPLAY;
      delete process.env.WAYLAND_DISPLAY;
      Object.defineProperty(process, "platform", { value: "linux" });
      expect(canOpenBrowser()).toBe(false);
    });

    it("should return true on macOS", () => {
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      delete process.env.DOCKER_CONTAINER;
      delete process.env.SSH_CONNECTION;
      delete process.env.SSH_TTY;
      delete process.env.container;
      Object.defineProperty(process, "platform", { value: "darwin" });
      expect(canOpenBrowser()).toBe(true);
    });

    it("should return true on Windows", () => {
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      delete process.env.DOCKER_CONTAINER;
      delete process.env.SSH_CONNECTION;
      delete process.env.SSH_TTY;
      delete process.env.container;
      Object.defineProperty(process, "platform", { value: "win32" });
      expect(canOpenBrowser()).toBe(true);
    });

    it("should return false on unknown platform", () => {
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      delete process.env.DOCKER_CONTAINER;
      delete process.env.SSH_CONNECTION;
      delete process.env.SSH_TTY;
      delete process.env.container;
      Object.defineProperty(process, "platform", { value: "freebsd" });
      expect(canOpenBrowser()).toBe(false);
    });
  });

  describe("openBrowser", () => {
    it("should not exec for invalid URL", () => {
      openBrowser("javascript:alert(1)");
      expect(mockedExecFile).not.toHaveBeenCalled();
    });

    it("should not exec in headless environment", () => {
      process.env.CI = "true";
      openBrowser("http://1.2.3.4:8000");
      expect(mockedExecFile).not.toHaveBeenCalled();
    });

    it("should execFile open command on macOS", () => {
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      delete process.env.DOCKER_CONTAINER;
      delete process.env.SSH_CONNECTION;
      delete process.env.SSH_TTY;
      delete process.env.container;
      Object.defineProperty(process, "platform", { value: "darwin" });

      openBrowser("http://1.2.3.4:8000");
      expect(mockedExecFile).toHaveBeenCalledWith(
        "open",
        ["http://1.2.3.4:8000"],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("should execFile cmd on Windows", () => {
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      delete process.env.DOCKER_CONTAINER;
      delete process.env.SSH_CONNECTION;
      delete process.env.SSH_TTY;
      delete process.env.container;
      Object.defineProperty(process, "platform", { value: "win32" });

      openBrowser("http://1.2.3.4:8000");
      expect(mockedExecFile).toHaveBeenCalledWith(
        "cmd",
        ["/c", "start", "", "http://1.2.3.4:8000"],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("should execFile xdg-open on Linux with DISPLAY", () => {
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      delete process.env.DOCKER_CONTAINER;
      delete process.env.SSH_CONNECTION;
      delete process.env.SSH_TTY;
      delete process.env.container;
      process.env.DISPLAY = ":0";
      Object.defineProperty(process, "platform", { value: "linux" });

      openBrowser("http://1.2.3.4:8000");
      expect(mockedExecFile).toHaveBeenCalledWith(
        "xdg-open",
        ["http://1.2.3.4:8000"],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });
});
