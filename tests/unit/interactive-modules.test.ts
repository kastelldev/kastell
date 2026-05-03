import { describe, it, expect, beforeEach } from "@jest/globals";

describe("interactive module exports", () => {
  it("re-exports interactiveMenu from barrel", async () => {
    const interactive = await import("../../src/commands/interactive/index.js");
    expect(interactive.interactiveMenu).toBeDefined();
    expect(interactive.buildSearchSource).toBeDefined();
  });
});

describe("backup-maintenance module", () => {
  it("exports prompt handlers", async () => {
    const mod = await import("../../src/commands/interactive/backup-maintenance.js");
    expect(mod.promptBackup).toBeDefined();
    expect(mod.promptSnapshot).toBeDefined();
    expect(mod.promptMaintain).toBeDefined();
    expect(mod.promptUpdate).toBeDefined();
    expect(mod.promptNotify).toBeDefined();
    expect(mod.promptCompletions).toBeDefined();
    expect(mod.promptImport).toBeDefined();
  });
});

describe("server-management module", () => {
  it("exports prompt handlers", async () => {
    const mod = await import("../../src/commands/interactive/server-management.js");
    expect(mod.promptInit).toBeDefined();
    expect(mod.promptStatus).toBeDefined();
    expect(mod.promptSsh).toBeDefined();
    expect(mod.promptFleet).toBeDefined();
  });
});

describe("menu module", () => {
  beforeEach(async () => {
    const { clearChoicesCache } = await import("../../src/commands/interactive/menu.js");
    clearChoicesCache();
  });

  it("exports clearChoicesCache", async () => {
    const menu = await import("../../src/commands/interactive/menu.js");
    expect(menu.clearChoicesCache).toBeDefined();
    expect(typeof menu.clearChoicesCache).toBe("function");
  });

  it("buildMainChoices returns fresh array each call", async () => {
    const { buildMainChoices } = await import("../../src/commands/interactive/menu.js");
    const a = buildMainChoices();
    const b = buildMainChoices();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("buildMainChoices includes exit option", async () => {
    const { buildMainChoices } = await import("../../src/commands/interactive/menu.js");
    const choices = buildMainChoices();
    const exit = choices.find((c) => "value" in c && c.value === "exit");
    expect(exit).toBeDefined();
  });
});
