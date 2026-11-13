import type { IBufferLine, ILink, ILinkProvider, Terminal } from '@xterm/xterm';

const FILE_LINE_RE =
  /(?:^|[\s(\['"`])((?:\.{0,2}\/)?(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,10}):(\d+)(?::(\d+))?/g;

export function createFileLinkProvider(
  term: Terminal,
  onOpenFileLine: (path: string, line: number) => void
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
      const line: IBufferLine | undefined = term.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(true);
      const links: ILink[] = [];
      FILE_LINE_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = FILE_LINE_RE.exec(text)) !== null) {
        const fullMatch = match[0];
        const rawPath = match[1];
        const lineNum = parseInt(match[2], 10);
        if (!rawPath || Number.isNaN(lineNum) || lineNum <= 0) continue;

        // Ignore URLs like http://127.0.0.1:4242
        if (rawPath.startsWith('http:') || rawPath.startsWith('https:') || /^\d+\.\d+\.\d+\.\d+$/.test(rawPath)) {
          continue;
        }

        const leadingOffset = fullMatch.indexOf(rawPath);
        const startX = match.index + leadingOffset + 1;
        const endX = match.index + fullMatch.length;
        const cleanPath = rawPath.replace(/^\.\//, '');

        links.push({
          range: {
            start: { x: startX, y: bufferLineNumber },
            end: { x: endX, y: bufferLineNumber },
          },
          text: `${cleanPath}:${lineNum}`,
          activate: () => {
            onOpenFileLine(cleanPath, lineNum);
          },
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  };
}
