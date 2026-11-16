// Herdr terminals report the agent TUI's raw OSC title in `title` / `status.msg`.
// Those strings carry the agent's *animated* status decoration: braille spinner
// frames (U+2800–U+28FF), Nerd Font private-use icons (U+E000–U+F8FF) and
// variation selectors. Rendering them verbatim rewrites the text node (and the
// `title` attribute) of every sidebar row / tab a dozen times per second, which
// reads as flicker, and shows tofu where the icon font is missing.
// Strip that decoration once, at display time.
const VOLATILE_GLYPHS = /[\u2800-\u28FF\uFE00-\uFE0F\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu;

export function cleanTerminalTitle(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(VOLATILE_GLYPHS, '').replace(/\s+/g, ' ').trim();
}
