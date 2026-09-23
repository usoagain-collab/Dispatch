import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';
import type { Island, Skill, Technician, User } from './types';
import { DataContext, type AppData } from './ui';
import Login from './pages/Login';
import BoardPage from './pages/Board';
import TechniciansPage from './pages/Technicians';
import TravelPage from './pages/Travel';
import JobsPage from './pages/Jobs';
import SettingsPage from './pages/Settings';

type Page = 'board' | 'techs' | 'travel' | 'jobs' | 'settings';
const PAGES: { id: Page; label: string }[] = [
  { id: 'board', label: 'Dispatch Board' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'techs', label: 'Technicians' },
  { id: 'travel', label: 'Travel & Time Off' },
  { id: 'settings', label: 'Settings' },
];

function pageFromHash(): Page {
  const h = window.location.hash.replace('#/', '').split('?')[0];
  return (PAGES.some((p) => p.id === h) ? h : 'board') as Page;
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [islands, setIslands] = useState<Island[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [techs, setTechs] = useState<Technician[]>([]);
  const [page, setPage] = useState<Page>(pageFromHash);
  const [refsLoaded, setRefsLoaded] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api
      .get<User>('/api/me')
      .then(setUser)
      .catch(() => setUser(null));
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const reloadRefs = useCallback(async () => {
    const [i, s, t] = await Promise.all([
      api.get<Island[]>('/api/islands'),
      api.get<Skill[]>('/api/skills'),
      api.get<Technician[]>('/api/technicians?all=1'),
    ]);
    setIslands(i);
    setSkills(s);
    setTechs(t);
    setRefsLoaded(true);
  }, []);

  useEffect(() => {
    if (user) reloadRefs();
  }, [user, reloadRefs]);

  const data: AppData | null = useMemo(() => {
    if (!user) return null;
    const iMap = new Map(islands.map((i) => [i.id, i]));
    const sMap = new Map(skills.map((s) => [s.id, s]));
    return {
      user,
      islands,
      skills,
      techs,
      canWrite: user.role !== 'viewer',
      reloadRefs,
      islandById: (id) => (id == null ? undefined : iMap.get(id)),
      skillById: (id) => sMap.get(id),
    };
  }, [user, islands, skills, techs, reloadRefs]);

  if (user === undefined) return <div className="splash">Loading…</div>;
  if (!user || !data) return <Login onLogin={setUser} />;

  const go = (p: Page) => {
    window.location.hash = `#/${p}`;
  };

  const logout = async () => {
    await api.post('/api/logout').catch(() => {});
    setUser(null);
  };

  return (
    <DataContext.Provider value={data}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">🌺</span> Island Dispatch
          </div>
          <nav className="nav">
            {PAGES.filter((p) => p.id !== 'settings' || user.role === 'admin').map((p) => (
              <button key={p.id} className={page === p.id ? 'active' : ''} onClick={() => go(p.id)}>
                {p.label}
              </button>
            ))}
          </nav>
          <div className="topbar-user">
            <span title={user.role}>{user.name}</span>
            {user.role !== 'admin' && (
              <button className="link" onClick={() => go('settings')}>
                Account
              </button>
            )}
            <button className="link" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>
        <main className="main">
          {!refsLoaded ? (
            <div className="splash">Loading…</div>
          ) : !islands.length && page !== 'settings' ? (
            <div className="empty-page">
              No islands set up yet.{' '}
              {user.role === 'admin' ? (
                <button className="link" onClick={() => go('settings')}>
                  Add your islands in Settings
                </button>
              ) : (
                'Ask an admin to add them.'
              )}
            </div>
          ) : page === 'board' ? (
            <BoardPage />
          ) : page === 'techs' ? (
            <TechniciansPage />
          ) : page === 'travel' ? (
            <TravelPage />
          ) : page === 'jobs' ? (
            <JobsPage />
          ) : (
            <SettingsPage />
          )}
        </main>
      </div>
    </DataContext.Provider>
  );
}
