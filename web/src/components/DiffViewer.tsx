import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import {
  AtSign,
  Columns2,
  ListTree,
  MessageSquarePlus,
  Plus,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import { api } from '../lib/api';
import { getGeistCodeTheme, getLanguageExtension } from '../lib/codemirrorLang';
import type { DiffHunk, FileDiff } from '../types/api';

interface DiffViewerProps {
  workspaceId: string;
  diff: FileDiff | null;
  loading: boolean;
  theme: 'light' | 'dark';
  onAddHunkRef: (path: string, hunk: DiffHunk) => void;
  onAddReviewComment: (path: string, startLine: number, endLine: number, text: string) => void;
  onGitMutated: () => void;
}

export function DiffViewer({
  workspaceId,
  diff,
  loading,
  theme,
  onAddHunkRef,
  onAddReviewComment,
  onGitMutated,
}: DiffViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<'unified' | 'split'>('unified');
  const [showHunks, setShowHunks] = useState(true);
  const [commentPrompt, setCommentPrompt] = useState<{ start: number; end: number } | null>(null);
  const [commentText, setCommentText] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !diff || diff.is_binary) return;

    const langExt = getLanguageExtension(diff.path);
    const themeExt = getGeistCodeTheme(theme === 'dark');

    if (layout === 'split') {
      const mv = new MergeView({
        a: {
          doc: diff.original_content,
          extensions: [
            lineNumbers(),
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            ...langExt,
            ...themeExt,
          ],
        },
        b: {
          doc: diff.modified_content,
          extensions: [
            lineNumbers(),
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            ...langExt,
            ...themeExt,
            EditorView.updateListener.of((update) => {
              if (update.selectionSet) {
                const sel = update.state.selection.main;
                if (!sel.empty) {
                  const s = update.state.doc.lineAt(sel.from).number;
                  const e = update.state.doc.lineAt(Math.max(sel.from, sel.to - 1)).number;
                  setCommentPrompt({ start: s, end: Math.max(s, e) });
                }
              }
            }),
          ],
        },
        parent: host,
        gutter: true,
        highlightChanges: true,
        collapseUnchanged: { margin: 3, minSize: 4 },
      });
      return () => mv.destroy();
    }

    const view = new EditorView({
      state: EditorState.create({
        doc: diff.modified_content,
        extensions: [
          lineNumbers(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          ...langExt,
          ...themeExt,
          unifiedMergeView({
            original: diff.original_content,
            gutter: true,
            highlightChanges: true,
            mergeControls: false,
            collapseUnchanged: { margin: 3, minSize: 4 },
          }),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet) {
              const sel = update.state.selection.main;
              if (!sel.empty) {
                const s = update.state.doc.lineAt(sel.from).number;
                const e = update.state.doc.lineAt(Math.max(sel.from, sel.to - 1)).number;
                setCommentPrompt({ start: s, end: Math.max(s, e) });
              }
            }
          }),
        ],
      }),
      parent: host,
    });
    return () => view.destroy();
  }, [diff, layout, theme]);

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading diff...</div>;
  }

  if (!diff) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        Select a changed file in Changes to inspect its diff.
      </div>
    );
  }

  const canMutate =
    diff.mode === 'working' || diff.mode === 'staged' || diff.mode === 'unstaged';

  const handleHunkAction = async (
    hunk: DiffHunk,
    action: 'stage' | 'unstage' | 'discard'
  ) => {
    if (action === 'discard' && !window.confirm(`Discard hunk ${hunk.header}?`)) {
      return;
    }
    try {
      await api.gitHunk(workspaceId, hunk.patch, action);
      onGitMutated();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-subtle)',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>
            {diff.path}
          </span>
          <span className="status-badge status-idle" style={{ textTransform: 'capitalize' }}>
            {diff.mode}
            {diff.target ? ` · ${diff.target.slice(0, 10)}` : ''}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {commentPrompt && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>
                L{commentPrompt.start}
                {commentPrompt.end > commentPrompt.start ? `-${commentPrompt.end}` : ''}
              </span>
              <input
                className="input"
                placeholder="Review comment..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && commentText.trim()) {
                    onAddReviewComment(
                      diff.path,
                      commentPrompt.start,
                      commentPrompt.end,
                      commentText.trim()
                    );
                    setCommentText('');
                    setCommentPrompt(null);
                  }
                }}
                style={{ width: 180, height: 24 }}
              />
              <button
                className="btn btn-sm btn-accent"
                disabled={!commentText.trim()}
                onClick={() => {
                  if (!commentText.trim()) return;
                  onAddReviewComment(
                    diff.path,
                    commentPrompt.start,
                    commentPrompt.end,
                    commentText.trim()
                  );
                  setCommentText('');
                  setCommentPrompt(null);
                }}
              >
                <MessageSquarePlus size={11} />
                <span>Add</span>
              </button>
            </div>
          )}

          <div className="seg-group">
            <button
              className={`seg-btn ${layout === 'unified' ? 'active' : ''}`}
              onClick={() => setLayout('unified')}
            >
              <ListTree size={12} />
              <span>Unified</span>
            </button>
            <button
              className={`seg-btn ${layout === 'split' ? 'active' : ''}`}
              onClick={() => setLayout('split')}
            >
              <Columns2 size={12} />
              <span>Side-by-Side</span>
            </button>
          </div>

          {diff.hunks.length > 0 && (
            <button
              className="btn btn-sm"
              onClick={() => setShowHunks((v) => !v)}
            >
              Hunks ({diff.hunks.length})
            </button>
          )}

          {canMutate && (
            <>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  await api.gitStage(workspaceId, diff.path);
                  onGitMutated();
                }}
              >
                <Plus size={11} />
                <span>Stage</span>
              </button>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  await api.gitUnstage(workspaceId, diff.path);
                  onGitMutated();
                }}
              >
                <Undo2 size={11} />
                <span>Unstage</span>
              </button>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  if (!window.confirm(`Discard changes to ${diff.path}?`)) return;
                  await api.gitDiscard(workspaceId, diff.path);
                  onGitMutated();
                }}
              >
                <RotateCcw size={11} />
                <span>Discard</span>
              </button>
            </>
          )}
        </div>
      </div>

      {showHunks && diff.hunks.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px',
            borderBottom: '1px solid var(--border-subtle)',
            overflowX: 'auto',
            background: 'var(--bg-surface)',
          }}
        >
          {diff.hunks.map((hunk) => (
            <div
              key={hunk.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 6px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-subtle)',
                flexShrink: 0,
              }}
            >
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {hunk.header.split('@@').slice(0, 2).join('@@')}@@
              </span>
              <button
                className="btn btn-ghost btn-icon"
                style={{ width: 20, height: 20 }}
                title="Reference Hunk"
                onClick={() => onAddHunkRef(diff.path, hunk)}
              >
                <AtSign size={11} />
              </button>
              {canMutate && diff.mode !== 'staged' && (
                <button
                  className="btn btn-ghost btn-icon"
                  style={{ width: 20, height: 20 }}
                  title="Stage Hunk"
                  onClick={() => void handleHunkAction(hunk, 'stage')}
                >
                  <Plus size={11} />
                </button>
              )}
              {canMutate && diff.mode === 'staged' && (
                <button
                  className="btn btn-ghost btn-icon"
                  style={{ width: 20, height: 20 }}
                  title="Unstage Hunk"
                  onClick={() => void handleHunkAction(hunk, 'unstage')}
                >
                  <Undo2 size={11} />
                </button>
              )}
              {canMutate && diff.mode !== 'staged' && (
                <button
                  className="btn btn-ghost btn-icon"
                  style={{ width: 20, height: 20 }}
                  title="Discard Hunk"
                  onClick={() => void handleHunkAction(hunk, 'discard')}
                >
                  <RotateCcw size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {diff.is_binary ? (
        <div style={{ padding: 24, color: 'var(--text-secondary)' }}>
          Binary file diff is not displayed.
        </div>
      ) : (
        <div ref={hostRef} style={{ flex: 1, minHeight: 0, overflow: 'auto' }} />
      )}
    </div>
  );
}
