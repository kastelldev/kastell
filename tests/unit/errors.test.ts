import {
  KastellError,
  TransientError,
  ValidationError,
  BusinessError,
  PermissionError,
} from "../../src/utils/errors";

describe("KastellError base class", () => {
  it("should be instanceof Error", () => {
    expect(new KastellError("x")).toBeInstanceOf(Error);
  });

  it("should be instanceof KastellError", () => {
    expect(new KastellError("x")).toBeInstanceOf(KastellError);
  });

  it("should preserve message", () => {
    expect(new KastellError("base message").message).toBe("base message");
  });

  it("should set name to constructor name", () => {
    expect(new KastellError("x").name).toBe("KastellError");
  });

  it("should derive code as KASTELL when no code given", () => {
    expect(new KastellError("x").code).toBe("KASTELL");
  });

  it("should accept custom code override", () => {
    expect(new KastellError("x", { code: "CUSTOM" }).code).toBe("CUSTOM");
  });

  it("should have undefined hint by default", () => {
    expect(new KastellError("x").hint).toBeUndefined();
  });

  it("should preserve hint when provided", () => {
    expect(new KastellError("x", { hint: "Try again" }).hint).toBe("Try again");
  });

  it("should preserve cause when provided", () => {
    const original = new Error("root cause");
    const err = new KastellError("wrapped", { cause: original });
    expect(err.cause).toBe(original);
  });
});

describe.each([
  { Cls: TransientError, code: "TRANSIENT", hint: "Retry later" },
  { Cls: ValidationError, code: "VALIDATION", hint: "Use valid IP" },
  { Cls: BusinessError, code: "BUSINESS", hint: "Upgrade plan" },
  { Cls: PermissionError, code: "PERMISSION", hint: "Check SSH key" },
] as const)("$Cls.name", ({ Cls, code, hint }) => {
  const others = [TransientError, ValidationError, BusinessError, PermissionError].filter(C => C !== Cls);

  it("should be instanceof KastellError", () => {
    expect(new Cls("x")).toBeInstanceOf(KastellError);
  });

  it("should be instanceof itself", () => {
    expect(new Cls("x")).toBeInstanceOf(Cls);
  });

  it.each(others)("should NOT be instanceof %s", (Other) => {
    expect(new Cls("x")).not.toBeInstanceOf(Other);
  });

  it(`should have code ${code}`, () => {
    expect(new Cls("x").code).toBe(code);
  });

  it("should have correct name", () => {
    expect(new Cls("x").name).toBe(Cls.name);
  });

  it("should preserve cause chain", () => {
    const original = new Error("root");
    const err = new Cls("wrapped", { cause: original });
    expect(err.cause).toBe(original);
  });

  it("should have undefined hint by default", () => {
    expect(new Cls("x").hint).toBeUndefined();
  });

  it("should preserve hint when provided", () => {
    expect(new Cls("x", { hint }).hint).toBe(hint);
  });
});

describe("instanceof cross-class isolation", () => {
  it("should not confuse ValidationError with BusinessError", () => {
    expect(new ValidationError("x")).not.toBeInstanceOf(BusinessError);
  });

  it("should not confuse BusinessError with PermissionError", () => {
    expect(new BusinessError("x")).not.toBeInstanceOf(PermissionError);
  });

  it("should not confuse PermissionError with TransientError", () => {
    expect(new PermissionError("x")).not.toBeInstanceOf(TransientError);
  });
});
