import type { ReferenceChip, ReviewComment } from '../types/api';

export function formatLineAnchor(path: string, startLine?: number, endLine?: number): string {
  if (!startLine) return `@${path}`;
  if (!endLine || endLine === startLine) return `@${path}#L${startLine}`;
  return `@${path}#L${startLine}-${endLine}`;
}

export function formatChipText(chip: ReferenceChip): string {
  if (chip.kind === 'path') {
    return `@${chip.path}`;
  }
  if (chip.kind === 'lines') {
    return formatLineAnchor(chip.path, chip.startLine, chip.endLine);
  }
  if (chip.kind === 'snippet') {
    const anchor = formatLineAnchor(chip.path, chip.startLine, chip.endLine);
    const lang = chip.language || '';
    return `${anchor}\n\`\`\`${lang}\n${chip.snippet || ''}\n\`\`\``;
  }
  if (chip.kind === 'hunk') {
    return `@${chip.path} (diff hunk)\n\`\`\`diff\n${chip.snippet || ''}\n\`\`\``;
  }
  if (chip.kind === 'review' && chip.comments && chip.comments.length > 0) {
    return formatReviewComments(chip.comments);
  }
  return `@${chip.path}`;
}

export function formatReviewComments(comments: ReviewComment[]): string {
  const byFile = new Map<string, ReviewComment[]>();
  for (const c of comments) {
    const arr = byFile.get(c.path) || [];
    arr.push(c);
    byFile.set(c.path, arr);
  }
  const sections: string[] = ['Review comments:'];
  for (const [filePath, items] of byFile.entries()) {
    sections.push(`@${filePath}`);
    for (const item of items) {
      const range =
        item.startLine === item.endLine
          ? `L${item.startLine}`
          : `L${item.startLine}-${item.endLine}`;
      sections.push(`- ${range}: ${item.text}`);
    }
  }
  return sections.join('\n');
}

export function buildComposerPayload(chips: ReferenceChip[], promptText: string): string {
  const parts: string[] = [];
  for (const chip of chips) {
    parts.push(formatChipText(chip));
  }
  const trimmed = promptText.trim();
  if (trimmed) {
    parts.push(trimmed);
  }
  return parts.join('\n\n');
}
