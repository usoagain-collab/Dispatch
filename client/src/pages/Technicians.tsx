import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Technician } from '../types';
import { LEVEL_LABEL } from '../types';
import { today } from '../dates';
import { IslandDot, useData } from '../ui';
import TechModal from '../components/TechModal';

export default function TechniciansPage() {
  const { islands, skills, canWrite, islandById, skillById, reloadRefs } = useData();
  const [techs, setTechs] = useState<Technician[]>([]);
  const [q, setQ] = useState('');
  const [island, setIsland] = useState(0);
  const [skill, setSkill] = useState(0);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Partial<Technician> | null>(null);

  const load = () => api.get<Technician[]>(`/api/technicians?all=1&today=${today()}`).then(setTechs);
  useEffect(() => {
    load();
  }, []);

  const list = useMemo(
    () =>
      techs.filter(
        (t) =>
          (showInactive || t.active) &&
          (!q || `${t.name} ${t.phone} ${t.email}`.toLowerCase().includes(q.toLowerCase())) &&
          (!island || t.home_island_id === island || t.today?.islandId === island) &&
          (!skill || t.skills.some((s) => s.skill_id === skill)),
      ),
    [techs, q, island, skill, showInactive],
  );

  return (
    <div className="page">
      <div className="page-head">
        <h1>Technicians</h1>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            + Add technician
          </button>
        )}
      </div>
      <div className="filters">
        <input placeholder="Search name, phone, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={island} onChange={(e) => setIsland(Number(e.target.value))}>
          <option value={0}>All islands</option>
          {islands.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <select value={skill} onChange={(e) => setSkill(Number(e.target.value))}>
          <option value={0}>Any skill</option>
          {skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Home island</th>
              <th>Today</th>
              <th>Skills</th>
              <th>Contact</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => {
              const loc = t.today;
              return (
                <tr key={t.id} onClick={() => setEditing(t)} className={t.active ? '' : 'inactive'}>
                  <td>
                    <span className="dot" style={{ background: t.color }} /> <strong>{t.name}</strong>
                    {!t.active && <span className="tag">Inactive</span>}
                  </td>
                  <td>
                    <IslandDot island={islandById(t.home_island_id)} /> {islandById(t.home_island_id)?.name}
                  </td>
                  <td>
                    {loc?.status === 'off' ? (
                      <span className="tag tag-off">🌴 Off</span>
                    ) : loc?.status === 'travel' ? (
                      <span className="tag tag-travel">✈ {islandById(loc.islandId)?.name}</span>
                    ) : (
                      <span className="muted">Home</span>
                    )}
                  </td>
                  <td>
                    <div className="chips">
                      {t.skills.map((s) => (
                        <span key={s.skill_id} className={`chip lvl-${s.level}`} title={LEVEL_LABEL[s.level]}>
                          {skillById(s.skill_id)?.name}
                          {s.level === 3 ? ' ★' : s.level === 1 ? ' (T)' : ''}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="small">
                    {t.phone && <a href={`tel:${t.phone}`} onClick={(e) => e.stopPropagation()}>{t.phone}</a>}
                    {t.email && <div className="muted">{t.email}</div>}
                  </td>
                </tr>
              );
            })}
            {!list.length && (
              <tr>
                <td colSpan={5} className="muted center">
                  No technicians match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted small">★ Expert · (T) Trainee</p>

      {editing && (
        <TechModal
          tech={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            load();
            reloadRefs();
          }}
        />
      )}
    </div>
  );
}
