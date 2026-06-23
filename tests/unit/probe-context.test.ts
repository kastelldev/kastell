// tests/unit/probe-context.test.ts
//
// Capability-limited probe context — surface is frozen and contains only
// target, sessionId, pluginName, checkId, signal, deadlineMs, controlled
// `ssh`, and redacting `logger`. No provider token/env/fs/spawn/session
// mutation crosses the boundary.

import { createProbeContext } from "../../src/core/probe/context.js";
import type { PluginProbeContext } from "../../src/plugin/sdk/types.js";

describe("createProbeContext", () => {
  const baseInput = {
    target: {
      serverId: "srv-1",
      provider: "hetzner",
      cloudId: "cloud-1",
      ip: "203.0.113.10",
    },
    sessionId: "00000000-0000-4000-8000-000000000001",
    pluginName: "acme-probe",
    checkId: "check-1",
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 60_000,
    handlerPath: "/tmp/probe.js",
    handlerSha256: "abc123",
    risk: "safe" as const,
    timeoutMs: 30_000,
    sshExec: jest.fn(),
  };

  it("exposes target, sessionId, pluginName, checkId, signal, deadlineMs, ssh, and logger only", () => {
    const ctx = createProbeContext(baseInput);
    const keys = Object.keys(ctx).sort();
    expect(keys).toEqual(
      [
        "checkId",
        "deadlineMs",
        "logger",
        "pluginName",
        "sessionId",
        "signal",
        "ssh",
        "target",
      ].sort(),
    );
  });

  it("the context object is frozen", () => {
    const ctx = createProbeContext(baseInput);
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it("the target object is also frozen", () => {
    const ctx = createProbeContext(baseInput);
    expect(Object.isFrozen(ctx.target)).toBe(true);
  });

  it("does not expose provider token", () => {
    const ctx = createProbeContext(baseInput);
    // @ts-expect-error -- index access on frozen context
    expect(ctx.token).toBeUndefined();
    // @ts-expect-error -- index access on frozen context
    expect(ctx.providerToken).toBeUndefined();
    // @ts-expect-error -- index access on frozen context
    expect(ctx.env).toBeUndefined();
  });

  it("does not expose filesystem, spawn, or session-mutating methods", () => {
    const ctx = createProbeContext(baseInput);
    // @ts-expect-error -- index access on frozen context
    expect(ctx.writeFile).toBeUndefined();
    // @ts-expect-error -- index access on frozen context
    expect(ctx.spawn).toBeUndefined();
    // @ts-expect-error -- index access on frozen context
    expect(ctx.reserve).toBeUndefined();
    // @ts-expect-error -- index access on frozen context
    expect(ctx.transition).toBeUndefined();
  });

  it("the target is a defensive copy — mutating the original after creation must not change the context", () => {
    const target = { ...baseInput.target };
    const ctx = createProbeContext({ ...baseInput, target });
    target.serverId = "tampered";
    target.ip = "10.0.0.1";
    expect(ctx.target.serverId).toBe("srv-1");
    expect(ctx.target.ip).toBe("203.0.113.10");
  });

  it("ssh is a function and clamps the requested timeoutMs to remaining deadline", async () => {
    const sshExec = jest.fn().mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });
    const now = Date.now();
    const ctx = createProbeContext({
      ...baseInput,
      sshExec,
      deadlineMs: now + 5_000,
    });
    await ctx.ssh("uptime");
    expect(sshExec).toHaveBeenCalledTimes(1);
    const args = sshExec.mock.calls[0]!;
    // The clamp is positive but no greater than the remaining 5_000.
    expect(args[2]).toMatchObject({ timeoutMs: expect.any(Number) });
    const requestedTimeout = (args[2] as { timeoutMs: number }).timeoutMs;
    expect(requestedTimeout).toBeLessThanOrEqual(5_000);
    expect(requestedTimeout).toBeGreaterThan(0);
  });

  it("ssh forwards the abort signal from the context", async () => {
    const sshExec = jest.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    const controller = new AbortController();
    const ctx = createProbeContext({
      ...baseInput,
      sshExec,
      signal: controller.signal,
    });
    await ctx.ssh("uptime");
    expect(sshExec.mock.calls[0]![2]).toMatchObject({ signal: controller.signal });
  });

  it("ssh clamps to 0 when the deadline has already passed and surfaces a timeout error", async () => {
    const sshExec = jest.fn().mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });
    const ctx = createProbeContext({
      ...baseInput,
      sshExec,
      deadlineMs: Date.now() - 1,
    });
    await ctx.ssh("uptime");
    const args = sshExec.mock.calls[0]![2] as { timeoutMs: number };
    expect(args.timeoutMs).toBe(0);
  });

  it("logger.info serializes handler-provided fields through safeStringify redactor", () => {
    const captured: Array<{ args: unknown[] }> = [];
    const baseLogger = {
      info: (...args: unknown[]) => captured.push({ args }),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const ctx = createProbeContext({ ...baseInput, baseLogger });
    ctx.logger.info("hello", { token: "secret-abc", note: "visible" });
    expect(captured).toHaveLength(1);
    const forwarded = captured[0]!.args;
    // The second arg is an object that has had token redacted.
    expect(typeof forwarded[1]).toBe("string");
    const serialized = forwarded[1] as string;
    expect(serialized).not.toContain("secret-abc");
    expect(serialized).toContain("visible");
  });

  it("logger.warn and logger.error also use the redacting serializer", () => {
    const captured: Array<{ level: string; args: unknown[] }> = [];
    const baseLogger = {
      info: () => undefined,
      warn: (...args: unknown[]) => captured.push({ level: "warn", args }),
      error: (...args: unknown[]) => captured.push({ level: "error", args }),
    };
    const ctx = createProbeContext({ ...baseInput, baseLogger });
    ctx.logger.warn("w", { password: "p" });
    ctx.logger.error("e", { apiKey: "ak" });
    expect(captured).toHaveLength(2);
    // The redacted keys themselves must be replaced with the redaction
    // marker, but the surrounding payload shape (key=value, JSON braces)
    // is preserved so log sinks can still see the field name.
    const warnPayload = captured[0]!.args[1] as string;
    const errorPayload = captured[1]!.args[1] as string;
    expect(warnPayload).toContain("[REDACTED]");
    expect(warnPayload).not.toContain('"p"');
    expect(errorPayload).toContain("[REDACTED]");
    expect(errorPayload).not.toContain('"ak"');
  });

  it("the returned context is structurally assignable to PluginProbeContext", () => {
    const ctx: PluginProbeContext = createProbeContext(baseInput);
    // Read every typed field — if the structural shape is missing, tsc fails.
    expect(ctx.sessionId).toBe(baseInput.sessionId);
    expect(ctx.pluginName).toBe(baseInput.pluginName);
    expect(ctx.checkId).toBe(baseInput.checkId);
    expect(ctx.signal).toBe(baseInput.signal);
    expect(ctx.deadlineMs).toBe(baseInput.deadlineMs);
  });
});
