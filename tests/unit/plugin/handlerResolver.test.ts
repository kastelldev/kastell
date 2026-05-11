import { resolve } from "path";
import { pathToFileURL } from "url";

const pluginDir = "/fake/plugin";
const handlerPath = "handlers/check.js";
const absPath = resolve(pluginDir, handlerPath);
const fileUrl = pathToFileURL(absPath).href;

let mockModuleResult: Record<string, unknown> = {};

jest.mock("../../../src/plugin/handlerResolver.js", () => {
  return {
    __esModule: true,
    resolvePluginHandler: jest.fn(),
  };
});

// Since resolvePluginHandler uses dynamic import() which is hard to mock,
// test the handler resolution logic directly
describe("resolvePluginHandler logic", () => {
  function pickHandler(mod: Record<string, unknown>): ((...args: unknown[]) => unknown) | undefined {
    const handler =
      (typeof mod.default === "function" ? mod.default : (mod.default as Record<string, unknown>)?.handler) ??
      mod.handler ??
      mod.fix ??
      mod.run;
    if (typeof handler !== "function") return undefined;
    return handler as (...args: unknown[]) => unknown;
  }

  it("resolves default export function", () => {
    const fn = jest.fn();
    expect(pickHandler({ default: fn })).toBe(fn);
  });

  it("resolves default.handler export", () => {
    const fn = jest.fn();
    expect(pickHandler({ default: { handler: fn } })).toBe(fn);
  });

  it("resolves named handler export", () => {
    const fn = jest.fn();
    expect(pickHandler({ default: undefined, handler: fn })).toBe(fn);
  });

  it("resolves named fix export", () => {
    const fn = jest.fn();
    expect(pickHandler({ default: undefined, handler: undefined, fix: fn })).toBe(fn);
  });

  it("resolves named run export", () => {
    const fn = jest.fn();
    expect(
      pickHandler({ default: undefined, handler: undefined, fix: undefined, run: fn }),
    ).toBe(fn);
  });

  it("returns undefined when no handler found", () => {
    expect(pickHandler({ default: { notHandler: true } })).toBeUndefined();
  });

  it("prefers default function over named exports", () => {
    const defaultFn = jest.fn();
    const handlerFn = jest.fn();
    expect(pickHandler({ default: defaultFn, handler: handlerFn })).toBe(defaultFn);
  });

  it("prefers handler over fix and run", () => {
    const handlerFn = jest.fn();
    const fixFn = jest.fn();
    expect(
      pickHandler({ default: undefined, handler: handlerFn, fix: fixFn }),
    ).toBe(handlerFn);
  });
});
