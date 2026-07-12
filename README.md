# CMemoryViz

A browser-based visualizer for **C memory models** in the **CSC 209 style** —
type C on the left, watch the `Section / Address / Value / Label` memory diagram
build up on the right, and step through execution one statement at a time.

Inspired by [MemoryViz](https://github.com/david-yz-liu/memory-viz) (which does
this for Python), but rebuilt around C's address-based memory model: explicit
hex addresses, Read-only / Heap / Stack sections, separated & labeled stack
frames, literal pointer addresses with arrows, and `???` for uninitialized
memory.

## How it works

Everything runs client-side. There is **no real C compiler** — instead a small
tree-walking interpreter executes a subset of C and models memory the way the
course does:

```
src/interpreter/
  lexer.ts        C tokenizer
  parser.ts       recursive-descent parser -> AST
  ast.ts          AST + C type definitions
  memory.ts       sections, deterministic "clean" address allocator, typed cells
  interpreter.ts  evaluator; records a memory snapshot before every statement
src/components/
  CodeEditor.tsx    Monaco editor (VSCode look) + toggleable Vim mode
  MemoryDiagram.tsx SVG table renderer + pointer arrows
  Controls.tsx      run / step / scrub the execution trace
```

The interpreter runs the whole program and records a **snapshot before each
statement**. The UI scrubs through that trace, so stopping "exactly before the
`return` on line 8" (as exam questions phrase it) is just an index into the
trace.

### Address conventions (to match the handout)

- `int` / pointer / `float` = 4 bytes, 4-byte aligned; `double` = 8 bytes,
  8-byte aligned; `char` = 1 byte.
- Fixed section bases: Read-only `0x104`, Globals `0x1a0`, Heap `0x240`,
  Stack `0x444`. Functions get pseudo-addresses from `0x50` (the "code"
  region) so function pointers have real values.
- Each function call pushes a labeled frame at a higher address.
- Uninitialized cells render as `???`; globals are zero-initialized like real C.

## Running

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # interpreter tests (reproduces the sumpairs midterm exactly)
npm run build
```

## Supported C subset

- Functions, calls, recursion, `return`; **function pointers**
  (`int (*fp)(int, int)`, `fp = add`, `(*fp)(...)`, fp parameters)
- `int`, `char`, `void`, `float`, `double`, pointers, arrays (incl.
  `int arr[] = {...}`, **multidimensional** `int m[2][2] = {{...},{...}}`),
  `struct` (incl. `{...}` initializers)
- **Global variables** (own diagram section, zero-initialized)
- Strings: `char s[] = "hi"` (bytes on the stack) and `char *s = "hi"`
  (read-only section), both rendered byte-by-byte with `'\0'`
- `malloc` / `calloc` / `free`, `sizeof`, casts, `strlen`
- Arithmetic (float-aware), comparison, logical, bitwise ops; pointer arithmetic
- `if` / `else`, `while`, `for`, `break`, `continue`
- `printf` (`%d %i %u %c %s %f %g %p %x %%`) -> captured stdout
- `&`, `*`, `[]`, `.`, `->`, pre/post `++`/`--`

## Features

- **Step & scrub** through execution; per-cell sub-labels (`[i]`, `.field`,
  `[1][0]`) next to each row.
- **Breakpoints**: click the gutter; Run stops at the first hit,
  `▶▶ Continue` jumps to the next. Perfect for "state exactly before line N".
- **Error squiggles** for parse and runtime errors, plus teaching-grade
  diagnostics: dangling-pointer reads name the freed block, double free,
  invalid free, uninitialized reads include the address.
- **Dangling pointers** render with a `⚠` in the diagram; function-pointer
  cells show the function's name.
- **Arrow routing** assigns each pointer arrow its own channel (fewest
  crossings).
- **Export** the diagram as SVG or PNG for problem sets.
- **Exam mode**: values and labels become blank inputs — fill in the diagram
  at any step, then Check (lenient grading: hex case, `NULL`/`0`, `???`,
  quoted or bare chars) or Reveal.
- Built-in **sample programs** (menu, top right) covering every feature.

## Roadmap

- Watch expressions / hover a variable to highlight its cell
- Diff view: highlight cells changed since the previous step
- Shareable links (encode the program in the URL)
- More of libc: `strcpy`, `strcat`, `memcpy`, `realloc`
- Structs returned by value, unions, `typedef`
