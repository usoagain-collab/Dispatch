import { useMemo, useState, type DragEvent, type MouseEvent } from 'react';
import type { BoardTech, Job } from '../types';
import { fmtTime, minutesOf, diffMinutes, today } from '../dates';
import { useData } from '../ui';
import { JobCard, draggedJobId, isJobDrag } from './JobCard';
import { TechLabel, dayStateLabel, type DropTarget } from './shared';

const SNAP = 30;
const LANE_H = 46;

/** Assign overlapping jobs to lanes so they stack instead of covering each other. */
function lanes(jobs: Job[]): { job: Job; lane: number }[] {
  const ends: number[] = [];
  return jobs
    .slice()
    .sort((a, b) => a.start_at!.localeCompare(b.start_at!))
    .map((job) => {
      const s = minutesOf(job.start_at!);
      let lane = ends.findIndex((e) => e <= s);
      if (lane === -1) lane = ends.length;
      ends[lane] = s + Math.max(30, diffMinutes(job.start_at!, job.end_at!));
      return { job, lane };
    });
}

export default function DayView({
  date,
  islandId,
  techs,
  jobs,
  onOpenJob,
  onCreate,
  onDropJob,
}: {
  date: string;
  islandId: number;
  techs: BoardTech[];
  jobs: Job[];
  onOpenJob: (j: Job) => void;
  onCreate: (techId: number | null, date: string, minutes: number) => void;
  onDropJob: (jobId: number, target: DropTarget) => void;
}) {
  const { canWrite, islandById } = useData();
  const [hover, setHover] = useState<{ techId: number | null; minutes: number } | null>(null);

  const dayJobs = jobs.filter((j) => j.start_at?.startsWith(date));
  const [startHour, endHour] = useMemo(() => {
    let s = 6;
    let e = 19;
    for (const j of dayJobs) {
      s = Math.min(s, Math.floor(minutesOf(j.start_at!) / 60));
      const endM = j.end_at!.slice(0, 10) > date ? 24 * 60 : minutesOf(j.end_at!);
      e = Math.max(e, Math.ceil(endM / 60));
    }
    return [s, Math.min(24, e)];
  }, [dayJobs, date]);
  const span = (endHour - startHour) * 60;
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const pct = (m: number) => `${((m - startHour * 60) / span) * 100}%`;

  const unassigned = dayJobs.filter((j) => !j.technician_id || !techs.some((t) => t.id === j.technician_id));
  const rows: (BoardTech | null)[] = [...techs, ...(unassigned.length ? [null] : [])];

  const minutesAt = (e: DragEvent | MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const raw = startHour * 60 + ((e.clientX - r.left) / r.width) * span;
    return Math.max(startHour * 60, Math.min(endHour * 60 - SNAP, Math.floor(raw / SNAP) * SNAP));
  };

  const nowMin = date === today() ? new Date().getHours() * 60 + new Date().getMinutes() : null;

  return (
    <div className="day-view">
      <div className="day-grid" style={{ ['--hours' as string]: hours.length }}>
        <div className="day-corner" />
        <div className="day-hours">
          {hours.map((h) => (
            <div key={h} className="day-hour">
              {fmtTime(h * 60)}
            </div>
          ))}
        </div>

        {rows.map((tech) => {
          const loc = tech?.days[date];
          const here = !tech || (loc?.islandId === islandId);
          const off = here && loc?.status === 'off';
          const rowJobs = tech
            ? dayJobs.filter((j) => j.technician_id === tech.id)
            : unassigned;
          const laid = lanes(rowJobs);
          const laneCount = Math.max(1, ...laid.map((l) => l.lane + 1));
          const droppable = canWrite && here;
          const key = tech?.id ?? 'unassigned';
          return (
            <div className="day-row" key={key} style={{ height: laneCount * LANE_H + 10 }}>
              <div className="day-tech">
                {tech ? (
                  <TechLabel tech={tech} loc={loc} islandId={islandId} />
                ) : (
                  <div className="tech-label">
                    <span className="tech-name muted">Unassigned / elsewhere</span>
                  </div>
                )}
              </div>
              <div
                className={`day-track${!here ? ' away' : ''}${off ? ' off' : ''}`}
                onDragOver={(e) => {
                  if (!droppable || !isJobDrag(e)) return;
                  e.preventDefault();
                  setHover({ techId: tech?.id ?? null, minutes: minutesAt(e) });
                }}
                onDragLeave={() => setHover(null)}
                onDrop={(e) => {
                  setHover(null);
                  const id = draggedJobId(e);
                  if (!droppable || id == null) return;
                  e.preventDefault();
                  onDropJob(id, { techId: tech?.id ?? null, date, minutes: minutesAt(e) });
                }}
                onClick={(e) => canWrite && here && onCreate(tech?.id ?? null, date, minutesAt(e))}
              >
                {hours.map((h) => (
                  <div key={h} className="day-cell" />
                ))}
                {!here && loc && <div className="track-note">{dayStateLabel(loc, islandId, islandById)}</div>}
                {off && <div className="track-note">🌴 Time off</div>}
                {nowMin != null && nowMin >= startHour * 60 && nowMin < endHour * 60 && (
                  <div className="now-line" style={{ left: pct(nowMin) }} />
                )}
                {hover && hover.techId === (tech?.id ?? null) && (
                  <div className="drop-ghost" style={{ left: pct(hover.minutes) }}>
                    {fmtTime(hover.minutes)}
                  </div>
                )}
                {laid.map(({ job, lane }) => {
                  const s = minutesOf(job.start_at!);
                  const endM = job.end_at!.slice(0, 10) > date ? endHour * 60 : minutesOf(job.end_at!);
                  const e = Math.min(endHour * 60, Math.max(s + 30, endM));
                  return (
                    <JobCard
                      key={job.id}
                      job={job}
                      tech={tech ?? undefined}
                      showTech={!tech}
                      onOpen={onOpenJob}
                      draggable={canWrite}
                      style={{
                        position: 'absolute',
                        left: pct(s),
                        width: `calc(${pct(e)} - ${pct(s)} - 3px)`,
                        top: 5 + lane * LANE_H,
                        height: LANE_H - 4,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
        {!rows.length && (
          <div className="empty-row">
            No technicians are working on this island on this day. Use <strong>+ Travel</strong> to bring someone over.
          </div>
        )}
      </div>
      <p className="hint-line">
        Click an empty slot to create a job at that time · Drag jobs to move or reassign · Snaps to {SNAP} min
      </p>
    </div>
  );
}
