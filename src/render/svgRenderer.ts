// A dependency-free, DOM-free renderer that turns a memory snapshot into a
// standalone SVG string. Because it reuses the shared `diagramModel` geometry,
// the CLI produces the same layout as the in-browser React diagram — the only
// difference is styles are inlined (no CSS variables) so the SVG is portable.

import type { MemorySnapshot } from "../interpreter/memory";
import {
  buildGroups,
  expectedPointerArrows,
  formatValue,
  hex,
  isPointer,
  ROW_H,
  HEADER_H,
} from "../components/diagramModel";

const X = {
  section: 14,
  frame: 92,
  addr: 176,
  value: 262,
  valueEnd: 372,
  label: 388,
  labelEnd: 540,
};
const ARROW_X0 = 372;
const CHANNEL_BASE = X.labelEnd + 18;
const CHANNEL_STEP = 14;

// Catppuccin-ish palette, matching the app's dark theme.
const C = {
  bg: "#181825",
  fg: "#cdd6f4",
  muted: "#7f849c",
  accent: "#89b4fa",
  accent2: "#a6e3a1",
  rule: "#45475a",
  cell: "#313244",
  uninit: "#45324a",
  valuePtr: "#f9e2af",
  arrow: "#f38ba8",
};

const FONT = "'JetBrains Mono', 'DejaVu Sans Mono', Menlo, monospace";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface RoutedArrow {
  fromY: number;
  toY: number;
  channel: number;
}

function routeArrows(raw: { fromY: number; toY: number }[]): {
  arrows: RoutedArrow[];
  channelCount: number;
} {
  const spans = raw
    .map((a) => ({ ...a, top: Math.min(a.fromY, a.toY), bot: Math.max(a.fromY, a.toY) }))
    .sort((p, q) => p.bot - p.top - (q.bot - q.top));
  const channels: { top: number; bot: number }[][] = [];
  const arrows: RoutedArrow[] = [];
  for (const s of spans) {
    let ch = 0;
    while (channels[ch]?.some((o) => !(s.bot < o.top - 8 || s.top > o.bot + 8))) ch++;
    (channels[ch] ||= []).push({ top: s.top, bot: s.bot });
    arrows.push({ fromY: s.fromY, toY: s.toY, channel: ch });
  }
  return { arrows, channelCount: channels.length };
}

export interface SvgOptions {
  functionAddrs?: Record<number, string>;
  title?: string;
}

export function renderMemorySvg(snap: MemorySnapshot, opts: SvgOptions = {}): string {
  const { functionAddrs, title } = opts;
  const { groups, height } = buildGroups(snap);

  // Map address -> row center y, for arrow endpoints.
  const addrToY = new Map<number, number>();
  for (const g of groups)
    for (const r of g.rows) addrToY.set(r.cell.address, r.y + ROW_H / 2);

  const rawArrows = expectedPointerArrows(snap, functionAddrs)
    .map((a) => {
      const fromY = addrToY.get(a.from);
      const toY = addrToY.get(a.to);
      return fromY !== undefined && toY !== undefined ? { fromY, toY } : null;
    })
    .filter((a): a is { fromY: number; toY: number } => a !== null);
  const { arrows, channelCount } = routeArrows(rawArrows);

  const width = CHANNEL_BASE + Math.max(1, channelCount) * CHANNEL_STEP + 24;
  const titleH = title ? 26 : 0;

  const parts: string[] = [];
  const text = (
    x: number,
    y: number,
    s: string,
    fill: string,
    opt: { weight?: number; style?: string; size?: number } = {}
  ) =>
    `<text x="${x}" y="${y}" fill="${fill}" font-size="${opt.size ?? 13}"` +
    (opt.weight ? ` font-weight="${opt.weight}"` : "") +
    (opt.style ? ` font-style="${opt.style}"` : "") +
    `>${esc(s)}</text>`;

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + titleH}" ` +
      `viewBox="0 0 ${width} ${height + titleH}" font-family="${FONT}">`
  );
  parts.push(
    `<defs><marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">` +
      `<path d="M0,0 L6,3 L0,6 Z" fill="${C.arrow}"/></marker></defs>`
  );
  parts.push(`<rect width="${width}" height="${height + titleH}" fill="${C.bg}"/>`);

  let dy = 0;
  if (title) {
    parts.push(text(X.section, 18, title, C.fg, { weight: 700, size: 14 }));
    dy = titleH;
  }

  // Header
  parts.push(text(X.section, dy + 22, "Section", C.fg, { weight: 700 }));
  parts.push(text(X.addr, dy + 22, "Address", C.fg, { weight: 700 }));
  parts.push(text(X.value, dy + 22, "Value", C.fg, { weight: 700 }));
  parts.push(text(X.label, dy + 22, "Label", C.fg, { weight: 700 }));
  parts.push(
    `<line x1="0" y1="${dy + HEADER_H - 4}" x2="${width}" y2="${dy + HEADER_H - 4}" ` +
      `stroke="${C.rule}" stroke-width="1.5"/>`
  );

  for (const g of groups) {
    if (g.sectionLabel)
      parts.push(
        text(X.section, dy + g.startY + 20, g.sectionLabel, C.accent, { weight: 700 })
      );
    if (g.frameLabel) {
      parts.push(
        text(X.frame, dy + g.startY + 20, g.frameLabel, C.accent2, { weight: 600 })
      );
      parts.push(
        `<path d="M ${X.frame - 8} ${dy + g.startY + 4} q -8 0 -8 8 L ${X.frame - 16} ${
          dy + g.endY - 12
        } q 0 8 8 8" fill="none" stroke="${C.accent2}" stroke-width="1.5" opacity="0.7"/>`
      );
    }
    for (const r of g.rows) {
      const y = dy + r.y;
      const uninit = r.cell.value === undefined;
      parts.push(
        `<rect x="${X.addr - 6}" y="${y + 3}" width="${X.valueEnd - X.addr + 12}" height="${
          ROW_H - 6
        }" rx="3" fill="${uninit ? C.uninit : C.cell}" stroke="${C.rule}" stroke-width="1"${
          uninit ? ' stroke-dasharray="4 3"' : ""
        }/>`
      );
      parts.push(text(X.addr, y + 20, hex(r.cell.address), C.muted));
      const vFill = isPointer(r.cell.type) ? C.valuePtr : C.fg;
      parts.push(
        text(X.value, y + 20, formatValue(r.cell, functionAddrs), vFill, { weight: 600 })
      );
      const label = [r.blockName, r.subLabel].filter(Boolean).join(" ");
      if (label) parts.push(text(X.label, y + 20, label, C.fg, { style: "italic" }));
    }
  }

  for (const a of arrows) {
    const cx = CHANNEL_BASE + a.channel * CHANNEL_STEP;
    parts.push(
      `<path d="M ${ARROW_X0} ${dy + a.fromY} H ${cx} V ${dy + a.toY} H ${X.valueEnd + 6}" ` +
        `fill="none" stroke="${C.arrow}" stroke-width="1.5" marker-end="url(#ah)"/>`
    );
  }

  parts.push("</svg>");
  return parts.join("\n");
}

// A plain-text rendering of the same table, for terminals / quick inspection.
export function renderMemoryText(snap: MemorySnapshot, opts: SvgOptions = {}): string {
  const { groups } = buildGroups(snap);
  const lines: string[] = [];
  if (opts.title) lines.push(opts.title, "");
  lines.push(pad("SECTION", 12) + pad("ADDRESS", 10) + pad("VALUE", 14) + "LABEL");
  lines.push("-".repeat(52));
  for (const g of groups) {
    const head = [g.sectionLabel, g.frameLabel && `frame: ${g.frameLabel}`]
      .filter(Boolean)
      .join(" · ");
    if (head) lines.push(head);
    for (const r of g.rows) {
      const label = [r.blockName, r.subLabel].filter(Boolean).join(" ");
      lines.push(
        pad("", 12) +
          pad(hex(r.cell.address), 10) +
          pad(formatValue(r.cell, opts.functionAddrs), 14) +
          label
      );
    }
  }
  return lines.join("\n") + "\n";
}

function pad(s: string, n: number): string {
  return s.length >= n ? s + " " : s + " ".repeat(n - s.length);
}
