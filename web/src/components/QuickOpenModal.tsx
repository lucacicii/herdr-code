import { useEffect, useState } from 'react';
import { FileCode2, Search } from 'lucide-react';
import { api } from '../lib/api';
import type { SearchMatch } from '../types/api';

interface QuickOpenModalProps {
  workspaceId: string;
  onClose: () => void;
  onSelectFile: (path: string) => void;
}

export function QuickOpenModal({ workspaceId, onClose, onSelectFile }: QuickOpenModalProps) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchFiles(workspaceId, query, 40);
        if (!cancelled) {
          setMatches(res.matches);
          setSelectedIdx(0);
        }
      } catch {
        if (!cancelled) setMatches([]);
      }
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workspaceId, query]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <Search size={15} style={{ color: 'var(--text-muted)' }} />
          <input
            autoFocus
            placeholder="Find file by name or path..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onClose();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIdx((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && matches[selectedIdx]) {
                e.preventDefault();
                onSelectFile(matches[selectedIdx].path);
                onClose();
              }
            }}
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              outline: 'none',
              boxShadow: 'none',
              fontSize: 13.5,
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
          {matches.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
              No matching files.
            </div>
          ) : (
            matches.map((m, idx) => (
              <div
                key={m.path}
                onClick={() => {
                  onSelectFile(m.path);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIdx(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '7px 10px',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  background: idx === selectedIdx ? 'var(--accent-soft)' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <FileCode2 size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                  <span style={{ fontWeight: 500 }}>{m.name}</span>
                  {m.dir && (
                    <span
                      className="mono"
                      style={{
                        fontSize: 11.5,
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {m.dir}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
