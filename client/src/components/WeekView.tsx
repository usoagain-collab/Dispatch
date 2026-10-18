import { useState } from 'react';
import type { BoardTech, Job, Travel } from '../types';
import { fmtShort, fmtWeekday, today } from '../dates';
import { useData } from '../ui';
import { JobCard, draggedJobId, isJobDrag } from './JobCard';
import { TechLabel, dayStateLabel, type DropTarget } from './shared';

export default function WeekView({
  days,
  islandId,
  techs,
  jobs,
  travel,
  onOpenJob,
  onCreate,
  onDropJob,
  onOpenDay,
}: {
  days: string[];
  islandId: number;
  techs: BoardTech[];
  jobs: Job[];
  travel: Travel[];
  onOpenJob: (j: Job) => void;
  onCreate: (techId: number | null, date: string) => void;
  onDropJob: (jobId: number, target: DropTarget) => void;
  onOpenDay: (date: string) => void;
}) {
  const { canWrite, islandById } = useData();
  const [hover, setHover] = useState<string | null>(null);
  const t0 = today();
  const tripStart = new Map(travel.map((t) => [t.id, t.start_date]));

  const byCell = new Map<string, Job[]>();
  const techIds = new Set(techs.map((t) => t.id));
  for (const j of jobs) {
    const tid = j.technician_id && techIds.has(j.technician_id) ? j.technician_id : 0;
    const key = `${tid}|${j.start_at!.slice(0, 10)}`;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key)!.push(j);
  }
  const hasUnassigned = days.some((d) => byCell.has(`0|${d}`));
  const rows: (BoardTech | null)[] = [...techs, ...(hasUnassigned ? [null] : [])];

  const workingCount = (d: string) =>
    techs.filter((t) => t.days[d]?.islandId === islandId && t.days[d]?.status !== 'off').length;
  const jobCount = (d: string) => jobs.filter((j) => j.start_at!.startsWith(d) && j.status !== 'cancelled').length;

  return (
    <div className="week-view">
      <div className="week-grid" style={{ gridTemplateColumns: `200px repeat(${days.length}, minmax(130px, 1fr))` }}>
        <div className="week-corner" />
        {days.map((d) => (
          <button
            key={d}
            className={`week-head${d === t0 ? ' is-today' : ''}`}
            onClick={() => onOpenDay(d)}
            title="Open day view"
          >
            <span className="week-head-day">
              {fmtWeekday(d)} <strong>{fmtShort(d)}</strong>
            </span>
            <span className="week-head-meta">
              {workingCount(d)} techs · {jobCount(d)} jobs
            </span>
          </button>
        ))}

        {rows.map((tech) => (
          <div className="week-row" key={tech?.id ?? 'unassigned'} style={{ display: 'contents' }}>
            <div className="week-tech">
              {tech ? (
                <TechLabel tech={tech} loc={undefined} islandId={islandId} />
              ) : (
                <div className="tech-label">
                  <span className="tech-name muted">Unassigned</span>
                </div>
              )}
            </div>
            {days.map((d) => {
              const loc = tech?.days[d];
              const here = !tech || loc?.islandId === islandId;
              const off = here && loc?.status === 'off';
              const cellJobs = (byCell.get(`${tech?.id ?? 0}|${d}`) ?? []).sort((a, b) =>
                a.start_at!.localeCompare(b.start_at!),
              );
              const key = `${tech?.id ?? 0}|${d}`;
              const droppable = canWrite && here;
              const arriving = here && loc?.travelId != null && tripStart.get(loc.travelId) === d;
              return (
                <div
                  key={d}
                  className={`week-cell${!here ? ' away' : ''}${off ? ' off' : ''}${hover === key ? ' drop-hover' : ''}${d === t0 ? ' is-today' : ''}`}
                  onDragOver={(e) => {
                    if (!droppable || !isJobDrag(e)) return;
                    e.preventDefault();
                    setHover(key);
                  }}
                  onDragLeave={() => setHover((h) => (h === key ? null : h))}
                  onDrop={(e) => {
                    setHover(null);
                    const id = draggedJobId(e);
                    if (!droppable || id == null) return;
                    e.preventDefault();
                    onDropJob(id, { techId: tech?.id ?? null, date: d });
                  }}
                  onClick={() => droppable && onCreate(tech?.id ?? null, d)}
                >
                  {!here && loc && <div className="cell-note">{dayStateLabel(loc, islandId, islandById)}</div>}
                  {off && <div className="cell-note">🌴 Off</div>}
                  {arriving && <div className="cell-arrive">✈ Arrives</div>}
                  {cellJobs.map((j) => (
                    <JobCard key={j.id} job={j} tech={tech ?? undefined} onOpen={onOpenJob} draggable={canWrite} />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
        {!rows.length && (
          <div className="empty-row" style={{ gridColumn: `1 / span ${days.length + 1}` }}>
            No technicians are working on this island this week. Use <strong>+ Travel</strong> to bring someone over.
          </div>
        )}
      </div>
      <p className="hint-line">Click a cell to add a job · Drag jobs between days or technicians (keeps the time of day) · Click a day header for the day view</p>
    </div>
  );
}

