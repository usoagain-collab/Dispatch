import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import type { Board, BoardTech, Job, JobStatus, Priority } from '../types';
import { JOB_TYPES, PRIORITIES, STATUS_LABEL, STATUSES } from '../types';
import { addMinutes, diffMinutes, fmtDayShort, fmtDuration, today } from '../dates';
import { Field, Modal, SkillPicker, useData, useToast } from '../ui';

export type JobDraft = Partial<Job> & { island_id: number };

const DURATIONS = [30, 60, 90, 120, 150, 180, 240, 300, 360, 420, 480, 540, 600];

/** Save a job, asking the dispatcher to confirm if the tech has time off. Returns false if cancelled/failed. */
export async function saveJobWithConfirm(
  id: number | undefined,
  body: Record<string, unknown>,
  toast: ReturnType<typeof useToast>,
): Promise<Job | null> {
  const send = (force: boolean) =>
    id
      ? api.put<{ job: Job; warnings: string[] }>(`/api/jobs/${id}`, { ...body, force })
      : api.post<{ job: Job; warnings: string[] }>('/api/jobs', { ...body, force });
  try {
    let res;
    try {
      res = await send(false);
    } catch (err) {
      if (err instanceof ApiError && err.body.needsConfirm) {
        if (!window.confirm(`${err.message}\n\nSchedule anyway?`)) return null;
        res = await send(true);
      } else throw err;
    }
    if (res.warnings.length) toast('warn', 'Saved with warnings', res.warnings);
    else toast('ok', 'Saved');
    return res.job;
  } catch (err) {
    toast('error', (err as Error).message);
    return null;
  }
}

interface TechOption {
  tech: BoardTech;
  available: boolean;
  reason: string;
  missing: string[];
}

export default function JobModal({
  draft,
  onClose,
  onSaved,
}: {
  draft: JobDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { islands, skills, techs, canWrite, islandById, skillById } = useData();
  const toast = useToast();
  const isNew = !draft.id;

  const initialDate = draft.start_at?.slice(0, 10) ?? '';
  const initialTime = draft.start_at?.slice(11, 16) ?? '08:00';
  const initialDuration =
    draft.start_at && draft.end_at ? diffMinutes(draft.start_at, draft.end_at) : (draft.duration_minutes ?? 120);

  const [f, setF] = useState({
    title: draft.title ?? '',
    customer_name: draft.customer_name ?? '',
    customer_phone: draft.customer_phone ?? '',
    address: draft.address ?? '',
    job_type: draft.job_type ?? 'Service',
    priority: (draft.priority ?? 'normal') as Priority,
    status: (draft.status ?? (draft.start_at ? 'scheduled' : 'unscheduled')) as JobStatus,
    island_id: draft.island_id,
    technician_id: draft.technician_id ?? null,
    date: initialDate,
    time: initialTime,
    duration: initialDuration,
    notes: draft.notes ?? '',
    skill_ids: draft.skill_ids ?? [],
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [dayTechs, setDayTechs] = useState<BoardTech[] | null>(null);

  // Who is on this island on the chosen date?
  useEffect(() => {
    if (!f.date) {
      setDayTechs(null);
      return;
    }
    let cancelled = false;
    api
      .get<Board>(`/api/board?island=${f.island_id}&start=${f.date}&end=${f.date}`)
      .then((b) => !cancelled && setDayTechs(b.technicians))
      .catch(() => !cancelled && setDayTechs([]));
    return () => {
      cancelled = true;
    };
  }, [f.island_id, f.date]);

  const techOptions: TechOption[] = useMemo(() => {
    if (!dayTechs) return [];
    return dayTechs
      .map((t) => {
        const loc = t.days[f.date];
        const have = new Set(t.skills.map((s) => s.skill_id));
        const missing = f.skill_ids.filter((s) => !have.has(s)).map((s) => skillById(s)?.name ?? '?');
        let available = true;
        let reason = '';
        if (!loc || loc.islandId !== f.island_id) {
          available = false;
          reason = `on ${islandById(loc?.islandId)?.name ?? 'another island'}`;
        } else if (loc.status === 'off') {
          available = false;
          reason = 'time off';
        } else if (loc.status === 'travel') {
          reason = `visiting from ${islandById(t.home_island_id)?.name}`;
        }
        return { tech: t, available, reason, missing };
      })
      .sort((a, b) => Number(b.available) - Number(a.available) || a.missing.length - b.missing.length);
  }, [dayTechs, f.date, f.island_id, f.skill_ids, islandById, skillById]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!f.title.trim()) {
      toast('error', 'Give the job a title');
      return;
    }
    setBusy(true);
    const start_at = f.date ? `${f.date}T${f.time || '08:00'}` : null;
    const body = {
      title: f.title,
      customer_name: f.customer_name,
      customer_phone: f.customer_phone,
      address: f.address,
      job_type: f.job_type,
      priority: f.priority,
      status: f.status,
      island_id: f.island_id,
      technician_id: f.technician_id,
      start_at,
      end_at: start_at ? addMinutes(start_at, f.duration) : null,
      duration_minutes: f.duration,
      notes: f.notes,
      skill_ids: f.skill_ids,
    };
    const saved = await saveJobWithConfirm(draft.id, body, toast);
    setBusy(false);
    if (saved) {
      onSaved();
      onClose();
    }
  };

  const remove = async () => {
    if (!draft.id || !window.confirm(`Delete "${f.title}"? This can't be undone.`)) return;
    try {
      await api.del(`/api/jobs/${draft.id}`);
      toast('ok', 'Job deleted');
      onSaved();
      onClose();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  const selectedTech = techOptions.find((o) => o.tech.id === f.technician_id);
  const accessible = islands.filter((i) => i.accessible);
  const durations = DURATIONS.includes(f.duration) ? DURATIONS : [...DURATIONS, f.duration].sort((a, b) => a - b);

  return (
    <Modal
      title={isNew ? 'New job' : 'Edit job'}
      onClose={onClose}
      width={760}
      footer={
        canWrite ? (
          <>
            {!isNew && (
              <button className="btn btn-danger-ghost" onClick={remove} type="button">
                Delete
              </button>
            )}
            <span className="spacer" />
            <button className="btn" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" form="job-form" disabled={busy}>
              {busy ? 'Saving…' : isNew ? 'Create job' : 'Save'}
            </button>
          </>
        ) : (
          <button className="btn" onClick={onClose}>
            Close
          </button>
        )
      }
    >
      <form id="job-form" className="form-grid" onSubmit={submit}>
        <fieldset disabled={!canWrite} className="form-grid-inner">
          <Field label="Job title" wide>
            <input value={f.title} onChange={(e) => set('title', e.target.value)} autoFocus={isNew} placeholder="e.g. AC not cooling" />
          </Field>
          <Field label="Customer">
            <input value={f.customer_name} onChange={(e) => set('customer_name', e.target.value)} />
          </Field>
          <Field label="Phone">
            <input value={f.customer_phone} onChange={(e) => set('customer_phone', e.target.value)} inputMode="tel" />
          </Field>
          <Field label="Address" wide>
            <input value={f.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="Island">
            <select value={f.island_id} onChange={(e) => set('island_id', Number(e.target.value))}>
              {accessible.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select value={f.job_type} onChange={(e) => set('job_type', e.target.value)}>
              {[...new Set([...JOB_TYPES, f.job_type])].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <div className="segmented">
              {PRIORITIES.map((p) => (
                <button
                  type="button"
                  key={p}
                  className={`${f.priority === p ? 'on' : ''} seg-${p}`}
                  onClick={() => set('priority', p)}
                >
                  {p[0].toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Status">
            <select value={f.status} onChange={(e) => set('status', e.target.value as JobStatus)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>

          <div className="form-section field-wide">
            <div className="form-section-title">Schedule</div>
            <div className="row-fields">
              <Field label="Date" hint={f.date ? fmtDayShort(f.date) : 'Leave empty to keep unscheduled'}>
                <div className="inline">
                  <input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
                  {!f.date && (
                    <button type="button" className="btn btn-small" onClick={() => set('date', today())}>
                      Today
                    </button>
                  )}
                  {f.date && (
                    <button type="button" className="btn btn-small" onClick={() => set('date', '')}>
                      Clear
                    </button>
                  )}
                </div>
              </Field>
              <Field label="Start time">
                <input type="time" step={900} value={f.time} onChange={(e) => set('time', e.target.value)} disabled={!f.date} />
              </Field>
              <Field label="Duration">
                <select value={f.duration} onChange={(e) => set('duration', Number(e.target.value))}>
                  {durations.map((d) => (
                    <option key={d} value={d}>
                      {fmtDuration(d)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <Field
            label="Technician"
            wide
            hint={!f.date ? 'Pick a date to see who is working on this island that day' : undefined}
          >
            {f.date ? (
              <div className="tech-options">
                <button
                  type="button"
                  className={`tech-option${f.technician_id == null ? ' on' : ''}`}
                  onClick={() => set('technician_id', null)}
                >
                  <span className="tech-option-name">Unassigned</span>
                </button>
                {dayTechs == null && <span className="muted">Checking who's available…</span>}
                {techOptions.map(({ tech, available, reason, missing }) => (
                  <button
                    type="button"
                    key={tech.id}
                    disabled={!available && reason !== 'time off'}
                    className={`tech-option${f.technician_id === tech.id ? ' on' : ''}${available ? '' : ' unavailable'}`}
                    onClick={() => set('technician_id', tech.id)}
                  >
                    <span className="dot" style={{ background: tech.color }} />
                    <span className="tech-option-name">{tech.name}</span>
                    {reason && <span className="tech-option-reason">{reason}</span>}
                    {f.skill_ids.length > 0 &&
                      (missing.length ? (
                        <span className="tech-option-missing" title={`Missing: ${missing.join(', ')}`}>
                          missing {missing.length}
                        </span>
                      ) : (
                        <span className="tech-option-match">✓ skills</span>
                      ))}
                  </button>
                ))}
                {dayTechs && !techOptions.length && <span className="muted">No technicians on this island that day.</span>}
              </div>
            ) : (
              <select
                value={f.technician_id ?? ''}
                onChange={(e) => set('technician_id', e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Unassigned</option>
                {techs
                  .filter((t) => t.active || t.id === f.technician_id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            )}
            {selectedTech && selectedTech.missing.length > 0 && (
              <div className="form-warn">
                {selectedTech.tech.name} is missing: {selectedTech.missing.join(', ')}
              </div>
            )}
          </Field>

          <Field label="Required skills" wide>
            <SkillPicker
              skills={skills}
              selected={f.skill_ids}
              onToggle={(id) =>
                set('skill_ids', f.skill_ids.includes(id) ? f.skill_ids.filter((x) => x !== id) : [...f.skill_ids, id])
              }
            />
          </Field>

          <Field label="Notes" wide>
            <textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </fieldset>
      </form>
    </Modal>
  );
}
