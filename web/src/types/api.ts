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
  status?: TerminalStatus | null;
  foreground?: ForegroundProc | null;
  template?: string | null;
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
  pinned: boolean;
  auto: boolean;
  terminals: TerminalInfo[];
  counts: WorkspaceCounts;
  updated_ms: number;
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

export type DiffMode = 'working' | 'staged' | 'unstaged' | 'branch' | 'commit';

export interface ChangedFile {
  path: string;
  status: string;
}

export interface DiffHunk {
  id: string;
  header: string;
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  patch: string;
  lines: string[];
}

export interface FileDiff {
  path: string;
  mode: DiffMode;
  target?: string;
  original_content: string;
  modified_content: string;
  unified_diff: string;
  hunks: DiffHunk[];
  is_binary: boolean;
}

export interface TemplateInfo {
  name: string;
  description?: string;
  argv?: string[];
}

export interface ReferenceChip {
  id: string;
  kind: 'path' | 'lines' | 'snippet' | 'hunk' | 'review';
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

export type CenterTab =
  | {
      id: string;
      kind: 'code';
      path: string;
      highlightStart?: number;
      highlightEnd?: number;
    }
  | {
      id: 'diff';
      kind: 'diff';
      path?: string;
      mode: DiffMode;
      target?: string;
    };
