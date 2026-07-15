// Headless CLI: render a C program's memory diagram to SVG (or text) at a
// chosen point in execution — handy for generating figures for problem sets.
//
//   npm run cli -- program.c --line 8 -o diagram.svg
//   npm run cli -- program.c --text
//
// The heavy lifting is the same interpreter + diagram model the web app uses;
// this file is just argument parsing and file I/O.

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./interpreter/interpreter";
import { renderMemorySvg, renderMemoryText } from "./render/svgRenderer";

interface Args {
  input?: string;
  line?: number;
  note?: string;
  step?: number;
  out?: string;
  text: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { text: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--text" || a === "-t") args.text = true;
    else if (a === "--line" || a === "-l") args.line = Number(argv[++i]);
    else if (a === "--note") args.note = argv[++i];
    else if (a === "--step" || a === "-s") args.step = Number(argv[++i]);
    else if (a === "--out" || a === "-o") args.out = argv[++i];
    else if (!a.startsWith("-")) args.input = a;
  }
  return args;
}

const USAGE = `cmemoryviz — render a C program's memory diagram

Usage:
  cmemoryviz <program.c> [options]

Options:
  -l, --line <n>     Show the state just before source line <n> runs
      --note <s>     Prefer the step with this note (e.g. "return")
  -s, --step <n>     Show trace step <n> (0-based) instead of a line
  -o, --out <file>   Write SVG to <file> (default: stdout)
  -t, --text         Render a plain-text table instead of SVG
  -h, --help         Show this help

Without --line/--step, the final state before the program ends is shown.`;

// Returns a process exit code. I/O is done here; callers in tests can pass an
// argv and inspect the written file.
export function main(argv: string[]): number {
  const args = parseArgs(argv);

  if (args.help || !args.input) {
    (args.input ? process.stdout : process.stderr).write(USAGE + "\n");
    return args.input || args.help ? 0 : 1;
  }

  let source: string;
  try {
    source = readFileSync(args.input, "utf8");
  } catch {
    process.stderr.write(`error: cannot read '${args.input}'\n`);
    return 1;
  }

  const result = run(source);
  if (result.error) {
    const loc = result.error.line ? ` (line ${result.error.line})` : "";
    process.stderr.write(`error: ${result.error.message}${loc}\n`);
    return 1;
  }
  if (result.steps.length === 0) {
    process.stderr.write("error: program produced no execution steps\n");
    return 1;
  }

  // Pick the step to render.
  let index: number;
  if (args.step !== undefined) {
    index = Math.max(0, Math.min(result.steps.length - 1, args.step));
  } else if (args.line !== undefined) {
    const found = result.steps.findIndex(
      (s) => s.line === args.line && (!args.note || s.note === args.note)
    );
    if (found < 0) {
      process.stderr.write(
        `error: no execution step at line ${args.line}` +
          (args.note ? ` with note "${args.note}"` : "") +
          "\n"
      );
      return 1;
    }
    index = found;
  } else {
    index = result.steps.length - 1;
  }

  const step = result.steps[index];
  const where = args.step !== undefined ? `step ${index}` : `line ${step.line}`;
  const title = `${basename(args.input)} — ${where}`;
  const opts = { functionAddrs: result.functionAddrs, title };

  const output = args.text
    ? renderMemoryText(step.snapshot, opts)
    : renderMemorySvg(step.snapshot, opts);

  if (args.out) {
    writeFileSync(args.out, output);
    process.stdout.write(`Wrote ${args.out} (${where}).\n`);
  } else {
    process.stdout.write(output + "\n");
  }
  return 0;
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
