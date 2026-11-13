import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Loader2,
  Minus,
  PackageCheck,
  Play,
  Plus,
  RefreshCw,
  Settings,
  X,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  DEFAULT_TERMINAL_FONT,
  FONT_PRESETS,
  type TerminalFontConfig,
} from '../lib/terminalFont';
import type { DependenciesStatus } from '../types/api';

interface SettingsModalProps {
  theme: 'light' | 'dark';
  terminalFont: TerminalFontConfig;
  canInstallPWA?: boolean;
  autoPromptReason?: string;
  onChangeTerminalFont: (cfg: TerminalFontConfig) => void;
  onInstallPWA?: () => void;
  onToggleTheme: () => void;
  onClose: () => void;
  onDependenciesChanged: () => void;
}

export function SettingsModal({
  theme,
  terminalFont,
  canInstallPWA,
  autoPromptReason,
  onChangeTerminalFont,
  onInstallPWA,
  onToggleTheme,
  onClose,
  onDependenciesChanged,
}: SettingsModalProps) {
  const [tab, setTab] = useState<'dependencies' | 'general'>('dependencies');
  const [status, setStatus] = useState<DependenciesStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installingTarget, setInstallingTarget] = useState<
    'herdr-core' | 'herdr-core-start' | null
  >(null);
  const [installLog, setInstallLog] = useState<string>('');
  const [installError, setInstallError] = useState<string>('');

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getDependencies();
      setStatus(res);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'Failed to check dependencies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleInstall = async (
    target: 'herdr-core' | 'herdr-core-start'
  ) => {
    setInstallingTarget(target);
    setInstallError('');
    setInstallLog('');
    try {
      const res = await api.installDependency(target);
      setStatus(res.status);
      setInstallLog(res.output || (res.ok ? 'Completed successfully.' : ''));
      if (!res.ok) {
        setInstallError(res.error || 'Installation failed');
      } else {
        onDependenciesChanged();
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'Installation request failed');
    } finally {
      setInstallingTarget(null);
    }
  };

  const renderBadge = (ok: boolean, okText: string, failText: string) => {
    if (ok) {
      return (
        <span className="status-badge status-done">
          <CheckCircle2 size={11} />
          <span>{okText}</span>
        </span>
      );
    }
    return (
      <span className="status-badge status-blocked">
        <XCircle size={11} />
        <span>{failText}</span>
      </span>
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        style={{ width: 720, maxHeight: '82vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={15} />
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Settings</span>
          </div>
          <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left Settings Nav */}
          <nav
            style={{
              width: 184,
              flexShrink: 0,
              borderRight: '1px solid var(--border-subtle)',
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              background: 'var(--bg-page)',
            }}
          >
            <button
              className={`tree-row ${tab === 'dependencies' ? 'active' : ''}`}
              style={{
                border: 'none',
                background: tab === 'dependencies' ? undefined : 'transparent',
                padding: '0 10px',
                height: 32,
                width: '100%',
                textAlign: 'left',
                fontSize: 12.5,
                fontWeight: tab === 'dependencies' ? 600 : 500,
                whiteSpace: 'nowrap',
              }}
              onClick={() => setTab('dependencies')}
            >
              <PackageCheck size={14} style={{ flexShrink: 0 }} />
              <span>Dependencies</span>
            </button>
            <button
              className={`tree-row ${tab === 'general' ? 'active' : ''}`}
              style={{
                border: 'none',
                background: tab === 'general' ? undefined : 'transparent',
                padding: '0 10px',
                height: 32,
                width: '100%',
                textAlign: 'left',
                fontSize: 12.5,
                fontWeight: tab === 'general' ? 600 : 500,
                whiteSpace: 'nowrap',
              }}
              onClick={() => setTab('general')}
            >
              <Settings size={14} style={{ flexShrink: 0 }} />
              <span>General</span>
            </button>
          </nav>

          {/* Right Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {tab === 'dependencies' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>Herdr Dependencies</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Detect and install local Herdr runtime dependencies required by herdr-code.
                    </div>
                  </div>
                  <button
                    className="btn btn-sm"
                    style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                    onClick={() => void loadStatus()}
                    disabled={loading || installingTarget !== null}
                  >
                    <RefreshCw size={12} className={loading ? 'spin-slow' : ''} />
                    <span>Re-check</span>
                  </button>
                </div>

                {autoPromptReason && status && (!status.hc_cli.installed || !status.hc_daemon.running) && (
                  <div
                    style={{
                      border: '1px solid var(--status-blocked)',
                      background: 'var(--status-blocked-bg)',
                      color: 'var(--text-primary)',
                      borderRadius: 'var(--radius-md)',
                      padding: '9px 12px',
                      fontSize: 12,
                      lineHeight: 1.45,
                    }}
                  >
                    {autoPromptReason}
                  </div>
                )}

                {loading && !status ? (
                  <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 12.5 }}>
                    Checking local environment...
                  </div>
                ) : (
                  status && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* 1. herdr-core (hc) CLI */}
                      <div
                        style={{
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-md)',
                          padding: 12,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>herdr-core (hc)</span>
                            {renderBadge(status.hc_cli.installed, 'Installed', 'Not Installed')}
                          </div>
                          <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {status.hc_cli.installed
                              ? `${status.hc_cli.version || 'hc'} · ${status.hc_cli.path}`
                              : 'Required runtime CLI & daemon (releases.herdr.dev/core/install.sh)'}
                          </div>
                        </div>

                        {!status.hc_cli.installed && (
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={installingTarget !== null}
                            onClick={() => void handleInstall('herdr-core')}
                          >
                            {installingTarget === 'herdr-core' ? (
                              <Loader2 size={12} className="spin-slow" />
                            ) : (
                              <Download size={12} />
                            )}
                            <span>
                              {installingTarget === 'herdr-core' ? 'Installing...' : 'Install herdr-core'}
                            </span>
                          </button>
                        )}
                      </div>

                      {/* 2. herdr-core Daemon */}
                      <div
                        style={{
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-md)',
                          padding: 12,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>herdr-core Daemon</span>
                            {renderBadge(status.hc_daemon.running, 'Running', 'Stopped')}
                          </div>
                          <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {status.hc_daemon.running
                              ? `v${status.hc_daemon.version} · PID ${status.hc_daemon.pid} · ${status.hc_daemon.live_terminals ?? 0} live · ${status.hc_daemon.socket_path}`
                              : `Socket offline: ${status.hc_daemon.socket_path}`}
                          </div>
                        </div>

                        {!status.hc_daemon.running && status.hc_cli.installed && (
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={installingTarget !== null}
                            onClick={() => void handleInstall('herdr-core-start')}
                          >
                            {installingTarget === 'herdr-core-start' ? (
                              <Loader2 size={12} className="spin-slow" />
                            ) : (
                              <Play size={12} />
                            )}
                            <span>
                              {installingTarget === 'herdr-core-start' ? 'Starting...' : 'Start Daemon'}
                            </span>
                          </button>
                        )}
                      </div>

                      {/* 3. Git CLI */}
                      <div
                        style={{
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-md)',
                          padding: 12,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>Git CLI</span>
                            {renderBadge(status.git_cli.installed, 'Installed', 'Not Installed')}
                          </div>
                          <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 4 }}>
                            {status.git_cli.installed
                              ? `${status.git_cli.version || 'git'} · ${status.git_cli.path}`
                              : 'Install Git for repository detection and Diff viewer.'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                )}

                {(installLog || installError) && (
                  <div
                    style={{
                      border: `1px solid ${installError ? 'var(--status-error)' : 'var(--border-subtle)'}`,
                      background: 'var(--bg-page)',
                      borderRadius: 'var(--radius-md)',
                      padding: 10,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: installError ? 'var(--status-error)' : 'var(--text-secondary)',
                        marginBottom: 4,
                      }}
                    >
                      {installError ? `Error: ${installError}` : 'Installer Output'}
                    </div>
                    {installLog && (
                      <pre
                        className="mono"
                        style={{
                          margin: 0,
                          fontSize: 11,
                          lineHeight: 1.45,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          maxHeight: 150,
                          overflowY: 'auto',
                        }}
                      >
                        {installLog}
                      </pre>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>General</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    Workbench appearance and local environment details.
                  </div>
                </div>

                <div
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Theme</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Current: {theme === 'light' ? 'Geist Light' : 'Geist Dark'}
                    </div>
                  </div>
                  <button className="btn btn-sm" onClick={onToggleTheme}>
                    Switch to {theme === 'light' ? 'Dark' : 'Light'}
                  </button>
                </div>

                <div
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>Terminal Typography</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        Font family, size, and line height for xterm panes.
                      </div>
                    </div>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => onChangeTerminalFont(DEFAULT_TERMINAL_FONT)}
                    >
                      Reset
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Font Preset</span>
                    <select
                      className="input"
                      value={
                        FONT_PRESETS.some((p) => p.value === terminalFont.fontFamily)
                          ? terminalFont.fontFamily
                          : '__custom__'
                      }
                      onChange={(e) => {
                        if (e.target.value !== '__custom__') {
                          onChangeTerminalFont({ ...terminalFont, fontFamily: e.target.value });
                        }
                      }}
                    >
                      {FONT_PRESETS.map((p) => (
                        <option key={p.label} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                      {!FONT_PRESETS.some((p) => p.value === terminalFont.fontFamily) && (
                        <option value="__custom__">Custom</option>
                      )}
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Custom Font Family</span>
                    <input
                      className="input mono"
                      style={{ fontSize: 11.5 }}
                      value={terminalFont.fontFamily}
                      onChange={(e) =>
                        onChangeTerminalFont({ ...terminalFont, fontFamily: e.target.value })
                      }
                      placeholder='e.g. "JetBrains Mono", Menlo, monospace'
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Size</span>
                      <button
                        className="btn btn-icon btn-sm"
                        onClick={() =>
                          onChangeTerminalFont({
                            ...terminalFont,
                            fontSize: Math.max(9, terminalFont.fontSize - 1),
                          })
                        }
                      >
                        <Minus size={11} />
                      </button>
                      <span className="mono tabular" style={{ minWidth: 34, textAlign: 'center', fontSize: 12 }}>
                        {terminalFont.fontSize}px
                      </span>
                      <button
                        className="btn btn-icon btn-sm"
                        onClick={() =>
                          onChangeTerminalFont({
                            ...terminalFont,
                            fontSize: Math.min(28, terminalFont.fontSize + 1),
                          })
                        }
                      >
                        <Plus size={11} />
                      </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Line Height</span>
                      <button
                        className="btn btn-icon btn-sm"
                        onClick={() =>
                          onChangeTerminalFont({
                            ...terminalFont,
                            lineHeight: Math.max(
                              1,
                              Number((terminalFont.lineHeight - 0.05).toFixed(2))
                            ),
                          })
                        }
                      >
                        <Minus size={11} />
                      </button>
                      <span className="mono tabular" style={{ minWidth: 34, textAlign: 'center', fontSize: 12 }}>
                        {terminalFont.lineHeight.toFixed(2)}
                      </span>
                      <button
                        className="btn btn-icon btn-sm"
                        onClick={() =>
                          onChangeTerminalFont({
                            ...terminalFont,
                            lineHeight: Math.min(
                              2,
                              Number((terminalFont.lineHeight + 0.05).toFixed(2))
                            ),
                          })
                        }
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                  </div>
                </div>

                {canInstallPWA && onInstallPWA && (
                  <div
                    style={{
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>Desktop App (PWA)</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        Install herdr-code as a standalone window.
                      </div>
                    </div>
                    <button className="btn btn-sm btn-primary" onClick={onInstallPWA}>
                      <Download size={12} />
                      <span>Install</span>
                    </button>
                  </div>
                )}

                {status && (
                  <div
                    style={{
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      fontSize: 12,
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Environment</div>
                    <div className="mono" style={{ color: 'var(--text-secondary)' }}>
                      Platform: {status.os} / {status.arch}
                    </div>
                    <div className="mono" style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                      hc Socket: {status.hc_daemon.socket_path}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
