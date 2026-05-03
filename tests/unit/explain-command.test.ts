import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { explainCommand } from "../../src/commands/explain.js";

jest.mock("../../src/core/audit/explainCheck.js", () => ({
  findCheckById: jest.fn(),
  formatSuggestions: jest.fn().mockReturnValue("Run `kastell audit --list-checks` to see all available checks."),
  formatExplainTerminal: jest.fn().mockReturnValue("terminal output"),
  formatExplainJson: jest.fn().mockReturnValue('{"id":"X"}'),
  formatExplainMarkdown: jest.fn().mockReturnValue("---\nid: X\n---"),
}));

import {
  findCheckById,
  formatExplainTerminal,
  formatExplainJson,
  formatExplainMarkdown,
} from "../../src/core/audit/explainCheck.js";

const mockedFind = findCheckById as jest.MockedFunction<typeof findCheckById>;

describe("explainCommand", () => {
  let consoleSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    exitSpy = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("prints terminal output for valid check ID", async () => {
    mockedFind.mockReturnValue({
      match: { id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH, name: "Test", category: "SSH", severity: "critical", explain: "test", fixTier: "FORBIDDEN", complianceRefs: [] },
      suggestions: [],
    });

    await explainCommand(CHECK_IDS.SSH.SSH_PASSWORD_AUTH, {});
    expect(formatExplainTerminal).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith("terminal output");
  });

  it("prints JSON when --format json", async () => {
    mockedFind.mockReturnValue({
      match: { id: "X", name: "Test", category: "SSH", severity: "critical", explain: "test", fixTier: "FORBIDDEN", complianceRefs: [] },
      suggestions: [],
    });

    await explainCommand("X", { format: "json" });
    expect(formatExplainJson).toHaveBeenCalled();
  });

  it("prints markdown when --format md", async () => {
    mockedFind.mockReturnValue({
      match: { id: "X", name: "Test", category: "SSH", severity: "critical", explain: "test", fixTier: "FORBIDDEN", complianceRefs: [] },
      suggestions: [],
    });

    await explainCommand("X", { format: "md" });
    expect(formatExplainMarkdown).toHaveBeenCalled();
  });

  it("exits with error and suggestions for unknown ID", async () => {
    mockedFind.mockReturnValue({ match: null, suggestions: [CHECK_IDS.SSH.SSH_PASSWORD_AUTH] });

    await expect(explainCommand("SSH-PASWORD", {})).rejects.toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with error and no suggestions for completely unknown ID", async () => {
    mockedFind.mockReturnValue({ match: null, suggestions: [] });

    await expect(explainCommand("ZZZZZ", {})).rejects.toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
