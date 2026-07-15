import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, parseArgs } from "../src/cli";

const PROGRAM = `int main() {
    int *p = malloc(2 * sizeof(int));
    p[0] = 10;
    p[1] = 20;
    return 0;
}`;

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "cmemviz-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

afterEach(() => vi.restoreAllMocks());

describe("parseArgs", () => {
  it("parses input, flags, and values", () => {
    const a = parseArgs(["prog.c", "--line", "8", "--note", "return", "-o", "out.svg"]);
    expect(a).toMatchObject({ input: "prog.c", line: 8, note: "return", out: "out.svg" });
  });
  it("supports short flags and --text", () => {
    const a = parseArgs(["prog.c", "-l", "3", "-t"]);
    expect(a).toMatchObject({ input: "prog.c", line: 3, text: true });
  });
});

describe("cli main", () => {
  it("writes an SVG file for a target line", () => {
    withTempDir((dir) => {
      const src = join(dir, "p.c");
      const out = join(dir, "out.svg");
      writeFileSync(src, PROGRAM);
      vi.spyOn(process.stdout, "write").mockReturnValue(true);

      const code = main([src, "--line", "5", "-o", out]);
      expect(code).toBe(0);

      const svg = readFileSync(out, "utf8");
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain("0x240"); // the heap block p points to
    });
  });

  it("renders text to stdout with --text", () => {
    withTempDir((dir) => {
      const src = join(dir, "p.c");
      writeFileSync(src, PROGRAM);
      const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);

      const code = main([src, "--text"]);
      expect(code).toBe(0);
      const printed = out.mock.calls.map((c) => c[0]).join("");
      expect(printed).toContain("SECTION");
      expect(printed).toContain("0x240");
    });
  });

  it("returns 1 for a missing file", () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(main(["/no/such/file.c"])).toBe(1);
  });

  it("returns 1 when the target line has no step", () => {
    withTempDir((dir) => {
      const src = join(dir, "p.c");
      writeFileSync(src, PROGRAM);
      vi.spyOn(process.stderr, "write").mockReturnValue(true);
      expect(main([src, "--line", "999"])).toBe(1);
    });
  });

  it("returns 1 and reports interpreter errors", () => {
    withTempDir((dir) => {
      const src = join(dir, "bad.c");
      writeFileSync(src, "int main() { return @; }");
      const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      expect(main([src])).toBe(1);
      expect(err.mock.calls.map((c) => c[0]).join("")).toContain("error:");
    });
  });

  it("--help returns 0", () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(main(["--help"])).toBe(0);
  });
});
