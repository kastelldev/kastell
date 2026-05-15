describe("BATCH_TIMEOUTS.plugin", () => {
  const originalEnv = process.env.PLUGIN_AUDIT_TIMEOUT_MS;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PLUGIN_AUDIT_TIMEOUT_MS;
    else process.env.PLUGIN_AUDIT_TIMEOUT_MS = originalEnv;
    jest.resetModules();
  });

  it("defaults to 60_000 when env unset", async () => {
    delete process.env.PLUGIN_AUDIT_TIMEOUT_MS;
    jest.resetModules();
    const { BATCH_TIMEOUTS } = await import("../../src/core/audit/commands.js");
    expect(BATCH_TIMEOUTS.plugin).toBe(60_000);
  });

  it("uses env override when valid positive number", async () => {
    process.env.PLUGIN_AUDIT_TIMEOUT_MS = "90000";
    jest.resetModules();
    const { BATCH_TIMEOUTS } = await import("../../src/core/audit/commands.js");
    expect(BATCH_TIMEOUTS.plugin).toBe(90_000);
  });

  it("falls back to default when env is NaN", async () => {
    process.env.PLUGIN_AUDIT_TIMEOUT_MS = "abc";
    jest.resetModules();
    const { BATCH_TIMEOUTS } = await import("../../src/core/audit/commands.js");
    expect(BATCH_TIMEOUTS.plugin).toBe(60_000);
  });

  it("falls back to default when env is zero or negative", async () => {
    process.env.PLUGIN_AUDIT_TIMEOUT_MS = "0";
    jest.resetModules();
    const { BATCH_TIMEOUTS } = await import("../../src/core/audit/commands.js");
    expect(BATCH_TIMEOUTS.plugin).toBe(60_000);
  });
});