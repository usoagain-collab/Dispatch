import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Travel } from '../types';
import { addDays, daysBetween, fmtDayShort, today } from '../dates';
import { IslandDot, useData } from '../ui';
import TravelModal, { type TravelDraft } from '../components/TravelModal';

export default function TravelPage() {
  const { islands, canWrite, islandById } = useData();
  const [rows, setRows] = useState<Travel[]>([]);
  const [island, setIsland] = useState(0);
  const [kind, setKind] = useState<'' | 'travel' | 'time_off'>('');
  const [showPast, setShowPast] = useState(false);
  const [draft, setDraft] = useState<TravelDraft | null>(null);
  const t0 = today();

  const load = () => api.get<Travel[]>(`/api/travel?from=${addDays(t0, showPast ? -90 : 0)}`).then(setRows);
  useEffect(() => {
    load();
  }, [showPast]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) => (!kind || r.kind === kind) && (!island || r.island_id === island || r.home_island_id === island),
      ),
    [rows, kind, island],
  );
  const now = filtered.filter((r) => r.start_date <= t0 && r.end_date >= t0);
  const upcoming = filtered.filter((r) => r.start_date > t0);
  const past = filtered.filter((r) => r.end_date < t0).reverse();

  const section = (title: string, list: Travel[]) =>
    list.length ? (
      <>
        <h2 className="section-title">
          {title} <span className="count">{list.length}</span>
        </h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Technician</th>
                <th>Type</th>
                <th>Where</th>
                <th>Dates</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const n = daysBetween(r.start_date, r.end_date) + 1;
                return (
                  <tr key={r.id} onClick={() => setDraft(r)}>
                    <td>
                      <strong>{r.technician_name}</strong>
                    </td>
                    <td>{r.kind === 'travel' ? <span className="tag tag-travel">✈ Travel</span> : <span className="tag tag-off">🌴 Time off</span>}</td>
                    <td>
                      {r.kind === 'travel' ? (
                        <>
                          <IslandDot island={islandById(r.home_island_id)} /> {r.home_island_name} →{' '}
                          <IslandDot island={islandById(r.island_id)} /> <strong>{r.island_name}</strong>
                        </>
                      ) : (
                        <span className="muted">{r.home_island_name}</span>
                      )}
                    </td>
                    <td>
                      {fmtDayShort(r.start_date)}
                      {n > 1 && ` – ${fmtDayShort(r.end_date)}`} <span className="muted">({n}d)</span>
                    </td>
                    <td className="muted">{r.notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    ) : null;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Travel & Time Off</h1>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setDraft({ start_date: t0 })}>
            + Add travel / time off
          </button>
        )}
      </div>
      <p className="muted">
        A technician on travel appears on the destination island's board for those dates and is hidden from their home
        island. Time off greys them out.
      </p>
      <div className="filters">
        <select value={island} onChange={(e) => setIsland(Number(e.target.value))}>
          <option value={0}>All islands</option>
          {islands.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <div className="segmented">
          <button className={kind === '' ? 'on' : ''} onClick={() => setKind('')}>
            All
          </button>
          <button className={kind === 'travel' ? 'on' : ''} onClick={() => setKind('travel')}>
            Travel
          </button>
          <button className={kind === 'time_off' ? 'on' : ''} onClick={() => setKind('time_off')}>
            Time off
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Show last 90 days
        </label>
      </div>
      {section('Happening now', now)}
      {section('Upcoming', upcoming)}
      {showPast && section('Past', past)}
      {!now.length && !upcoming.length && (!showPast || !past.length) && (
        <div className="empty-page">No travel or time off scheduled.</div>
      )}
      {draft && <TravelModal draft={draft} onClose={() => setDraft(null)} onSaved={load} />}
    </div>
  );
}
