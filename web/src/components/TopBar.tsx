import {
  FolderPlus,
  GitBranch,
  Moon,
  Plus,
  Search,
  Sun,
  Terminal as TerminalIcon,
} from 'lucide-react';
import type { RepoStatus, Workspace } from '../types/api';

interface TopBarProps {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  repoStatus: RepoStatus | null;
  hcConnected: boolean;
  hcVersion?: string;
  theme: 'light' | 'dark';
  onSelectWorkspace: (id: string) => void;
  onOpenAddWorkspace: () => void;
  onOpenQuickSearch: () => void;
  onOpenNewTerminal: () => void;
  onToggleTheme: () => void;
}

export function TopBar({
  workspaces,
  activeWorkspace,
  repoStatus,
  hcConnected,
  hcVersion,
  theme,
  onSelectWorkspace,
  onOpenAddWorkspace,
  onOpenQuickSearch,
  onOpenNewTerminal,
  onToggleTheme,
}: TopBarProps) {
  return (
    <header className="wb-topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, fontSize: 13 }}>
          <TerminalIcon size={15} strokeWidth={2.2} />
          <span>herdr-code</span>
        </div>

        <span style={{ color: 'var(--border-strong)' }}>/</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <select
            className="input"
            aria-label="Workspace"
            value={activeWorkspace?.id || ''}
            onChange={(e) => onSelectWorkspace(e.target.value)}
            style={{ minWidth: 180, maxWidth: 280, fontWeight: 500 }}
          >
            {workspaces.length === 0 && <option value="">No Workspaces</option>}
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name} ({ws.counts.total})
              </option>
            ))}
          </select>

          <button className="btn btn-sm" onClick={onOpenAddWorkspace} title="Add Workspace">
            <FolderPlus size={13} />
            <span>Add Workspace</span>
          </button>

          {repoStatus?.is_repo && repoStatus.branch && (
            <span
              className="mono"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11.5,
                color: 'var(--text-secondary)',
                padding: '2px 8px',
                borderRadius: 6,
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <GitBranch size={12} />
              <span>{repoStatus.branch}</span>
            </span>
          )}

          {activeWorkspace && activeWorkspace.counts.blocked > 0 && (
            <span className="status-badge status-blocked tabular">
              <span className="status-dot" />
              <span>{activeWorkspace.counts.blocked} Blocked</span>
            </span>
          )}
          {activeWorkspace && activeWorkspace.counts.working > 0 && (
            <span className="status-badge status-working tabular">
              <span className="status-dot" />
              <span>{activeWorkspace.counts.working} Working</span>
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          className="btn"
          onClick={onOpenQuickSearch}
          disabled={!activeWorkspace}
          title="Find File (Cmd+P)"
          style={{ color: 'var(--text-secondary)', gap: 8 }}
        >
          <Search size={13} />
          <span>Find File</span>
          <kbd
            className="mono"
            style={{
              fontSize: 10.5,
              padding: '1px 5px',
              borderRadius: 4,
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            ⌘P
          </kbd>
        </button>

        <button className="btn btn-primary" onClick={onOpenNewTerminal} disabled={!activeWorkspace}>
          <Plus size={13} />
          <span>New Terminal</span>
        </button>

        <span
          className={`status-badge ${hcConnected ? 'status-done' : 'status-error'}`}
          title={hcConnected ? `herdr-core ${hcVersion || ''}` : 'herdr-core disconnected'}
        >
          <span className="status-dot" />
          <span>{hcConnected ? `hc ${hcVersion || 'ok'}` : 'hc offline'}</span>
        </span>

        <button
          className="btn btn-icon btn-ghost"
          onClick={onToggleTheme}
          title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          aria-label="Toggle Theme"
        >
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
        </button>
      </div>
    </header>
  );
}
