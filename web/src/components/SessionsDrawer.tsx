import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { api } from '../lib/api';
import type { SessionInfo, Workspace } from '../types/api';

interface SessionsDrawerProps {
  workspaces: Workspace[];
  onClose: () => void;
  /** Opens one space's own history drawer, where a session can be replayed or resumed. */
  onOpenSpace: (workspaceId: string) => void;
}

function formatTime(session: SessionInfo): string {
  const ms = session.finished_ms || session.started_ms;
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

/**
 * Every conversation this workbench knows about, across every space — including
 * spaces the Herdr app no longer publishes, whose sessions survive only in the
 * agents' own stores.
 *
 * It is a finding aid: picking a row jumps to that space's history drawer, which
 * owns replay and resume.
 */
export function SessionsDrawer({ workspaces, onClose, onOpenSpace }: SessionsDrawerProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [spaceFilter, setSpaceFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSessions(await api.listAllSessions());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A space with no sessions yet still belongs in the filter, so the list follows
  // the sidebar rather than only the conversations found.
  // Directories that are not a space still show up in the filter, marked as such:
  // their conversations are real even though the sidebar gives them no row.
  const labelFor = useCallback(
    (id: string, fallback: string) => {
      const ws = workspaces.find((w) => w.id === id);
      const name = ws ? ws.name || ws.path : fallback;
      return ws && !ws.space_id ? `${name} · no space` : name;
    },
    [workspaces]
  );

  const spaceOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const ws of workspaces) {
      if (ws.id) seen.set(ws.id, labelFor(ws.id, ws.name || ws.path));
    }
    for (const s of sessions) {
      if (s.workspace_id && !seen.has(s.workspace_id)) {
        seen.set(s.workspace_id, labelFor(s.workspace_id, s.workspace_name || s.workspace_id));
      }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [workspaces, sessions, labelFor]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (spaceFilter !== 'all' && s.workspace_id !== spaceFilter) return false;
      if (!q) return true;
      return [s.title, s.session_id, s.agent, s.cwd, s.workspace_name, s.where]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [sessions, spaceFilter, query]);

  // One header per space only makes sense when nothing is filtered out.
  const grouped = spaceFilter === 'all';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(720px, 94vw)',
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
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>All sessions</div>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by title, session id, agent or directory…"
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
          <select
            className="input"
            value={spaceFilter}
            onChange={(e) => setSpaceFilter(e.target.value)}
            title="Filter by space"
            style={{ width: 190, height: 28, fontSize: 12 }}
          >
            <option value="all">All spaces</option>
            {spaceOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
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

        <div style={{ padding: '6px 14px', fontSize: 11, color: 'var(--text-muted)' }}>
          {loading ? 'Loading…' : `${filtered.length} of ${sessions.length} sessions`}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 12 }}>
          {!loading && filtered.length === 0 && (
            <div style={{ padding: 18, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              No conversations match.
            </div>
          )}

          {filtered.map((s, i) => {
            const prev = i > 0 ? filtered[i - 1] : null;
            const showSpaceHeader = grouped && (!prev || prev.workspace_id !== s.workspace_id);
            const spaceName = s.workspace_id
              ? labelFor(s.workspace_id, s.workspace_name || s.workspace_id)
              : 'no space';
            return (
              <div key={`${s.workspace_id || ''}-${s.session_id || s.address || i}`}>
                {showSpaceHeader && (
                  <div
                    style={{
                      padding: '10px 14px 3px',
                      fontSize: 10.5,
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {spaceName}
                  </div>
                )}
                <button
                  onClick={() => s.workspace_id && onOpenSpace(s.workspace_id)}
                  title={s.cwd ? `${s.cwd}\nClick to open this space's history` : undefined}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '7px 14px',
                    background: 'transparent',
                    border: 'none',
                    borderLeft: '2px solid transparent',
                    color: 'var(--text)',
                    cursor: s.workspace_id ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '0 5px',
                        borderRadius: 4,
                        background: 'var(--surface-hover, rgba(127,127,127,0.14))',
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        flexShrink: 0,
                      }}
                    >
                      {s.agent}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.title || s.session_id || s.address || 'untitled'}
                    </span>
                    {grouped && (
                      <span style={{ fontSize: 10.5, color: 'var(--text-muted)', flexShrink: 0 }}>{spaceName}</span>
                    )}
                    <span className="mono tabular" style={{ fontSize: 10.5, color: 'var(--text-muted)', flexShrink: 0 }}>
                      {formatTime(s)}
                    </span>
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10.5,
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.cwd || s.where || ''}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
