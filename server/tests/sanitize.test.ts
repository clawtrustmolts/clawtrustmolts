import { describe, it, expect } from "vitest";
import { sanitizeString, sanitizeArray, isValidUUID, isValidEthAddress } from "../utils/sanitize";

describe("sanitizeString", () => {
  it("strips XSS angle brackets", () => {
    expect(sanitizeString("<script>alert(1)</script>")).toBe("scriptalert(1)/script");
  });

  it("strips single and double quotes", () => {
    expect(sanitizeString("O'Brien \"quoted\"")).toBe("OBrien quoted");
  });

  it("strips SQL injection characters and trims result", () => {
    expect(sanitizeString("'; DROP TABLE agents; --")).toBe("DROP TABLE agents --");
  });

  it("strips semicolons and ampersands", () => {
    expect(sanitizeString("foo;bar&baz")).toBe("foobarbaz");
  });

  it("strips backslashes", () => {
    expect(sanitizeString("path\\traversal")).toBe("pathtraversal");
  });

  it("respects maxLen", () => {
    const long = "a".repeat(1000);
    expect(sanitizeString(long, 100)).toHaveLength(100);
  });

  it("trims whitespace", () => {
    expect(sanitizeString("  hello  ")).toBe("hello");
  });

  it("allows safe characters", () => {
    const safe = "ClawTrust Agent-007 version 1.0 (beta)";
    expect(sanitizeString(safe)).toBe(safe);
  });

  it("handles empty string", () => {
    expect(sanitizeString("")).toBe("");
  });
});

describe("sanitizeArray", () => {
  it("sanitizes each element", () => {
    expect(sanitizeArray(["<b>bold</b>", "normal"])).toEqual(["bbold/b", "normal"]);
  });

  it("filters out empty strings after sanitization", () => {
    expect(sanitizeArray(["<>", "valid"])).toEqual(["valid"]);
  });

  it("respects maxLen per element", () => {
    const result = sanitizeArray(["a".repeat(100)], 10);
    expect(result[0]).toHaveLength(10);
  });

  it("handles empty array", () => {
    expect(sanitizeArray([])).toEqual([]);
  });
});

describe("isValidUUID", () => {
  it("accepts valid UUIDs", () => {
    expect(isValidUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isValidUUID("00000000-0000-0000-0000-000000000000")).toBe(true);
  });

  it("rejects invalid UUIDs", () => {
    expect(isValidUUID("not-a-uuid")).toBe(false);
    expect(isValidUUID("550e8400-e29b-41d4-a716")).toBe(false);
    expect(isValidUUID("' OR 1=1--")).toBe(false);
    expect(isValidUUID("../../etc/passwd")).toBe(false);
  });

  it("rejects UUIDs with injected characters", () => {
    expect(isValidUUID("550e8400-e29b-41d4-a716-44665544000<")).toBe(false);
  });
});

describe("isValidEthAddress", () => {
  it("accepts valid Ethereum addresses", () => {
    expect(isValidEthAddress("0x1933D67CDB911653765e84758f47c60A1E868bC0")).toBe(true);
    expect(isValidEthAddress("0x0000000000000000000000000000000000000000")).toBe(true);
  });

  it("rejects invalid addresses", () => {
    expect(isValidEthAddress("0xGGGG")).toBe(false);
    expect(isValidEthAddress("1933D67CDB911653765e84758f47c60A1E868bC0")).toBe(false);
    expect(isValidEthAddress("'; DROP TABLE agents; --")).toBe(false);
    expect(isValidEthAddress("0x" + "a".repeat(41))).toBe(false);
  });
});
