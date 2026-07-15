// A small hand-written C lexer for the supported subset.

export type TokenType =
  "keyword" | "identifier" | "number" | "char" | "string" | "punct" | "eof";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
}

const KEYWORDS = new Set([
  "int",
  "char",
  "void",
  "float",
  "double",
  "struct",
  "union",
  "enum",
  "typedef",
  "return",
  "if",
  "else",
  "while",
  "for",
  "break",
  "continue",
  "sizeof",
  "unsigned",
  "const",
]);

// Multi-character punctuators, longest first so we match greedily.
const PUNCT = [
  "<<=",
  ">>=",
  "->",
  "++",
  "--",
  "<<",
  ">>",
  "<=",
  ">=",
  "==",
  "!=",
  "&&",
  "||",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  ";",
  ",",
  "=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "!",
  "&",
  "|",
  "^",
  "~",
  ".",
  "?",
  ":",
];

export class LexError extends Error {
  constructor(
    message: string,
    public line: number
  ) {
    super(`Line ${line}: ${message}`);
  }
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;

  const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
  const isIdentPart = (c: string) => /[A-Za-z0-9_]/.test(c);
  const isDigit = (c: string) => /[0-9]/.test(c);

  while (i < n) {
    const c = src[i];

    // Newlines / whitespace
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }

    // Line comments
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    // Block comments
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    // Preprocessor directives: ignore the whole line (e.g. #include, #define)
    if (c === "#") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }

    // Numbers: decimal ints, hex (0x..), and floats (1.5, 2e3, 1.5e-2)
    if (isDigit(c)) {
      const start = i;
      if (c === "0" && (src[i + 1] === "x" || src[i + 1] === "X")) {
        i += 2;
        while (i < n && /[0-9a-fA-F]/.test(src[i])) i++;
        // integer suffixes (u/U/l/L) — consumed and ignored
        while (i < n && /[uUlL]/.test(src[i])) i++;
      } else {
        while (i < n && isDigit(src[i])) i++;
        if (src[i] === "." && isDigit(src[i + 1])) {
          i++;
          while (i < n && isDigit(src[i])) i++;
        }
        if (
          (src[i] === "e" || src[i] === "E") &&
          (isDigit(src[i + 1]) ||
            ((src[i + 1] === "+" || src[i + 1] === "-") && isDigit(src[i + 2])))
        ) {
          i += 2;
          while (i < n && isDigit(src[i])) i++;
        }
        // suffixes (f/F/u/U/l/L) — consumed and ignored
        while (i < n && /[fFuUlL]/.test(src[i])) i++;
      }
      tokens.push({ type: "number", value: src.slice(start, i), line });
      continue;
    }

    // Identifiers / keywords
    if (isIdentStart(c)) {
      const start = i;
      while (i < n && isIdentPart(src[i])) i++;
      const value = src.slice(start, i);
      tokens.push({
        type: KEYWORDS.has(value) ? "keyword" : "identifier",
        value,
        line,
      });
      continue;
    }

    // Char literal
    if (c === "'") {
      i++;
      let value: string;
      if (src[i] === "\\") {
        value = src.slice(i, i + 2);
        i += 2;
      } else {
        value = src[i];
        i++;
      }
      if (src[i] !== "'") throw new LexError("unterminated char literal", line);
      i++;
      tokens.push({ type: "char", value, line });
      continue;
    }

    // String literal
    if (c === '"') {
      i++;
      let str = "";
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\") {
          str += src[i] + src[i + 1];
          i += 2;
        } else {
          str += src[i];
          i++;
        }
      }
      if (i >= n) throw new LexError("unterminated string literal", line);
      i++;
      tokens.push({ type: "string", value: str, line });
      continue;
    }

    // Punctuators
    let matched = false;
    for (const p of PUNCT) {
      if (src.startsWith(p, i)) {
        tokens.push({ type: "punct", value: p, line });
        i += p.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    throw new LexError(`unexpected character '${c}'`, line);
  }

  tokens.push({ type: "eof", value: "", line });
  return tokens;
}
