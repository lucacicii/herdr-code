export type AgentState = 'idle' | 'working' | 'done' | 'blocked' | 'error';

export interface TerminalStatus {
  state: AgentState;
  app?: string;
  kind?: string;
  msg?: string;
  progress?: number;
  title?: string;
}

export interface ForegroundProc {
  pid: number;
  name: string;
  argv: string[];
  cwd: string;
}

export interface TerminalInfo {
  address: string;
  name?: string | null;
  title: string;
  argv: string[];
  cwd: string;
  state: 'live' | 'finished';
  created_ms: number;
  cols: number;
  rows: number;
  parent?: string | null;
  labels?: Record<string, string>;
  status?: TerminalStatus | null;
  status_ms?: number | null;
  foreground?: ForegroundProc | null;
  template?: string | null;
  turn?: number;
}

export interface WorkspaceCounts {
  working: number;
  blocked: number;
  idle: number;
  done: number;
  error: number;
  total: number;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  is_git_repo: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  main_repo_path?: string;
  pinned: boolean;
  auto: boolean;
  /** Set when the row is a Herdr.app space (herdr.space terminal label) rather than a directory pin. */
  space_id?: string;
  terminals: TerminalInfo[];
  counts: WorkspaceCounts;
  updated_ms: number;
}

export interface HerdrLayoutNode {
  id: string;
  type: string;
  content?: { terminal?: string };
  children?: HerdrLayoutNode[];
}

export interface HerdrTab {
  id: string;
  name: string;
  root?: HerdrLayoutNode;
}

export interface HerdrSpace {
  id: string;
  folder: string;
  name: string;
  tabs: HerdrTab[];
}

export interface HerdrSpacesResponse {
  spaces: HerdrSpace[];
  colors: Record<string, string>;
}

/** One agent conversation run in a space, as the history drawer lists it. */
export interface SessionInfo {
  address: string;
  agent: string;
  session_id: string;
  id_known: boolean;
  title: string;
  where: string;
  cwd: string;
  state: 'live' | 'finished';
  started_ms: number;
  finished_ms?: number;
  reason?: string;
  exit_code?: number | null;
  resume_argv: string[];
  resume_note?: string;
}

export interface TerminalOutput {
  text: string;
  complete: boolean;
  how: string;
}

export interface DepCLIStatus {
  installed: boolean;
  path?: string;
  version?: string;
}

export interface DepDaemonStatus {
  running: boolean;
  socket_path: string;
  version?: string;
  pid?: number;
  live_terminals?: number;
  error?: string;
}

export interface DependenciesStatus {
  os: string;
  arch: string;
  all_required_ok: boolean;
  hc_cli: DepCLIStatus;
  hc_daemon: DepDaemonStatus;
  git_cli: DepCLIStatus;
}

export interface InstallDependencyResponse {
  ok: boolean;
  target: string;
  output: string;
  error?: string;
  status: DependenciesStatus;
}

export interface TreeEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  line_count: number;
  is_binary: boolean;
  truncated: boolean;
  language: string;
}

export interface SearchMatch {
  path: string;
  name: string;
  dir: string;
  score: number;
}

export interface GitFileStatus {
  path: string;
  old_path?: string;
  index: string;
  worktree: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface CommitInfo {
  hash: string;
  short_hash: string;
  subject: string;
  author: string;
  relative_time: string;
}

export interface RepoStatus {
  is_repo: boolean;
  branch: string;
  branches: string[];
  files: GitFileStatus[];
  recent_commits: CommitInfo[];
}

export interface TemplateInfo {
  name: string;
  description?: string;
  argv?: string[];
}

export interface ReferenceChip {
  id: string;
  kind: 'path' | 'lines' | 'snippet' | 'review';
  label: string;
  path: string;
  startLine?: number;
  endLine?: number;
  snippet?: string;
  language?: string;
  comments?: ReviewComment[];
}

export interface ReviewComment {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface CenterTab {
  id: string;
  kind: 'code';
  path: string;
  highlightStart?: number;
  highlightEnd?: number;
}
