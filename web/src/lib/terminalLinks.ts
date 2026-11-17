import type { IBufferLine, ILink, ILinkProvider, Terminal } from '@xterm/xterm';

/**
 * One pass over a row finds both kinds of targets:
 *   - http(s)/file URLs,
 *   - filesystem paths: absolute, `~/`, `./`, `../` or `dir/file.ext`,
 *     optionally followed by `:line` or `:line:col`.
 */
const TARGET_RE =
  /https?:\/\/[^\s<>"'`]+|file:\/\/[^\s<>"'`]+|~\/[^\s<>"'`]+|(?:\.{1,2})?\/[^\s<>"'`]+|[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+\.[A-Za-z0-9]{1,10}/g;

const TRAILING_PUNCT = /[.,;:)\]}>"'`]+$/;
const LINE_SUFFIX = /^(.*?):(\d+)(?::(\d+))?$/;

export interface TerminalTarget {
  /** Absolute, home-relative or workspace-relative path. */
  path: string;
  line?: number;
  column?: number;
}

/** Strips a `:line[:col]` suffix without touching Windows-style drive paths. */
function splitLocation(raw: string): { path: string; line?: number; column?: number } {
  const match = LINE_SUFFIX.exec(raw);
  if (!match || !match[1]) return { path: raw };
  const line = parseInt(match[2], 10);
  if (!Number.isFinite(line) || line <= 0) return { path: raw };
  const column = match[3] ? parseInt(match[3], 10) : undefined;
  return { path: match[1], line, column };
}

export function createFileLinkProvider(
  term: Terminal,
  onOpenPath: (target: TerminalTarget) => void
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
      // getLine() resolves absolute buffer indices; the provider is asked for real ones.
      const line: IBufferLine | undefined = term.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(true);
      const links: ILink[] = [];
      TARGET_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = TARGET_RE.exec(text)) !== null) {
        const token = match[0].replace(TRAILING_PUNCT, '');
        if (token.length < 3) continue;
        const startX = match.index + 1;
        const endX = startX + token.length;

        if (/^https?:\/\//.test(token)) {
          links.push({
            range: { start: { x: startX, y: bufferLineNumber }, end: { x: endX, y: bufferLineNumber } },
            text: token,
            activate: () => window.open(token, '_blank', 'noopener,noreferrer'),
          });
          continue;
        }
        if (/^file:\/\//.test(token)) {
          const path = decodeURIComponent(token.slice('file://'.length));
          links.push({
            range: { start: { x: startX, y: bufferLineNumber }, end: { x: endX, y: bufferLineNumber } },
            text: token,
            activate: () => onOpenPath({ path }),
          });
          continue;
        }

        const { path, line: lineNumber, column } = splitLocation(token);
        if (!path) continue;
        // A bare word with a dot is far more often prose than a path.
        if (!path.includes('/')) continue;
        links.push({
          range: { start: { x: startX, y: bufferLineNumber }, end: { x: endX, y: bufferLineNumber } },
          text: token,
          activate: () => onOpenPath({ path, line: lineNumber, column }),
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  };
}
