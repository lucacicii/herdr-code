import { useEffect, useRef, useState } from 'react';
import { Columns2, Plus, OctagonX, Terminal as TerminalIcon, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Composer } from './Composer';
import { StatusBadge } from './StatusBadge';
import { XTermPane, type XTermPaneHandle } from './XTermPane';
import type { ReferenceChip, ReviewComment, TerminalInfo } from '../types/api';

interface RightTerminalPaneProps {
  workspaceTerminals: TerminalInfo[];
  allTerminals: TerminalInfo[];
  theme: 'light' | 'dark';
  chips: ReferenceChip[];
  reviewComments: ReviewComment[];
  onRemoveChip: (id: string) => void;
  onClearChips: () => void;
  onAddPathChip: (path: string) => void;
  onRemoveReviewComment: (id: string) => void;
  onClearReviewComments: () => void;
  onAttachReviewComments: () => void;
  onOpenFileLine: (path: string, line: number) => void;
  onOpenNewTerminal: () => void;
  onTerminalsMutated: () => void;
}

export function RightTerminalPane({
  workspaceTerminals,
  allTerminals,
  theme,
  chips,
  reviewComments,
  onRemoveChip,
  onClearChips,
  onAddPathChip,
  onRemoveReviewComment,
  onClearReviewComments,
  onAttachReviewComments,
  onOpenFileLine,
  onOpenNewTerminal,
  onTerminalsMutated,
}: RightTerminalPaneProps) {
  const [showAll, setShowAll] = useState(false);
  const [splitMode, setSplitMode] = useState(false);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [secondaryId, setSecondaryId] = useState<string | null>(null);
  const [focusedSlot, setFocusedSlot] = useState<0 | 1>(0);

  const pane0Ref = useRef<XTermPaneHandle>(null);
  const pane1Ref = useRef<XTermPaneHandle>(null);

  const list = showAll ? allTerminals : workspaceTerminals;

  useEffect(() => {
    if (list.length === 0) {
      setPrimaryId(null);
      setSecondaryId(null);
      return;
    }
    if (!primaryId || !list.some((t) => t.address === primaryId)) {
      setPrimaryId(list[0].address);
    }
    if (splitMode && (!secondaryId || !list.some((t) => t.address === secondaryId))) {
      const alt = list.find((t) => t.address !== primaryId) || list[0];
      setSecondaryId(alt.address);
    }
  }, [list, primaryId, secondaryId, splitMode]);

  const primaryTerm = list.find((t) => t.address === primaryId) || null;
  const secondaryTerm = splitMode ? list.find((t) => t.address === secondaryId) || null : null;

  const focusedTerm =
    focusedSlot === 1 && secondaryTerm ? secondaryTerm : primaryTerm;

  const selectTerminal = (addr: string) => {
    if (splitMode && focusedSlot === 1) {
      setSecondaryId(addr);
    } else {
      setPrimaryId(addr);
      setFocusedSlot(0);
    }
  };

  const handleFillInput = async (payload: string) => {
    if (!focusedTerm) return;
    const handle = focusedSlot === 1 && secondaryTerm ? pane1Ref.current : pane0Ref.current;
    const ok = handle?.pasteText(payload, false);
    if (!ok) {
      window.alert('Terminal WebSocket is not connected.');
    }
    handle?.focus();
  };

  const handleSendPrompt = async (payload: string) => {
    if (!focusedTerm) return;
    const handle = focusedSlot === 1 && secondaryTerm ? pane1Ref.current : pane0Ref.current;
    if (handle?.pasteText(payload, true)) {
      handle.focus();
      return;
    }
    await api.sendTerminal(focusedTerm.address, payload, true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Terminal Tabs Header */}
      <div
        style={{
          height: 36,
          minHeight: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-subtle)',
          padding: '0 6px',
          gap: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            overflowX: 'auto',
            flex: 1,
            minWidth: 0,
          }}
        >
          {list.map((t) => {
            const isPrimary = t.address === primaryId;
            const isSecondary = splitMode && t.address === secondaryId;
            const isActive = isPrimary || isSecondary;
            const label = t.name || t.title || t.foreground?.name || t.address;
            const st = t.status?.state || 'idle';
            return (
              <button
                key={t.address}
                onClick={() => selectTerminal(t.address)}
                title={`${label} (${t.cwd})`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 27,
                  padding: '0 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: isActive ? '1px solid var(--border-strong)' : '1px solid transparent',
                  background: isActive ? 'var(--bg-surface)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                <StatusBadge state={st} label={label} />
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          <button
            className={`btn btn-sm ${showAll ? 'btn-accent' : 'btn-ghost'}`}
            onClick={() => setShowAll((v) => !v)}
            title="Show Terminals Across All Workspaces"
          >
            All ({allTerminals.length})
          </button>

          <button
            className={`btn btn-icon btn-sm ${splitMode ? 'btn-accent' : 'btn-ghost'}`}
            onClick={() => setSplitMode((v) => !v)}
            disabled={list.length < 2}
            title="Split 2nd Terminal Pane"
          >
            <Columns2 size={13} />
          </button>

          {focusedTerm && (
            <>
              <button
                className="btn btn-icon btn-sm btn-ghost"
                title="Interrupt (Ctrl+C)"
                onClick={async () => {
                  await api.interruptTerminal(focusedTerm.address);
                }}
              >
                <OctagonX size={13} />
              </button>
              <button
                className="btn btn-icon btn-sm btn-ghost"
                title="Kill Terminal"
                onClick={async () => {
                  if (!window.confirm(`Kill terminal "${focusedTerm.name || focusedTerm.address}"?`)) {
                    return;
                  }
                  await api.killTerminal(focusedTerm.address);
                  onTerminalsMutated();
                }}
              >
                <Trash2 size={13} />
              </button>
            </>
          )}

          <button
            className="btn btn-icon btn-sm"
            title="New Terminal"
            onClick={onOpenNewTerminal}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Terminal Viewports */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: splitMode ? 4 : 0,
          background: 'var(--border-subtle)',
        }}
      >
        {!primaryTerm ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              background: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
            }}
          >
            <TerminalIcon size={28} strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
            <div>No live terminals in this workspace.</div>
            <button className="btn btn-primary" onClick={onOpenNewTerminal}>
              <Plus size={13} />
              <span>New Terminal</span>
            </button>
          </div>
        ) : (
          <>
            <XTermPane
              ref={pane0Ref}
              terminal={primaryTerm}
              theme={theme}
              focused={!splitMode || focusedSlot === 0}
              onFocus={() => setFocusedSlot(0)}
              onOpenFileLine={onOpenFileLine}
              onPastePath={onAddPathChip}
            />
            {splitMode && secondaryTerm && (
              <XTermPane
                ref={pane1Ref}
                terminal={secondaryTerm}
                theme={theme}
                focused={focusedSlot === 1}
                onFocus={() => setFocusedSlot(1)}
                onOpenFileLine={onOpenFileLine}
                onPastePath={onAddPathChip}
              />
            )}
          </>
        )}
      </div>

      {/* Bottom Prompt & Reference Composer */}
      <Composer
        targetTerminal={focusedTerm}
        chips={chips}
        reviewComments={reviewComments}
        onRemoveChip={onRemoveChip}
        onClearChips={onClearChips}
        onRemoveReviewComment={onRemoveReviewComment}
        onClearReviewComments={onClearReviewComments}
        onAttachReviewComments={onAttachReviewComments}
        onFillInput={handleFillInput}
        onSendPrompt={handleSendPrompt}
      />
    </div>
  );
}
