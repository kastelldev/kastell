/**
 * Shell-escape a value using POSIX single-quote wrapping.
 * Embedded single quotes are escaped as: close-quote, escaped-quote, reopen-quote.
 * Defense-in-depth — callers should also validate input (e.g., validateCronExpr).
 */
export function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
