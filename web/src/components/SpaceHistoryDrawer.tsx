import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Play, RefreshCw, Search, X } from 'lucide-react';
import { api } from '../lib/api';
import { DARK_XTERM_THEME, LIGHT_XTERM_THEME } from './XTermPane';
import type { TerminalFontConfig } from '../lib/terminalFont';
import type { SessionInfo, TerminalInfo, Workspace } from '../types/api';

interface SpaceHistoryDrawerProps {
  workspace: Workspace;
  theme: 'light' | 'dark';
  terminalFont: TerminalFontConfig;
  onClose: () => void;
  onResumed: (terminal: TerminalInfo) => void;
}

/** The core accepts 1-32 of a-z 0-9 - _ . starting with a letter or digit. */
function terminalName(session: SessionInfo): string {
  const slug = session.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  if (slug && /^[a-z0-9]/.test(slug)) return slug;
  const prefix = session.session_id.replace(/[^a-z0-9]/g, '').slice(0, 8) || session.address;
  return `${session.agent}-${prefix}`.slice(0, 32);
}

function formatTime(ms: number): string {
  if (!ms) return '';
  const date = new Date(ms);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const clock = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return clock;
  return `${date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })} ${clock}`;
}

/** What a terminal printed, replayed read-only so its colours survive. */
function ReplayPane({
  text,
  theme,
  fontFamily,
  fontSize,
  lineHeight,
}: {
  text: string;
  theme: 'light' | 'dark';
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new Terminal({
      fontFamily,
      fontSize,
      lineHeight,
      cursorBlink: false,
      disableStdin: true,
      scrollback: 20000,
      theme: theme === 'dark' ? DARK_XTERM_THEME : LIGHT_XTERM_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    term.write(text);
    const resize = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* container not laid out yet */
      }
    });
    resize.observe(container);
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    });
    return () => {
      resize.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [text, theme, fontFamily, fontSize, lineHeight]);

  return <div ref={containerRef} style={{ flex: 1, minHeight: 0, padding: '8px 10px' }} />;
}

/** Lists the conversations a space has run and reopens one, or resumes it. */
export function SpaceHistoryDrawer({
  workspace,
  theme,
  terminalFont,
  onClose,
  onResumed,
}: SpaceHistoryDrawerProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [outputError, setOutputError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.listSessions(workspace.id);
      setSessions(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((s) => {
      const hay = `${s.session_id} ${s.title} ${s.where} ${s.agent} ${s.address}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [sessions, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const current = filtered.find((s) => s.address === selected) ?? null;

  useEffect(() => {
    if (!current) {
      setOutput(null);
      setOutputError(null);
      return;
    }
    let cancelled = false;
    setOutput(null);
    setOutputError(null);
    api
      .terminalOutput(current.address, 4000)
      .then((res) => {
        if (!cancelled) setOutput(res.text);
      })
      .catch((err) => {
        if (!cancelled) setOutputError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [current?.address]);

  const resume = async (session: SessionInfo) => {
    if (resuming || session.resume_argv.length === 0) return;
    setResuming(true);
    try {
      const res = await api.createTerminal({
        workspace_id: workspace.id,
        cwd: session.cwd,
        argv: session.resume_argv,
        keep: true,
        name: terminalName(session),
      });
      onResumed(res.terminal);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(820px, 94vw)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg, 0 8px 40px rgba(0,0,0,0.3))',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 14px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <Search size={15} style={{ color: 'var(--text-muted)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              History — {workspace.name || workspace.path}
            </div>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by session id or title…"
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text)',
                fontSize: 13,
                padding: '2px 0',
              }}
            />
          </div>
          <button className="btn" onClick={() => void load()} title="Refresh">
            <RefreshCw size={14} className={loading ? 'spin' : undefined} />
          </button>
          <button className="btn" onClick={onClose} title="Close (Esc)">
            <X size={14} />
          </button>
        </div>

        {error && (
          <div style={{ padding: '8px 14px', color: 'var(--error, #dc2626)', fontSize: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div
            style={{
              width: 350,
              flexShrink: 0,
              overflowY: 'auto',
              borderRight: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ padding: '6px 14px', fontSize: 11, color: 'var(--text-muted)' }}>
              {loading ? 'Loading…' : `${filtered.length} of ${sessions.length} sessions`}
            </div>
            {filtered.map((s) => {
              const active = s.address === selected;
              return (
                <button
                  key={s.address}
                  onClick={() => setSelected(s.address)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '7px 14px',
                    background: active ? 'var(--surface-hover, rgba(127,127,127,0.12))' : 'transparent',
                    border: 'none',
                    borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        padding: '0 5px',
                        borderRadius: 4,
                        background: 'var(--surface-hover, rgba(127,127,127,0.14))',
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                      }}
                    >
                      {s.agent}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.title || s.address}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      fontFamily: terminalFont.fontFamily,
                      marginTop: 2,
                    }}
                  >
                    <span>{formatTime(s.finished_ms || s.started_ms)}</span>
                    <span style={{ opacity: 0.7 }}>
                      {s.id_known ? s.session_id.slice(0, 8) : 'no id'}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.where}
                    </span>
                    {s.state === 'finished' && s.reason && <span>{s.reason}</span>}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {!current ? (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                }}
              >
                Pick a session to read what it printed.
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 14px',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {current.title || current.address}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {current.resume_note || (current.id_known ? current.session_id : 'session id unknown')}
                    </div>
                  </div>
                  <button
                    className="btn btn-accent"
                    onClick={() => void resume(current)}
                    disabled={resuming}
                    title={current.resume_argv.join(' ')}
                  >
                    <Play size={13} />
                    <span style={{ marginLeft: 4 }}>{resuming ? 'Resuming…' : 'Resume'}</span>
                  </button>
                </div>
                {outputError ? (
                  <div style={{ padding: 14, fontSize: 12, color: 'var(--error, #dc2626)' }}>
                    {outputError}
                  </div>
                ) : output === null ? (
                  <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
                ) : (
                  <ReplayPane
                    text={output}
                    theme={theme}
                    fontFamily={terminalFont.fontFamily}
                    fontSize={terminalFont.fontSize}
                    lineHeight={terminalFont.lineHeight}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
