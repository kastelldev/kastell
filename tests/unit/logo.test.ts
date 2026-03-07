import { renderLogo } from "../../src/utils/logo.js";
import figlet from "figlet";

describe("renderLogo", () => {
  it("returns a string containing KASTELL", () => {
    const result = renderLogo();
    expect(result).toContain("KASTELL");
  });

  it("calls figlet.textSync with correct arguments", () => {
    renderLogo();
    expect(figlet.textSync).toHaveBeenCalledWith("KASTELL", {
      font: "Standard",
      horizontalLayout: "default",
    });
  });

  it("returns a non-empty string", () => {
    const result = renderLogo();
    expect(result.length).toBeGreaterThan(0);
  });
});
