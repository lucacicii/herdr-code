import { useState } from 'react';
import { CornerDownLeft, MessageSquare, Send, Trash2, X } from 'lucide-react';
import { buildComposerPayload, formatReviewComments } from '../lib/references';
import type { ReferenceChip, ReviewComment, TerminalInfo } from '../types/api';

interface ComposerProps {
  targetTerminal: TerminalInfo | null;
  chips: ReferenceChip[];
  reviewComments: ReviewComment[];
  onRemoveChip: (id: string) => void;
  onClearChips: () => void;
  onRemoveReviewComment: (id: string) => void;
  onClearReviewComments: () => void;
  onAttachReviewComments: () => void;
  onFillInput: (payload: string) => Promise<void>;
  onSendPrompt: (payload: string) => Promise<void>;
}

export function Composer({
  targetTerminal,
  chips,
  reviewComments,
  onRemoveChip,
  onClearChips,
  onRemoveReviewComment,
  onClearReviewComments,
  onAttachReviewComments,
  onFillInput,
  onSendPrompt,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showReviews, setShowReviews] = useState(false);

  const hasContent = chips.length > 0 || text.trim().length > 0;
  const termName = targetTerminal
    ? targetTerminal.name || targetTerminal.title || targetTerminal.address
    : null;

  const handleAction = async (submit: boolean) => {
    if (!targetTerminal || !hasContent || busy) return;
    const payload = buildComposerPayload(chips, text);
    if (!payload.trim()) return;

    setBusy(true);
    try {
      if (submit) {
        await onSendPrompt(payload);
      } else {
        await onFillInput(payload);
      }
      setText('');
      onClearChips();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {reviewComments.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '5px 8px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ padding: '0 4px', height: 20 }}
              onClick={() => setShowReviews((v) => !v)}
            >
              <MessageSquare size={12} />
              <span>{reviewComments.length} Review Comments</span>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button className="btn btn-sm btn-accent" onClick={onAttachReviewComments}>
                Attach to Prompt
              </button>
              <button
                className="btn btn-ghost btn-icon"
                style={{ width: 22, height: 22 }}
                title="Clear Review Comments"
                onClick={onClearReviewComments}
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>

          {showReviews && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 120, overflowY: 'auto' }}>
              {reviewComments.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    fontSize: 11.5,
                    padding: '2px 4px',
                    borderRadius: 4,
                    background: 'var(--bg-surface)',
                  }}
                >
                  <span className="mono" style={{ color: 'var(--accent)', flexShrink: 0 }}>
                    {c.path.split('/').pop()}#L{c.startLine}
                    {c.endLine > c.startLine ? `-${c.endLine}` : ''}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.text}
                  </span>
                  <button
                    className="btn btn-ghost btn-icon"
                    style={{ width: 18, height: 18 }}
                    onClick={() => onRemoveReviewComment(c.id)}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {chips.map((chip) => (
            <span
              key={chip.id}
              title={chip.snippet || chip.path}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 7px',
                borderRadius: 999,
                fontSize: 11.5,
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                border: '1px solid transparent',
              }}
            >
              <span className="mono">{chip.label}</span>
              <button
                className="btn btn-ghost btn-icon"
                style={{ width: 14, height: 14, color: 'var(--accent)' }}
                onClick={() => onRemoveChip(chip.id)}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          rows={2}
          placeholder={
            termName
              ? `Prompt or reference for ${termName}… (⌘Enter send, ⇧⌘Enter fill)`
              : 'Select a terminal to compose...'
          }
          disabled={!targetTerminal}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void handleAction(!e.shiftKey);
            }
          }}
          style={{
            width: '100%',
            resize: 'vertical',
            minHeight: 54,
            maxHeight: 180,
            padding: '7px 9px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-subtle)',
            fontSize: 12.5,
            lineHeight: 1.45,
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-secondary)' }}>
            <span>Target:</span>
            <span className="mono" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              {termName || 'None'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              className="btn btn-sm"
              disabled={!targetTerminal || !hasContent || busy}
              onClick={() => void handleAction(false)}
              title="Paste into terminal without pressing Enter (⇧⌘Enter)"
            >
              <CornerDownLeft size={12} />
              <span>Fill Input</span>
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={!targetTerminal || !hasContent || busy}
              onClick={() => void handleAction(true)}
              title="Send prompt and press Enter (⌘Enter)"
            >
              <Send size={12} />
              <span>Send Prompt</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { formatReviewComments };
