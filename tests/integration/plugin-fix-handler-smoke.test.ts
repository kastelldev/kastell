import { resolve } from "path";
import { resolvePluginHandler } from "../../src/plugin/handlerResolver.js";

describe("executePluginFix smoke", () => {
  const fixtureDir = resolve(__dirname, "__fixtures__/plugin-smoke");

  test("resolvePluginHandler loads handler via pathToFileURL and executes", async () => {
    const handler = await resolvePluginHandler(fixtureDir, "./index.js");
    const result = await handler();
    expect(result).toMatchObject({ status: "applied", message: "smoke fix executed" });
  });

  test("handler resolves even when module has no default export but has named export", async () => {
    const handler = await resolvePluginHandler(fixtureDir, "./index.js");
    expect(typeof handler).toBe("function");
  });
});