import type {
  FileContent,
  RepoStatus,
  SearchMatch,
  SessionInfo,
  TemplateInfo,
  TerminalInfo,
  TerminalOutput,
  TreeEntry,
  Workspace,
} from '../types/api';

let authToken: string | null = null;

export function initTokenFromEnv(): string | null {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    authToken = urlToken;
    localStorage.setItem('herdr_code_token', urlToken);
    params.delete('token');
    const next = params.toString();
    const cleanUrl = window.location.pathname + (next ? `?${next}` : '');
    window.history.replaceState({}, '', cleanUrl);
    return authToken;
  }
  const stored = localStorage.getItem('herdr_code_token');
  if (stored) {
    authToken = stored;
  }
  return authToken;
}

export function setAuthToken(token: string) {
  authToken = token;
  localStorage.setItem('herdr_code_token', token);
}

export function getAuthToken(): string | null {
  return authToken;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export function wsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${proto}//${window.location.host}${path}`;
  if (!authToken) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}token=${encodeURIComponent(authToken)}`;
}

export const api = {
  health: () =>
    req<{
      ok: boolean;
      version: string;
      hc_connected: boolean;
      hc_version?: string;
      auth_required: boolean;
      hc_error?: string;
    }>('/api/health'),

  listWorkspaces: (includeFinished = false) =>
    req<{ workspaces: Workspace[] }>(`/api/workspaces${includeFinished ? '?include_finished=1' : ''}`),

  addWorkspace: (path: string, pin = true) =>
    req<{ workspace: Workspace }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ path, pin }),
    }),

  pinWorkspace: (id: string, pinned: boolean) =>
    req<{ ok: boolean }>(`/api/workspaces/${encodeURIComponent(id)}/pin`, {
      method: 'POST',
      body: JSON.stringify({ pinned }),
    }),

  watchWorkspace: (id: string) =>
    req<{ ok: boolean }>(`/api/workspaces/${encodeURIComponent(id)}/watch`, {
      method: 'POST',
    }),

  adoptWorkspace: (id: string) =>
    req<{ space_id: string; adopted: string[]; created: boolean }>(
      `/api/workspaces/${encodeURIComponent(id)}/adopt`,
      { method: 'POST' }
    ),

  browseLocalDirs: (dir = '~') =>
    req<{ current: string; parent: string; dirs: { name: string; path: string }[] }>(
      `/api/fs/browse?dir=${encodeURIComponent(dir)}`
    ),

  listTree: (wsId: string, path = '', hidden = false) =>
    req<{ path: string; entries: TreeEntry[] }>(
      `/api/workspaces/${encodeURIComponent(wsId)}/tree?path=${encodeURIComponent(path)}&hidden=${hidden ? '1' : '0'}`
    ),

  searchFiles: (wsId: string, q: string, limit = 50) =>
    req<{ matches: SearchMatch[] }>(
      `/api/workspaces/${encodeURIComponent(wsId)}/files/search?q=${encodeURIComponent(q)}&limit=${limit}`
    ),

  readFile: (wsId: string, path: string) =>
    req<FileContent>(
      `/api/workspaces/${encodeURIComponent(wsId)}/file?path=${encodeURIComponent(path)}`
    ),

  // Hands a path to the desktop: Finder selects the file, other OSes open its folder.
  revealPath: (path: string) =>
    req<{ ok: boolean; path: string }>('/api/fs/reveal', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  // Opens a directory itself in the desktop's file manager.
  openPath: (path: string) =>
    req<{ ok: boolean; path: string }>('/api/fs/open', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  gitStatus: (wsId: string) =>
    req<RepoStatus>(`/api/workspaces/${encodeURIComponent(wsId)}/git/status`),

  listTemplates: () => req<{ templates: TemplateInfo[] }>('/api/templates'),

  herdrSpaces: () => req<import('../types/api').HerdrSpacesResponse>('/api/herdr/spaces'),

  // A space name is a label the app owns; an empty name asks it to derive one
  // again from where the space's first terminal is.
  renameSpace: (spaceId: string, name: string) =>
    req<{ ok: boolean; space_id: string; name: string }>(
      `/api/herdr/spaces/${encodeURIComponent(spaceId)}/rename`,
      { method: 'POST', body: JSON.stringify({ name }) }
    ),

  listTerminals: () => req<{ terminals: TerminalInfo[] }>('/api/terminals'),

  labelTerminal: (id: string, labels: Record<string, string>) =>
    req<{ ok: boolean }>(`/api/terminals/${encodeURIComponent(id)}/label`, {
      method: 'POST',
      body: JSON.stringify({ labels }),
    }),

  createTerminal: (opts: {
    workspace_id?: string;
    cwd?: string;
    line?: string;
    argv?: string[];
    name?: string;
    keep?: boolean;
  }) =>
    req<{ terminal: TerminalInfo }>('/api/terminals', {
      method: 'POST',
      body: JSON.stringify(opts),
    }),

  /** Every agent conversation run in a space, newest first. */
  listSessions: (workspaceId: string) =>
    req<SessionInfo[]>(`/api/sessions?workspace_id=${encodeURIComponent(workspaceId)}`),

  /** What a terminal printed: live scrollback or the history kept after it ended. */
  terminalOutput: (address: string, lines = 2000) =>
    req<TerminalOutput>(`/api/terminals/${encodeURIComponent(address)}/output?lines=${lines}`),

  sendTerminal: (id: string, text: string, force = true) =>
    req<{ ok: boolean }>(`/api/terminals/${encodeURIComponent(id)}/send`, {
      method: 'POST',
      body: JSON.stringify({ text, force }),
    }),

  interruptTerminal: (id: string) =>
    req<{ ok: boolean }>(`/api/terminals/${encodeURIComponent(id)}/interrupt`, {
      method: 'POST',
    }),

  killTerminal: (id: string) =>
    req<{ ok: boolean }>(`/api/terminals/${encodeURIComponent(id)}/kill`, {
      method: 'POST',
    }),

  getDependencies: () =>
    req<import('../types/api').DependenciesStatus>('/api/settings/dependencies'),

  installDependency: (target: 'herdr-core' | 'herdr-core-start') =>
    req<import('../types/api').InstallDependencyResponse>('/api/settings/dependencies/install', {
      method: 'POST',
      body: JSON.stringify({ target }),
    }),
};
