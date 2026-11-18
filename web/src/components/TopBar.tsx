import { useEffect, useState } from 'react';
import {
  GitBranch,
  Moon,
  PanelRight,
  Search,
  Settings,
  Sun,
  Terminal as TerminalIcon,
} from 'lucide-react';
import type { RepoStatus, Workspace } from '../types/api';

interface TopBarProps {
  activeWorkspace: Workspace | null;
  repoStatus: RepoStatus | null;
  hcConnected: boolean;
  // False when /api/health itself is unreachable, i.e. the herdr-code server is
  // gone — not the hc daemon. The two look identical in the UI otherwise.
  serverOnline: boolean;
  theme: 'light' | 'dark';
  codePaneOpen: boolean;
  codeTabCount: number;
  onOpenQuickSearch: () => void;
  onToggleCodePane: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
}

// A space's name says nothing about where it lives, so the top bar shows the
// directory too; the home prefix is folded to ~ to keep it readable.
function shortenPath(path: string): string {
  return path.replace(/^(\/Users\/[^/]+|\/home\/[^/]+)(?=\/|$)/, '~');
}

export function TopBar({
  activeWorkspace,
  repoStatus,
  hcConnected,
  serverOnline,
  theme,
  codePaneOpen,
  codeTabCount,
  onOpenQuickSearch,
  onToggleCodePane,
  onOpenSettings,
  onToggleTheme,
}: TopBarProps) {
  const [copiedPath, setCopiedPath] = useState(false);

  useEffect(() => {
    if (!copiedPath) return;
    const timer = setTimeout(() => setCopiedPath(false), 1200);
    return () => clearTimeout(timer);
  }, [copiedPath]);

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(true);
    } catch {
      // Clipboard access is refused outside a secure context; the tooltip still
      // carries the full path.
    }
  };

  return (
    <header className="wb-topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, fontSize: 13 }}>
          <TerminalIcon size={15} strokeWidth={2.2} />
          <span>herdr-code</span>
        </div>

        {activeWorkspace && (
          <>
            <span style={{ color: 'var(--border-strong)' }}>/</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span
                title={activeWorkspace.path}
                style={{
                  fontWeight: 500,
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 220,
                }}
              >
                {activeWorkspace.name}
              </span>

              <span
                className="mono"
                title={`${activeWorkspace.path} — click to copy`}
                onClick={() => void copyPath(activeWorkspace.path)}
                style={{
                  fontSize: 11.5,
                  color: copiedPath ? 'var(--text-primary)' : 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                  maxWidth: 280,
                  cursor: 'pointer',
                }}
              >
                {copiedPath ? 'copied' : shortenPath(activeWorkspace.path)}
              </span>

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

              {activeWorkspace.counts.blocked > 0 && (
                <span className="status-badge status-blocked tabular">
                  <span className="status-dot" />
                  <span>{activeWorkspace.counts.blocked} Blocked</span>
                </span>
              )}
              {activeWorkspace.counts.working > 0 && (
                <span className="status-badge status-working tabular">
                  <span className="status-dot" />
                  <span>{activeWorkspace.counts.working} Working</span>
                </span>
              )}
            </div>
          </>
        )}
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

        <button
          className={`btn ${codePaneOpen ? 'btn-accent' : ''}`}
          onClick={onToggleCodePane}
          title={codePaneOpen ? 'Hide Code & Diff Panel' : 'Show Code & Diff Panel'}
          aria-label="Toggle Code Panel"
        >
          <PanelRight size={13} />
          <span>Code{codeTabCount > 0 ? ` (${codeTabCount})` : ''}</span>
        </button>

        {!serverOnline ? (
          <span
            className="status-badge status-error"
            title="Can't reach the herdr-code server — retrying every couple of seconds"
          >
            <span className="status-dot" />
            <span>server offline</span>
          </span>
        ) : (
          !hcConnected && (
            <button
              className="status-badge status-error"
              style={{ border: 'none', cursor: 'pointer' }}
              onClick={onOpenSettings}
              title="herdr-core disconnected — click to open Settings"
            >
              <span className="status-dot" />
              <span>hc offline</span>
            </button>
          )
        )}

        <button
          className="btn btn-icon btn-ghost"
          style={{ position: 'relative' }}
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Open Settings"
        >
          <Settings size={14} />
          {(!serverOnline || !hcConnected) && (
            <span
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--status-blocked)',
              }}
            />
          )}
        </button>

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
