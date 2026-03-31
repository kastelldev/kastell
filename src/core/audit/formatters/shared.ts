/**
 * Shared formatting utilities for audit formatters.
 * Extracted to eliminate duplication across terminal, summary, and compliance formatters.
 */

import chalk from "chalk";
import type { Severity } from "../types.js";

/** Score color based on value: >=80 green, >=60 yellow, else red */
export function scoreColor(score: number): (text: string) => string {
  if (score >= 80) return chalk.green;
  if (score >= 60) return chalk.yellow;
  return chalk.red;
}

/** Build a simple progress bar using block characters */
export function progressBar(score: number, width: number = 10): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

/** Map audit severity to a chalk color function */
export function severityChalk(severity: Severity): typeof chalk.red {
  switch (severity) {
    case "critical": return chalk.red;
    case "warning":  return chalk.yellow;
    case "info":     return chalk.blue;
  }
}
