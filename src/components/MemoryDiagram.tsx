// Renders a memory snapshot as the CSC 209 "Section / Address / Value / Label"
// table, with arrows drawn from pointer cells to the rows they point at.
//
// Arrow routing: each arrow gets a vertical "channel" to the right of the
// table. Channels are assigned greedily (shortest spans first, reusing a
// channel whenever spans don't overlap), which keeps crossings to a minimum.

import { useMemo, useRef } from "react";
import type { MemorySnapshot } from "../interpreter/memory";
import {
  buildGroups,
  formatValue,
  hex,
  isPointer,
  ROW_H,
  HEADER_H,
} from "./diagramModel";

// Column x positions
const X = {
  section: 14,
  frame: 92,
  addr: 176,
  value: 262,
  valueEnd: 372,
  label: 388,
  labelEnd: 540,
};
const ARROW_X0 = 372; // arrows leave from here
const CHANNEL_BASE = X.labelEnd + 18;
const CHANNEL_STEP = 14;
const BASE_WIDTH = CHANNEL_BASE + 24;

interface Props {
  snapshot: MemorySnapshot | null;
  functionAddrs?: Record<number, string>;
  // Cells that changed in the step being shown (highlighted).
  changedAddrs?: Set<number>;
}

interface Arrow {
  fromY: number;
  toY: number;
  channel: number;
}

// Assign channels: shortest arrows hug the table; overlapping spans get
// pushed further out. Greedy interval partitioning.
function routeArrows(raw: { fromY: number; toY: number }[]): {
  arrows: Arrow[];
  channelCount: number;
} {
  const spans = raw
    .map((a) => ({
      ...a,
      top: Math.min(a.fromY, a.toY),
      bot: Math.max(a.fromY, a.toY),
    }))
    .sort((p, q) => p.bot - p.top - (q.bot - q.top));
  const channels: { top: number; bot: number }[][] = [];
  const arrows: Arrow[] = [];
  for (const s of spans) {
    let ch = 0;
    while (channels[ch]?.some((o) => !(s.bot < o.top - 8 || s.top > o.bot + 8))) {
      ch++;
    }
    (channels[ch] ||= []).push({ top: s.top, bot: s.bot });
    arrows.push({ fromY: s.fromY, toY: s.toY, channel: ch });
  }
  return { arrows, channelCount: channels.length };
}

// ---- SVG / PNG export ----------------------------------------------------
// The SVG is styled via CSS classes + variables, which don't survive outside
// the page. Exporting clones the tree and inlines computed styles.

const STYLE_PROPS = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "opacity",
  "text-anchor",
];

function inlineStyles(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  let style = "";
  for (const p of STYLE_PROPS) {
    const v = cs.getPropertyValue(p);
    if (v) style += `${p}:${v};`;
  }
  dst.setAttribute("style", style);
  dst.removeAttribute("class");
  for (let i = 0; i < src.children.length; i++) {
    inlineStyles(src.children[i], dst.children[i]);
  }
}

function serializeSvg(svgEl: SVGSVGElement): string {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  inlineStyles(svgEl, clone);
  // Solid background so the export is readable anywhere.
  const bgColor =
    getComputedStyle(document.documentElement).getPropertyValue("--bg-panel").trim() ||
    "#181825";
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", bgColor);
  clone.insertBefore(bg, clone.firstChild);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(clone);
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportSvg(svgEl: SVGSVGElement) {
  const src = serializeSvg(svgEl);
  download("memory-diagram.svg", new Blob([src], { type: "image/svg+xml" }));
}

function exportPng(svgEl: SVGSVGElement) {
  const src = serializeSvg(svgEl);
  const url = URL.createObjectURL(new Blob([src], { type: "image/svg+xml" }));
  const img = new Image();
  img.onload = () => {
    const scale = 2; // 2x for crisp text
    const canvas = document.createElement("canvas");
    canvas.width = svgEl.width.baseVal.value * scale;
    canvas.height = svgEl.height.baseVal.value * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (blob) download("memory-diagram.png", blob);
    }, "image/png");
  };
  img.src = url;
}

// ---------------------------------------------------------------------------

export function MemoryDiagram({ snapshot, functionAddrs, changedAddrs }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const built = useMemo(() => (snapshot ? buildGroups(snapshot) : null), [snapshot]);

  if (!snapshot || !built) {
    return (
      <div className="diagram-empty">Run the program to see the memory diagram.</div>
    );
  }

  const { groups, height } = built;

  // Map address -> row center y, for arrow targets.
  const addrToY = new Map<number, number>();
  for (const g of groups)
    for (const r of g.rows) addrToY.set(r.cell.address, r.y + ROW_H / 2);

  // Collect pointer arrows and dangling pointers.
  const rawArrows: { fromY: number; toY: number }[] = [];
  const danglingAddrs = new Set<number>();
  for (const g of groups) {
    for (const r of g.rows) {
      const { cell } = r;
      if (!isPointer(cell.type) || cell.value === undefined || cell.value === 0) continue;
      if (functionAddrs?.[cell.value]) continue; // function pointer: shown by name
      const toY = addrToY.get(cell.value);
      if (toY !== undefined) {
        rawArrows.push({ fromY: r.y + ROW_H / 2, toY });
      } else {
        // Points at memory that no longer (or never) exists.
        danglingAddrs.add(cell.address);
      }
    }
  }
  const { arrows, channelCount } = routeArrows(rawArrows);
  const width = BASE_WIDTH + channelCount * CHANNEL_STEP;

  return (
    <div className="diagram-area">
      <div className="diagram-toolbar">
        <button
          className="btn mini"
          onClick={() => svgRef.current && exportSvg(svgRef.current)}
        >
          ⭳ SVG
        </button>
        <button
          className="btn mini"
          onClick={() => svgRef.current && exportPng(svgRef.current)}
        >
          ⭳ PNG
        </button>
      </div>
      <div className="diagram-scroll">
        <svg
          ref={svgRef}
          className="diagram-svg"
          width={width}
          height={height}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L6,3 L0,6 Z" fill="var(--arrow)" />
            </marker>
          </defs>

          {/* Header */}
          <g className="diagram-header">
            <text x={X.section} y={22}>
              Section
            </text>
            <text x={X.addr} y={22}>
              Address
            </text>
            <text x={X.value} y={22}>
              Value
            </text>
            <text x={X.label} y={22}>
              Label
            </text>
            <line
              x1={0}
              y1={HEADER_H - 4}
              x2={X.labelEnd}
              y2={HEADER_H - 4}
              className="rule"
            />
          </g>

          {/* Groups */}
          {groups.map((g, gi) => (
            <g key={gi}>
              {g.sectionLabel && (
                <text x={X.section} y={g.startY + 20} className="section-label">
                  {g.sectionLabel}
                </text>
              )}
              {g.frameLabel && (
                <>
                  <text x={X.frame} y={g.startY + 20} className="frame-label">
                    {g.frameLabel}
                  </text>
                  {/* bracket spanning the frame */}
                  <path
                    d={`M ${X.frame - 8} ${g.startY + 4} q -8 0 -8 8 L ${X.frame - 16} ${
                      g.endY - 12
                    } q 0 8 8 8`}
                    className="frame-bracket"
                    fill="none"
                  />
                </>
              )}
              {g.rows.map((r, ri) => {
                const dangling = danglingAddrs.has(r.cell.address);
                const fnName =
                  isPointer(r.cell.type) && r.cell.value !== undefined
                    ? functionAddrs?.[r.cell.value]
                    : undefined;
                const changed = changedAddrs?.has(r.cell.address);
                return (
                  <g key={ri} className="cell-row">
                    <rect
                      x={X.addr - 6}
                      y={r.y + 3}
                      width={X.valueEnd - X.addr + 12}
                      height={ROW_H - 6}
                      rx={3}
                      className={[
                        "cell-box",
                        r.cell.value === undefined ? "cell-uninit" : "",
                        changed ? "cell-changed" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                    <text x={X.addr} y={r.y + 20} className="addr">
                      {hex(r.cell.address)}
                    </text>
                    <text
                      x={X.value}
                      y={r.y + 20}
                      className={
                        dangling
                          ? "value value-dangling"
                          : fnName
                            ? "value value-fn"
                            : isPointer(r.cell.type)
                              ? "value value-ptr"
                              : "value"
                      }
                    >
                      {formatValue(r.cell, functionAddrs) + (dangling ? " ⚠" : "")}
                    </text>
                    {r.blockName && (
                      <text x={X.label} y={r.y + 20} className="var-label">
                        {r.blockName}
                      </text>
                    )}
                    {r.subLabel && (
                      <text
                        x={X.labelEnd}
                        y={r.y + 20}
                        className="sub-label"
                        textAnchor="end"
                      >
                        {r.subLabel}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          ))}

          {/* Pointer arrows */}
          {arrows.map((a, i) => {
            const cx = CHANNEL_BASE + a.channel * CHANNEL_STEP;
            return (
              <path
                key={i}
                d={`M ${ARROW_X0} ${a.fromY} H ${cx} V ${a.toY} H ${X.valueEnd + 6}`}
                className="pointer-arrow"
                fill="none"
                markerEnd="url(#arrowhead)"
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
