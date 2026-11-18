import { useCallback, useState } from 'react';
import { ArrowUp, CornerDownRight, Folder, FolderPlus, X } from 'lucide-react';
import { api } from '../lib/api';

interface NewSpaceModalProps {
  /** Prefilled directory, usually the space the person is looking at right now. */
  defaultFolder?: string | null;
  onClose: () => void;
  onCreated: (spaceId: string) => void;
}

interface DirEntry {
  name: string;
  path: string;
}

/**
 * Creates a Herdr space. A space is the app's container, so this goes through
 * `herdr-app do space.new` rather than inventing a row only the workbench knows:
 * both windows end up showing the same thing.
 *
 * The folder field browses: Enter lists what is inside whatever is typed, so a
 * path can be explored instead of guessed. Cmd/Ctrl+Enter creates.
 */
export function NewSpaceModal({ defaultFolder, onClose, onCreated }: NewSpaceModalProps) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState(defaultFolder || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const [current, setCurrent] = useState('');
  const [parent, setParent] = useState('');
  const [dirs, setDirs] = useState<DirEntry[]>([]);

  const listDir = useCallback(async (target: string) => {
    const wanted = target.trim() || '~';
    setBrowsing(true);
    setBrowseError('');
    try {
      const res = await api.browseLocalDirs(wanted);
      setCurrent(res.current);
      setParent(res.parent);
      setDirs(res.dirs || []);
      // Follow the listing: the field now holds what is actually being shown, so
      // Create Space makes a space where the list says it will.
      setFolder(res.current);
    } catch (err) {
      setDirs([]);
      setCurrent('');
      setParent('');
      setBrowseError(err instanceof Error ? err.message : String(err));
    } finally {
      setBrowsing(false);
    }
  }, []);

  const create = async () => {
    if (busy) return;
    const target = folder.trim();
    if (!target) {
      setError('A folder is required — it is where the space starts.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.createSpace(name.trim(), target);
      onCreated(res.space_id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            <FolderPlus size={15} />
            <span>New space</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            className="input"
            autoFocus
            placeholder="Name (optional — Herdr names it after the folder)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void listDir(folder);
              }
            }}
          />

          <input
            className="input mono"
            placeholder="/path/to/project — Enter lists what is inside"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              // Cmd/Ctrl+Enter is the "yes, this one" gesture; plain Enter browses.
              if (e.metaKey || e.ctrlKey) void create();
              else void listDir(folder);
            }}
          />

          {(browsing || browseError || dirs.length > 0) && (
            <div
              style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              <div
                className="mono"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  borderBottom: '1px solid var(--border-subtle)',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--surface)',
                }}
              >
                <CornerDownRight size={11} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {browsing ? 'Listing…' : current || '—'}
                </span>
                {parent && (
                  <button
                    className="btn btn-ghost btn-icon"
                    title="Up one level"
                    style={{ width: 18, height: 18 }}
                    onClick={() => void listDir(parent)}
                  >
                    <ArrowUp size={11} />
                  </button>
                )}
              </div>

              {browseError && (
                <div style={{ padding: '8px', fontSize: 12, color: 'var(--error, #dc2626)' }}>{browseError}</div>
              )}

              {!browseError && !browsing && dirs.length === 0 && (
                <div style={{ padding: '8px', fontSize: 12, color: 'var(--text-muted)' }}>
                  No sub-folders here.
                </div>
              )}

              {dirs.map((d) => (
                <button
                  key={d.path}
                  onClick={() => void listDir(d.path)}
                  title={d.path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    width: '100%',
                    textAlign: 'left',
                    padding: '5px 8px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text)',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  <Folder size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.name}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Enter in the path lists its sub-folders; click one to go in. ⌘/Ctrl+Enter creates the space
            where the path points. ~ is expanded.
          </div>

          {error && <div style={{ fontSize: 12, color: 'var(--error, #dc2626)' }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => void create()} disabled={busy}>
              {busy ? 'Creating…' : 'Create Space'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
