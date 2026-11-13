import { useCallback, useEffect, useRef, useState } from 'react';
import { AddWorkspaceModal } from './components/AddWorkspaceModal';
import { CenterCodePane } from './components/CenterCodePane';
import { LeftSidebar } from './components/LeftSidebar';
import { NewTerminalModal } from './components/NewTerminalModal';
import { QuickOpenModal } from './components/QuickOpenModal';
import { RightTerminalPane, type RightTerminalPaneHandle } from './components/RightTerminalPane';
import { SettingsModal } from './components/SettingsModal';
import { TopBar } from './components/TopBar';
import { api, initTokenFromEnv, setAuthToken, wsUrl } from './lib/api';
import { formatLineAnchor } from './lib/references';
import {
  loadTerminalFontConfig,
  saveTerminalFontConfig,
  type TerminalFontConfig,
} from './lib/terminalFont';
import type {
  CenterTab,
  DiffHunk,
  DiffMode,
  FileContent,
  FileDiff,
  HerdrSpace,
  RepoStatus,
  TerminalInfo,
  Workspace,
} from './types/api';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('herdr_code_theme');
    return saved === 'dark' ? 'dark' : 'light';
  });
  const [terminalFont, setTerminalFont] = useState<TerminalFontConfig>(() =>
    loadTerminalFontConfig()
  );

  useEffect(() => {
    saveTerminalFontConfig(terminalFont);
  }, [terminalFont]);

  const [authNeeded, setAuthNeeded] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  const [hcConnected, setHcConnected] = useState(false);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() =>
    localStorage.getItem('herdr_code_ws')
  );
  const [allTerminals, setAllTerminals] = useState<TerminalInfo[]>([]);
  const [herdrSpaces, setHerdrSpaces] = useState<HerdrSpace[]>([]);
  const [herdrColors, setHerdrColors] = useState<Record<string, string>>({});
  const [focusedTerminalAddress, setFocusedTerminalAddress] = useState<string | null>(null);
  const [terminalFocusReq, setTerminalFocusReq] = useState<{ address: string; seq: number } | null>(null);
  const [repoStatus, setRepoStatus] = useState<RepoStatus | null>(null);

  const [tabs, setTabs] = useState<CenterTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [filesByPath, setFilesByPath] = useState<Record<string, FileContent>>({});

  const [diffMode, setDiffMode] = useState<DiffMode>('working');
  const [diffTarget, setDiffTarget] = useState('');
  const [activeDiffPath, setActiveDiffPath] = useState<string | null>(null);
  const [activeDiff, setActiveDiff] = useState<FileDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const terminalPaneRef = useRef<RightTerminalPaneHandle>(null);

  const [refreshSignal, setRefreshSignal] = useState(0);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [showAddWorkspace, setShowAddWorkspace] = useState(false);
  const [showNewTerminal, setShowNewTerminal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsPromptReason, setSettingsPromptReason] = useState<string | undefined>(undefined);
  const [codePaneOpen, setCodePaneOpen] = useState(false);
  const checkedDepsOnBootRef = useRef(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  // Column widths in pixels (left fixed, center flex, right fixed)
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(520);
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

      const [wsRes, termRes, herdrRes] = await Promise.all([
        api.listWorkspaces(),
        api.listTerminals().catch(() => ({ terminals: [] as TerminalInfo[] })),
        api.herdrSpaces().catch(() => ({ spaces: [] as HerdrSpace[], colors: {} as Record<string, string> })),
      ]);
      setAuthNeeded(false);
      setWorkspaces(wsRes.workspaces);
      setAllTerminals(termRes.terminals || []);
      setHerdrSpaces(herdrRes.spaces || []);
      setHerdrColors(herdrRes.colors || {});

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

  // Option A: Auto-check Herdr dependencies on initial load; if missing or daemon stopped, open Settings automatically
  useEffect(() => {
    if (authNeeded || checkedDepsOnBootRef.current) return;
    let cancelled = false;
    void api
      .getDependencies()
      .then((deps) => {
        if (cancelled) return;
        checkedDepsOnBootRef.current = true;
        if (!deps.hc_cli.installed) {
          setSettingsPromptReason(
            'herdr-core (hc) is not installed yet. Click "Install herdr-core" below to install and start it automatically.'
          );
          setShowSettings(true);
        } else if (!deps.hc_daemon.running) {
          setSettingsPromptReason(
            'herdr-core Daemon is not running. Click "Start Daemon" below to connect live terminals.'
          );
          setShowSettings(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authNeeded]);

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
        setRightWidth(Math.max(280, Math.min(960, d.startW - (e.clientX - d.startX))));
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
      setCodePaneOpen(true);

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
      setCodePaneOpen(true);
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

  const pasteIntoFocusedTerminal = useCallback((text: string) => {
    terminalPaneRef.current?.pasteText(text);
  }, []);

  const addFileRef = (path: string) => {
    pasteIntoFocusedTerminal(`@${path} `);
  };

  const addLineRef = (path: string, startLine: number, endLine: number) => {
    pasteIntoFocusedTerminal(`${formatLineAnchor(path, startLine, endLine)} `);
  };

  const addSnippetRef = (
    path: string,
    startLine: number,
    endLine: number,
    snippet: string,
    language: string
  ) => {
    const anchor = formatLineAnchor(path, startLine, endLine);
    pasteIntoFocusedTerminal(`${anchor}\n\`\`\`${language || ''}\n${snippet}\n\`\`\`\n`);
  };

  const addHunkRef = (path: string, hunk: DiffHunk) => {
    pasteIntoFocusedTerminal(`@${path} (diff hunk)\n\`\`\`diff\n${hunk.patch}\n\`\`\`\n`);
  };

  const addReviewComment = (path: string, startLine: number, endLine: number, text: string) => {
    const anchor = formatLineAnchor(path, startLine, endLine);
    pasteIntoFocusedTerminal(`- ${anchor}: ${text}\n`);
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
        activeWorkspace={activeWorkspace}
        repoStatus={repoStatus}
        hcConnected={hcConnected}
        theme={theme}
        codePaneOpen={codePaneOpen}
        codeTabCount={tabs.length}
        onOpenQuickSearch={() => setShowQuickOpen(true)}
        onToggleCodePane={() => setCodePaneOpen((v) => !v)}
        onOpenSettings={() => {
          setSettingsPromptReason(undefined);
          setShowSettings(true);
        }}
        onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
      />

      <main className="wb-main">
        <aside className="wb-col" style={{ width: leftWidth, flexShrink: 0 }}>
          <LeftSidebar
            workspaces={workspaces}
            workspace={activeWorkspace}
            allTerminals={allTerminals}
            focusedTerminalAddress={focusedTerminalAddress}
            herdrSpaces={herdrSpaces}
            herdrColors={herdrColors}
            repoStatus={repoStatus}
            activeFilePath={activeFilePath}
            diffMode={diffMode}
            diffTarget={diffTarget}
            activeDiffPath={activeDiffPath}
            refreshSignal={refreshSignal}
            onSelectWorkspace={setActiveWorkspaceId}
            onFocusSession={(address, wsId) => {
              if (wsId && wsId !== activeWorkspaceId) {
                setActiveWorkspaceId(wsId);
              }
              setTerminalFocusReq((prev) => ({ address, seq: (prev?.seq || 0) + 1 }));
            }}
            onOpenAddWorkspace={() => setShowAddWorkspace(true)}
            onTerminalsMutated={() => void refreshData()}
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

        <section className="wb-col" style={{ flex: 1, minWidth: 320 }}>
          <RightTerminalPane
            ref={terminalPaneRef}
            workspaceTerminals={activeWorkspace?.terminals || []}
            allTerminals={allTerminals}
            activeWorkspacePath={activeWorkspace?.path}
            focusRequest={terminalFocusReq}
            theme={theme}
            terminalFont={terminalFont}
            onFocusedTerminalChange={setFocusedTerminalAddress}
            onAddPathChip={addFileRef}
            onOpenFileLine={(p, line) => void openFile(p, line)}
            onOpenNewTerminal={() => setShowNewTerminal(true)}
            onTerminalsMutated={() => void refreshData()}
          />
        </section>

        {codePaneOpen && (
          <>
            <div
              className="wb-resizer"
              onMouseDown={(e) => {
                dragRef.current = { side: 'right', startX: e.clientX, startW: rightWidth };
              }}
            />

            <aside className="wb-col" style={{ width: rightWidth, flexShrink: 0, minWidth: 260 }}>
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
                    if (next.length === 0) {
                      setCodePaneOpen(false);
                    }
                    return next;
                  });
                }}
                onCollapse={() => setCodePaneOpen(false)}
                onOpenQuickSearch={() => setShowQuickOpen(true)}
                onAddFileRef={addFileRef}
                onAddLineRef={addLineRef}
                onAddSnippetRef={addSnippetRef}
                onAddHunkRef={addHunkRef}
                onAddReviewComment={addReviewComment}
                onGitMutated={handleGitMutated}
              />
            </aside>
          </>
        )}
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

      {showSettings && (
        <SettingsModal
          theme={theme}
          terminalFont={terminalFont}
          canInstallPWA={Boolean(installPrompt)}
          autoPromptReason={settingsPromptReason}
          onChangeTerminalFont={setTerminalFont}
          onInstallPWA={async () => {
            if (!installPrompt) return;
            await installPrompt.prompt();
            const choice = await installPrompt.userChoice;
            if (choice.outcome === 'accepted') {
              setInstallPrompt(null);
            }
          }}
          onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          onClose={() => {
            setShowSettings(false);
            setSettingsPromptReason(undefined);
          }}
          onDependenciesChanged={() => void refreshData()}
        />
      )}
    </div>
  );
}

export default App;
