import { javascript } from '@codemirror/lang-javascript';
import { go } from '@codemirror/lang-go';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

export function getLanguageExtension(langOrPath: string): Extension[] {
  const lower = langOrPath.toLowerCase();
  if (lower === 'tsx' || lower.endsWith('.tsx')) {
    return [javascript({ typescript: true, jsx: true })];
  }
  if (lower === 'typescript' || lower.endsWith('.ts') || lower.endsWith('.mts')) {
    return [javascript({ typescript: true })];
  }
  if (lower === 'jsx' || lower.endsWith('.jsx')) {
    return [javascript({ jsx: true })];
  }
  if (lower === 'javascript' || lower.endsWith('.js') || lower.endsWith('.mjs')) {
    return [javascript()];
  }
  if (lower === 'go' || lower.endsWith('.go')) {
    return [go()];
  }
  if (lower === 'python' || lower.endsWith('.py')) {
    return [python()];
  }
  if (lower === 'rust' || lower.endsWith('.rs')) {
    return [rust()];
  }
  if (lower === 'json' || lower.endsWith('.json')) {
    return [json()];
  }
  if (lower === 'markdown' || lower.endsWith('.md')) {
    return [markdown()];
  }
  if (lower === 'css' || lower.endsWith('.css') || lower.endsWith('.scss')) {
    return [css()];
  }
  if (lower === 'html' || lower.endsWith('.html')) {
    return [html()];
  }
  if (lower === 'yaml' || lower.endsWith('.yml') || lower.endsWith('.yaml')) {
    return [yaml()];
  }
  return [];
}

const geistLightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#d73a49' },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: '#171717' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: '#6f42c1' },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: '#005cc5' },
  { tag: [tags.definition(tags.name), tags.separator], color: '#171717' },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation], color: '#005cc5' },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp], color: '#032f62' },
  { tag: [tags.meta, tags.comment], color: '#6a737d', fontStyle: 'italic' },
  { tag: tags.string, color: '#032f62' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.heading, fontWeight: 'bold', color: '#005cc5' },
  { tag: tags.bool, color: '#005cc5' },
]);

const geistDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#ff6188' },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: '#ededed' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: '#c084fc' },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: '#60a5fa' },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation], color: '#60a5fa' },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp], color: '#93c5fd' },
  { tag: [tags.meta, tags.comment], color: '#737373', fontStyle: 'italic' },
  { tag: tags.string, color: '#a5f3fc' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.heading, fontWeight: 'bold', color: '#60a5fa' },
  { tag: tags.bool, color: '#60a5fa' },
]);

export function getGeistCodeTheme(dark: boolean): Extension[] {
  const editorTheme = EditorView.theme(
    {
      '&': {
        backgroundColor: 'var(--bg-surface)',
        color: 'var(--text-primary)',
      },
      '.cm-content': {
        caretColor: 'var(--accent)',
      },
      '.cm-selectionBackground, ::selection': {
        backgroundColor: dark ? 'rgba(50, 145, 255, 0.25)' : 'rgba(0, 112, 243, 0.16)',
      },
      '.cm-activeLine': {
        backgroundColor: dark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.025)',
      },
    },
    { dark }
  );
  return [editorTheme, syntaxHighlighting(dark ? geistDarkHighlight : geistLightHighlight)];
}
