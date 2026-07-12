import { describe, it, expect } from "vitest";
import { encodeShareState, decodeShareState, SharedState } from "./share";

describe("share links", () => {
  it("roundtrips full state", () => {
    const state: SharedState = {
      v: 1,
      src: 'int main() {\n    char *s = "héllo → wörld";\n    return 0;\n}\n',
      step: 7,
      bps: [3, 8],
      exam: true,
    };
    const decoded = decodeShareState("#" + encodeShareState(state));
    expect(decoded).toEqual(state);
  });

  it("produces URL-safe output", () => {
    // Lots of bytes that would produce + and / in plain base64
    const src = Array.from({ length: 200 }, (_, i) => String.fromCharCode(i % 128)).join("");
    const encoded = encodeShareState({ v: 1, src });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeShareState(encoded)?.src).toBe(src);
  });

  it("rejects garbage and empty hashes", () => {
    expect(decodeShareState("")).toBeNull();
    expect(decodeShareState("#")).toBeNull();
    expect(decodeShareState("#not-base64!!!")).toBeNull();
    expect(decodeShareState("#" + btoa('{"v":2,"src":"x"}'))).toBeNull();
  });
});
