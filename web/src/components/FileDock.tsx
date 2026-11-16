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
  GitCommit,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Undo2,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import type { ChangedFile, DiffMode, RepoStatus, TreeEntry, Workspace } from '../types/api';

type FileDockMode = 'files' | 'changes';

interface FileDockProps {
  workspace: Workspace | null;
  repoStatus: RepoStatus | null;
  activeFilePath: string | null;
  diffMode: DiffMode;
  diffTarget: string;
  activeDiffPath: string | null;
  refreshSignal: number;
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string, mode: DiffMode, target: string) => void;
  onChangeDiffParams: (mode: DiffMode, target: string) => void;
  onInsertReferencePath: (path: string) => void;
  onGitMutated: () => void;
  onOpenQuickSearch: () => void;
}

/**
 * Floating tool dock pinned to the right edge of the window, plus the
 * Files / Changes overlay panel it toggles. The panel floats above the
 * panes instead of taking a layout column.
 */
export function FileDock({
  workspace,
  repoStatus,
  activeFilePath,
  diffMode,
  diffTarget,
  activeDiffPath,
  refreshSignal,
  onOpenFile,
  onOpenDiff,
  onChangeDiffParams,
  onInsertReferencePath,
  onGitMutated,
  onOpenQuickSearch,
}: FileDockProps) {
  const [mode, setMode] = useState<FileDockMode | null>(null);

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

  useEffect(() => {
    if (!workspace) setMode(null);
  }, [workspace]);

  const changeCount = repoStatus?.files?.length || 0;

  return (
    <>
      {mode && (
        <div className="float-panel" role="dialog" aria-label={mode === 'files' ? 'Files' : 'Changes'}>
          <div className="float-panel-header">
            <span className="float-panel-title">{mode === 'files' ? 'Files' : 'Changes'}</span>
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
            mode={mode}
            workspace={workspace}
            repoStatus={repoStatus}
            activeFilePath={activeFilePath}
            diffMode={diffMode}
            diffTarget={diffTarget}
            activeDiffPath={activeDiffPath}
            refreshSignal={refreshSignal}
            onOpenFile={onOpenFile}
            onOpenDiff={onOpenDiff}
            onChangeDiffParams={onChangeDiffParams}
            onInsertReferencePath={onInsertReferencePath}
            onGitMutated={onGitMutated}
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
        <button
          className={`dock-btn ${mode === 'changes' ? 'active' : ''}`}
          title={`Changes${changeCount ? ` (${changeCount})` : ''}`}
          onClick={() => setMode((cur) => (cur === 'changes' ? null : 'changes'))}
        >
          <GitCommit size={15} />
          {changeCount > 0 && (
            <span className="dock-badge">{changeCount > 99 ? '99+' : changeCount}</span>
          )}
        </button>
        <div className="dock-sep" />
        <button className="dock-btn" title="Find File (⌘P)" onClick={onOpenQuickSearch}>
          <Search size={15} />
        </button>
      </div>
    </>
  );
}

interface FilesPanelBodyProps {
  mode: FileDockMode;
  workspace: Workspace | null;
  repoStatus: RepoStatus | null;
  activeFilePath: string | null;
  diffMode: DiffMode;
  diffTarget: string;
  activeDiffPath: string | null;
  refreshSignal: number;
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string, mode: DiffMode, target: string) => void;
  onChangeDiffParams: (mode: DiffMode, target: string) => void;
  onInsertReferencePath: (path: string) => void;
  onGitMutated: () => void;
}

function FilesPanelBody({
  mode,
  workspace,
  repoStatus,
  activeFilePath,
  diffMode,
  diffTarget,
  activeDiffPath,
  refreshSignal,
  onOpenFile,
  onOpenDiff,
  onChangeDiffParams,
  onInsertReferencePath,
  onGitMutated,
}: FilesPanelBodyProps) {
  const [showHidden, setShowHidden] = useState(false);
  const [treeCache, setTreeCache] = useState<Record<string, TreeEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingDiffList, setLoadingDiffList] = useState(false);

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

  const loadChangedFiles = useCallback(async () => {
    if (!workspaceId || !repoStatus?.is_repo) {
      setChangedFiles([]);
      return;
    }
    setLoadingDiffList(true);
    try {
      const res = await api.gitDiffFiles(workspaceId, diffMode, diffTarget);
      setChangedFiles(res.files);
    } catch {
      setChangedFiles([]);
    } finally {
      setLoadingDiffList(false);
    }
  }, [workspaceId, repoStatus?.is_repo, diffMode, diffTarget]);

  useEffect(() => {
    void loadChangedFiles();
  }, [loadChangedFiles, refreshSignal]);

  const toggleDir = async (relDir: string) => {
    const next = !expanded[relDir];
    setExpanded((prev) => ({ ...prev, [relDir]: next }));
    if (next && !treeCache[relDir]) {
      await loadDir(relDir);
    }
  };

  const handleStage = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    if (!workspace) return;
    await api.gitStage(workspace.id, path);
    onGitMutated();
  };

  const handleUnstage = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    if (!workspace) return;
    await api.gitUnstage(workspace.id, path);
    onGitMutated();
  };

  const handleDiscard = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    if (!workspace) return;
    if (!window.confirm(`Discard changes to ${path}?`)) return;
    await api.gitDiscard(workspace.id, path);
    onGitMutated();
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

  if (mode === 'files') {
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

  if (!repoStatus?.is_repo) {
    return (
      <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>
        Not a Git repository.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="float-panel-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
        <select
          className="input"
          value={diffMode}
          onChange={(e) => {
            const nextMode = e.target.value as DiffMode;
            let nextTarget = '';
            if (nextMode === 'branch') {
              nextTarget =
                repoStatus.branches.find((b) => b === 'main' || b === 'master') ||
                repoStatus.branches[0] ||
                '';
            } else if (nextMode === 'commit') {
              nextTarget = repoStatus.recent_commits[0]?.hash || '';
            }
            onChangeDiffParams(nextMode, nextTarget);
          }}
        >
          <option value="working">Working Tree</option>
          <option value="staged">Staged Only</option>
          <option value="unstaged">Unstaged Only</option>
          <option value="branch">Compare Branch</option>
          <option value="commit">Recent Commit</option>
        </select>

        {diffMode === 'branch' && (
          <select
            className="input mono"
            value={diffTarget}
            onChange={(e) => onChangeDiffParams('branch', e.target.value)}
          >
            {repoStatus.branches.map((b) => (
              <option key={b} value={b}>
                {b}...HEAD
              </option>
            ))}
          </select>
        )}

        {diffMode === 'commit' && (
          <select
            className="input"
            value={diffTarget}
            onChange={(e) => onChangeDiffParams('commit', e.target.value)}
          >
            {repoStatus.recent_commits.map((c) => (
              <option key={c.hash} value={c.hash}>
                {c.short_hash} · {c.subject}
              </option>
            ))}
          </select>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 4px' }}>
        {loadingDiffList && (
          <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>
            Loading changes...
          </div>
        )}
        {!loadingDiffList && changedFiles.length === 0 && (
          <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>
            No changes in this view.
          </div>
        )}
        {changedFiles.map((f) => {
          const isAct = activeDiffPath === f.path;
          const statusEntry = repoStatus.files.find((sf) => sf.path === f.path);
          const canMutate =
            diffMode === 'working' || diffMode === 'staged' || diffMode === 'unstaged';
          return (
            <div
              key={f.path}
              className={`tree-row ${isAct ? 'active' : ''}`}
              style={{ paddingLeft: 10 }}
              onClick={() => onOpenDiff(f.path, diffMode, diffTarget)}
            >
              <GitCommit size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <span
                className="mono"
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  width: 12,
                  color:
                    f.status === '?' || f.status === 'A'
                      ? 'var(--status-done)'
                      : f.status === 'D'
                        ? 'var(--status-error)'
                        : 'var(--status-blocked)',
                }}
              >
                {f.status}
              </span>
              <span
                title={f.path}
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 12,
                  flex: 1,
                }}
              >
                {f.path}
              </span>

              <div className="tree-ref-btn" style={{ display: 'flex', gap: 2 }}>
                {canMutate && statusEntry && (statusEntry.unstaged || statusEntry.untracked) && (
                  <button
                    className="btn btn-ghost btn-icon"
                    style={{ width: 20, height: 20 }}
                    title="Stage File"
                    onClick={(e) => void handleStage(e, f.path)}
                  >
                    <Plus size={11} />
                  </button>
                )}
                {canMutate && statusEntry && statusEntry.staged && (
                  <button
                    className="btn btn-ghost btn-icon"
                    style={{ width: 20, height: 20 }}
                    title="Unstage File"
                    onClick={(e) => void handleUnstage(e, f.path)}
                  >
                    <Undo2 size={11} />
                  </button>
                )}
                {canMutate && (
                  <button
                    className="btn btn-ghost btn-icon"
                    style={{ width: 20, height: 20 }}
                    title="Discard Changes"
                    onClick={(e) => void handleDiscard(e, f.path)}
                  >
                    <RotateCcw size={11} />
                  </button>
                )}
                <button
                  className="btn btn-ghost btn-icon"
                  style={{ width: 20, height: 20 }}
                  title={`Reference @${f.path}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onInsertReferencePath(f.path);
                  }}
                >
                  <AtSign size={11} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
