export interface TerminalFontConfig {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

export const FONT_PRESETS = [
  { label: 'SF Mono (macOS)', value: 'ui-monospace, "SFMono-Regular", Menlo, Monaco, monospace' },
  { label: 'Menlo', value: 'Menlo, Monaco, Consolas, monospace' },
  { label: 'JetBrains Mono', value: '"JetBrainsMono Nerd Font", "JetBrains Mono", ui-monospace, Menlo, monospace' },
  { label: 'MesloLGS NF', value: '"MesloLGS NF", "MesloLGS Nerd Font", ui-monospace, Menlo, monospace' },
  { label: 'Fira Code', value: '"FiraCode Nerd Font", "Fira Code", ui-monospace, Menlo, monospace' },
  { label: 'Hack', value: '"Hack Nerd Font", Hack, ui-monospace, Menlo, monospace' },
  { label: 'Maple Mono', value: '"Maple Mono NF CN", "Maple Mono", ui-monospace, Menlo, monospace' },
];

export const DEFAULT_TERMINAL_FONT: TerminalFontConfig = {
  fontFamily: FONT_PRESETS[0].value,
  fontSize: 13,
  lineHeight: 1.35,
};

export function loadTerminalFontConfig(): TerminalFontConfig {
  const fontFamily = localStorage.getItem('herdr_code_term_font') || DEFAULT_TERMINAL_FONT.fontFamily;
  const rawSize = Number(localStorage.getItem('herdr_code_term_size'));
  const fontSize =
    Number.isFinite(rawSize) && rawSize >= 9 && rawSize <= 28
      ? rawSize
      : DEFAULT_TERMINAL_FONT.fontSize;
  const rawLh = Number(localStorage.getItem('herdr_code_term_lh'));
  const lineHeight =
    Number.isFinite(rawLh) && rawLh >= 1 && rawLh <= 2
      ? rawLh
      : DEFAULT_TERMINAL_FONT.lineHeight;
  return { fontFamily, fontSize, lineHeight };
}

export function saveTerminalFontConfig(cfg: TerminalFontConfig): void {
  localStorage.setItem('herdr_code_term_font', cfg.fontFamily);
  localStorage.setItem('herdr_code_term_size', String(cfg.fontSize));
  localStorage.setItem('herdr_code_term_lh', String(cfg.lineHeight));
}
