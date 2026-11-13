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
  GitCommit,
  Plus,
  RefreshCw,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  ChangedFile,
  DiffMode,
  RepoStatus,
  TreeEntry,
  Workspace,
} from '../types/api';

interface LeftSidebarProps {
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

export function LeftSidebar({
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
}: LeftSidebarProps) {
  const [section, setSection] = useState<'files' | 'changes'>('files');
  const [showHidden, setShowHidden] = useState(false);
  const [treeCache, setTreeCache] = useState<Record<string, TreeEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingDiffList, setLoadingDiffList] = useState(false);

  const loadDir = useCallback(
    async (relDir: string) => {
      if (!workspace) return;
      if (relDir === '') setLoadingTree(true);
      try {
        const res = await api.listTree(workspace.id, relDir, showHidden);
        setTreeCache((prev) => ({ ...prev, [relDir]: res.entries }));
      } finally {
        if (relDir === '') setLoadingTree(false);
      }
    },
    [workspace, showHidden]
  );

  useEffect(() => {
    setTreeCache({});
    setExpanded({});
    if (workspace) {
      void loadDir('');
    }
  }, [workspace?.id, showHidden, loadDir]);

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
    if (!workspace || !repoStatus?.is_repo) {
      setChangedFiles([]);
      return;
    }
    setLoadingDiffList(true);
    try {
      const res = await api.gitDiffFiles(workspace.id, diffMode, diffTarget);
      setChangedFiles(res.files);
    } catch {
      setChangedFiles([]);
    } finally {
      setLoadingDiffList(false);
    }
  }, [workspace, repoStatus?.is_repo, diffMode, diffTarget]);

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

  const renderTree = (relDir: string, depth: number) => {
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

  const changeCount = repoStatus?.files?.length || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          gap: 6,
        }}
      >
        <div className="seg-group">
          <button
            className={`seg-btn ${section === 'files' ? 'active' : ''}`}
            onClick={() => setSection('files')}
          >
            Files
          </button>
          <button
            className={`seg-btn ${section === 'changes' ? 'active' : ''}`}
            onClick={() => setSection('changes')}
          >
            <span>Changes</span>
            {changeCount > 0 && <span className="tabular">({changeCount})</span>}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {section === 'files' && (
            <button
              className="btn btn-icon btn-ghost"
              onClick={() => setShowHidden((v) => !v)}
              title={showHidden ? 'Hide Dotfiles' : 'Show Dotfiles'}
            >
              {showHidden ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          )}
          <button
            className="btn btn-icon btn-ghost"
            onClick={() => (section === 'files' ? void loadDir('') : onGitMutated())}
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {section === 'files' ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 4px' }}>
          {!workspace && (
            <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>
              Select or add a workspace.
            </div>
          )}
          {workspace && loadingTree && !treeCache[''] && (
            <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>Loading...</div>
          )}
          {workspace && renderTree('', 0)}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {!repoStatus?.is_repo ? (
            <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>
              Not a Git repository.
            </div>
          ) : (
            <>
              <div
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
