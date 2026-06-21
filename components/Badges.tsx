import { STATUS_LABEL, PRI_LABEL } from '@/lib/constants';

const STATUS_CLS: Record<string, string> = {
  new: 'b-new', 'in-progress': 'b-progress', 'waiting-on-admin': 'b-waiting-admin',
  'waiting-on-requester': 'b-waiting', 'on-hold': 'b-hold', resolved: 'b-resolved', closed: 'b-closed',
};
const PRI_CLS: Record<string, string> = { low: 'b-low', medium: 'b-medium', high: 'b-high', urgent: 'b-urgent' };
const PRI_COL: Record<string, string> = { low: '#9CA3AF', medium: '#1C64F2', high: '#B45309', urgent: '#C0392B' };

export function StatusBadge({ status, labels }: { status: string; labels?: Record<string, string> }) {
  const L = labels || STATUS_LABEL;
  return <span className={`badge ${STATUS_CLS[status] || 'b-hold'}`}>{L[status] || status}</span>;
}

export function PriBadge({ priority }: { priority: string }) {
  return (
    <span className={`badge ${PRI_CLS[priority] || 'b-low'}`}>
      <span className="pri-dot" style={{ background: PRI_COL[priority] || '#9CA3AF' }} />
      {PRI_LABEL[priority] || priority}
    </span>
  );
}
