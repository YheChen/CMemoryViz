// Monaco-based C editor. Monaco gives us the VSCode look for free; monaco-vim
// layers a Vim mode on top, toggleable at runtime. Clicking the gutter toggles
// breakpoints; parse/runtime errors surface as squiggles.

import { useEffect, useRef } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
// @ts-ignore - monaco-vim ships without types
import { initVimMode } from "monaco-vim";

interface Props {
  value: string;
  onChange: (value: string) => void;
  vim: boolean;
  highlightLine: number | null;
  breakpoints: Set<number>;
  onToggleBreakpoint: (line: number) => void;
  error: { message: string; line?: number } | null;
}

export function CodeEditor({
  value,
  onChange,
  vim,
  highlightLine,
  breakpoints,
  onToggleBreakpoint,
  error,
}: Props) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const vimModeRef = useRef<{ dispose: () => void } | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const lineDecorations = useRef<string[]>([]);
  const bpDecorations = useRef<string[]>([]);
  // Keep the latest callback without re-registering the mouse listener.
  const toggleRef = useRef(onToggleBreakpoint);
  toggleRef.current = onToggleBreakpoint;

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    applyVim(vim);
    // Gutter click -> toggle breakpoint.
    editor.onMouseDown((e) => {
      const t = e.target;
      if (
        t.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        t.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
      ) {
        if (t.position) toggleRef.current(t.position.lineNumber);
      }
    });
    renderBreakpoints();
  };

  function applyVim(enable: boolean) {
    if (!editorRef.current || !statusRef.current) return;
    if (enable && !vimModeRef.current) {
      vimModeRef.current = initVimMode(editorRef.current, statusRef.current);
    } else if (!enable && vimModeRef.current) {
      vimModeRef.current.dispose();
      vimModeRef.current = null;
    }
  }

  useEffect(() => {
    applyVim(vim);
  }, [vim]);

  // Highlight the line the interpreter is about to execute.
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    if (highlightLine == null) {
      lineDecorations.current = editor.deltaDecorations(lineDecorations.current, []);
      return;
    }
    lineDecorations.current = editor.deltaDecorations(lineDecorations.current, [
      {
        range: new monaco.Range(highlightLine, 1, highlightLine, 1),
        options: {
          isWholeLine: true,
          className: "current-line-hl",
        },
      },
    ]);
    editor.revealLineInCenterIfOutsideViewport(highlightLine);
  }, [highlightLine]);

  // Breakpoint dots in the glyph margin.
  function renderBreakpoints() {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    bpDecorations.current = editor.deltaDecorations(
      bpDecorations.current,
      [...breakpoints].map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          glyphMarginClassName: "breakpoint-glyph",
          glyphMarginHoverMessage: { value: "Breakpoint — Run stops here" },
        },
      }))
    );
  }
  useEffect(renderBreakpoints, [breakpoints]);

  // Error squiggles.
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;
    if (!error) {
      monaco.editor.setModelMarkers(model, "cmemoryviz", []);
      return;
    }
    const line = error.line ?? 1;
    const content = model.getLineContent(Math.min(line, model.getLineCount()));
    monaco.editor.setModelMarkers(model, "cmemoryviz", [
      {
        severity: monaco.MarkerSeverity.Error,
        message: error.message,
        startLineNumber: line,
        startColumn: content.length - content.trimStart().length + 1,
        endLineNumber: line,
        endColumn: content.length + 1,
      },
    ]);
  }, [error]);

  return (
    <div className="editor-wrap">
      <Editor
        height="100%"
        defaultLanguage="c"
        theme="vs-dark"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        onMount={onMount}
        options={{
          fontSize: 14,
          minimap: { enabled: false },
          glyphMargin: true,
          scrollBeyondLastLine: false,
          fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, monospace",
          automaticLayout: true,
        }}
      />
      <div ref={statusRef} className="vim-status" />
    </div>
  );
}
