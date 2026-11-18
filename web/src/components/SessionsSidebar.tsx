import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  GitBranch,
  History,
  Layers,
  ListOrdered,
  Loader2,
  PanelsTopLeft,
  Pencil,
  Pin,
  RefreshCw,
  Terminal as TerminalIcon,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { cleanTerminalTitle } from '../lib/terminalText';
import type { AgentState, HerdrSpace, TerminalInfo, Workspace } from '../types/api';

interface SessionsSidebarProps {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  allTerminals: TerminalInfo[];
  focusedTerminalAddress: string | null;
  herdrSpaces: HerdrSpace[];
  herdrColors: Record<string, string>;
  onSelectWorkspace: (wsId: string) => void;
  onFocusSession: (terminalAddress: string, workspaceId: string | null) => void;
  onOpenAddWorkspace: () => void;
  onTerminalsMutated: () => void;
  onOpenHistory: (wsId: string) => void;
  includeFinished: boolean;
  onToggleIncludeFinished: () => void;
}

const ANSI_HEX: Record<string, string> = {
  ansi1: '#d9649a',
  ansi2: '#3fae6a',
  ansi3: '#e3814f',
  ansi4: '#5b8def',
  ansi5: '#8b7cf6',
  ansi6: '#22a99a',
};
const COLOR_KEYS = ['ansi6', 'ansi3', 'ansi4', 'ansi5', 'ansi2', 'ansi1'];

function hashColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  const paletteKey = COLOR_KEYS[Math.abs(h) % COLOR_KEYS.length];
  return ANSI_HEX[paletteKey];
}

function getSpaceColor(
  ws: Workspace,
  herdrSpace: HerdrSpace | undefined,
  colors: Record<string, string>
): string {
  if (herdrSpace && colors[herdrSpace.id] && ANSI_HEX[colors[herdrSpace.id]]) {
    return ANSI_HEX[colors[herdrSpace.id]];
  }
  if (ws.space_id && colors[ws.space_id] && ANSI_HEX[colors[ws.space_id]]) {
    return ANSI_HEX[colors[ws.space_id]];
  }
  const firstLabelSpace = ws.terminals.find((t) => t.labels?.['herdr.space'])?.labels?.['herdr.space'];
  if (firstLabelSpace && colors[firstLabelSpace] && ANSI_HEX[colors[firstLabelSpace]]) {
    return ANSI_HEX[colors[firstLabelSpace]];
  }
  return hashColor(ws.path);
}

const KNOWN_AGENT_APPS = new Set([
  'claude',
  'claude-code',
  'codex',
  'pi',
  'omp',
  'opencode',
  'gemini',
  'amp',
  'cursor',
  'cursor-agent',
  'copilot',
  'grok',
  'kimi',
  'kiro',
  'kiro-cli',
  'hermes',
  'crush',
  'agy',
]);

function detectProgram(t: TerminalInfo): { label: string; isAgent: boolean; color: string } {
  const raw =
    t.status?.app ||
    t.template ||
    t.foreground?.name ||
    (t.argv?.[0] ? t.argv[0].split('/').pop() : '') ||
    'shell';
  const norm = raw.toLowerCase();
  if (norm.includes('claude') || t.status?.app === 'claude') {
    return { label: 'Claude', isAgent: true, color: '#d97757' };
  }
  if (norm.includes('codex')) {
    return { label: 'Codex', isAgent: true, color: '#10a37f' };
  }
  if (norm === 'pi' || norm.startsWith('pi ')) {
    return { label: 'Pi', isAgent: true, color: '#8b5cf6' };
  }
  if (norm === 'omp') {
    return { label: 'OMP', isAgent: true, color: '#ec4899' };
  }
  if (norm.includes('opencode')) {
    return { label: 'OpenCode', isAgent: true, color: '#3b82f6' };
  }
  if (norm.includes('gemini')) {
    return { label: 'Gemini', isAgent: true, color: '#8e75b2' };
  }
  if (KNOWN_AGENT_APPS.has(norm) || (t.status && t.status.state !== 'idle')) {
    return { label: raw, isAgent: true, color: '#6366f1' };
  }
  return { label: raw || 'shell', isAgent: false, color: 'var(--text-muted)' };
}

function getStateRank(st: AgentState): number {
  switch (st) {
    case 'blocked':
      return 0;
    case 'error':
      return 1;
    case 'done':
      return 2;
    case 'working':
      return 3;
    case 'idle':
    default:
      return 4;
  }
}

function formatAge(ms: number | null | undefined, now: number): string {
  if (!ms) return '';
  const diffSec = Math.max(0, Math.floor((now - ms) / 1000));
  if (diffSec < 60) return '<1m';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function collectTabTerminals(herdrSpaces: HerdrSpace[]): Map<string, { space: HerdrSpace; tabName: string }> {
  const map = new Map<string, { space: HerdrSpace; tabName: string }>();
  const walk = (node: HerdrSpace['tabs'][number]['root'], space: HerdrSpace, tabName: string) => {
    if (!node) return;
    if (node.content?.terminal) {
      map.set(node.content.terminal, { space, tabName });
    }
    for (const child of node.children || []) {
      walk(child, space, tabName);
    }
  };
  for (const sp of herdrSpaces) {
    for (const tab of sp.tabs || []) {
      walk(tab.root, sp, tab.name);
    }
  }
  return map;
}

type CtxMenu =
  | { kind: 'space'; ws: Workspace; x: number; y: number }
  | { kind: 'terminal'; t: TerminalInfo; x: number; y: number };

const MENU_WIDTH = 190;

export function SessionsSidebar({
  workspaces,
  activeWorkspaceId,
  allTerminals,
  focusedTerminalAddress,
  herdrSpaces,
  herdrColors,
  onSelectWorkspace,
  onFocusSession,
  onOpenAddWorkspace,
  onTerminalsMutated,
  onOpenHistory,
  includeFinished,
  onToggleIncludeFinished,
}: SessionsSidebarProps) {
  const [sortMode, setSortMode] = useState<'priority' | 'grouped'>(() =>
    localStorage.getItem('herdr_code_agent_sort') === 'grouped' ? 'grouped' : 'priority'
  );
  const [agentsOnly, setAgentsOnly] = useState<boolean>(
    () => localStorage.getItem('herdr_code_agents_only') !== '0'
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [collapsedParents, setCollapsedParents] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Clamp the context menu against its rendered height: a space menu grows or
  // shrinks with the optional "Show in Herdr.app" item.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!ctxMenu || !el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(8, Math.min(ctxMenu.x, window.innerWidth - rect.width - 8));
    const y = Math.max(8, Math.min(ctxMenu.y, window.innerHeight - rect.height - 8));
    if (x !== ctxMenu.x || y !== ctxMenu.y) setCtxMenu({ ...ctxMenu, x, y });
  }, [ctxMenu]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!ctxMenu) return;
    const dismiss = (e: MouseEvent) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    const onScroll = () => setCtxMenu(null);
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
    };
  }, [ctxMenu]);

  useEffect(() => {
    localStorage.setItem('herdr_code_agent_sort', sortMode);
  }, [sortMode]);

  useEffect(() => {
    localStorage.setItem('herdr_code_agents_only', agentsOnly ? '1' : '0');
  }, [agentsOnly]);

  const tabTerminalMap = useMemo(() => collectTabTerminals(herdrSpaces), [herdrSpaces]);

  // Map terminal address -> workspace
  const terminalToWorkspace = useMemo(() => {
    const m = new Map<string, Workspace>();
    for (const ws of workspaces) {
      for (const t of ws.terminals) {
        m.set(t.address, ws);
      }
    }
    return m;
  }, [workspaces]);

  // Organize Spaces with nested worktrees under main repo
  const organizedSpaces = useMemo(() => {
    const byPath = new Map<string, Workspace>();
    // Space rows share their anchor directory with a directory row; worktrees must
    // stay parented to the directory row so a space never swallows another repo.
    for (const ws of workspaces) if (!ws.space_id) byPath.set(ws.path, ws);

    const childrenByParent = new Map<string, Workspace[]>();
    const roots: Workspace[] = [];
    for (const ws of workspaces) {
      if (ws.main_repo_path && byPath.has(ws.main_repo_path)) {
        const arr = childrenByParent.get(ws.main_repo_path) || [];
        arr.push(ws);
        childrenByParent.set(ws.main_repo_path, arr);
      } else {
        roots.push(ws);
      }
    }

    const ordered: { ws: Workspace; isWorktree: boolean }[] = [];
    for (const r of roots) {
      ordered.push({ ws: r, isWorktree: false });
      for (const wt of childrenByParent.get(r.path) || []) {
        ordered.push({ ws: wt, isWorktree: true });
      }
    }
    return ordered;
  }, [workspaces]);

  // Build agent/session list with parent->child hierarchy
  const { topItems, childrenByParent } = useMemo(() => {
    const live = allTerminals.filter((t) => t.state === 'live');
    const byAddr = new Map<string, TerminalInfo>();
    for (const t of live) byAddr.set(t.address, t);

    const filtered = live.filter((t) => {
      if (!agentsOnly) return true;
      const prog = detectProgram(t);
      if (prog.isAgent) return true;
      // Keep children whose parent is visible
      if (t.parent && byAddr.has(t.parent)) {
        return detectProgram(byAddr.get(t.parent)!).isAgent;
      }
      return false;
    });

    const filteredSet = new Set(filtered.map((t) => t.address));
    const kids = new Map<string, TerminalInfo[]>();
    const tops: TerminalInfo[] = [];

    for (const t of filtered) {
      if (t.parent && filteredSet.has(t.parent)) {
        const list = kids.get(t.parent) || [];
        list.push(t);
        kids.set(t.parent, list);
      } else {
        tops.push(t);
      }
    }

    const effectiveRank = (t: TerminalInfo): number => {
      let best = getStateRank(t.status?.state || 'idle');
      for (const child of kids.get(t.address) || []) {
        best = Math.min(best, getStateRank(child.status?.state || 'idle'));
      }
      return best;
    };

    const isPinned = (t: TerminalInfo) => t.labels?.['herdr.pinned'] === '1';

    tops.sort((a, b) => {
      if (isPinned(a) !== isPinned(b)) return isPinned(a) ? -1 : 1;
      const ra = effectiveRank(a);
      const rb = effectiveRank(b);
      if (ra !== rb) return ra - rb;
      return (b.status_ms || b.created_ms) - (a.status_ms || a.created_ms);
    });

    return { topItems: tops, childrenByParent: kids };
  }, [allTerminals, agentsOnly]);

  // Priority status sections matching official Herdr App:
  // Pinned -> Needs you (blocked) -> Error -> Done -> Working -> Idle
  const prioritySections = useMemo(() => {
    const rankToState = (r: number): AgentState => {
      switch (r) {
        case 0:
          return 'blocked';
        case 1:
          return 'error';
        case 2:
          return 'done';
        case 3:
          return 'working';
        default:
          return 'idle';
      }
    };

    const effectiveState = (t: TerminalInfo): AgentState => {
      let best = getStateRank(t.status?.state || 'idle');
      for (const child of childrenByParent.get(t.address) || []) {
        best = Math.min(best, getStateRank(child.status?.state || 'idle'));
      }
      return rankToState(best);
    };

    const sectionMeta: Record<AgentState, { label: string; color: string }> = {
      blocked: { label: 'Needs you', color: 'var(--status-blocked)' },
      error: { label: 'Error', color: 'var(--status-error)' },
      done: { label: 'Done', color: 'var(--status-done)' },
      working: { label: 'Working', color: 'var(--status-working)' },
      idle: { label: 'Idle', color: 'var(--text-muted)' },
    };

    const sections: {
      key: string;
      label: string;
      color: string;
      statusKey?: AgentState;
      items: TerminalInfo[];
    }[] = [];

    const pinned = topItems.filter((t) => t.labels?.['herdr.pinned'] === '1');
    const unpinned = topItems.filter((t) => t.labels?.['herdr.pinned'] !== '1');

    if (pinned.length > 0) {
      sections.push({
        key: 'sec-pinned',
        label: 'Pinned',
        color: 'var(--accent)',
        items: pinned,
      });
    }

    const byState = new Map<AgentState, TerminalInfo[]>();
    for (const t of unpinned) {
      const st = effectiveState(t);
      const arr = byState.get(st) || [];
      arr.push(t);
      byState.set(st, arr);
    }

    const order: AgentState[] = ['blocked', 'error', 'done', 'working', 'idle'];
    for (const st of order) {
      const items = byState.get(st);
      if (items && items.length > 0) {
        sections.push({
          key: `sec-${st}`,
          label: sectionMeta[st].label,
          color: sectionMeta[st].color,
          statusKey: st,
          items,
        });
      }
    }

    return sections;
  }, [topItems, childrenByParent]);

  // Grouped by workspace/space when sortMode === 'grouped'
  const groupedSections = useMemo(() => {
    const groups = new Map<string, { label: string; color: string; wsId: string | null; items: TerminalInfo[] }>();
    for (const t of topItems) {
      const ws = terminalToWorkspace.get(t.address) || null;
      const key = ws ? ws.id : '__other__';
      const label = ws ? ws.name : 'Other';
      const herdrMeta = tabTerminalMap.get(t.address);
      const color = ws ? getSpaceColor(ws, herdrMeta?.space, herdrColors) : '#737373';
      let g = groups.get(key);
      if (!g) {
        g = { label, color, wsId: ws?.id || null, items: [] };
        groups.set(key, g);
      }
      g.items.push(t);
    }
    return Array.from(groups.entries());
  }, [topItems, terminalToWorkspace, tabTerminalMap, herdrColors]);

  const togglePin = async (e: React.MouseEvent, t: TerminalInfo) => {
    e.stopPropagation();
    const currentlyPinned = t.labels?.['herdr.pinned'] === '1';
    try {
      await api.labelTerminal(t.address, { 'herdr.pinned': currentlyPinned ? '' : '1' });
      onTerminalsMutated();
    } catch {
      // ignore
    }
  };

  const openCtxMenu = (
    e: React.MouseEvent,
    payload: { kind: 'space'; ws: Workspace } | { kind: 'terminal'; t: TerminalInfo }
  ) => {
    e.preventDefault();
    e.stopPropagation();
    // A space menu holds 2–3 items depending on live sessions, so only the raw
    // cursor point is taken here; the layout effect below clamps against the
    // rendered menu box.
    const x = Math.min(e.clientX, window.innerWidth - MENU_WIDTH - 8);
    const y = e.clientY;
    setCtxMenu(
      payload.kind === 'space'
        ? { kind: 'space', ws: payload.ws, x, y }
        : { kind: 'terminal', t: payload.t, x, y }
    );
  };

  const closeSession = async (t: TerminalInfo) => {
    setCtxMenu(null);
    const st = t.status?.state || 'idle';
    const label = t.name || cleanTerminalTitle(t.title) || t.foreground?.name || t.address;
    if ((st === 'working' || st === 'blocked') && !window.confirm(`Close ${st} session "${label}"?`)) {
      return;
    }
    // Kill descendants first: a parent's sub-sessions would otherwise be orphaned
    // outside the row that rendered them.
    const doomed: TerminalInfo[] = [];
    const walk = (addr: string) => {
      for (const child of childrenByParent.get(addr) || []) {
        walk(child.address);
        doomed.push(child);
      }
    };
    walk(t.address);
    doomed.push(t);
    for (const victim of doomed) {
      try {
        await api.killTerminal(victim.address);
      } catch {
        // already gone
      }
    }
    onTerminalsMutated();
  };

  const closeSpace = async (ws: Workspace) => {
    setCtxMenu(null);
    const live = ws.terminals.filter((t) => t.state === 'live');
    if (live.length > 0 && !window.confirm(`Close space "${ws.name}" and its ${live.length} session(s)?`)) {
      return;
    }
    for (const t of live) {
      try {
        await api.killTerminal(t.address);
      } catch {
        // already gone
      }
    }
    try {
      await api.pinWorkspace(ws.id, false);
    } catch {
      // ignore
    }
    onTerminalsMutated();
  };

  const renameSpace = async (ws: Workspace) => {
    setCtxMenu(null);
    if (!ws.space_id) return;
    const answer = window.prompt(
      `Rename space "${ws.name}"\n\nLeave it empty to let Herdr name it after its first terminal.`,
      ws.name
    );
    if (answer === null) return;
    const name = answer.trim();
    if (name === ws.name) return;
    try {
      await api.renameSpace(ws.space_id, name);
      onTerminalsMutated();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not rename this space');
    }
  };

  const openSpaceDir = async (ws: Workspace) => {
    setCtxMenu(null);
    try {
      await api.openPath(ws.path);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not open this directory');
    }
  };

  const adoptSpace = async (ws: Workspace) => {
    setCtxMenu(null);
    try {
      await api.adoptWorkspace(ws.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not show this space in Herdr');
      return;
    }
    onTerminalsMutated();
  };

  const renderStatusIndicator = (state: AgentState, compactBlocked = false) => {
    if (state === 'blocked') {
      if (compactBlocked) {
        return (
          <span
            title="Needs you"
            style={{
              width: 14,
              height: 14,
              borderRadius: 4,
              background: 'var(--status-blocked-bg)',
              color: 'var(--status-blocked)',
              fontSize: 10,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            !
          </span>
        );
      }
      return (
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '1px 5px',
            borderRadius: 999,
            background: 'var(--status-blocked-bg)',
            color: 'var(--status-blocked)',
            whiteSpace: 'nowrap',
          }}
        >
          Needs you
        </span>
      );
    }
    if (state === 'working') {
      return (
        <span title="Working" style={{ display: 'inline-flex', flexShrink: 0 }}>
          <Loader2
            size={12}
            className="spin-slow"
            style={{ color: 'var(--status-working)' }}
          />
        </span>
      );
    }
    if (state === 'done') {
      return (
        <span
          title="Done"
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--status-done)',
            flexShrink: 0,
          }}
        />
      );
    }
    if (state === 'error') {
      return (
        <span
          title="Error"
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--status-error)',
            flexShrink: 0,
          }}
        />
      );
    }
    return (
      <span
        title="Idle"
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          border: '1.5px solid var(--status-idle)',
          flexShrink: 0,
        }}
      />
    );
  };

  const renderAgentRow = (t: TerminalInfo, depth = 0, compactBlocked = false) => {
    const ws = terminalToWorkspace.get(t.address) || null;
    const prog = detectProgram(t);
    const tabMeta = tabTerminalMap.get(t.address);
    const st: AgentState = t.status?.state || 'idle';
    const isFocused = focusedTerminalAddress === t.address;
    const isPinned = t.labels?.['herdr.pinned'] === '1';
    const kids = childrenByParent.get(t.address) || [];
    const hasKids = kids.length > 0;
    const kidsCollapsed = Boolean(collapsedParents[t.address]);

    const primaryName =
      (sortMode === 'priority' && ws ? ws.name : null) ||
      t.name ||
      tabMeta?.tabName ||
      prog.label;
    const secondary = cleanTerminalTitle(
      t.status?.msg ||
        t.name ||
        tabMeta?.tabName ||
        (t.title && t.title !== primaryName ? t.title : '') ||
        ''
    );
    const age = formatAge(t.status_ms || t.created_ms, now);

    return (
      <div key={t.address}>
        <div
          className={`tree-row ${isFocused ? 'active' : ''}`}
          style={{
            paddingLeft: depth > 0 ? 22 : 8,
            paddingRight: 6,
            height: 32,
            gap: 6,
          }}
          onClick={() => onFocusSession(t.address, ws?.id || null)}
          onContextMenu={(e) => openCtxMenu(e, { kind: 'terminal', t })}
          title={`${prog.label} · ${t.cwd}${t.title ? `\n${cleanTerminalTitle(t.title)}` : ''}`}
        >
          {depth > 0 ? (
            <span
              className="mono"
              style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}
            >
              └
            </span>
          ) : hasKids ? (
            <button
              className="btn btn-ghost btn-icon"
              style={{ width: 16, height: 16, padding: 0 }}
              onClick={(e) => {
                e.stopPropagation();
                setCollapsedParents((p) => ({ ...p, [t.address]: !p[t.address] }));
              }}
            >
              {kidsCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
            </button>
          ) : null}

          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              background: prog.isAgent ? prog.color : 'var(--bg-subtle)',
              color: prog.isAgent ? '#ffffff' : 'var(--text-secondary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9.5,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {prog.isAgent ? prog.label.slice(0, 1).toUpperCase() : <TerminalIcon size={10} />}
          </span>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
              <span
                style={{
                  fontWeight: isFocused ? 600 : 500,
                  fontSize: 12,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {primaryName}
              </span>
              {hasKids && (
                <span
                  className="mono tabular"
                  style={{
                    fontSize: 10,
                    padding: '0 4px',
                    borderRadius: 4,
                    background: 'var(--bg-subtle)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  +{kids.length}
                </span>
              )}
            </div>
            {secondary && secondary !== primaryName && (
              <span
                style={{
                  fontSize: 10.5,
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {secondary}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <button
              className="btn btn-ghost btn-icon row-action"
              style={{
                width: 18,
                height: 18,
                opacity: isPinned ? 1 : undefined,
                color: isPinned ? 'var(--accent)' : 'var(--text-muted)',
              }}
              title={isPinned ? 'Unpin' : 'Pin to top'}
              onClick={(e) => void togglePin(e, t)}
            >
              <Pin size={10} />
            </button>
            {age && (
              <span className="mono tabular" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                {age}
              </span>
            )}
            {renderStatusIndicator(st, compactBlocked)}
          </div>
        </div>

        {hasKids && !kidsCollapsed && kids.map((child) => renderAgentRow(child, depth + 1, compactBlocked))}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Top Half: Spaces (Projects & Worktrees) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '44%',
          minHeight: 110,
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '7px 10px 4px',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-muted)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          <span>Spaces ({workspaces.filter((w) => w.space_id).length})</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button
              className={`btn btn-ghost btn-icon ${includeFinished ? 'btn-accent' : ''}`}
              style={{ width: 20, height: 20 }}
              title={
                includeFinished
                  ? 'Showing closed terminals too (Herdr.app history) — click to hide'
                  : 'Hide closed terminals — click to show Herdr.app history'
              }
              onClick={onToggleIncludeFinished}
            >
              <History size={12} />
            </button>
            <button
              className="btn btn-ghost btn-icon"
              style={{ width: 20, height: 20 }}
              title="Refresh"
              onClick={onTerminalsMutated}
            >
              <RefreshCw size={12} />
            </button>
            <button
              className="btn btn-ghost btn-icon"
              style={{ width: 20, height: 20 }}
              title="Add Workspace"
              onClick={onOpenAddWorkspace}
            >
              <FolderPlus size={12} />
            </button>
          </div>
        </div>

        <div
          style={{ flex: 1, overflowY: 'auto', padding: '0 6px 6px' }}
          onScroll={() => setCtxMenu(null)}
        >
          {organizedSpaces.map(({ ws, isWorktree }, index) => {
            const isActive = ws.id === activeWorkspaceId;
            const firstAddr = ws.terminals[0]?.address;
            const herdrMeta = firstAddr ? tabTerminalMap.get(firstAddr) : undefined;
            const avatarColor = getSpaceColor(ws, herdrMeta?.space, herdrColors);
            const displayName = herdrMeta?.space?.name || ws.name;
            const showBranch =
              ws.branch &&
              ((ws.branch !== 'main' && ws.branch !== 'master') ||
                (ws.ahead || 0) > 0 ||
                (ws.behind || 0) > 0);

            return (
              <Fragment key={ws.id}>
                {!ws.space_id && (index === 0 || !!organizedSpaces[index - 1]?.ws.space_id) && (
                  <div
                    style={{
                      padding: '7px 8px 3px',
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Projects
                  </div>
                )}
              <div
                key={ws.id}
                className={`tree-row ${isActive ? 'active' : ''}`}
                style={{
                  paddingLeft: isWorktree ? 22 : 8,
                  paddingRight: 8,
                  height: 30,
                  gap: 8,
                }}
                onClick={() => onSelectWorkspace(ws.id)}
                onContextMenu={(e) => openCtxMenu(e, { kind: 'space', ws })}
                title={`${ws.space_id ? 'Herdr space — ' : ''}${ws.path}${
                  ws.branch ? ` (${ws.branch})` : ''
                }`}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 5,
                    background: avatarColor,
                    color: '#ffffff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10.5,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {displayName.slice(0, 1).toUpperCase()}
                </span>

                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {ws.space_id && (
                    <span
                      title="Herdr.app space"
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        background: avatarColor,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span
                    style={{
                      fontWeight: isActive ? 600 : 500,
                      fontSize: 12.5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {displayName}
                  </span>
                  {showBranch && (
                    <span
                      className="mono"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2,
                        fontSize: 10.5,
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <GitBranch size={10} />
                      <span>{ws.branch}</span>
                      {(ws.ahead || 0) > 0 && <span>↑{ws.ahead}</span>}
                      {(ws.behind || 0) > 0 && <span>↓{ws.behind}</span>}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  {ws.counts.blocked > 0 && (
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: 'var(--status-blocked)',
                      }}
                      title={`${ws.counts.blocked} blocked`}
                    />
                  )}
                  {ws.counts.working > 0 && (
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: 'var(--status-working)',
                      }}
                      title={`${ws.counts.working} working`}
                    />
                  )}
                  {ws.counts.total > 0 && (
                    <span className="mono tabular" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {ws.counts.total}
                    </span>
                  )}
                  <button
                    className="btn btn-ghost btn-icon"
                    title="Past sessions in this space"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenHistory(ws.id);
                    }}
                    style={{
                      width: 18,
                      height: 18,
                      color: 'var(--text-muted)',
                      opacity: isActive ? 1 : 0.7,
                    }}
                  >
                    <History size={10} />
                  </button>
                </div>
              </div>
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* Bottom Half: Agents & Sessions */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '7px 10px 4px',
            gap: 6,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-muted)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {agentsOnly ? 'Agents' : 'Sessions'} ({topItems.length})
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <button
              className={`btn btn-sm ${!agentsOnly ? 'btn-accent' : 'btn-ghost'}`}
              style={{ height: 20, padding: '0 6px', fontSize: 11 }}
              onClick={() => setAgentsOnly((v) => !v)}
              title={agentsOnly ? 'Showing AI Agents — click to show all terminals' : 'Showing All Terminals'}
            >
              {agentsOnly ? 'Agents' : 'All'}
            </button>

            <button
              className="btn btn-ghost btn-icon"
              style={{ width: 20, height: 20 }}
              onClick={() => setSortMode((m) => (m === 'priority' ? 'grouped' : 'priority'))}
              title={sortMode === 'priority' ? 'Sort: Priority (click for Grouped by Space)' : 'Sort: Grouped by Space (click for Priority)'}
            >
              {sortMode === 'priority' ? <ListOrdered size={12} /> : <Layers size={12} />}
            </button>
          </div>
        </div>

        <div
          style={{ flex: 1, overflowY: 'auto', padding: '0 6px 10px' }}
          onScroll={() => setCtxMenu(null)}
        >
          {topItems.length === 0 ? (
            <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              {agentsOnly ? 'No active agents. Click "All" to see shells.' : 'No live sessions.'}
            </div>
          ) : sortMode === 'priority' ? (
            prioritySections.map((sec) => {
              const collapsed = Boolean(collapsedGroups[sec.key]);
              const mostUrgent = sec.items.reduce<AgentState>((acc, item) => {
                const st = item.status?.state || 'idle';
                return getStateRank(st) < getStateRank(acc) ? st : acc;
              }, 'idle');
              return (
                <div key={sec.key} style={{ marginBottom: 4 }}>
                  <div
                    className="tree-row"
                    style={{
                      height: 22,
                      paddingLeft: 4,
                      paddingRight: 6,
                      gap: 5,
                      cursor: 'pointer',
                    }}
                    onClick={() => setCollapsedGroups((c) => ({ ...c, [sec.key]: !c[sec.key] }))}
                    title={collapsed ? `Expand ${sec.label}` : `Collapse ${sec.label}`}
                  >
                    {collapsed ? (
                      <ChevronRight size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    ) : (
                      <ChevronDown size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    )}
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: sec.color,
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {sec.label}
                    </span>
                    {collapsed && mostUrgent !== 'idle' && renderStatusIndicator(mostUrgent, true)}
                    <span className="mono tabular" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                      {sec.items.length}
                    </span>
                  </div>
                  {!collapsed &&
                    sec.items.map((t) => renderAgentRow(t, 0, sec.statusKey === 'blocked'))}
                </div>
              );
            })
          ) : (
            groupedSections.map(([key, grp]) => {
              const collapsed = Boolean(collapsedGroups[key]);
              return (
                <div key={key} style={{ marginBottom: 4 }}>
                  <div
                    className="tree-row"
                    style={{ height: 24, paddingLeft: 4, gap: 6, color: 'var(--text-secondary)' }}
                    onClick={() => setCollapsedGroups((c) => ({ ...c, [key]: !c[key] }))}
                  >
                    {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: grp.color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 11.5, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {grp.label}
                    </span>
                    <span className="mono tabular" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                      {grp.items.length}
                    </span>
                  </div>
                  {!collapsed && grp.items.map((t) => renderAgentRow(t, 0))}
                </div>
              );
            })
          )}
        </div>
      </div>

      {ctxMenu && (
        <div
          ref={menuRef}
          className="ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y, width: MENU_WIDTH }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {ctxMenu.kind === 'space' ? (
            <>
              <div className="ctx-menu-label">{ctxMenu.ws.name}</div>
              {ctxMenu.ws.space_id && (
                <button className="ctx-menu-item" onClick={() => void renameSpace(ctxMenu.ws)}>
                  <Pencil size={12} />
                  Rename Space…
                </button>
              )}
              <button className="ctx-menu-item" onClick={() => void openSpaceDir(ctxMenu.ws)}>
                <FolderOpen size={12} />
                Open Directory
              </button>
              {ctxMenu.ws.terminals.some((t) => t.state === 'live') && (
                <button className="ctx-menu-item" onClick={() => void adoptSpace(ctxMenu.ws)}>
                  <PanelsTopLeft size={12} />
                  {ctxMenu.ws.space_id ? 'Add to Herdr Space' : 'Show in Herdr.app'}
                </button>
              )}
              <button className="ctx-menu-item danger" onClick={() => void closeSpace(ctxMenu.ws)}>
                <X size={12} />
                Close Space
              </button>
            </>
          ) : (
            <>
              <div className="ctx-menu-label">
                {ctxMenu.t.name || cleanTerminalTitle(ctxMenu.t.title) || ctxMenu.t.foreground?.name || 'Session'}
              </div>
              <button className="ctx-menu-item danger" onClick={() => void closeSession(ctxMenu.t)}>
                <X size={12} />
                {childrenByParent.get(ctxMenu.t.address)?.length ? 'Close Session + Sub-sessions' : 'Close Session'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
