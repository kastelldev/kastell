import { displayChangelog } from "../core/changelog.js";
import { logger } from "../utils/logger.js";

export function changelogCommand(version?: string, options: { all?: boolean } = {}): void {
  const output = displayChangelog({ version, all: options.all });

  if (!output) {
    logger.error("No changelog found.");
    return;
  }

  console.log(output);
}
