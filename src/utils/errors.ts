export class KastellError extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(message: string, options?: { cause?: unknown; hint?: string; code?: string }) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.code = options?.code ?? this.constructor.name.toUpperCase().replace("ERROR", "");
    this.hint = options?.hint;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TransientError extends KastellError {}
export class ValidationError extends KastellError {}
export class BusinessError extends KastellError {}
export class PermissionError extends KastellError {}
