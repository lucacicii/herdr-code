import { useCallback, useEffect, useState } from 'react';
import {
  AtSign,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileCode2,
  Folder,
  FolderOpen,
  FolderTree,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import type { RepoStatus, TreeEntry, Workspace } from '../types/api';

interface FileDockProps {
  workspace: Workspace | null;
  repoStatus: RepoStatus | null;
  activeFilePath: string | null;
  refreshSignal: number;
  onOpenFile: (path: string) => void;
  onInsertReferencePath: (path: string) => void;
  onOpenQuickSearch: () => void;
}

/**
 * Floating tool dock pinned to the right edge of the window, plus the
 * Files overlay panel it toggles. The panel floats above the
 * panes instead of taking a layout column.
 */
export function FileDock({
  workspace,
  repoStatus,
  activeFilePath,
  refreshSignal,
  onOpenFile,
  onInsertReferencePath,
  onOpenQuickSearch,
}: FileDockProps) {
  const [mode, setMode] = useState<'files' | null>(null);
  const close = useCallback(() => setMode(null), []);

  // Dismiss on Escape, or when the active workspace disappears.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mode) {
        e.stopPropagation();
        setMode(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode]);

  // Dismiss when the pointer lands anywhere outside the panel and the dock.
  useEffect(() => {
    if (!mode) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.float-panel') || target.closest('.float-dock')) return;
      setMode(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [mode]);

  useEffect(() => {
    if (!workspace) setMode(null);
  }, [workspace]);

  return (
    <>
      {mode && (
        <div className="float-panel" role="dialog" aria-label="Files">
          <div className="float-panel-header">
            <span className="float-panel-title">Files</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                className="btn btn-ghost btn-icon"
                style={{ width: 22, height: 22 }}
                title="Close"
                onClick={() => setMode(null)}
              >
                <X size={13} />
              </button>
            </div>
          </div>
          <FilesPanelBody
            workspace={workspace}
            repoStatus={repoStatus}
            activeFilePath={activeFilePath}
            refreshSignal={refreshSignal}
            onOpenFile={(path) => {
              onOpenFile(path);
              close();
            }}
            onInsertReferencePath={onInsertReferencePath}
          />
        </div>
      )}

      <div className="float-dock">
        <button
          className={`dock-btn ${mode === 'files' ? 'active' : ''}`}
          title="Files"
          onClick={() => setMode((cur) => (cur === 'files' ? null : 'files'))}
        >
          <FolderTree size={15} />
        </button>
        <div className="dock-sep" />
        <button
          className="dock-btn"
          title="Find File (⌘P)"
          onClick={() => {
            close();
            onOpenQuickSearch();
          }}
        >
          <Search size={15} />
        </button>
      </div>
    </>
  );
}

interface FilesPanelBodyProps {
  workspace: Workspace | null;
  repoStatus: RepoStatus | null;
  activeFilePath: string | null;
  refreshSignal: number;
  onOpenFile: (path: string) => void;
  onInsertReferencePath: (path: string) => void;
}

function FilesPanelBody({
  workspace,
  repoStatus,
  activeFilePath,
  refreshSignal,
  onOpenFile,
  onInsertReferencePath,
}: FilesPanelBodyProps) {
  const [showHidden, setShowHidden] = useState(false);
  const [treeCache, setTreeCache] = useState<Record<string, TreeEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loadingTree, setLoadingTree] = useState(false);

  // Depend on the workspace id, not the (re-created every poll) workspace object,
  // so background refreshes do not wipe the loaded tree.
  const workspaceId = workspace?.id;

  const loadDir = useCallback(
    async (relDir: string) => {
      if (!workspaceId) return;
      if (relDir === '') setLoadingTree(true);
      try {
        const res = await api.listTree(workspaceId, relDir, showHidden);
        setTreeCache((prev) => ({ ...prev, [relDir]: res.entries }));
      } finally {
        if (relDir === '') setLoadingTree(false);
      }
    },
    [workspaceId, showHidden]
  );

  useEffect(() => {
    setTreeCache({});
    setExpanded({});
    if (workspace) {
      void loadDir('');
    }
  }, [workspaceId, showHidden, loadDir]);

  useEffect(() => {
    if (!workspace || refreshSignal === 0) return;
    void loadDir('');
    for (const dir of Object.keys(expanded)) {
      if (expanded[dir]) {
        void loadDir(dir);
      }
    }
  }, [refreshSignal]);

  const toggleDir = async (relDir: string) => {
    const next = !expanded[relDir];
    setExpanded((prev) => ({ ...prev, [relDir]: next }));
    if (next && !treeCache[relDir]) {
      await loadDir(relDir);
    }
  };

  const gitMap = new Map<string, string>();
  if (repoStatus?.files) {
    for (const f of repoStatus.files) {
      gitMap.set(f.path, f.untracked ? '?' : f.worktree || f.index || 'M');
    }
  }

  const renderTree = (relDir: string, depth: number): React.ReactNode => {
    const entries = treeCache[relDir] || [];
    return entries.map((entry) => {
      const isExp = !!expanded[entry.path];
      const isAct = !entry.is_dir && activeFilePath === entry.path;
      const gStatus = gitMap.get(entry.path);

      return (
        <div key={entry.path}>
          <div
            className={`tree-row ${isAct ? 'active' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/herdr-path', entry.path);
              e.dataTransfer.setData('text/plain', `@${entry.path}`);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => {
              if (entry.is_dir) {
                void toggleDir(entry.path);
              } else {
                onOpenFile(entry.path);
              }
            }}
          >
            {entry.is_dir ? (
              <>
                {isExp ? (
                  <ChevronDown size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                ) : (
                  <ChevronRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                )}
                {isExp ? (
                  <FolderOpen size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                ) : (
                  <Folder size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                )}
              </>
            ) : (
              <>
                <span style={{ width: 13, flexShrink: 0 }} />
                <FileCode2 size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              </>
            )}

            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 12.5,
              }}
            >
              {entry.name}
            </span>

            {gStatus && (
              <span
                className="mono"
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  marginLeft: 4,
                  color:
                    gStatus === '?' || gStatus === 'A'
                      ? 'var(--status-done)'
                      : gStatus === 'D'
                        ? 'var(--status-error)'
                        : 'var(--status-blocked)',
                }}
              >
                {gStatus}
              </span>
            )}

            <button
              className="btn btn-ghost btn-icon tree-ref-btn"
              style={{ width: 20, height: 20 }}
              title={`Reference @${entry.path}`}
              onClick={(e) => {
                e.stopPropagation();
                onInsertReferencePath(entry.path);
              }}
            >
              <AtSign size={11} />
            </button>
          </div>
          {entry.is_dir && isExp && renderTree(entry.path, depth + 1)}
        </div>
      );
    });
  };

  if (!workspace) {
    return (
      <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>
        Select or add a workspace.
      </div>
    );
  }

  return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="float-panel-toolbar">
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>
            {workspace.name}
          </span>
          <button
            className="btn btn-ghost btn-icon"
            style={{ width: 22, height: 22 }}
            onClick={() => setShowHidden((v) => !v)}
            title={showHidden ? 'Hide Dotfiles' : 'Show Dotfiles'}
          >
            {showHidden ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <button
            className="btn btn-ghost btn-icon"
            style={{ width: 22, height: 22 }}
            onClick={() => void loadDir('')}
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 4px' }}>
          {loadingTree && !treeCache[''] && (
            <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>Loading...</div>
          )}
          {renderTree('', 0)}
        </div>
      </div>
    );
}
