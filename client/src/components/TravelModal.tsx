import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Travel } from '../types';
import { addDays, daysBetween, fmtDayShort, today } from '../dates';
import { Field, Modal, useData, useToast } from '../ui';

export type TravelDraft = Partial<Travel>;

export default function TravelModal({
  draft,
  onClose,
  onSaved,
}: {
  draft: TravelDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { techs, islands, islandById, canWrite, user } = useData();
  const toast = useToast();
  const isNew = !draft.id;
  const [f, setF] = useState({
    technician_id: draft.technician_id ?? 0,
    kind: draft.kind ?? 'travel',
    island_id: draft.island_id ?? 0,
    start_date: draft.start_date ?? today(),
    end_date: draft.end_date ?? draft.start_date ?? today(),
    notes: draft.notes ?? '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const [busy, setBusy] = useState(false);

  const tech = techs.find((t) => t.id === f.technician_id);
  const destinations = islands.filter((i) => i.id !== tech?.home_island_id);
  const nights = daysBetween(f.start_date, f.end_date) + 1;

  // Group active techs by home island, the user's islands first.
  const groups = islands
    .map((i) => ({ island: i, list: techs.filter((t) => t.home_island_id === i.id && (t.active || t.id === f.technician_id)) }))
    .filter((g) => g.list.length)
    .sort((a, b) => Number(user.islandIds.includes(b.island.id)) - Number(user.islandIds.includes(a.island.id)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.technician_id) return toast('error', 'Pick a technician');
    if (f.kind === 'travel' && !f.island_id) return toast('error', 'Pick where they are going');
    setBusy(true);
    try {
      const body = { ...f, island_id: f.kind === 'travel' ? f.island_id : null };
      const res = draft.id
        ? await api.put<{ warnings: string[] }>(`/api/travel/${draft.id}`, body)
        : await api.post<{ warnings: string[] }>('/api/travel', body);
      if (res.warnings.length) toast('warn', 'Saved — check these jobs', res.warnings);
      else toast('ok', f.kind === 'travel' ? 'Travel saved' : 'Time off saved');
      onSaved();
      onClose();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft.id || !window.confirm('Delete this entry?')) return;
    try {
      const res = await api.del<{ warnings: string[] }>(`/api/travel/${draft.id}`);
      if (res.warnings.length) toast('warn', 'Deleted — check these jobs', res.warnings);
      else toast('ok', 'Deleted');
      onSaved();
      onClose();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  return (
    <Modal
      title={isNew ? 'Add travel or time off' : f.kind === 'travel' ? 'Edit travel' : 'Edit time off'}
      onClose={onClose}
      footer={
        canWrite && (
          <>
            {!isNew && (
              <button className="btn btn-danger-ghost" type="button" onClick={remove}>
                Delete
              </button>
            )}
            <span className="spacer" />
            <button className="btn" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" form="travel-form" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        )
      }
    >
      <form id="travel-form" className="form-grid" onSubmit={submit}>
        <fieldset disabled={!canWrite} className="form-grid-inner">
          <Field label="What" wide>
            <div className="segmented segmented-lg">
              <button type="button" className={f.kind === 'travel' ? 'on' : ''} onClick={() => set('kind', 'travel')}>
                ✈ Travel to another island
              </button>
              <button type="button" className={f.kind === 'time_off' ? 'on' : ''} onClick={() => set('kind', 'time_off')}>
                🌴 Time off
              </button>
            </div>
          </Field>
          <Field label="Technician" wide>
            <select
              value={f.technician_id}
              onChange={(e) => {
                const id = Number(e.target.value);
                const home = techs.find((t) => t.id === id)?.home_island_id;
                setF((p) => ({ ...p, technician_id: id, island_id: p.island_id === home ? 0 : p.island_id }));
              }}
              autoFocus={isNew}
            >
              <option value={0}>Choose…</option>
              {groups.map((g) => (
                <optgroup key={g.island.id} label={`${g.island.name} (home)`}>
                  {g.list.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          {f.kind === 'travel' && (
            <Field label="Working on" wide hint={tech ? `Home island: ${islandById(tech.home_island_id)?.name}` : undefined}>
              <div className="island-picker">
                {destinations.map((i) => (
                  <button
                    type="button"
                    key={i.id}
                    className={f.island_id === i.id ? 'on' : ''}
                    style={{ ['--island' as string]: i.color }}
                    onClick={() => set('island_id', i.id)}
                  >
                    {i.name}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label="From">
            <input
              type="date"
              value={f.start_date}
              onChange={(e) => {
                const v = e.target.value;
                setF((p) => ({ ...p, start_date: v, end_date: p.end_date < v ? v : p.end_date }));
              }}
            />
          </Field>
          <Field label="Through (last day)">
            <input type="date" value={f.end_date} min={f.start_date} onChange={(e) => set('end_date', e.target.value)} />
          </Field>
          <div className="field-wide quick-dates">
            <span className="muted">Quick:</span>
            {[1, 2, 3, 5, 7, 14].map((n) => (
              <button type="button" key={n} className="btn btn-small" onClick={() => set('end_date', addDays(f.start_date, n - 1))}>
                {n} day{n > 1 ? 's' : ''}
              </button>
            ))}
          </div>
          {nights > 0 && tech && (
            <div className="field-wide summary-box">
              <strong>{tech.name}</strong>{' '}
              {f.kind === 'travel' ? (
                <>
                  will show on the <strong>{islandById(f.island_id)?.name ?? '…'}</strong> board and be hidden from{' '}
                  <strong>{islandById(tech.home_island_id)?.name}</strong>
                </>
              ) : (
                <>will be marked unavailable</>
              )}{' '}
              from <strong>{fmtDayShort(f.start_date)}</strong> through <strong>{fmtDayShort(f.end_date)}</strong> ({nights} day
              {nights > 1 ? 's' : ''}).
            </div>
          )}
          <Field label="Notes" wide>
            <input value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Flight, job, hotel…" />
          </Field>
        </fieldset>
      </form>
    </Modal>
  );
}
