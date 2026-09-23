import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Technician, Travel } from '../types';
import { addDays, fmtDayShort, today } from '../dates';
import { Field, IslandDot, Modal, SkillPicker, useData, useToast } from '../ui';
import TravelModal, { type TravelDraft } from './TravelModal';

const COLORS = ['#0ea5e9', '#f97316', '#14b8a6', '#a855f7', '#22c55e', '#ec4899', '#eab308', '#ef4444', '#6366f1', '#84cc16', '#06b6d4', '#f43f5e'];

export default function TechModal({
  tech,
  onClose,
  onSaved,
}: {
  tech: Partial<Technician>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { islands, skills, canWrite, islandById, user } = useData();
  const toast = useToast();
  const isNew = !tech.id;
  const accessible = islands.filter((i) => i.accessible);
  const [f, setF] = useState({
    name: tech.name ?? '',
    phone: tech.phone ?? '',
    email: tech.email ?? '',
    home_island_id: tech.home_island_id ?? accessible[0]?.id ?? 0,
    color: tech.color ?? COLORS[Math.floor(Math.random() * COLORS.length)],
    notes: tech.notes ?? '',
    active: tech.active ?? 1,
  });
  const [levels, setLevels] = useState<Record<number, number>>(
    Object.fromEntries((tech.skills ?? []).map((s) => [s.skill_id, s.level])),
  );
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [travel, setTravel] = useState<Travel[]>([]);
  const [travelDraft, setTravelDraft] = useState<TravelDraft | null>(null);

  const editable = canWrite && (isNew || user.islandIds.includes(tech.home_island_id!));

  const loadTravel = () => {
    if (tech.id) api.get<Travel[]>(`/api/travel?technician_id=${tech.id}&from=${addDays(today(), -30)}`).then(setTravel);
  };
  useEffect(loadTravel, [tech.id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        ...f,
        skills: Object.entries(levels).map(([skill_id, level]) => ({ skill_id: Number(skill_id), level })),
      };
      if (tech.id) await api.put(`/api/technicians/${tech.id}`, body);
      else await api.post('/api/technicians', body);
      toast('ok', 'Technician saved');
      onSaved();
      onClose();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        title={isNew ? 'Add technician' : tech.name}
        onClose={onClose}
        width={720}
        footer={
          editable && (
            <>
              <span className="spacer" />
              <button className="btn" type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit" form="tech-form" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </>
          )
        }
      >
        <form id="tech-form" className="form-grid" onSubmit={submit}>
          <fieldset disabled={!editable} className="form-grid-inner">
            <Field label="Name">
              <input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus={isNew} />
            </Field>
            <Field label="Home island">
              <select value={f.home_island_id} onChange={(e) => set('home_island_id', Number(e.target.value))}>
                {(isNew ? accessible : islands).map((i) => (
                  <option key={i.id} value={i.id} disabled={!i.accessible}>
                    {i.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Phone">
              <input value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
            </Field>
            <Field label="Email">
              <input value={f.email} onChange={(e) => set('email', e.target.value)} type="email" />
            </Field>
            <Field label="Board color" wide>
              <div className="color-row">
                {COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`swatch${f.color === c ? ' on' : ''}`}
                    style={{ background: c }}
                    onClick={() => set('color', c)}
                    aria-label={c}
                  />
                ))}
                <input type="color" value={f.color} onChange={(e) => set('color', e.target.value)} />
              </div>
            </Field>
            <Field label="Skills & certifications" wide hint="Click to add a skill, then set the level.">
              <SkillPicker
                skills={skills}
                selected={Object.keys(levels).map(Number)}
                levels={levels}
                onToggle={(id) =>
                  setLevels((l) => {
                    const next = { ...l };
                    if (id in next) delete next[id];
                    else next[id] = 2;
                    return next;
                  })
                }
                onLevel={(id, level) => setLevels((l) => ({ ...l, [id]: level }))}
              />
            </Field>
            <Field label="Notes" wide>
              <textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
            {!isNew && (
              <label className="check field-wide">
                <input type="checkbox" checked={!!f.active} onChange={(e) => set('active', e.target.checked ? 1 : 0)} />
                Active (inactive technicians are hidden from the board)
              </label>
            )}
          </fieldset>
        </form>

        {!isNew && (
          <div className="form-section">
            <div className="form-section-title">
              Travel & time off
              {canWrite && (
                <button
                  className="btn btn-small"
                  onClick={() => setTravelDraft({ technician_id: tech.id, start_date: today() })}
                >
                  + Add
                </button>
              )}
            </div>
            {travel.length ? (
              <ul className="mini-list">
                {travel.map((t) => (
                  <li key={t.id} onClick={() => setTravelDraft(t)}>
                    {t.kind === 'travel' ? (
                      <>
                        ✈ <IslandDot island={islandById(t.island_id)} /> {t.island_name}
                      </>
                    ) : (
                      <>🌴 Time off</>
                    )}
                    <span className="muted">
                      {fmtDayShort(t.start_date)}
                      {t.end_date !== t.start_date && ` – ${fmtDayShort(t.end_date)}`}
                    </span>
                    {t.notes && <span className="muted"> · {t.notes}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No upcoming travel or time off.</p>
            )}
          </div>
        )}
      </Modal>
      {travelDraft && (
        <TravelModal
          draft={travelDraft}
          onClose={() => setTravelDraft(null)}
          onSaved={() => {
            loadTravel();
            onSaved();
          }}
        />
      )}
    </>
  );
}
