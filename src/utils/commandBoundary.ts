import { logger } from "./logger.js";
import { markCommandFailed } from "./exitCode.js";

export class CommandFailure extends Error {
  readonly hint?: string;

  constructor(message: string, options?: { hint?: string; cause?: unknown }) {
    super(message, options?.cause instanceof Error ? { cause: options.cause } : undefined);
    this.name = "CommandFailure";
    this.hint = options?.hint;
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
        logger.error(error.message);
        if (error.hint) logger.info(error.hint);
        markCommandFailed();
        return;
      }
      throw error;
    }
  };
}