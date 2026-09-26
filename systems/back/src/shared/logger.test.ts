import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger, formatUnknownError } from "./logger";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logger privacy", () => {
  it("does not serialize error stacks into structured log context", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createLogger("info");

    logger.error("test.failure", { error: new Error("boom") });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const record = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));

    expect(record.error).toEqual({
      name: "Error",
      message: "boom"
    });
    expect(record.error).not.toHaveProperty("stack");
  });

  it("does not inspect arbitrary thrown objects", () => {
    expect(formatUnknownError({ token: "secret", cookie: "private" })).toBe("non_error_thrown");
    expect(formatUnknownError("token=secret")).toBe("string_thrown");
  });
});
