// A compact breadcrumb of the active call stack at the current step. Hovering a
// frame highlights its cells in the diagram; clicking scrolls the diagram to it.

interface FrameInfo {
  id: number;
  funcName: string;
}

interface Props {
  frames: FrameInfo[];
  highlightFrameId?: number | null;
  onHoverFrame: (frameId: number | null) => void;
  onSelectFrame: (frameId: number) => void;
}

export function CallStackPanel({
  frames,
  highlightFrameId,
  onHoverFrame,
  onSelectFrame,
}: Props) {
  if (frames.length === 0) return null;

  return (
    <div className="callstack" aria-label="Call stack">
      <span className="callstack-label">call stack</span>
      {frames.map((f, i) => (
        <span key={f.id} className="callstack-item">
          {i > 0 && <span className="callstack-sep">›</span>}
          <button
            className={
              highlightFrameId === f.id ? "callstack-frame active" : "callstack-frame"
            }
            onMouseEnter={() => onHoverFrame(f.id)}
            onMouseLeave={() => onHoverFrame(null)}
            onClick={() => onSelectFrame(f.id)}
            title={`Scroll to ${f.funcName}()`}
          >
            {f.funcName}
          </button>
        </span>
      ))}
    </div>
  );
}
