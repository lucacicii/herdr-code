import type { IDisposable, Terminal } from '@xterm/xterm';

/**
 * Inline image support for panes that host a full-screen TUI.
 *
 * @xterm/addon-image pins every picture to the cells under it: it tags those cells
 * with an image id and drops the picture when the tag is disposed. A TUI repaints
 * its whole frame several times a second (`ESC[B ESC[2K` over the rows it reserved
 * for the image), which disposes the tags within one frame - the picture is stored,
 * then deleted, and the layer canvas stays blank.
 *
 * This layer keeps placements in absolute buffer lines instead and repaints them on
 * every render, so a TUI may overwrite the rows as often as it likes.
 *
 * Only the iTerm2 inline-image protocol (OSC 1337 ; File=inline=1;...) is handled;
 * that is what PI/omp emits (PI_FORCE_IMAGE_PROTOCOL=iterm2 in internal/server).
 */

interface Placement {
  line: number; // absolute buffer line of the top-left cell
  col: number;
  cols: number;
  rows: number;
  kind: 'normal' | 'alternate';
  bitmap: ImageBitmap;
  bytes: number;
}

const MAX_BASE64 = 8 * 1024 * 1024;
const MAX_IMAGES = 48;
const MAX_BITMAP_BYTES = 256 * 1024 * 1024;

function mimeOf(bytes: Uint8Array): string | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes.length > 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  return null;
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function parseHeader(header: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    fields[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  return fields;
}

export class InlineImageLayer implements IDisposable {
  private readonly placements: Placement[] = [];
  private canvas: HTMLCanvasElement | null = null;
  private bitmapBytes = 0;
  private disposed = false;
  private readonly disposables: IDisposable[] = [];

  constructor(private readonly term: Terminal) {
    this.disposables.push(
      term.parser.registerOscHandler(1337, (data) => this.handleOsc(data)),
      term.onRender(() => this.paint()),
      term.onResize(() => this.paint())
    );
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    for (const p of this.placements) p.bitmap.close();
    this.placements.length = 0;
    this.canvas?.remove();
    this.canvas = null;
  }

  private handleOsc(data: string): boolean {
    if (!data.startsWith('File=')) return false;
    const colon = data.indexOf(':');
    if (colon < 0) return true;
    const fields = parseHeader(data.slice(5, colon));
    if (fields.inline !== '1' && fields.inline !== 'true') return true;
    const payload = data.slice(colon + 1);
    if (!payload || payload.length > MAX_BASE64) return true;

    const buffer = this.term.buffer.active;
    // The cursor sits on the top row of the picture: TUIs emit ESC[<n>A first and
    // restore the cursor afterwards, so nothing else has to move.
    const line = buffer.baseY + buffer.cursorY;
    const col = buffer.cursorX;
    const kind = buffer.type === 'alternate' ? 'alternate' : 'normal';
    const cols = Number.parseInt(fields.width ?? '', 10);
    const rows = Number.parseInt(fields.height ?? '', 10);

    void this.load(payload, {
      line,
      col,
      kind,
      cols: Number.isFinite(cols) && cols > 0 ? cols : 0,
      rows: Number.isFinite(rows) && rows > 0 ? rows : 0,
    });
    return true;
  }

  private async load(
    payload: string,
    at: { line: number; col: number; kind: 'normal' | 'alternate'; cols: number; rows: number }
  ): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(payload);
    } catch {
      return;
    }
    const mime = mimeOf(bytes);
    if (!mime) return;
    let bitmap: ImageBitmap;
    try {
      const part = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      bitmap = await createImageBitmap(new Blob([part], { type: mime }));
    } catch {
      return;
    }
    if (this.disposed) {
      bitmap.close();
      return;
    }
    const cell = this.cellSize();
    const cols = at.cols || Math.max(1, Math.ceil(bitmap.width / cell.width));
    const rows = at.rows || Math.max(1, Math.ceil(bitmap.height / cell.height));
    const cost = bitmap.width * bitmap.height * 4;
    this.placements.push({ line: at.line, col: at.col, cols, rows, kind: at.kind, bitmap, bytes: cost });
    this.bitmapBytes += cost;
    while (this.placements.length > MAX_IMAGES || (this.bitmapBytes > MAX_BITMAP_BYTES && this.placements.length > 1)) {
      const dropped = this.placements.shift();
      if (!dropped) break;
      this.bitmapBytes -= dropped.bytes;
      dropped.bitmap.close();
    }
    this.paint();
  }

  /** The element the renderer paints into; the DOM type only exposes `.xterm`. */
  private screen(): HTMLElement | null {
    return (this.term.element?.querySelector('.xterm-screen') as HTMLElement | null) ?? null;
  }

  private screenRect(): DOMRect | undefined {
    return this.screen()?.getBoundingClientRect();
  }

  private cellSize(): { width: number; height: number } {
    const rect = this.screenRect();
    const cols = this.term.cols || 1;
    const rows = this.term.rows || 1;
    if (rect && rect.width > 0 && rect.height > 0) {
      return { width: rect.width / cols, height: rect.height / rows };
    }
    return { width: 9, height: 18 };
  }

  private ensureCanvas(): HTMLCanvasElement | null {
    if (this.canvas) return this.canvas;
    const screen = this.screen();
    if (!screen) return null;
    const canvas = document.createElement('canvas');
    canvas.className = 'xterm-inline-images';
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '2';
    screen.appendChild(canvas);
    this.canvas = canvas;
    return canvas;
  }

  private paint(): void {
    if (this.disposed) return;
    const screen = this.screen();
    if (!screen) return;
    if (this.placements.length === 0) {
      this.canvas?.remove();
      this.canvas = null;
      return;
    }
    const canvas = this.ensureCanvas();
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const rect = screen.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const buffer = this.term.buffer.active;
    const kind = buffer.type === 'alternate' ? 'alternate' : 'normal';
    const cell = { width: width / (this.term.cols || 1), height: height / (this.term.rows || 1) };
    const top = buffer.viewportY;

    for (const p of this.placements) {
      if (p.kind !== kind) continue;
      const row = p.line - top;
      if (row + p.rows <= 0 || row >= this.term.rows) continue;
      const boxW = p.cols * cell.width;
      const boxH = p.rows * cell.height;
      const scale = Math.min(boxW / p.bitmap.width, boxH / p.bitmap.height);
      const drawW = p.bitmap.width * scale;
      const drawH = p.bitmap.height * scale;
      const x = p.col * cell.width + (boxW - drawW) / 2;
      const y = row * cell.height + (boxH - drawH) / 2;
      // Text always wins: a row band that holds glyphs inside the picture's columns is
      // left to the terminal, so scrolling or a repaint can never hide content.
      const first = Math.max(row, 0);
      const last = Math.min(row + p.rows, this.term.rows);
      const colStart = Math.max(0, Math.floor(x / cell.width));
      const colEnd = Math.min(this.term.cols, Math.ceil((x + drawW) / cell.width));
      for (let band = first; band < last; band++) {
        if (!this.bandBlank(buffer, p.line + (band - row), colStart, colEnd - colStart)) continue;
        const topY = band * cell.height;
        const interTop = Math.max(topY, y);
        const interBottom = Math.min(topY + cell.height, y + drawH);
        const interH = interBottom - interTop;
        if (interH <= 0) continue;
        const sy = ((interTop - y) / drawH) * p.bitmap.height;
        ctx.drawImage(p.bitmap, 0, sy, p.bitmap.width, (interH / drawH) * p.bitmap.height, x, interTop, drawW, interH);
      }
    }
  }

  /** True when the buffer line holds no glyphs under the picture's column span. */
  private bandBlank(buffer: IBuffer, line: number, col: number, cols: number): boolean {
    const target = buffer.getLine(line - buffer.baseY);
    if (!target) return false;
    const cell = buffer.getNullCell();
    const end = Math.min(col + cols, this.term.cols);
    for (let x = Math.max(0, col); x < end; x++) {
      const current = target.getCell(x, cell);
      if (!current) continue;
      const chars = current.getChars();
      if (chars.length > 0 && chars.trim().length > 0) return false;
    }
    return true;
  }
}
