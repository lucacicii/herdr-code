import { useState } from 'react';
import { FolderPlus, X } from 'lucide-react';
import { api } from '../lib/api';

interface NewSpaceModalProps {
  /** Prefilled directory, usually the space the person is looking at right now. */
  defaultFolder?: string | null;
  onClose: () => void;
  onCreated: (spaceId: string) => void;
}

/**
 * Creates a Herdr space. A space is the app's container, so this goes through
 * `herdr-app do space.new` rather than inventing a row only the workbench knows:
 * both windows end up showing the same thing.
 */
export function NewSpaceModal({ defaultFolder, onClose, onCreated }: NewSpaceModalProps) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState(defaultFolder || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
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
              if (e.key === 'Enter') void create();
            }}
          />
          <input
            className="input mono"
            placeholder="/path/to/project"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
          />
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            The space opens with one shell in that folder. ~ is expanded.
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
