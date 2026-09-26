import { describe, expect, it } from "vitest";

import {
  parseObjectBody,
  parseNullableStringField,
  parseOptionalNonNegativeIntegerField,
  parseOptionalStringField,
  parseRequiredStringField
} from "./zod-request-body";

const createError = (message: string) => new Error(message);

describe("zod request body helpers", () => {
  it("preserves object and required string field semantics", () => {
    const body = parseObjectBody(
      { field: "  value  " },
      "Body must be an object.",
      createError
    );

    expect(parseRequiredStringField(body, "field", createError)).toBe("value");
    expect(() => parseObjectBody([], "Body must be an object.", createError)).toThrow(
      "Body must be an object."
    );
    expect(() => parseRequiredStringField({ field: "   " }, "field", createError)).toThrow(
      "field is required."
    );
  });

  it("preserves optional string and non-negative integer field semantics", () => {
    expect(parseOptionalStringField({}, "note", createError)).toBeNull();
    expect(parseOptionalStringField({ note: null }, "note", createError)).toBeNull();
    expect(parseOptionalStringField({ note: "" }, "note", createError)).toBeNull();
    expect(parseOptionalStringField({ note: "   " }, "note", createError)).toBe("");
    expect(() => parseOptionalStringField({ note: 1 }, "note", createError)).toThrow(
      "note must be a string."
    );

    expect(parseOptionalNonNegativeIntegerField({}, "version", createError)).toBeNull();
    expect(parseOptionalNonNegativeIntegerField({ version: 0 }, "version", createError)).toBe(0);
    expect(parseOptionalNonNegativeIntegerField({ version: 2 }, "version", createError)).toBe(2);
    expect(() =>
      parseOptionalNonNegativeIntegerField({ version: 1.5 }, "version", createError)
    ).toThrow("version must be a non-negative integer.");
    expect(() =>
      parseOptionalNonNegativeIntegerField({ version: -1 }, "version", createError)
    ).toThrow("version must be a non-negative integer.");
  });

  it("supports nullable string fields that collapse blank input to null", () => {
    expect(parseNullableStringField({}, "note", createError)).toBeNull();
    expect(parseNullableStringField({ note: null }, "note", createError)).toBeNull();
    expect(parseNullableStringField({ note: "" }, "note", createError)).toBeNull();
    expect(parseNullableStringField({ note: "   " }, "note", createError)).toBeNull();
    expect(parseNullableStringField({ note: "  Ready  " }, "note", createError)).toBe("Ready");
    expect(() => parseNullableStringField({ note: 1 }, "note", createError)).toThrow(
      "note must be a string."
    );
  });
});
