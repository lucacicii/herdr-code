import { useEffect, useState } from 'react';
import { Terminal as TerminalIcon, X } from 'lucide-react';
import { api } from '../lib/api';
import type { TemplateInfo, TerminalInfo, Workspace } from '../types/api';

interface NewTerminalModalProps {
  workspace: Workspace;
  // Where to start when the caller knows better than the space's folder (the tab the
  // person was looking at). Falls back to the workspace path.
  defaultCwd?: string | null;
  onClose: () => void;
  onCreated: (term: TerminalInfo) => void;
}

export function NewTerminalModal({
  workspace,
  defaultCwd,
  onClose,
  onCreated,
}: NewTerminalModalProps) {
  const targetCwd = defaultCwd || workspace.path;
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .listTemplates()
      .then((res) => setTemplates(res.templates || []))
      .catch(() => setTemplates([]));
  }, []);

  const launch = async (opts: { line?: string; argv?: string[]; name?: string }) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.createTerminal({
        workspace_id: workspace.id,
        cwd: targetCwd,
        name: opts.name || undefined,
        line: opts.line || undefined,
        argv: opts.argv,
      });
      onCreated(res.terminal);
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
            <TerminalIcon size={15} />
            <span>New Terminal in {workspace.name}</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            className="mono"
            style={{
              fontSize: 11.5,
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={targetCwd}
          >
            Starts in {targetCwd}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button
              className="btn"
              disabled={busy}
              onClick={() => void launch({ name: name.trim() || undefined })}
            >
              Default Shell
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => void launch({ line: 'claude', name: name.trim() || undefined })}
            >
              claude
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => void launch({ line: 'codex', name: name.trim() || undefined })}
            >
              codex
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => void launch({ line: 'pi', name: name.trim() || undefined })}
            >
              pi
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => void launch({ line: 'omp', name: name.trim() || undefined })}
            >
              omp
            </button>
            {templates.map((tpl) => (
              <button
                key={tpl.name}
                className="btn"
                disabled={busy}
                onClick={() =>
                  void launch({
                    argv: tpl.argv,
                    line: tpl.argv?.length ? undefined : tpl.name,
                    name: name.trim() || undefined,
                  })
                }
              >
                {tpl.name}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              className="input"
              placeholder="Optional session name (e.g. backend-agent)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="input mono"
              placeholder="Custom command (leave empty for default shell)"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void launch({ line: command.trim() || undefined, name: name.trim() || undefined });
                }
              }}
            />
          </div>

          {error && <div style={{ fontSize: 12, color: 'var(--status-error)' }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                void launch({ line: command.trim() || undefined, name: name.trim() || undefined })
              }
            >
              {busy ? 'Launching...' : 'Launch Terminal'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
