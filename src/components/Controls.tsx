// Stepper controls: run, scrub through the recorded execution trace, and
// continue to the next breakpoint.

interface Props {
  onRun: () => void;
  onContinue: () => void;
  hasBreakpoints: boolean;
  stepIndex: number;
  stepCount: number;
  onSeek: (i: number) => void;
  currentLine: number | null;
  note?: string;
}

export function Controls({
  onRun,
  onContinue,
  hasBreakpoints,
  stepIndex,
  stepCount,
  onSeek,
  currentLine,
  note,
}: Props) {
  const hasSteps = stepCount > 0;
  const atStart = stepIndex <= 0;
  const atEnd = stepIndex >= stepCount - 1;

  return (
    <div className="controls">
      <button className="btn primary" onClick={onRun} title="Interpret the code">
        ▶ Run
      </button>
      <div className="stepper">
        <button className="btn" disabled={!hasSteps || atStart} onClick={() => onSeek(0)}>
          ⏮
        </button>
        <button
          className="btn"
          disabled={!hasSteps || atStart}
          onClick={() => onSeek(stepIndex - 1)}
        >
          ◀ Step
        </button>
        <button
          className="btn"
          disabled={!hasSteps || atEnd}
          onClick={() => onSeek(stepIndex + 1)}
        >
          Step ▶
        </button>
        {hasBreakpoints && (
          <button
            className="btn"
            disabled={!hasSteps || atEnd}
            onClick={onContinue}
            title="Continue to the next breakpoint"
          >
            ▶▶ Continue
          </button>
        )}
        <button
          className="btn"
          disabled={!hasSteps || atEnd}
          onClick={() => onSeek(stepCount - 1)}
        >
          ⏭
        </button>
      </div>
      <input
        className="scrubber"
        type="range"
        min={0}
        max={Math.max(0, stepCount - 1)}
        value={stepIndex < 0 ? 0 : stepIndex}
        disabled={!hasSteps}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      <div className="step-info">
        {hasSteps ? (
          <>
            <span className="step-count">
              step {stepIndex + 1}/{stepCount}
            </span>
            {currentLine != null && <span className="step-line">line {currentLine}</span>}
            {note && <span className="step-note">{note}</span>}
          </>
        ) : (
          <span className="muted">not run</span>
        )}
      </div>
    </div>
  );
}
