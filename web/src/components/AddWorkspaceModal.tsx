import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Folder, FolderPlus, X } from 'lucide-react';
import { api } from '../lib/api';
import type { Workspace } from '../types/api';

interface AddWorkspaceModalProps {
  onClose: () => void;
  onAdded: (ws: Workspace) => void;
}

const LAST_DIR_KEY = 'herdr_code_last_dir';

export function AddWorkspaceModal({ onClose, onAdded }: AddWorkspaceModalProps) {
  const [pathInput, setPathInput] = useState('');
  const [currentDir, setCurrentDir] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navTimer = useRef<number | null>(null);
  const navSeq = useRef(0);

  // `echo` rewrites the path input from the canonical directory (button / row
  // navigation); typing suppresses it so the caret doesn't jump.
  const browse = async (
    target: string,
    opts: { echo?: boolean; quiet?: boolean } = {},
  ): Promise<boolean> => {
    const seq = ++navSeq.current;
    try {
      const res = await api.browseLocalDirs(target);
      if (seq !== navSeq.current) return false; // a newer browse superseded this one
      setCurrentDir(res.current);
      setParentDir(res.parent);
      setDirs(res.dirs);
      if (opts.echo ?? true) setPathInput(res.current);
      setError('');
      localStorage.setItem(LAST_DIR_KEY, res.current);
      return true;
    } catch (err) {
      if (seq !== navSeq.current) return false;
      if (!opts.quiet) setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const cancelAutoNav = () => {
    if (navTimer.current !== null) {
      window.clearTimeout(navTimer.current);
      navTimer.current = null;
    }
    navSeq.current++; // drop any in-flight auto-navigation result
  };

  const scheduleAutoNav = (value: string) => {
    cancelAutoNav();
    const typed = value.trim();
    if (!typed) return;
    navTimer.current = window.setTimeout(() => {
      navTimer.current = null;
      void browse(typed, { echo: false, quiet: true });
    }, 250);
  };

  useEffect(() => cancelAutoNav, []);

  useEffect(() => {
    // Reopen where the user left off; fall back to home if it vanished.
    const last = localStorage.getItem(LAST_DIR_KEY);
    if (!last) {
      void browse('~');
      return;
    }
    void browse(last).then((ok) => {
      if (!ok) void browse('~');
    });
  }, []);

  const handleSubmit = async () => {
    if (!pathInput.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.addWorkspace(pathInput.trim(), true);
      localStorage.setItem(LAST_DIR_KEY, pathInput.trim());
      onAdded(res.workspace);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
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
            <span>Add Workspace</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input mono"
              value={pathInput}
              onChange={(e) => {
                setPathInput(e.target.value);
                scheduleAutoNav(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmit();
              }}
              placeholder="/path/to/project"
              style={{ flex: 1 }}
            />
            <button
              className="btn"
              onClick={() => {
                cancelAutoNav();
                void browse(pathInput || '~');
              }}
            >
              Browse
            </button>
          </div>

          {error && (
            <div style={{ fontSize: 12, color: 'var(--status-error)' }}>{error}</div>
          )}

          <div
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                background: 'var(--bg-subtle)',
                borderBottom: '1px solid var(--border-subtle)',
                fontSize: 11.5,
              }}
            >
              <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                {currentDir}
              </span>
              {parentDir && (
                <button className="btn btn-sm btn-ghost" onClick={() => void browse(parentDir)}>
                  <ArrowUp size={12} />
                  <span>Up</span>
                </button>
              )}
            </div>

            <div style={{ maxHeight: 240, overflowY: 'auto', padding: 4 }}>
              {dirs.map((d) => (
                <div
                  key={d.path}
                  className="tree-row"
                  style={{ paddingLeft: 8 }}
                  onClick={() => {
                    cancelAutoNav();
                    void browse(d.path);
                  }}
                >
                  <Folder size={14} style={{ color: 'var(--text-secondary)' }} />
                  <span>{d.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={!pathInput.trim() || busy}
              onClick={() => void handleSubmit()}
            >
              Add Workspace
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
