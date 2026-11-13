import type { AgentState } from '../types/api';

const LABELS: Record<AgentState, string> = {
  working: 'Working',
  blocked: 'Blocked',
  done: 'Done',
  error: 'Error',
  idle: 'Idle',
};

export function StatusBadge({ state = 'idle', label }: { state?: AgentState; label?: string }) {
  return (
    <span className={`status-badge status-${state}`}>
      <span className="status-dot" />
      <span>{label || LABELS[state] || 'Idle'}</span>
    </span>
  );
}
