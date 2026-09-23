import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Island, Role, Skill } from '../types';
import { Field, IslandDot, Modal, useData, useToast } from '../ui';

interface UserRow {
  id: number;
  username: string;
  name: string;
  role: Role;
  active: number;
  islandIds: number[];
}

export default function SettingsPage() {
  const { user } = useData();
  return (
    <div className="page">
      <div className="page-head">
        <h1>{user.role === 'admin' ? 'Settings' : 'Account'}</h1>
      </div>
      {user.role === 'admin' && (
        <>
          <UsersSection />
          <IslandsSection />
          <SkillsSection />
        </>
      )}
      <PasswordSection />
    </div>
  );
}

function PasswordSection() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/me/password', { current, next });
      toast('ok', 'Password changed');
      setCurrent('');
      setNext('');
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  return (
    <section className="card settings-card">
      <h2>Change my password</h2>
      <form className="inline-form" onSubmit={submit}>
        <input type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        <input type="password" placeholder="New password (8+ characters)" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <button className="btn btn-primary" disabled={!current || next.length < 8}>
          Change
        </button>
      </form>
    </section>
  );
}

// ---- users -------------------------------------------------------------------

function UsersSection() {
  const { islands, islandById } = useData();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [editing, setEditing] = useState<Partial<UserRow> | null>(null);
  const load = () => api.get<UserRow[]>('/api/users').then(setUsers);
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="card settings-card">
      <div className="card-head">
        <h2>Users</h2>
        <button className="btn btn-small" onClick={() => setEditing({ role: 'dispatcher', islandIds: [] })}>
          + Add user
        </button>
      </div>
      <p className="muted small">
        Dispatchers only see the boards and jobs for the islands you give them. Admins see everything. Viewers can look but
        not change anything.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Username</th>
            <th>Role</th>
            <th>Islands</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} onClick={() => setEditing(u)} className={u.active ? '' : 'inactive'}>
              <td>
                <strong>{u.name}</strong> {!u.active && <span className="tag">Disabled</span>}
              </td>
              <td>{u.username}</td>
              <td className="cap">{u.role}</td>
              <td>
                {u.role === 'admin'
                  ? 'All islands'
                  : u.islandIds.map((id) => (
                      <span key={id} className="nowrap">
                        <IslandDot island={islandById(id)} /> {islandById(id)?.name}{' '}
                      </span>
                    ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <UserModal row={editing} islands={islands} onClose={() => setEditing(null)} onSaved={load} />}
    </section>
  );
}

function UserModal({
  row,
  islands,
  onClose,
  onSaved,
}: {
  row: Partial<UserRow>;
  islands: Island[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    name: row.name ?? '',
    username: row.username ?? '',
    role: row.role ?? 'dispatcher',
    islandIds: row.islandIds ?? [],
    active: row.active ?? 1,
    password: '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const body = { ...f, active: !!f.active };
      if (row.id) await api.put(`/api/users/${row.id}`, body);
      else await api.post('/api/users', body);
      toast('ok', 'User saved');
      onSaved();
      onClose();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  return (
    <Modal
      title={row.id ? `Edit ${row.name}` : 'Add user'}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" form="user-form">
            Save
          </button>
        </>
      }
    >
      <form id="user-form" className="form-grid" onSubmit={submit}>
        <div className="form-grid-inner">
          <Field label="Name">
            <input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
          </Field>
          <Field label="Username">
            <input value={f.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Role" wide>
            <div className="segmented">
              {(['dispatcher', 'admin', 'viewer'] as Role[]).map((r) => (
                <button type="button" key={r} className={f.role === r ? 'on' : ''} onClick={() => set('role', r)}>
                  {r[0].toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
          </Field>
          {f.role !== 'admin' && (
            <Field label="Islands this user can see" wide>
              <div className="island-picker">
                {islands.map((i) => {
                  const on = f.islandIds.includes(i.id);
                  return (
                    <button
                      type="button"
                      key={i.id}
                      className={on ? 'on' : ''}
                      style={{ ['--island' as string]: i.color }}
                      onClick={() => set('islandIds', on ? f.islandIds.filter((x) => x !== i.id) : [...f.islandIds, i.id])}
                    >
                      {on ? '✓ ' : ''}
                      {i.name}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
          <Field label={row.id ? 'Reset password' : 'Password'} wide hint={row.id ? 'Leave blank to keep the current password' : '8+ characters'}>
            <input type="text" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
          </Field>
          {row.id && (
            <label className="check field-wide">
              <input type="checkbox" checked={!!f.active} onChange={(e) => set('active', e.target.checked ? 1 : 0)} /> Account
              enabled
            </label>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ---- islands -----------------------------------------------------------------

function IslandsSection() {
  const { islands, reloadRefs } = useData();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Island> | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      if (editing.id) await api.put(`/api/islands/${editing.id}`, editing);
      else await api.post('/api/islands', { ...editing, sort: islands.length });
      await reloadRefs();
      setEditing(null);
      toast('ok', 'Island saved');
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  const remove = async (i: Island) => {
    if (!window.confirm(`Delete ${i.name}?`)) return;
    try {
      await api.del(`/api/islands/${i.id}`);
      await reloadRefs();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  return (
    <section className="card settings-card">
      <div className="card-head">
        <h2>Islands</h2>
        <button className="btn btn-small" onClick={() => setEditing({ name: '', code: '', color: '#2563eb' })}>
          + Add island
        </button>
      </div>
      <ul className="settings-list">
        {islands.map((i) => (
          <li key={i.id}>
            <IslandDot island={i} /> <strong>{i.name}</strong> <span className="muted">{i.code}</span>
            <span className="spacer" />
            <button className="link" onClick={() => setEditing(i)}>
              Edit
            </button>
            <button className="link danger" onClick={() => remove(i)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <form className="inline-form" onSubmit={save}>
          <input placeholder="Island name" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
          <input placeholder="Code (e.g. OAH)" value={editing.code ?? ''} maxLength={6} onChange={(e) => setEditing({ ...editing, code: e.target.value })} style={{ width: 120 }} />
          <input type="color" value={editing.color ?? '#2563eb'} onChange={(e) => setEditing({ ...editing, color: e.target.value })} />
          <button className="btn btn-primary">Save</button>
          <button className="btn" type="button" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}

// ---- skills ------------------------------------------------------------------

function SkillsSection() {
  const { skills, reloadRefs } = useData();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Skill> | null>(null);
  const categories = [...new Set(skills.map((s) => s.category))];
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      if (editing.id) await api.put(`/api/skills/${editing.id}`, editing);
      else await api.post('/api/skills', editing);
      await reloadRefs();
      setEditing(null);
      toast('ok', 'Skill saved');
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  const remove = async (s: Skill) => {
    if (!window.confirm(`Delete "${s.name}"? It will be removed from every technician and job.`)) return;
    try {
      await api.del(`/api/skills/${s.id}`);
      await reloadRefs();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  return (
    <section className="card settings-card">
      <div className="card-head">
        <h2>Skills & certifications</h2>
        <button className="btn btn-small" onClick={() => setEditing({ name: '', category: categories[0] ?? 'General' })}>
          + Add skill
        </button>
      </div>
      {editing && (
        <form className="inline-form" onSubmit={save}>
          <input placeholder="Skill name" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
          <input
            placeholder="Category"
            list="skill-categories"
            value={editing.category ?? ''}
            onChange={(e) => setEditing({ ...editing, category: e.target.value })}
          />
          <datalist id="skill-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button className="btn btn-primary">Save</button>
          <button className="btn" type="button" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </form>
      )}
      {categories.map((c) => (
        <div key={c} className="skill-group">
          <div className="skill-group-name">{c}</div>
          <div className="chips">
            {skills
              .filter((s) => s.category === c)
              .map((s) => (
                <span key={s.id} className="chip chip-edit">
                  <button className="link" onClick={() => setEditing(s)}>
                    {s.name}
                  </button>
                  <button className="link danger" onClick={() => remove(s)} aria-label={`Delete ${s.name}`}>
                    ×
                  </button>
                </span>
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}
