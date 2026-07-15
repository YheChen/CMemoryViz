// Differential testing: for each program in test/corpus, compile & run it with
// a real C compiler and assert our interpreter produces the same stdout. This
// validates the interpreter against ground truth on every CI run (GitHub's
// ubuntu runners have gcc). Skips gracefully when no compiler is available.

import { describe, it, expect } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/interpreter/interpreter";

const CORPUS_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "corpus");

function findCompiler(): string | null {
  for (const cc of ["cc", "gcc", "clang"]) {
    try {
      execSync(`${cc} --version`, { stdio: "ignore" });
      return cc;
    } catch {
      // try next
    }
  }
  return null;
}

const compiler = findCompiler();
const programs = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".c"));

function compileAndRun(cc: string, sourcePath: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cmemviz-"));
  const bin = join(dir, "a.out");
  try {
    execFileSync(cc, ["-std=c11", "-w", "-o", bin, sourcePath]);
    return execFileSync(bin, [], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const suite = compiler ? describe : describe.skip;

suite(`differential vs ${compiler ?? "C compiler"}`, () => {
  it("has a non-empty corpus", () => {
    expect(programs.length).toBeGreaterThan(0);
  });

  for (const file of programs) {
    it(`${file} matches the compiler's output`, () => {
      const sourcePath = join(CORPUS_DIR, file);
      const source = readFileSync(sourcePath, "utf8");

      const expected = compileAndRun(compiler!, sourcePath);

      const result = run(source);
      expect(result.error, `interpreter error: ${result.error?.message}`).toBeUndefined();

      expect(result.output).toBe(expected);
    });
  }
});

// A tiny self-check that always runs, so the file isn't a no-op when gcc is
// missing (e.g. on a contributor's machine without a compiler).
describe("corpus sanity", () => {
  it("every corpus program runs in the interpreter without error", () => {
    for (const file of programs) {
      const source = readFileSync(join(CORPUS_DIR, file), "utf8");
      const result = run(source);
      expect(result.error, `${file}: ${result.error?.message}`).toBeUndefined();
    }
  });

  it("captures the same non-empty output shape regardless of compiler", () => {
    // Guards against accidentally shipping programs with no printf output.
    for (const file of programs) {
      const source = readFileSync(join(CORPUS_DIR, file), "utf8");
      expect(run(source).output.length, `${file} produced no output`).toBeGreaterThan(0);
    }
  });
});
