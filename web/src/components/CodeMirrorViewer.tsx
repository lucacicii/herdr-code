import { useEffect, useRef, useState } from 'react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, lineNumbers } from '@codemirror/view';
import { MessageSquarePlus, Quote, Code2 } from 'lucide-react';
import { getGeistCodeTheme, getLanguageExtension } from '../lib/codemirrorLang';
import type { FileContent } from '../types/api';

interface CodeMirrorViewerProps {
  file: FileContent;
  theme: 'light' | 'dark';
  highlightStart?: number;
  highlightEnd?: number;
  onAddLineRef: (path: string, startLine: number, endLine: number) => void;
  onAddSnippetRef: (
    path: string,
    startLine: number,
    endLine: number,
    snippet: string,
    language: string
  ) => void;
  onAddReviewComment: (path: string, startLine: number, endLine: number, text: string) => void;
}

const setHighlightLines = StateEffect.define<{ start: number; end: number } | null>();

const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const eff of tr.effects) {
      if (eff.is(setHighlightLines)) {
        if (!eff.value) return Decoration.none;
        const { start, end } = eff.value;
        const builder = [];
        const maxLines = tr.state.doc.lines;
        const s = Math.max(1, Math.min(start, maxLines));
        const e = Math.max(s, Math.min(end, maxLines));
        for (let ln = s; ln <= e; ln++) {
          const line = tr.state.doc.line(ln);
          builder.push(
            Decoration.line({ class: 'cm-highlight-target-line' }).range(line.from)
          );
        }
        return Decoration.set(builder);
      }
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

interface SelectionInfo {
  startLine: number;
  endLine: number;
  snippet: string;
  top: number;
  left: number;
}

export function CodeMirrorViewer({
  file,
  theme,
  highlightStart,
  highlightEnd,
  onAddLineRef,
  onAddSnippetRef,
  onAddReviewComment,
}: CodeMirrorViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [commentMode, setCommentMode] = useState(false);
  const [commentText, setCommentText] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host || file.is_binary) return;

    setSelection(null);
    setCommentMode(false);
    setCommentText('');

    const state = EditorState.create({
      doc: file.content,
      extensions: [
        lineNumbers(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        highlightField,
        ...getLanguageExtension(file.language || file.path),
        ...getGeistCodeTheme(theme === 'dark'),
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) {
            const sel = update.state.selection.main;
            if (sel.empty) {
              setSelection(null);
              setCommentMode(false);
              return;
            }
            const fromLine = update.state.doc.lineAt(sel.from);
            const toLine = update.state.doc.lineAt(Math.max(sel.from, sel.to - 1));
            const startLine = fromLine.number;
            const endLine = Math.max(startLine, toLine.number);
            const snippet = update.state.doc.sliceString(fromLine.from, toLine.to);

            const coords = update.view.coordsAtPos(sel.from);
            const hostRect = host.getBoundingClientRect();
            const top = coords ? Math.max(8, coords.top - hostRect.top - 42) : 12;
            const left = coords
              ? Math.max(8, Math.min(coords.left - hostRect.left, Math.max(8, hostRect.width - 280)))
              : 16;

            setSelection({ startLine, endLine, snippet, top, left });
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [file.path, file.content, file.is_binary, file.language, theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!highlightStart) {
      view.dispatch({ effects: setHighlightLines.of(null) });
      return;
    }
    const lineNum = Math.max(1, Math.min(highlightStart, view.state.doc.lines));
    const endNum = highlightEnd ? Math.max(lineNum, highlightEnd) : lineNum;
    const line = view.state.doc.line(lineNum);
    view.dispatch({
      effects: [
        setHighlightLines.of({ start: lineNum, end: endNum }),
        EditorView.scrollIntoView(line.from, { y: 'center' }),
      ],
    });
  }, [highlightStart, highlightEnd, file.path, file.content]);

  if (file.is_binary) {
    return (
      <div style={{ padding: 24, color: 'var(--text-secondary)' }}>
        Binary file ({file.size} bytes) cannot be displayed in the code reader.
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />

      {selection && (
        <div
          style={{
            position: 'absolute',
            top: selection.top,
            left: selection.left,
            zIndex: 20,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-popover)',
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxWidth: 'calc(100% - 16px)',
            minWidth: commentMode ? Math.min(280, 300) : 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '0 4px' }}>
              L{selection.startLine}
              {selection.endLine > selection.startLine ? `-${selection.endLine}` : ''}
            </span>
            <button
              className="btn btn-sm"
              onClick={() => {
                onAddLineRef(file.path, selection.startLine, selection.endLine);
                setSelection(null);
              }}
            >
              <Quote size={11} />
              <span>Ref Lines</span>
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                onAddSnippetRef(
                  file.path,
                  selection.startLine,
                  selection.endLine,
                  selection.snippet,
                  file.language
                );
                setSelection(null);
              }}
            >
              <Code2 size={11} />
              <span>Ref Snippet</span>
            </button>
            <button
              className="btn btn-sm btn-accent"
              onClick={() => setCommentMode((v) => !v)}
            >
              <MessageSquarePlus size={11} />
              <span>Comment</span>
            </button>
          </div>

          {commentMode && (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                autoFocus
                placeholder="Write review comment..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && commentText.trim()) {
                    onAddReviewComment(
                      file.path,
                      selection.startLine,
                      selection.endLine,
                      commentText.trim()
                    );
                    setCommentText('');
                    setCommentMode(false);
                    setSelection(null);
                  } else if (e.key === 'Escape') {
                    setCommentMode(false);
                  }
                }}
                style={{ flex: 1, height: 26 }}
              />
              <button
                className="btn btn-sm btn-primary"
                disabled={!commentText.trim()}
                onClick={() => {
                  if (!commentText.trim()) return;
                  onAddReviewComment(
                    file.path,
                    selection.startLine,
                    selection.endLine,
                    commentText.trim()
                  );
                  setCommentText('');
                  setCommentMode(false);
                  setSelection(null);
                }}
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
