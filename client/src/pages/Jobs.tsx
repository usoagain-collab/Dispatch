import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Job, JobStatus } from '../types';
import { STATUS_LABEL, STATUSES } from '../types';
import { fmtDayShort, fmtTime } from '../dates';
import { IslandDot, useData, useToast } from '../ui';
import JobModal, { type JobDraft } from '../components/JobModal';

export default function JobsPage() {
  const { islands, techs, canWrite, islandById } = useData();
  const toast = useToast();
  const accessible = islands.filter((i) => i.accessible);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [q, setQ] = useState('');
  const [island, setIsland] = useState(0);
  const [status, setStatus] = useState<'' | JobStatus>('');
  const [draft, setDraft] = useState<JobDraft | null>(null);

  const load = () => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (island) p.set('island', String(island));
    if (status) p.set('status', status);
    api
      .get<Job[]>(`/api/jobs?${p}`)
      .then(setJobs)
      .catch((e) => toast('error', e.message));
  };
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q, island, status]);

  const techName = (id: number | null) => techs.find((t) => t.id === id)?.name;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Jobs</h1>
        {canWrite && accessible.length > 0 && (
          <button className="btn btn-primary" onClick={() => setDraft({ island_id: island || accessible[0].id })}>
            + New job
          </button>
        )}
      </div>
      <div className="filters">
        <input placeholder="Search customer, address, phone, title…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <select value={island} onChange={(e) => setIsland(Number(e.target.value))}>
          <option value={0}>All my islands</option>
          {accessible.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as JobStatus | '')}>
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Job</th>
              <th>Customer</th>
              <th>Island</th>
              <th>Technician</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} onClick={() => setDraft(j)}>
                <td className="nowrap">
                  {j.start_at ? (
                    <>
                      {fmtDayShort(j.start_at.slice(0, 10))} <span className="muted">{fmtTime(j.start_at)}</span>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {j.priority === 'emergency' && <span className="badge badge-emergency">EMERG</span>}{' '}
                  {j.priority === 'high' && <span className="badge badge-high">HIGH</span>} <strong>{j.title}</strong>
                  <div className="muted small">{j.job_type}</div>
                </td>
                <td>
                  {j.customer_name}
                  <div className="muted small">{j.address}</div>
                </td>
                <td className="nowrap">
                  <IslandDot island={islandById(j.island_id)} /> {islandById(j.island_id)?.name}
                </td>
                <td>{techName(j.technician_id) ?? <span className="muted">Unassigned</span>}</td>
                <td>
                  <span className={`status status-${j.status}`}>{STATUS_LABEL[j.status]}</span>
                </td>
              </tr>
            ))}
            {!jobs.length && (
              <tr>
                <td colSpan={6} className="muted center">
                  No jobs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {jobs.length >= 200 && <p className="muted small">Showing the first 200 matches — narrow your search to see more.</p>}
      {draft && <JobModal draft={draft} onClose={() => setDraft(null)} onSaved={load} />}
    </div>
  );
}
