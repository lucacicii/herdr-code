import { AtSign, FileCode2, GitCompare, Search, X } from 'lucide-react';
import { CodeMirrorViewer } from './CodeMirrorViewer';
import { DiffViewer } from './DiffViewer';
import type { CenterTab, DiffHunk, FileContent, FileDiff } from '../types/api';

interface CenterCodePaneProps {
  workspaceId: string | null;
  tabs: CenterTab[];
  activeTabId: string | null;
  filesByPath: Record<string, FileContent>;
  activeDiff: FileDiff | null;
  loadingDiff: boolean;
  theme: 'light' | 'dark';
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onOpenQuickSearch: () => void;
  onAddFileRef: (path: string) => void;
  onAddLineRef: (path: string, startLine: number, endLine: number) => void;
  onAddSnippetRef: (
    path: string,
    startLine: number,
    endLine: number,
    snippet: string,
    language: string
  ) => void;
  onAddHunkRef: (path: string, hunk: DiffHunk) => void;
  onAddReviewComment: (path: string, startLine: number, endLine: number, text: string) => void;
  onGitMutated: () => void;
}

export function CenterCodePane({
  workspaceId,
  tabs,
  activeTabId,
  filesByPath,
  activeDiff,
  loadingDiff,
  theme,
  onSelectTab,
  onCloseTab,
  onOpenQuickSearch,
  onAddFileRef,
  onAddLineRef,
  onAddSnippetRef,
  onAddHunkRef,
  onAddReviewComment,
  onGitMutated,
}: CenterCodePaneProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          height: 36,
          minHeight: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-subtle)',
          padding: '0 6px',
          gap: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            overflowX: 'auto',
            flex: 1,
            minWidth: 0,
          }}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const label =
              tab.kind === 'diff'
                ? `Diff: ${tab.path || tab.mode}`
                : tab.path.split('/').pop() || tab.path;
            return (
              <div
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                title={tab.kind === 'code' ? tab.path : `Diff ${tab.path || ''}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 28,
                  padding: '0 8px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: 12,
                  background: isActive ? 'var(--bg-surface)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: isActive ? '1px solid var(--border-subtle)' : '1px solid transparent',
                  flexShrink: 0,
                }}
              >
                {tab.kind === 'diff' ? <GitCompare size={12} /> : <FileCode2 size={12} />}
                <span>{label}</span>
                <button
                  className="btn btn-ghost btn-icon"
                  style={{ width: 16, height: 16 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>

        {activeTab && activeTab.kind === 'code' && (
          <button
            className="btn btn-sm"
            onClick={() => onAddFileRef(activeTab.path)}
            title={`Reference @${activeTab.path}`}
          >
            <AtSign size={11} />
            <span>Ref File</span>
          </button>
        )}
      </div>

      {!activeTab ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            color: 'var(--text-secondary)',
          }}
        >
          <FileCode2 size={28} strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
          <div style={{ fontSize: 13 }}>Open a file from the tree or press ⌘P</div>
          <button className="btn" onClick={onOpenQuickSearch} disabled={!workspaceId}>
            <Search size={13} />
            <span>Find File</span>
          </button>
        </div>
      ) : activeTab.kind === 'code' ? (
        filesByPath[activeTab.path] ? (
          <CodeMirrorViewer
            file={filesByPath[activeTab.path]}
            theme={theme}
            highlightStart={activeTab.highlightStart}
            highlightEnd={activeTab.highlightEnd}
            onAddLineRef={onAddLineRef}
            onAddSnippetRef={onAddSnippetRef}
            onAddReviewComment={onAddReviewComment}
          />
        ) : (
          <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading file...</div>
        )
      ) : (
        workspaceId && (
          <DiffViewer
            workspaceId={workspaceId}
            diff={activeDiff}
            loading={loadingDiff}
            theme={theme}
            onAddHunkRef={onAddHunkRef}
            onAddReviewComment={onAddReviewComment}
            onGitMutated={onGitMutated}
          />
        )
      )}
    </div>
  );
}
