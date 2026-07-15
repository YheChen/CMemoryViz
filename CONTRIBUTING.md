# Contributing to CMemoryViz

Thanks for your interest in improving CMemoryViz! This project is a browser-based
C memory-model visualizer, and contributions of all kinds are welcome — bug
reports, new sample programs, interpreter features, and diagram improvements.

## Getting set up

```bash
git clone https://github.com/YheChen/CMemoryViz.git
cd CMemoryViz
npm install
npm run dev      # http://localhost:5173
```

## Before you open a pull request

Please make sure the full check suite passes locally — it's exactly what CI runs:

```bash
npm run lint          # ESLint
npm run format:check  # Prettier (run `npm run format` to auto-fix)
npx tsc --noEmit      # type-check
npm test              # Vitest
npm run build         # production build
```

## Project layout

- `src/interpreter/` — the engine (lexer → parser → interpreter → memory model).
  It has **no UI dependencies** and is fully unit-tested; most language work
  happens here.
- `src/components/` — React + SVG UI (editor, diagram, exam mode, etc.).
- `src/challenges.ts` — the practice-problem bank.

## Guidelines

- **Add tests.** New interpreter behavior should come with Vitest coverage. The
  interpreter is a pure `string -> trace` function, so tests are easy to write —
  see `src/interpreter/*.test.ts`.
- **Match the surrounding style.** Prettier and ESLint are enforced in CI.
- **Keep the memory model faithful.** Address conventions (sizes, alignment,
  section bases) intentionally mirror the CSC 209 teaching model; discuss changes
  to them in an issue first.
- **Small, focused PRs** are easiest to review.

## Reporting bugs

Open an issue using the bug report template and include the C snippet that
reproduces the problem — a [shareable link](https://c-memory-viz.vercel.app) is
even better.

By contributing, you agree that your contributions will be licensed under the
project's [MIT License](LICENSE).
