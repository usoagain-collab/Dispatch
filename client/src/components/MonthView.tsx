import { useState } from 'react';
import type { BoardTech, Job, Travel } from '../types';
import { fmtWeekday, today } from '../dates';
import { useData } from '../ui';
import { JobCard, draggedJobId, isJobDrag } from './JobCard';
import type { DropTarget } from './shared';

const MAX_CHIPS = 4;

export default function MonthView({
  anchor,
  days,
  islandId,
  techs,
  jobs,
  travel,
  onOpenJob,
  onOpenDay,
  onDropJob,
}: {
  anchor: string;
  days: string[];
  islandId: number;
  techs: BoardTech[];
  jobs: Job[];
  travel: Travel[];
  onOpenJob: (j: Job) => void;
  onOpenDay: (date: string) => void;
  onDropJob: (jobId: number, target: DropTarget) => void;
}) {
  const { canWrite } = useData();
  const [hover, setHover] = useState<string | null>(null);
  const month = anchor.slice(0, 7);
  const t0 = today();
  const techById = new Map(techs.map((t) => [t.id, t]));

  const jobsOn = (d: string) =>
    jobs.filter((j) => j.start_at!.startsWith(d)).sort((a, b) => a.start_at!.localeCompare(b.start_at!));
  const working = (d: string) =>
    techs.filter((t) => t.days[d]?.islandId === islandId && t.days[d]?.status !== 'off').length;
  const arrivals = (d: string) => travel.filter((t) => t.kind === 'travel' && t.island_id === islandId && t.start_date === d);
  const departures = (d: string) =>
    travel.filter((t) => t.kind === 'travel' && t.island_id !== islandId && t.home_island_id === islandId && t.start_date === d);
  const offs = (d: string) =>
    travel.filter((t) => t.kind === 'time_off' && t.start_date <= d && t.end_date >= d && techById.get(t.technician_id)?.days[d]?.islandId === islandId);

  return (
    <div className="month-view">
      <div className="month-grid">
        {days.slice(0, 7).map((d) => (
          <div key={d} className="month-dow">
            {fmtWeekday(d)}
          </div>
        ))}
        {days.map((d) => {
          const list = jobsOn(d);
          const inMonth = d.startsWith(month);
          const arr = arrivals(d);
          const dep = departures(d);
          const off = offs(d);
          return (
            <div
              key={d}
              className={`month-cell${inMonth ? '' : ' other-month'}${d === t0 ? ' is-today' : ''}${hover === d ? ' drop-hover' : ''}`}
              onClick={() => onOpenDay(d)}
              onDragOver={(e) => {
                if (!canWrite || !isJobDrag(e)) return;
                e.preventDefault();
                setHover(d);
              }}
              onDragLeave={() => setHover((h) => (h === d ? null : h))}
              onDrop={(e) => {
                setHover(null);
                const id = draggedJobId(e);
                if (!canWrite || id == null) return;
                e.preventDefault();
                const job = jobs.find((j) => j.id === id);
                onDropJob(id, { techId: job ? job.technician_id : null, date: d });
              }}
            >
              <div className="month-cell-head">
                <span className="month-date">{Number(d.slice(8))}</span>
                <span className="month-meta" title="Technicians working on this island">
                  {working(d)} techs
                </span>
              </div>
              {(arr.length > 0 || dep.length > 0 || off.length > 0) && (
                <div className="month-travel">
                  {arr.map((t) => (
                    <span key={t.id} className="tag tag-travel" title={t.notes}>
                      ✈ {t.technician_name.split(' ')[0]} in
                    </span>
                  ))}
                  {dep.map((t) => (
                    <span key={t.id} className="tag tag-away" title={`To ${t.island_name}`}>
                      ✈ {t.technician_name.split(' ')[0]} out
                    </span>
                  ))}
                  {off.map((t) => (
                    <span key={t.id} className="tag tag-off">
                      🌴 {t.technician_name.split(' ')[0]}
                    </span>
                  ))}
                </div>
              )}
              {list.slice(0, MAX_CHIPS).map((j) => (
                <JobCard
                  key={j.id}
                  job={j}
                  tech={j.technician_id ? techById.get(j.technician_id) : undefined}
                  onOpen={onOpenJob}
                  draggable={canWrite}
                  compact
                />
              ))}
              {list.length > MAX_CHIPS && <div className="more">+{list.length - MAX_CHIPS} more</div>}
            </div>
          );
        })}
      </div>
      <p className="hint-line">Click a day to open it · Drag a job to another day (keeps technician and time)</p>
    </div>
  );
}
