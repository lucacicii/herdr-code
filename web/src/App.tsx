import { useCallback, useEffect, useRef, useState } from 'react';
import { AddWorkspaceModal } from './components/AddWorkspaceModal';
import { CenterCodePane } from './components/CenterCodePane';
import { LeftSidebar } from './components/LeftSidebar';
import { NewTerminalModal } from './components/NewTerminalModal';
import { QuickOpenModal } from './components/QuickOpenModal';
import { RightTerminalPane } from './components/RightTerminalPane';
import { TopBar } from './components/TopBar';
import { api, initTokenFromEnv, setAuthToken, wsUrl } from './lib/api';
import { formatLineAnchor } from './lib/references';
import type {
  CenterTab,
  DiffHunk,
  DiffMode,
  FileContent,
  FileDiff,
  ReferenceChip,
  RepoStatus,
  ReviewComment,
  TerminalInfo,
  Workspace,
} from './types/api';

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('herdr_code_theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

  const [authNeeded, setAuthNeeded] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  const [hcConnected, setHcConnected] = useState(false);
  const [hcVersion, setHcVersion] = useState<string | undefined>();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() =>
    localStorage.getItem('herdr_code_ws')
  );
  const [allTerminals, setAllTerminals] = useState<TerminalInfo[]>([]);
  const [repoStatus, setRepoStatus] = useState<RepoStatus | null>(null);

  const [tabs, setTabs] = useState<CenterTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [filesByPath, setFilesByPath] = useState<Record<string, FileContent>>({});

  const [diffMode, setDiffMode] = useState<DiffMode>('working');
  const [diffTarget, setDiffTarget] = useState('');
  const [activeDiffPath, setActiveDiffPath] = useState<string | null>(null);
  const [activeDiff, setActiveDiff] = useState<FileDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const [chips, setChips] = useState<ReferenceChip[]>([]);
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);

  const [refreshSignal, setRefreshSignal] = useState(0);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [showAddWorkspace, setShowAddWorkspace] = useState(false);
  const [showNewTerminal, setShowNewTerminal] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  // Column widths in pixels (left fixed, right flex/px, center flex)
  const [leftWidth, setLeftWidth] = useState(260);
  const [rightWidth, setRightWidth] = useState(540);
  const dragRef = useRef<{ side: 'left' | 'right'; startX: number; startW: number } | null>(null);

  useEffect(() => {
    initTokenFromEnv();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('herdr_code_theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? '#0a0a0a' : '#ffffff');
    }
  }, [theme]);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const refreshData = useCallback(async () => {
    try {
      const h = await api.health();
      setHcConnected(h.hc_connected);
      setHcVersion(h.hc_version);

      const [wsRes, termRes] = await Promise.all([
        api.listWorkspaces(),
        api.listTerminals().catch(() => ({ terminals: [] as TerminalInfo[] })),
      ]);
      setAuthNeeded(false);
      setWorkspaces(wsRes.workspaces);
      setAllTerminals(termRes.terminals || []);

      setActiveWorkspaceId((prev) => {
        if (prev && wsRes.workspaces.some((w) => w.id === prev)) return prev;
        return wsRes.workspaces[0]?.id || null;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('unauthorized') || msg.includes('401')) {
        setAuthNeeded(true);
      }
    }
  }, []);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || null;

  useEffect(() => {
    if (activeWorkspaceId) {
      localStorage.setItem('herdr_code_ws', activeWorkspaceId);
    }
  }, [activeWorkspaceId]);

  const refreshGit = useCallback(async () => {
    if (!activeWorkspaceId) {
      setRepoStatus(null);
      return;
    }
    try {
      const st = await api.gitStatus(activeWorkspaceId);
      setRepoStatus(st);
    } catch {
      setRepoStatus(null);
    }
  }, [activeWorkspaceId]);

  // Switch fsnotify watcher & clear workspace-specific tabs when workspace changes
  const prevWsRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeWorkspaceId) return;
    if (prevWsRef.current && prevWsRef.current !== activeWorkspaceId) {
      setTabs([]);
      setActiveTabId(null);
      setFilesByPath({});
      setActiveDiff(null);
      setActiveDiffPath(null);
    }
    prevWsRef.current = activeWorkspaceId;
    void api.watchWorkspace(activeWorkspaceId).catch(() => {});
    void refreshGit();
  }, [activeWorkspaceId, refreshGit]);

  // Global Events WebSocket (hc events + fs.changed)
  useEffect(() => {
    if (authNeeded) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(wsUrl('/ws/events'));
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'hc.connected' || msg.type === 'hc.disconnected' || msg.type === 'hc.snapshot' || msg.type === 'hc.event') {
            void refreshData();
          } else if (msg.type === 'fs.changed') {
            setRefreshSignal((n) => n + 1);
            void refreshGit();
            const changedPaths: string[] = msg.paths || [];
            if (activeWorkspaceId && changedPaths.length > 0) {
              for (const p of changedPaths) {
                setFilesByPath((prev) => {
                  if (!prev[p]) return prev;
                  void api.readFile(activeWorkspaceId, p).then((fc) => {
                    setFilesByPath((curr) => ({ ...curr, [p]: fc }));
                  }).catch(() => {});
                  return prev;
                });
              }
            }
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        if (!closed) {
          retryTimer = setTimeout(connect, 2000);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [authNeeded, refreshData, refreshGit, activeWorkspaceId]);

  // Cmd+P quick open
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        if (!activeWorkspaceId) return;
        e.preventDefault();
        setShowQuickOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeWorkspaceId]);

  // Column resizer drag
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.side === 'left') {
        setLeftWidth(Math.max(180, Math.min(460, d.startW + (e.clientX - d.startX))));
      } else {
        setRightWidth(Math.max(320, Math.min(900, d.startW - (e.clientX - d.startX))));
      }
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const openFile = useCallback(
    async (path: string, line?: number) => {
      if (!activeWorkspaceId) return;
      const tabId = `code:${path}`;
      setTabs((prev) => {
        const existing = prev.find((t) => t.id === tabId);
        if (existing) {
          return prev.map((t) =>
            t.id === tabId && t.kind === 'code'
              ? { ...t, highlightStart: line, highlightEnd: line }
              : t
          );
        }
        return [
          ...prev,
          { id: tabId, kind: 'code', path, highlightStart: line, highlightEnd: line },
        ];
      });
      setActiveTabId(tabId);

      try {
        const fc = await api.readFile(activeWorkspaceId, path);
        setFilesByPath((prev) => ({ ...prev, [path]: fc }));
      } catch {
        // ignore unreadable path (e.g. broken terminal link)
      }
    },
    [activeWorkspaceId]
  );

  const openDiff = useCallback(
    async (path: string, mode: DiffMode, target: string) => {
      if (!activeWorkspaceId) return;
      setDiffMode(mode);
      setDiffTarget(target);
      setActiveDiffPath(path);
      setTabs((prev) => {
        const existing = prev.find((t) => t.id === 'diff');
        if (existing) {
          return prev.map((t) => (t.id === 'diff' ? { id: 'diff', kind: 'diff', path, mode, target } : t));
        }
        return [...prev, { id: 'diff', kind: 'diff', path, mode, target }];
      });
      setActiveTabId('diff');
      setLoadingDiff(true);
      try {
        const d = await api.gitDiff(activeWorkspaceId, mode, target, path);
        setActiveDiff(d);
      } catch {
        setActiveDiff(null);
      } finally {
        setLoadingDiff(false);
      }
    },
    [activeWorkspaceId]
  );

  const handleGitMutated = useCallback(() => {
    setRefreshSignal((n) => n + 1);
    void refreshGit();
    if (activeDiffPath && activeWorkspaceId) {
      void api
        .gitDiff(activeWorkspaceId, diffMode, diffTarget, activeDiffPath)
        .then(setActiveDiff)
        .catch(() => setActiveDiff(null));
    }
  }, [activeDiffPath, activeWorkspaceId, diffMode, diffTarget, refreshGit]);

  const addFileRef = (path: string) => {
    setChips((prev) => [
      ...prev,
      { id: makeId('ref'), kind: 'path', label: `@${path}`, path },
    ]);
  };

  const addLineRef = (path: string, startLine: number, endLine: number) => {
    setChips((prev) => [
      ...prev,
      {
        id: makeId('ref'),
        kind: 'lines',
        label: formatLineAnchor(path, startLine, endLine),
        path,
        startLine,
        endLine,
      },
    ]);
  };

  const addSnippetRef = (
    path: string,
    startLine: number,
    endLine: number,
    snippet: string,
    language: string
  ) => {
    setChips((prev) => [
      ...prev,
      {
        id: makeId('ref'),
        kind: 'snippet',
        label: `${formatLineAnchor(path, startLine, endLine)} (snippet)`,
        path,
        startLine,
        endLine,
        snippet,
        language,
      },
    ]);
  };

  const addHunkRef = (path: string, hunk: DiffHunk) => {
    setChips((prev) => [
      ...prev,
      {
        id: makeId('ref'),
        kind: 'hunk',
        label: `@${path.split('/').pop()} (${hunk.id})`,
        path,
        snippet: hunk.patch,
      },
    ]);
  };

  const addReviewComment = (path: string, startLine: number, endLine: number, text: string) => {
    setReviewComments((prev) => [
      ...prev,
      { id: makeId('rc'), path, startLine, endLine, text },
    ]);
  };

  const attachReviewComments = () => {
    if (reviewComments.length === 0) return;
    setChips((prev) => [
      ...prev,
      {
        id: makeId('rev'),
        kind: 'review',
        label: `Review (${reviewComments.length} comments)`,
        path: reviewComments[0].path,
        comments: [...reviewComments],
      },
    ]);
    setReviewComments([]);
  };

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const activeFilePath = activeTab?.kind === 'code' ? activeTab.path : null;

  if (authNeeded) {
    return (
      <div className="wb-root" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="modal-card" style={{ width: 380, padding: 20, gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Authentication Required</div>
          <input
            className="input mono"
            type="password"
            placeholder="Bearer token"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tokenInput.trim()) {
                setAuthToken(tokenInput.trim());
                void refreshData();
              }
            }}
          />
          <button
            className="btn btn-primary"
            onClick={() => {
              setAuthToken(tokenInput.trim());
              void refreshData();
            }}
          >
            Connect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wb-root">
      <TopBar
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        repoStatus={repoStatus}
        hcConnected={hcConnected}
        hcVersion={hcVersion}
        theme={theme}
        canInstallPWA={Boolean(installPrompt)}
        onInstallPWA={async () => {
          if (!installPrompt) return;
          await installPrompt.prompt();
          const choice = await installPrompt.userChoice;
          if (choice.outcome === 'accepted') {
            setInstallPrompt(null);
          }
        }}
        onSelectWorkspace={setActiveWorkspaceId}
        onOpenAddWorkspace={() => setShowAddWorkspace(true)}
        onOpenQuickSearch={() => setShowQuickOpen(true)}
        onOpenNewTerminal={() => setShowNewTerminal(true)}
        onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
      />

      <main className="wb-main">
        <aside className="wb-col" style={{ width: leftWidth, flexShrink: 0 }}>
          <LeftSidebar
            workspace={activeWorkspace}
            repoStatus={repoStatus}
            activeFilePath={activeFilePath}
            diffMode={diffMode}
            diffTarget={diffTarget}
            activeDiffPath={activeDiffPath}
            refreshSignal={refreshSignal}
            onOpenFile={(p) => void openFile(p)}
            onOpenDiff={(p, m, t) => void openDiff(p, m, t)}
            onChangeDiffParams={(m, t) => {
              setDiffMode(m);
              setDiffTarget(t);
            }}
            onInsertReferencePath={addFileRef}
            onGitMutated={handleGitMutated}
          />
        </aside>

        <div
          className="wb-resizer"
          onMouseDown={(e) => {
            dragRef.current = { side: 'left', startX: e.clientX, startW: leftWidth };
          }}
        />

        <section className="wb-col" style={{ flex: 1, minWidth: 260 }}>
          <CenterCodePane
            workspaceId={activeWorkspaceId}
            tabs={tabs}
            activeTabId={activeTabId}
            filesByPath={filesByPath}
            activeDiff={activeDiff}
            loadingDiff={loadingDiff}
            theme={theme}
            onSelectTab={setActiveTabId}
            onCloseTab={(id) => {
              setTabs((prev) => {
                const next = prev.filter((t) => t.id !== id);
                if (activeTabId === id) {
                  setActiveTabId(next[next.length - 1]?.id || null);
                }
                return next;
              });
            }}
            onOpenQuickSearch={() => setShowQuickOpen(true)}
            onAddFileRef={addFileRef}
            onAddLineRef={addLineRef}
            onAddSnippetRef={addSnippetRef}
            onAddHunkRef={addHunkRef}
            onAddReviewComment={addReviewComment}
            onGitMutated={handleGitMutated}
          />
        </section>

        <div
          className="wb-resizer"
          onMouseDown={(e) => {
            dragRef.current = { side: 'right', startX: e.clientX, startW: rightWidth };
          }}
        />

        <aside className="wb-col" style={{ width: rightWidth, flexShrink: 0 }}>
          <RightTerminalPane
            workspaceTerminals={activeWorkspace?.terminals || []}
            allTerminals={allTerminals}
            theme={theme}
            chips={chips}
            reviewComments={reviewComments}
            onRemoveChip={(id) => setChips((prev) => prev.filter((c) => c.id !== id))}
            onClearChips={() => setChips([])}
            onAddPathChip={addFileRef}
            onRemoveReviewComment={(id) =>
              setReviewComments((prev) => prev.filter((c) => c.id !== id))
            }
            onClearReviewComments={() => setReviewComments([])}
            onAttachReviewComments={attachReviewComments}
            onOpenFileLine={(p, line) => void openFile(p, line)}
            onOpenNewTerminal={() => setShowNewTerminal(true)}
            onTerminalsMutated={() => void refreshData()}
          />
        </aside>
      </main>

      {showQuickOpen && activeWorkspaceId && (
        <QuickOpenModal
          workspaceId={activeWorkspaceId}
          onClose={() => setShowQuickOpen(false)}
          onSelectFile={(p) => void openFile(p)}
        />
      )}

      {showAddWorkspace && (
        <AddWorkspaceModal
          onClose={() => setShowAddWorkspace(false)}
          onAdded={(ws) => {
            void refreshData().then(() => setActiveWorkspaceId(ws.id));
          }}
        />
      )}

      {showNewTerminal && activeWorkspace && (
        <NewTerminalModal
          workspace={activeWorkspace}
          onClose={() => setShowNewTerminal(false)}
          onCreated={() => {
            void refreshData();
          }}
        />
      )}
    </div>
  );
}

export default App;
