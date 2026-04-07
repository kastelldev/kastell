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

describe("TransientError", () => {
  it("should be instanceof KastellError", () => {
    expect(new TransientError("x")).toBeInstanceOf(KastellError);
  });

  it("should be instanceof TransientError", () => {
    expect(new TransientError("x")).toBeInstanceOf(TransientError);
  });

  it("should NOT be instanceof ValidationError", () => {
    expect(new TransientError("x")).not.toBeInstanceOf(ValidationError);
  });

  it("should NOT be instanceof BusinessError", () => {
    expect(new TransientError("x")).not.toBeInstanceOf(BusinessError);
  });

  it("should NOT be instanceof PermissionError", () => {
    expect(new TransientError("x")).not.toBeInstanceOf(PermissionError);
  });

  it("should have code TRANSIENT", () => {
    expect(new TransientError("x").code).toBe("TRANSIENT");
  });

  it("should have name TransientError", () => {
    expect(new TransientError("x").name).toBe("TransientError");
  });

  it("should preserve cause chain", () => {
    const original = new Error("root");
    const err = new TransientError("wrapped", { cause: original });
    expect(err.cause).toBe(original);
  });

  it("should have undefined hint by default", () => {
    expect(new TransientError("x").hint).toBeUndefined();
  });

  it("should preserve hint when provided", () => {
    expect(new TransientError("x", { hint: "Retry later" }).hint).toBe("Retry later");
  });
});

describe("ValidationError", () => {
  it("should be instanceof KastellError", () => {
    expect(new ValidationError("x")).toBeInstanceOf(KastellError);
  });

  it("should be instanceof ValidationError", () => {
    expect(new ValidationError("x")).toBeInstanceOf(ValidationError);
  });

  it("should NOT be instanceof TransientError", () => {
    expect(new ValidationError("x")).not.toBeInstanceOf(TransientError);
  });

  it("should have code VALIDATION", () => {
    expect(new ValidationError("x").code).toBe("VALIDATION");
  });

  it("should have name ValidationError", () => {
    expect(new ValidationError("x").name).toBe("ValidationError");
  });

  it("should preserve hint when provided", () => {
    expect(new ValidationError("bad ip", { hint: "Use valid IP" }).hint).toBe("Use valid IP");
  });
});

describe("BusinessError", () => {
  it("should be instanceof KastellError", () => {
    expect(new BusinessError("x")).toBeInstanceOf(KastellError);
  });

  it("should be instanceof BusinessError", () => {
    expect(new BusinessError("x")).toBeInstanceOf(BusinessError);
  });

  it("should NOT be instanceof TransientError", () => {
    expect(new BusinessError("x")).not.toBeInstanceOf(TransientError);
  });

  it("should have code BUSINESS", () => {
    expect(new BusinessError("x").code).toBe("BUSINESS");
  });

  it("should have name BusinessError", () => {
    expect(new BusinessError("x").name).toBe("BusinessError");
  });

  it("should preserve hint when provided", () => {
    expect(new BusinessError("limit reached", { hint: "Upgrade plan" }).hint).toBe("Upgrade plan");
  });
});

describe("PermissionError", () => {
  it("should be instanceof KastellError", () => {
    expect(new PermissionError("x")).toBeInstanceOf(KastellError);
  });

  it("should be instanceof PermissionError", () => {
    expect(new PermissionError("x")).toBeInstanceOf(PermissionError);
  });

  it("should NOT be instanceof ValidationError", () => {
    expect(new PermissionError("x")).not.toBeInstanceOf(ValidationError);
  });

  it("should have code PERMISSION", () => {
    expect(new PermissionError("x").code).toBe("PERMISSION");
  });

  it("should have name PermissionError", () => {
    expect(new PermissionError("x").name).toBe("PermissionError");
  });

  it("should preserve hint when provided", () => {
    expect(new PermissionError("denied", { hint: "Check SSH key" }).hint).toBe("Check SSH key");
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
