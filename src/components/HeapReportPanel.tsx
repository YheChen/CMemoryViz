// Memory lifecycle report: heap allocation hygiene over the whole run —
// total allocations, frees, and (the exam-relevant part) blocks that were
// never freed. Leaks are what CSC 209 marks you down for.

import type { HeapReport } from "../interpreter/interpreter";

function hex(n: number): string {
  return "0x" + n.toString(16);
}

export function HeapReportPanel({
  report,
  currentStep,
}: {
  report: HeapReport;
  currentStep: number | null;
}) {
  if (report.totalAllocs === 0) return null;

  const balanced = report.leaks.length === 0;

  // Bytes currently live at the scrubbed step (matches the heap in the diagram).
  const liveNow =
    currentStep == null
      ? null
      : report.events
          .filter((e) => e.step <= currentStep)
          .reduce((acc, e) => {
            if (e.kind === "alloc") acc.set(e.address, e.size);
            else acc.delete(e.address);
            return acc;
          }, new Map<number, number>());
  const liveBytes = liveNow ? [...liveNow.values()].reduce((s, b) => s + b, 0) : null;

  return (
    <div className="heap-report">
      <div className="heap-report-head">
        <span className="heap-report-title">Heap report</span>
        <span className={balanced ? "heap-badge heap-ok" : "heap-badge heap-leak"}>
          {balanced
            ? "✓ no leaks"
            : `⚠ ${report.leaks.length} leak${report.leaks.length > 1 ? "s" : ""}`}
        </span>
      </div>

      <div className="heap-stats">
        <span>
          <strong>{report.totalAllocs}</strong> alloc{report.totalAllocs !== 1 ? "s" : ""}{" "}
          ({report.totalBytes} B)
        </span>
        <span>
          <strong>{report.totalFreed}</strong> free{report.totalFreed !== 1 ? "s" : ""}
        </span>
        {liveBytes != null && (
          <span title="Bytes live on the heap at the step you're viewing">
            live now: <strong>{liveBytes} B</strong>
          </span>
        )}
      </div>

      {!balanced && (
        <ul className="heap-leaks">
          {report.leaks.map((l) => (
            <li key={l.address}>
              leaked <code>{l.size} B</code> at <code>{hex(l.address)}</code> — allocated
              on line <strong>{l.line}</strong>, never freed
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
