import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Board, ViewMode } from '../types';
import { addMinutes, at, diffMinutes, fmtDayShort, minutesOf, shiftAnchor, today, viewRange, viewTitle } from '../dates';
import { useData, useToast } from '../ui';
import DayView from '../components/DayView';
import WeekView from '../components/WeekView';
import MonthView from '../components/MonthView';
import JobModal, { saveJobWithConfirm, type JobDraft } from '../components/JobModal';
import TravelModal, { type TravelDraft } from '../components/TravelModal';
import { JobCard, draggedJobId, isJobDrag } from '../components/JobCard';
import type { DropTarget } from '../components/shared';

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(`dispatch.${k}`);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(`dispatch.${k}`, v);
    } catch {
      /* ignore */
    }
  },
};

export default function BoardPage() {
  const { islands, skills, canWrite, islandById, skillById } = useData();
  const toast = useToast();
  const accessible = islands.filter((i) => i.accessible);

  const [islandId, setIslandId] = useState<number>(() => {
    const saved = Number(store.get('island'));
    return accessible.some((i) => i.id === saved) ? saved : (accessible[0]?.id ?? 0);
  });
  const [view, setView] = useState<ViewMode>(() => (store.get('view') as ViewMode) || 'week');
  const [anchor, setAnchor] = useState(today);
  const [skillFilter, setSkillFilter] = useState<number[]>([]);
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);
  const [jobDraft, setJobDraft] = useState<JobDraft | null>(null);
  const [travelDraft, setTravelDraft] = useState<TravelDraft | null>(null);
  const [sidebarHover, setSidebarHover] = useState(false);

  useEffect(() => store.set('island', String(islandId)), [islandId]);
  useEffect(() => store.set('view', view), [view]);

  const [start, end] = viewRange(view, anchor);

  const load = useCallback(async () => {
    if (!islandId) return;
    setLoading(true);
    try {
      setBoard(await api.get<Board>(`/api/board?island=${islandId}&start=${start}&end=${end}`));
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [islandId, start, end, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh every minute so multiple dispatchers stay in sync.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && !jobDraft && !travelDraft && load(), 60_000);
    return () => clearInterval(t);
  }, [load, jobDraft, travelDraft]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (jobDraft || travelDraft || e.metaKey || e.ctrlKey || e.altKey) return;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'd') setView('day');
      else if (k === 'w') setView('week');
      else if (k === 'm') setView('month');
      else if (k === 't') setAnchor(today());
      else if (e.key === 'ArrowLeft') setAnchor((a) => shiftAnchor(view, a, -1));
      else if (e.key === 'ArrowRight') setAnchor((a) => shiftAnchor(view, a, 1));
      else if (k === 'n' && canWrite) setJobDraft({ island_id: islandId, start_at: `${view === 'day' ? anchor : today()}T08:00` });
      else if (/^[1-9]$/.test(e.key) && accessible[Number(e.key) - 1]) setIslandId(accessible[Number(e.key) - 1].id);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, anchor, islandId, canWrite, jobDraft, travelDraft, accessible]);

  const techs = useMemo(() => {
    if (!board) return [];
    if (!skillFilter.length) return board.technicians;
    return board.technicians.filter((t) => skillFilter.every((s) => t.skills.some((ts) => ts.skill_id === s)));
  }, [board, skillFilter]);

  const visibleJobs = useMemo(() => {
    if (!board) return [];
    if (!skillFilter.length) return board.jobs;
    const ids = new Set(techs.map((t) => t.id));
    return board.jobs.filter((j) => !j.technician_id || ids.has(j.technician_id));
  }, [board, techs, skillFilter]);

  const findJob = (id: number) => board?.jobs.find((j) => j.id === id) ?? board?.unscheduled.find((j) => j.id === id);

  const dropJob = async (jobId: number, target: DropTarget) => {
    const job = findJob(jobId);
    if (!job) return;
    const duration = job.start_at && job.end_at ? diffMinutes(job.start_at, job.end_at) : job.duration_minutes;
    const minutes = target.minutes ?? (job.start_at ? minutesOf(job.start_at) : 8 * 60);
    const start_at = at(target.date, minutes);
    const end_at = addMinutes(start_at, duration);
    if (job.start_at === start_at && job.technician_id === target.techId) return;
    // Optimistic update so the drag feels instant.
    setBoard((b) =>
      b && {
        ...b,
        unscheduled: b.unscheduled.filter((j) => j.id !== jobId),
        jobs: [
          ...b.jobs.filter((j) => j.id !== jobId),
          { ...job, technician_id: target.techId, start_at, end_at, status: job.status === 'unscheduled' ? 'scheduled' : job.status },
        ],
      },
    );
    await saveJobWithConfirm(jobId, { technician_id: target.techId, start_at, end_at }, toast);
    load();
  };

  const unscheduleJob = async (jobId: number) => {
    const job = findJob(jobId);
    if (!job || !job.start_at) return;
    await saveJobWithConfirm(jobId, { start_at: null, end_at: null, status: 'unscheduled' }, toast);
    load();
  };

  const newJobAt = (techId: number | null, date: string, minutes = 8 * 60) =>
    setJobDraft({ island_id: islandId, technician_id: techId, start_at: at(date, minutes), end_at: at(date, minutes + 120) });

  const openDay = (d: string) => {
    setAnchor(d);
    setView('day');
  };

  const island = islandById(islandId);
  const incoming = board?.travel.filter((t) => t.kind === 'travel' && t.island_id === islandId) ?? [];
  const outgoing = board?.travel.filter((t) => t.kind === 'travel' && t.island_id !== islandId) ?? [];
  const timeOff = board?.travel.filter((t) => t.kind === 'time_off') ?? [];
  const conflicts = board?.jobs.filter((j) => j.conflict) ?? [];

  if (!accessible.length) {
    return <div className="empty-page">Your account doesn't have access to any islands yet. Ask an admin to add you.</div>;
  }

  return (
    <div className="board" style={{ ['--island' as string]: island?.color }}>
      <div className="board-toolbar">
        <div className="island-tabs" role="tablist">
          {accessible.map((i, idx) => (
            <button
              key={i.id}
              role="tab"
              aria-selected={i.id === islandId}
              className={i.id === islandId ? 'on' : ''}
              style={{ ['--island' as string]: i.color }}
              onClick={() => setIslandId(i.id)}
              title={`Shortcut: ${idx + 1}`}
            >
              {i.name}
            </button>
          ))}
        </div>
      </div>

      <div className="board-toolbar board-toolbar-2">
        <div className="date-nav">
          <button className="btn" onClick={() => setAnchor(today())} title="Shortcut: T">
            Today
          </button>
          <button className="btn icon-btn" onClick={() => setAnchor((a) => shiftAnchor(view, a, -1))} aria-label="Previous" title="←">
            ‹
          </button>
          <button className="btn icon-btn" onClick={() => setAnchor((a) => shiftAnchor(view, a, 1))} aria-label="Next" title="→">
            ›
          </button>
          <input
            type="date"
            className="date-jump"
            value={anchor}
            onChange={(e) => e.target.value && setAnchor(e.target.value)}
            aria-label="Jump to date"
          />
          <h1 className="view-title">
            {viewTitle(view, anchor)}
            {loading && <span className="spinner" aria-label="Loading" />}
          </h1>
        </div>
        <div className="toolbar-right">
          <div className="segmented">
            {(['day', 'week', 'month'] as ViewMode[]).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)} title={`Shortcut: ${v[0].toUpperCase()}`}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <select
            className="skill-filter"
            value=""
            onChange={(e) => e.target.value && setSkillFilter((f) => [...f, Number(e.target.value)])}
            aria-label="Filter technicians by skill"
          >
            <option value="">Filter by skill…</option>
            {skills
              .filter((s) => !skillFilter.includes(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
          {canWrite && (
            <>
              <button className="btn" onClick={() => setTravelDraft({ island_id: islandId, start_date: view === 'day' ? anchor : today() })}>
                ✈ Travel / Off
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setJobDraft({ island_id: islandId, start_at: `${view === 'day' ? anchor : today()}T08:00` })}
                title="Shortcut: N"
              >
                + New job
              </button>
            </>
          )}
        </div>
      </div>

      {skillFilter.length > 0 && (
        <div className="filter-bar">
          Showing technicians with:
          {skillFilter.map((s) => (
            <button key={s} className="chip on" onClick={() => setSkillFilter((f) => f.filter((x) => x !== s))}>
              {skillById(s)?.name} ×
            </button>
          ))}
          <button className="link" onClick={() => setSkillFilter([])}>
            Clear
          </button>
        </div>
      )}

      <div className="board-body">
        <div className="board-main">
          {board &&
            (view === 'day' ? (
              <DayView
                date={anchor}
                islandId={islandId}
                techs={techs}
                jobs={visibleJobs}
                onOpenJob={setJobDraft}
                onCreate={newJobAt}
                onDropJob={dropJob}
              />
            ) : view === 'week' ? (
              <WeekView
                days={board.days}
                islandId={islandId}
                techs={techs}
                jobs={visibleJobs}
                travel={board.travel}
                onOpenJob={setJobDraft}
                onCreate={(t, d) => newJobAt(t, d)}
                onDropJob={dropJob}
                onOpenDay={openDay}
              />
            ) : (
              <MonthView
                anchor={anchor}
                days={board.days}
                islandId={islandId}
                techs={techs}
                jobs={visibleJobs}
                travel={board.travel}
                onOpenJob={setJobDraft}
                onOpenDay={openDay}
                onDropJob={dropJob}
              />
            ))}
        </div>

        <aside className="board-side">
          <section
            className={`side-section unscheduled${sidebarHover ? ' drop-hover' : ''}`}
            onDragOver={(e) => {
              if (!canWrite || !isJobDrag(e)) return;
              e.preventDefault();
              setSidebarHover(true);
            }}
            onDragLeave={() => setSidebarHover(false)}
            onDrop={(e) => {
              setSidebarHover(false);
              const id = draggedJobId(e);
              if (id != null) unscheduleJob(id);
            }}
          >
            <h3>
              Unscheduled <span className="count">{board?.unscheduled.length ?? 0}</span>
            </h3>
            <p className="side-hint">Drag onto the board to schedule. Drop a job here to unschedule it.</p>
            {board?.unscheduled.map((j) => (
              <JobCard key={j.id} job={j} onOpen={setJobDraft} draggable={canWrite} />
            ))}
            {board && !board.unscheduled.length && <p className="muted small">Nothing waiting 🎉</p>}
            {canWrite && (
              <button className="btn btn-small btn-block" onClick={() => setJobDraft({ island_id: islandId, status: 'unscheduled' })}>
                + Add to queue
              </button>
            )}
          </section>

          {conflicts.length > 0 && (
            <section className="side-section conflicts">
              <h3>
                ⚠ Needs attention <span className="count">{conflicts.length}</span>
              </h3>
              {conflicts.map((j) => (
                <button key={j.id} className="side-item" onClick={() => setJobDraft(j)}>
                  <strong>{j.title}</strong>
                  <span>{j.conflict}</span>
                </button>
              ))}
            </section>
          )}

          <section className="side-section">
            <h3>✈ Visiting {island?.name}</h3>
            {incoming.length ? (
              incoming.map((t) => (
                <button key={t.id} className="side-item" onClick={() => setTravelDraft(t)}>
                  <strong>{t.technician_name}</strong>
                  <span>
                    from {t.home_island_name} · {fmtDayShort(t.start_date)}
                    {t.end_date !== t.start_date && ` – ${fmtDayShort(t.end_date)}`}
                  </span>
                </button>
              ))
            ) : (
              <p className="muted small">No visitors in this period.</p>
            )}
          </section>

          <section className="side-section">
            <h3>🛫 Away from {island?.name}</h3>
            {outgoing.length ? (
              outgoing.map((t) => (
                <button key={t.id} className="side-item" onClick={() => setTravelDraft(t)}>
                  <strong>{t.technician_name}</strong>
                  <span>
                    on {t.island_name} · {fmtDayShort(t.start_date)}
                    {t.end_date !== t.start_date && ` – ${fmtDayShort(t.end_date)}`}
                  </span>
                </button>
              ))
            ) : (
              <p className="muted small">Everyone is home.</p>
            )}
          </section>

          {timeOff.length > 0 && (
            <section className="side-section">
              <h3>🌴 Time off</h3>
              {timeOff.map((t) => (
                <button key={t.id} className="side-item" onClick={() => setTravelDraft(t)}>
                  <strong>{t.technician_name}</strong>
                  <span>
                    {fmtDayShort(t.start_date)}
                    {t.end_date !== t.start_date && ` – ${fmtDayShort(t.end_date)}`}
                    {t.notes && ` · ${t.notes}`}
                  </span>
                </button>
              ))}
            </section>
          )}

          <p className="shortcuts muted small">
            Shortcuts: <kbd>D</kbd>/<kbd>W</kbd>/<kbd>M</kbd> view · <kbd>←</kbd>/<kbd>→</kbd> move · <kbd>T</kbd> today ·{' '}
            <kbd>N</kbd> new job · <kbd>1</kbd>–<kbd>9</kbd> island
          </p>
        </aside>
      </div>

      {jobDraft && <JobModal draft={jobDraft} onClose={() => setJobDraft(null)} onSaved={load} />}
      {travelDraft && (
        <TravelModal
          draft={travelDraft}
          onClose={() => setTravelDraft(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
