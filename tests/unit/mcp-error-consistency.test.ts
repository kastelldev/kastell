import { readdirSync, readFileSync } from "fs";
import { join } from "path";

describe("MCP error format consistency", () => {
  const toolsDir = join(__dirname, "../../src/mcp/tools");
  const toolFiles = readdirSync(toolsDir).filter((f) => f.endsWith(".ts") && !f.includes(".handlers."));

  it("all tool files use sanitizeStderr(getErrorMessage(error)) pattern", () => {
    const inconsistent: string[] = [];
    for (const file of toolFiles) {
      const content = readFileSync(join(toolsDir, file), "utf-8");
      if (content.includes("error instanceof Error ? error.message")) {
        inconsistent.push(file);
      }
    }
    expect(inconsistent).toEqual([]);
  });

  it("all tool files import getErrorMessage and sanitizeStderr", () => {
    const missing: string[] = [];
    for (const file of toolFiles) {
      const content = readFileSync(join(toolsDir, file), "utf-8");
      if (content.includes("catch (error")) {
        if (!content.includes("getErrorMessage") || !content.includes("sanitizeStderr")) {
          missing.push(file);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("MCP tool annotations (SC#5)", () => {
  it("all 17 tools in ALL_MCP_TOOLS have readOnlyHint annotation", () => {
    const serverTs = readFileSync(join(__dirname, "../../src/mcp/server.ts"), "utf-8");
    // 17 tools in ALL_MCP_TOOLS array, each with readOnlyHint in annotations
    const annotationBlocks = serverTs.match(/readOnlyHint:/g) || [];
    expect(annotationBlocks.length).toBe(17);
  });

  it("read-only tools have readOnlyHint: true", () => {
    const serverTs = readFileSync(join(__dirname, "../../src/mcp/server.ts"), "utf-8");
    const readOnlyTools = ["server_info", "server_logs", "server_audit", "server_doctor", "server_fleet", "server_explain"];
    for (const tool of readOnlyTools) {
      // Match tool entry in ALL_MCP_TOOLS array and its annotations block
      const toolMatch = serverTs.match(new RegExp(`name:\\s+"${tool}"[\\s\\S]*?annotations:\\s*\\{[\\s\\S]*?readOnlyHint:\\s*(true|false)`));
      expect(toolMatch).not.toBeNull();
      expect(toolMatch![1]).toBe("true");
    }
  });

  it("destructive tools have destructiveHint: true", () => {
    const serverTs = readFileSync(join(__dirname, "../../src/mcp/server.ts"), "utf-8");
    const destructiveTools = ["server_manage", "server_backup", "server_provision", "server_fix", "server_lock"];
    for (const tool of destructiveTools) {
      // Match tool entry in ALL_MCP_TOOLS array and its annotations block
      const toolMatch = serverTs.match(new RegExp(`name:\\s+"${tool}"[\\s\\S]*?annotations:\\s*\\{[\\s\\S]*?destructiveHint:\\s*(true|false)`));
      expect(toolMatch).not.toBeNull();
      expect(toolMatch![1]).toBe("true");
    }
  });
});
