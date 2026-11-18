import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Columns2, Maximize2, Plus, Rows2, Terminal as TerminalIcon, X } from 'lucide-react';
import { api } from '../lib/api';
import { cleanTerminalTitle } from '../lib/terminalText';
import type { TerminalFontConfig } from '../lib/terminalFont';
import { StatusBadge } from './StatusBadge';
import { XTermPane, type XTermPaneHandle } from './XTermPane';
import type { TerminalInfo } from '../types/api';

export interface RightTerminalPaneHandle {
  pasteText: (text: string) => boolean;
}

interface RightTerminalPaneProps {
  workspaceTerminals: TerminalInfo[];
  allTerminals: TerminalInfo[];
  activeWorkspaceId?: string | null;
  activeWorkspacePath?: string;
  // wsId ties a focus request to the space that asked for it, so a request left
  // over from a previous space can never surface another space's terminal.
  focusRequest?: { address: string; wsId?: string | null; seq: number } | null;
  theme: 'light' | 'dark';
  terminalFont: TerminalFontConfig;
  onFocusedTerminalChange?: (address: string | null) => void;
  onAddPathChip: (path: string) => void;
  onOpenPath: (path: string) => void;
  onOpenNewTerminal: () => void;
  onTerminalsMutated: () => void;
}

export const RightTerminalPane = forwardRef<RightTerminalPaneHandle, RightTerminalPaneProps>(
  function RightTerminalPane(
    {
      workspaceTerminals,
      allTerminals,
      activeWorkspaceId,
      activeWorkspacePath,
      focusRequest,
      theme,
      terminalFont,
      onFocusedTerminalChange,
      onAddPathChip,
      onOpenPath,
      onOpenNewTerminal,
      onTerminalsMutated,
    },
    ref
  ) {
    const [splitMode, setSplitMode] = useState(false);
    const [splitAxis, setSplitAxis] = useState<'horizontal' | 'vertical'>(() =>
      localStorage.getItem('herdr_code_split_axis') === 'vertical' ? 'vertical' : 'horizontal'
    );
    const [primaryId, setPrimaryId] = useState<string | null>(null);
    const [secondaryId, setSecondaryId] = useState<string | null>(null);
    const [focusedSlot, setFocusedSlot] = useState<0 | 1>(0);

    useEffect(() => {
      localStorage.setItem('herdr_code_split_axis', splitAxis);
    }, [splitAxis]);

    const pane0Ref = useRef<XTermPaneHandle>(null);
    const pane1Ref = useRef<XTermPaneHandle>(null);

    // A freshly created terminal can land here before the workspace snapshot
    // includes it, so the requested terminal alone may stand in for the space's
    // list — never the whole allTerminals set, which would leak every space's
    // sessions into this pane. Requests made for another space are ignored.
    const requestedTerm =
      focusRequest && (focusRequest.wsId == null || focusRequest.wsId === activeWorkspaceId)
        ? allTerminals.find((t) => t.address === focusRequest.address) || null
        : null;

    const list =
      workspaceTerminals.length > 0
        ? workspaceTerminals
        : requestedTerm
          ? [requestedTerm]
          : workspaceTerminals;

    useEffect(() => {
      if (list.length === 0) {
        setPrimaryId(null);
        setSecondaryId(null);
        setSplitMode(false);
        setFocusedSlot(0);
        return;
      }
      let nextPrimary = primaryId;
      if (!nextPrimary || !list.some((t) => t.address === nextPrimary)) {
        nextPrimary = list[0].address;
        setPrimaryId(nextPrimary);
      }
      if (splitMode) {
        const secondaryValid =
          secondaryId &&
          secondaryId !== nextPrimary &&
          list.some((t) => t.address === secondaryId);
        if (!secondaryValid) {
          const alt = list.find((t) => t.address !== nextPrimary);
          if (alt) {
            setSecondaryId(alt.address);
          } else {
            setSecondaryId(null);
            setSplitMode(false);
            setFocusedSlot(0);
          }
        }
      }
    }, [list, primaryId, secondaryId, splitMode]);

    const primaryTerm = list.find((t) => t.address === primaryId) || null;
    const secondaryTerm =
      splitMode && secondaryId && secondaryId !== primaryId
        ? list.find((t) => t.address === secondaryId) || null
        : null;

    const focusedTerm =
      focusedSlot === 1 && secondaryTerm ? secondaryTerm : primaryTerm;

    useEffect(() => {
      onFocusedTerminalChange?.(focusedTerm?.address || null);
    }, [focusedTerm?.address, onFocusedTerminalChange]);

    useEffect(() => {
      if (!focusRequest) return;
      if (focusRequest.wsId != null && focusRequest.wsId !== activeWorkspaceId) return;
      const addr = focusRequest.address;
      if (splitMode && secondaryId === addr) {
        setFocusedSlot(1);
      } else if (splitMode && primaryId === addr) {
        setFocusedSlot(0);
      } else if (splitMode && focusedSlot === 1) {
        setSecondaryId(addr);
      } else {
        setPrimaryId(addr);
        setFocusedSlot(0);
      }
    }, [focusRequest?.seq]);

    const selectTerminal = (addr: string) => {
      if (splitMode) {
        if (addr === primaryId) {
          setFocusedSlot(0);
          pane0Ref.current?.focus();
          return;
        }
        if (addr === secondaryId) {
          setFocusedSlot(1);
          pane1Ref.current?.focus();
          return;
        }
        if (focusedSlot === 1) {
          setSecondaryId(addr);
          return;
        }
        setPrimaryId(addr);
        return;
      }
      setPrimaryId(addr);
      setFocusedSlot(0);
    };

    const assignPaneTerminal = (slot: 0 | 1, addr: string) => {
      if (slot === 0) {
        if (addr === secondaryId) {
          setSecondaryId(primaryId);
        }
        setPrimaryId(addr);
        setFocusedSlot(0);
      } else {
        if (addr === primaryId) {
          setPrimaryId(secondaryId);
        }
        setSecondaryId(addr);
        setFocusedSlot(1);
      }
    };

    const handleToggleSplit = async () => {
      if (splitMode) {
        setSplitMode(false);
        setFocusedSlot(0);
        return;
      }
      const alt = list.find((t) => t.address !== primaryId);
      if (alt) {
        setSecondaryId(alt.address);
        setSplitMode(true);
        setFocusedSlot(1);
        return;
      }
      if (activeWorkspacePath) {
        try {
          const res = await api.createTerminal({ cwd: activeWorkspacePath });
          onTerminalsMutated();
          setSecondaryId(res.terminal.address);
          setSplitMode(true);
          setFocusedSlot(1);
        } catch {
          onOpenNewTerminal();
        }
      } else {
        onOpenNewTerminal();
      }
    };

    const handleKillTerminal = async (term: TerminalInfo, e: React.MouseEvent) => {
      e.stopPropagation();
      const label = term.name || cleanTerminalTitle(term.title) || term.foreground?.name || term.address;
      if (!window.confirm(`Close terminal "${label}"?`)) {
        return;
      }
      await api.killTerminal(term.address);
      onTerminalsMutated();
    };

    useImperativeHandle(
      ref,
      () => ({
        pasteText: (text: string) => {
          const handle = focusedSlot === 1 && secondaryTerm ? pane1Ref.current : pane0Ref.current;
          if (!handle) return false;
          const ok = handle.pasteText(text, false);
          handle.focus();
          return ok;
        },
      }),
      [focusedSlot, secondaryTerm]
    );

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
              const label = t.name || cleanTerminalTitle(t.title) || t.foreground?.name || t.address;
              const st = t.status?.state || 'idle';
              return (
                <div
                  key={t.address}
                  onClick={() => selectTerminal(t.address)}
                  title={`${label} (${t.cwd})`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    height: 27,
                    padding: '0 6px 0 8px',
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
                  <button
                    className="btn btn-icon btn-ghost"
                    style={{ width: 16, height: 16, opacity: isActive ? 0.75 : 0.45 }}
                    title={`Close ${label}`}
                    onClick={(e) => void handleKillTerminal(t, e)}
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })}

            <button
              className="btn btn-icon btn-sm btn-ghost"
              title="New Terminal"
              onClick={onOpenNewTerminal}
              style={{ flexShrink: 0 }}
            >
              <Plus size={13} />
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            {splitMode && (
              <button
                className="btn btn-icon btn-sm btn-ghost"
                onClick={() => setSplitAxis((a) => (a === 'horizontal' ? 'vertical' : 'horizontal'))}
                title={
                  splitAxis === 'horizontal'
                    ? 'Switch Split to Top / Bottom'
                    : 'Switch Split to Side by Side'
                }
              >
                {splitAxis === 'horizontal' ? <Rows2 size={13} /> : <Columns2 size={13} />}
              </button>
            )}

            <button
              className={`btn btn-icon btn-sm ${splitMode ? 'btn-accent' : 'btn-ghost'}`}
              onClick={() => void handleToggleSplit()}
              disabled={list.length === 0}
              title={
                splitMode
                  ? 'Close Split Pane'
                  : list.length < 2
                    ? 'Split with New Terminal'
                    : 'Split 2nd Terminal Pane'
              }
            >
              {splitMode ? <Maximize2 size={13} /> : <Columns2 size={13} />}
            </button>
          </div>
        </div>

        {/* Terminal Viewports */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: splitMode && splitAxis === 'horizontal' ? 'row' : 'column',
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
                background: 'var(--bg-page)',
                color: 'var(--text-secondary)',
              }}
            >
              <TerminalIcon size={24} style={{ color: 'var(--text-muted)' }} />
              <div style={{ fontSize: 13 }}>No terminals in this workspace</div>
              <button className="btn btn-primary" onClick={onOpenNewTerminal}>
                <Plus size={13} />
                <span>Start Terminal</span>
              </button>
            </div>
          ) : (
            <>
              <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                {splitMode && secondaryTerm && (
                  <div
                    onMouseDown={() => setFocusedSlot(0)}
                    style={{
                      height: 26,
                      minHeight: 26,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0 8px',
                      background: focusedSlot === 0 ? 'var(--bg-subtle)' : 'var(--bg-page)',
                      borderBottom: '1px solid var(--border-subtle)',
                      fontSize: 11.5,
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span
                        className="mono"
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          color: focusedSlot === 0 ? 'var(--accent)' : 'var(--text-muted)',
                        }}
                      >
                        PANE 1
                      </span>
                      <select
                        className="input"
                        aria-label="Pane 1 Terminal"
                        value={primaryTerm.address}
                        onChange={(e) => assignPaneTerminal(0, e.target.value)}
                        style={{ height: 20, fontSize: 11.5, padding: '0 6px' }}
                      >
                        {list.map((t) => (
                          <option key={t.address} value={t.address}>
                            {t.name || cleanTerminalTitle(t.title) || t.foreground?.name || t.address}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                <XTermPane
                  key={`pane0-${primaryTerm.address}`}
                  ref={pane0Ref}
                  terminal={primaryTerm}
                  theme={theme}
                  fontFamily={terminalFont.fontFamily}
                  fontSize={terminalFont.fontSize}
                  lineHeight={terminalFont.lineHeight}
                  focused={!splitMode || focusedSlot === 0}
                  onFocus={() => setFocusedSlot(0)}
                  onOpenPath={onOpenPath}
                  onPastePath={onAddPathChip}
                />
              </div>
              {splitMode && secondaryTerm && (
                <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  <div
                    onMouseDown={() => setFocusedSlot(1)}
                    style={{
                      height: 26,
                      minHeight: 26,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0 8px',
                      background: focusedSlot === 1 ? 'var(--bg-subtle)' : 'var(--bg-page)',
                      borderBottom: '1px solid var(--border-subtle)',
                      fontSize: 11.5,
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span
                        className="mono"
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          color: focusedSlot === 1 ? 'var(--accent)' : 'var(--text-muted)',
                        }}
                      >
                        PANE 2
                      </span>
                      <select
                        className="input"
                        aria-label="Pane 2 Terminal"
                        value={secondaryTerm.address}
                        onChange={(e) => assignPaneTerminal(1, e.target.value)}
                        style={{ height: 20, fontSize: 11.5, padding: '0 6px' }}
                      >
                        {list.map((t) => (
                          <option key={t.address} value={t.address}>
                            {t.name || cleanTerminalTitle(t.title) || t.foreground?.name || t.address}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      className="btn btn-icon btn-ghost"
                      style={{ width: 20, height: 20 }}
                      title="Close Split Pane"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSplitMode(false);
                        setFocusedSlot(0);
                      }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                  <XTermPane
                    key={`pane1-${secondaryTerm.address}`}
                    ref={pane1Ref}
                    terminal={secondaryTerm}
                    theme={theme}
                    fontFamily={terminalFont.fontFamily}
                    fontSize={terminalFont.fontSize}
                    lineHeight={terminalFont.lineHeight}
                    focused={focusedSlot === 1}
                    onFocus={() => setFocusedSlot(1)}
                    onOpenPath={onOpenPath}
                    onPastePath={onAddPathChip}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }
);
