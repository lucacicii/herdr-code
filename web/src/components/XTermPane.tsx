import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { wsUrl } from '../lib/api';
import { createFileLinkProvider } from '../lib/terminalLinks';
import type { TerminalInfo } from '../types/api';

export interface XTermPaneHandle {
  pasteText: (text: string, submit?: boolean) => boolean;
  focus: () => void;
}

interface XTermPaneProps {
  terminal: TerminalInfo;
  theme: 'light' | 'dark';
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  focused: boolean;
  onFocus: () => void;
  onOpenFileLine: (path: string, line: number) => void;
  onPastePath: (path: string) => void;
}

const LIGHT_XTERM_THEME = {
  background: '#ffffff',
  foreground: '#171717',
  cursor: '#0070f3',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(0, 112, 243, 0.18)',
  black: '#171717',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#d97706',
  blue: '#0070f3',
  magenta: '#7c3aed',
  cyan: '#0891b2',
  white: '#e5e5e5',
  brightBlack: '#737373',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#f59e0b',
  brightBlue: '#3b82f6',
  brightMagenta: '#8b5cf6',
  brightCyan: '#06b6d4',
  brightWhite: '#ffffff',
};

const DARK_XTERM_THEME = {
  background: '#0a0a0a',
  foreground: '#ededed',
  cursor: '#3291ff',
  cursorAccent: '#0a0a0a',
  selectionBackground: 'rgba(50, 145, 255, 0.25)',
  black: '#171717',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#f59e0b',
  blue: '#3291ff',
  magenta: '#a855f7',
  cyan: '#22d3ee',
  white: '#d4d4d4',
  brightBlack: '#737373',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#fbbf24',
  brightBlue: '#60a5fa',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
};

const encoder = new TextEncoder();

export const XTermPane = forwardRef<XTermPaneHandle, XTermPaneProps>(function XTermPane(
  { terminal, theme, fontFamily, fontSize, lineHeight, focused, onFocus, onOpenFileLine, onPastePath },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connState, setConnState] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [dragOver, setDragOver] = useState(false);
  const onOpenFileLineRef = useRef(onOpenFileLine);
  onOpenFileLineRef.current = onOpenFileLine;

  useImperativeHandle(ref, () => ({
    pasteText(text: string, submit = false) {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return false;
      }
      ws.send(JSON.stringify({ type: 'paste', text, bracketed: true }));
      if (submit) {
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            const enter = new Uint8Array([0x00, 0x0d]);
            ws.send(enter);
          }
        }, 40);
      }
      return true;
    },
    focus() {
      termRef.current?.focus();
    },
  }));

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = theme === 'dark' ? DARK_XTERM_THEME : LIGHT_XTERM_THEME;
  }, [theme]);

  useEffect(() => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term) return;
    term.options.fontFamily = fontFamily;
    term.options.fontSize = fontSize;
    term.options.lineHeight = lineHeight;
    if (fitAddon) {
      try {
        fitAddon.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch {
        // ignore resize errors
      }
    }
  }, [fontFamily, fontSize, lineHeight]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily,
      fontSize,
      lineHeight,
      cursorBlink: true,
      scrollback: 5000,
      theme: theme === 'dark' ? DARK_XTERM_THEME : LIGHT_XTERM_THEME,
    });
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    const linksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(linksAddon);
    term.open(container);

    const fileLinkDisp = term.registerLinkProvider(
      createFileLinkProvider(term, (path, line) => {
        onOpenFileLineRef.current(path, line);
      })
    );

    try {
      fitAddon.fit();
    } catch {
      // ignore initial zero-size fit
    }

    termRef.current = term;
    setConnState('connecting');

    const socket = new WebSocket(
      wsUrl(
        `/ws/terminal/${encodeURIComponent(terminal.address)}?cols=${term.cols || 100}&rows=${term.rows || 30}&history=1000`
      )
    );
    socket.binaryType = 'arraybuffer';
    wsRef.current = socket;

    socket.onopen = () => {
      setConnState('open');
      try {
        fitAddon.fit();
        socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      } catch {
        // ignore
      }
    };

    socket.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(ev.data);
        if (bytes.length > 1 && bytes[0] === 0x00) {
          term.write(bytes.subarray(1));
        }
        return;
      }
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'error') {
            term.writeln(`\r\n[herdr-code] error: ${msg.message}`);
          } else if (msg.type === 'closed') {
            setConnState('closed');
          }
        } catch {
          // ignore
        }
      }
    };

    socket.onclose = () => {
      setConnState('closed');
    };

    const dataDisp = term.onData((data) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const encoded = encoder.encode(data);
      const buf = new Uint8Array(1 + encoded.length);
      buf[0] = 0x00;
      buf.set(encoded, 1);
      socket.send(buf);
    });

    const binDisp = term.onBinary((data) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const buf = new Uint8Array(1 + data.length);
      buf[0] = 0x01;
      for (let i = 0; i < data.length; i++) {
        buf[i + 1] = data.charCodeAt(i) & 0xff;
      }
      socket.send(buf);
    });

    const ro = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch {
        // ignore
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      dataDisp.dispose();
      binDisp.dispose();
      fileLinkDisp.dispose();
      socket.close();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [terminal.address]);

  return (
    <div
      onMouseDown={onFocus}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('text/herdr-path')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        const relPath = e.dataTransfer.getData('text/herdr-path');
        if (relPath) {
          e.preventDefault();
          onFocus();
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'paste', text: `@${relPath} `, bracketed: true }));
          } else {
            onPastePath(relPath);
          }
          termRef.current?.focus();
        }
      }}
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        padding: '6px 8px',
        border: dragOver
          ? '1px solid var(--accent)'
          : focused
            ? '1px solid var(--border-strong)'
            : '1px solid transparent',
        background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
        overflow: 'hidden',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {connState === 'closed' && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 10,
            padding: '2px 8px',
            borderRadius: 6,
            fontSize: 11,
            background: 'var(--status-error-bg)',
            color: 'var(--status-error)',
          }}
        >
          Disconnected
        </div>
      )}
    </div>
  );
});
