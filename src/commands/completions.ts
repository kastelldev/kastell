import {
  generateBashCompletions,
  generateZshCompletions,
  generateFishCompletions,
} from "../core/completions.js";
import { logger } from "../utils/logger.js";

export async function completionsCommand(shell?: string): Promise<void> {
  switch (shell) {
    case "bash":
      console.log(generateBashCompletions());
      break;
    case "zsh":
      console.log(generateZshCompletions());
      break;
    case "fish":
      console.log(generateFishCompletions());
      break;
    default:
      logger.info("Usage: kastell completions <bash|zsh|fish>");
      logger.info("");
      logger.info("Examples:");
      logger.info(
        "  kastell completions bash > ~/.local/share/bash-completion/completions/kastell",
      );
      logger.info("  kastell completions zsh > ~/.zfunc/_kastell");
      logger.info(
        "  kastell completions fish > ~/.config/fish/completions/kastell.fish",
      );
      break;
  }
}
