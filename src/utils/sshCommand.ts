/**
 * SSH command builder — array-based construction with shell escaping.
 *
 * Use cmd() to build commands from typed arguments. Each argument is
 * shell-escaped, preventing command injection via crafted inputs.
 *
 * Use raw() ONLY for hardcoded static strings (heredocs, complex redirections)
 * that cannot be expressed via cmd(). Never pass user input to raw().
 */

/** Branded string type. Prevents accidental raw string usage while remaining zero-overhead. */
export type SshCommand = string & { readonly __brand: "SshCommand" };

/**
 * POSIX-safe shell escaping.
 * - Safe chars (alphanumeric + ._:/@=+-) → returned as-is
 * - Empty string → ''
 * - Everything else → wrapped in single quotes, with embedded single quotes
 *   replaced by the POSIX idiom: '\''
 */
export function shellEscape(arg: string): string {
  if (arg.length === 0) return "''";
  if (/^[a-zA-Z0-9._:/@=+-]+$/.test(arg)) return arg;
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Build a single command from program + arguments.
 * Each argument is shell-escaped before joining with spaces.
 */
export function cmd(...args: string[]): SshCommand {
  if (args.some((a) => a.length === 0)) {
    throw new Error("cmd() received an empty string argument — this is likely a bug");
  }
  return args.map(shellEscape).join(" ") as SshCommand;
}

/**
 * Wrap a pre-validated static string as SshCommand.
 *
 * WARNING: Only use for hardcoded constants or complex shell constructs
 * (heredocs, multi-line scripts, redirections) that cannot be expressed
 * via cmd(). Never pass user input to raw() — it is NOT escaped.
 */
export function raw(command: string): SshCommand {
  return command as SshCommand;
}

/** Join commands with ' && ' (fail-fast sequential execution). */
export function and(...commands: SshCommand[]): SshCommand {
  return commands.join(" && ") as SshCommand;
}

/** Join commands with ' | ' (pipe stdout to next command). */
export function pipe(...commands: SshCommand[]): SshCommand {
  return commands.join(" | ") as SshCommand;
}

/** Join commands with ' || ' (run next if previous fails). */
export function or(...commands: SshCommand[]): SshCommand {
  return commands.join(" || ") as SshCommand;
}

/** Join commands with ' ; ' (sequential, regardless of exit code). */
export function seq(...commands: SshCommand[]): SshCommand {
  return commands.join(" ; ") as SshCommand;
}

/** Wrap a command in a subshell: ( ... ) */
export function subshell(command: SshCommand): SshCommand {
  return `( ${command} )` as SshCommand;
}

/**
 * Extract the final shell string from an SshCommand.
 * Provides semantic clarity at call sites — SshCommand is already a string.
 */
export function buildCommandString(command: SshCommand): string {
  return command;
}
