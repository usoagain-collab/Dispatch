import type { CSSProperties, DragEvent } from 'react';
import type { Job, Technician } from '../types';
import { fmtDuration, fmtTime } from '../dates';

export const JOB_MIME = 'application/x-dispatch-job';

export function startJobDrag(e: DragEvent, job: Job) {
  e.dataTransfer.setData(JOB_MIME, String(job.id));
  e.dataTransfer.setData('text/plain', job.title);
  e.dataTransfer.effectAllowed = 'move';
}

export function draggedJobId(e: DragEvent): number | null {
  const v = e.dataTransfer.getData(JOB_MIME);
  return v ? Number(v) : null;
}

export function isJobDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(JOB_MIME);
}

export function JobCard({
  job,
  tech,
  onOpen,
  draggable,
  compact,
  showTech,
  style,
}: {
  job: Job;
  tech?: Technician;
  onOpen: (job: Job) => void;
  draggable: boolean;
  compact?: boolean;
  showTech?: boolean;
  style?: CSSProperties;
}) {
  const cls = [
    'job',
    `job-${job.status}`,
    `prio-${job.priority}`,
    job.conflict ? 'job-conflict' : '',
    compact ? 'job-compact' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const tip = [
    job.title,
    job.customer_name,
    job.address,
    job.start_at && job.end_at ? `${fmtTime(job.start_at)} – ${fmtTime(job.end_at)}` : fmtDuration(job.duration_minutes),
    tech ? `Tech: ${tech.name}` : 'Unassigned',
    job.conflict ? `⚠ ${job.conflict}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <div
      className={cls}
      style={{ ...style, borderLeftColor: tech?.color ?? '#94a3b8' }}
      draggable={draggable}
      onDragStart={(e) => startJobDrag(e, job)}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(job);
      }}
      title={tip}
    >
      <div className="job-line1">
        {job.priority === 'emergency' && <span className="badge badge-emergency">EMERG</span>}
        {job.priority === 'high' && <span className="badge badge-high">HIGH</span>}
        {job.conflict && <span className="badge badge-conflict">⚠</span>}
        {job.start_at && <span className="job-time">{fmtTime(job.start_at)}</span>}
        <span className="job-title">{job.title}</span>
      </div>
      {!compact && (
        <div className="job-line2">
          {showTech && <span className="job-tech">{tech ? tech.name : 'Unassigned'} · </span>}
          {job.customer_name || job.address}
          {!job.start_at && <span className="muted"> · {fmtDuration(job.duration_minutes)}</span>}
        </div>
      )}
    </div>
  );
}
