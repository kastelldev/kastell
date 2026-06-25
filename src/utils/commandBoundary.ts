import { logger } from "./logger.js";
import { markCommandFailed } from "./exitCode.js";

/**
 * The boundary's typed error. `hint` is a non-fatal remediation cue that
 * the boundary surfaces via `logger.info` after `logger.error(message)`.
 * `cause` is the original error from upstream — preserved as the audit
 * trail for operator diagnostics. The boundary's `logger.error(message)`
 * call intentionally does NOT log `cause` to user output; cause is
 * forensic context for logs/telemetry, not part of the user-facing
 * message. Non-Error causes are defensively wrapped so they are not
 * silently dropped on the audit trail (ESLint preserve-caught-error
 * requires an Error for Error.cause).
 */
export class CommandFailure extends Error {
  readonly hint?: string;
  readonly logged: boolean;

  constructor(message: string, options?: { hint?: string; cause?: unknown; logged?: boolean }) {
    // `instanceof Error` guard satisfies ESLint preserve-caught-error:
    // Error.cause only accepts an Error (or undefined). Non-Error causes
    // (string, plain object, network error wrappers) are wrapped defensively
    // so they are not silently dropped on the audit trail.
    const cause =
      options?.cause instanceof Error
        ? options.cause
        : options?.cause !== undefined
          ? new Error(String(options.cause))
          : undefined;
    super(message, cause ? { cause } : undefined);
    this.name = "CommandFailure";
    this.hint = options?.hint;
    this.logged = options?.logged ?? false;
  }
}

export function failWith(message: string, hint?: string): never {
  throw new CommandFailure(message, hint ? { hint } : undefined);
}

export function withCommandBoundary<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<void> | void,
): (...args: TArgs) => Promise<void> {
  return async (...args: TArgs): Promise<void> => {
    try {
      await handler(...args);
    } catch (error) {
      if (error instanceof CommandFailure) {
        if (!error.logged) logger.error(error.message);
        if (error.hint) logger.info(error.hint);
        markCommandFailed();
        return;
      }
      throw error;
    }
  };
}

// NOTE: hint emission (`logger.info(error.hint)`) is intentionally NOT
// machine-mode-aware. The boundary fires after the command has surfaced its
// machine output (stdout) and after `setMachineMode(false)` has reset state
// in current call sites. If a future command combines `--json` / machineMode
// with the boundary, it MUST reset machine mode (`setMachineMode(false)`)
// before the boundary can fire — otherwise the hint is silently routed to
// stderr (or swallowed if `2>&1` is not redirected) instead of contaminating
// the JSON payload on stdout. A deeper refactor (per-call `isMachineMode()`
// guard) is deferred to P147; today no command goes through both paths.
