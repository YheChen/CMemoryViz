// Shareable links: the whole app state (program, step, breakpoints, exam
// mode) is encoded into the URL hash, so a link reproduces the exact view —
// e.g. "here's the memory state just before line 8, fill it in."

export interface SharedState {
  v: 1;
  src: string;
  step?: number; // step index to land on
  bps?: number[]; // breakpoint lines
  exam?: boolean;
}

// base64url so the payload survives in a URL hash without escaping.
function toBase64Url(s: string): string {
  const utf8 = new TextEncoder().encode(s);
  let bin = "";
  for (const b of utf8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeShareState(state: SharedState): string {
  return toBase64Url(JSON.stringify(state));
}

export function decodeShareState(hash: string): SharedState | null {
  const payload = hash.replace(/^#/, "");
  if (!payload) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(payload));
    if (parsed?.v !== 1 || typeof parsed.src !== "string") return null;
    return parsed as SharedState;
  } catch {
    return null;
  }
}

export function buildShareUrl(state: SharedState): string {
  return `${location.origin}${location.pathname}#${encodeShareState(state)}`;
}
