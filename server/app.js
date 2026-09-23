import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { tx } from './db.js';
import {
  COOKIE,
  createSession,
  destroySession,
  hashPassword,
  loadUserAccess,
  userForRequest,
  verifyPassword,
} from './auth.js';
import { addDays, dateRange, isDate, locationOn, locationsForRange } from './location.js';

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const bad = (msg) => new HttpError(400, msg);
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const PRIORITIES = ['low', 'normal', 'high', 'emergency'];
const STATUSES = ['unscheduled', 'scheduled', 'in_progress', 'completed', 'cancelled'];
const MAX_BOARD_DAYS = 45;

function str(v, field, { max = 500, required = false } = {}) {
  if (v == null || v === '') {
    if (required) throw bad(`${field} is required`);
    return '';
  }
  if (typeof v !== 'string') throw bad(`${field} must be text`);
  const s = v.trim();
  if (required && !s) throw bad(`${field} is required`);
  if (s.length > max) throw bad(`${field} is too long (max ${max})`);
  return s;
}

function int(v, field, { required = false, nullable = false } = {}) {
  if (v == null || v === '') {
    if (required) throw bad(`${field} is required`);
    if (nullable) return null;
    return undefined;
  }
  const n = Number(v);
  if (!Number.isInteger(n)) throw bad(`${field} must be a whole number`);
  return n;
}

function date(v, field) {
  if (!isDate(v)) throw bad(`${field} must be a date (YYYY-MM-DD)`);
  return v;
}

function datetime(v, field) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !DATETIME_RE.test(v) || !isDate(v.slice(0, 10))) {
    throw bad(`${field} must be a date and time (YYYY-MM-DDTHH:MM)`);
  }
  return v;
}

function color(v, fallback) {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw bad('Color must look like #1a2b3c');
  return v;
}

function idList(v, field) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw bad(`${field} must be a list`);
  return [...new Set(v.map((x) => int(x, field, { required: true })))];
}

function fmtDate(d) {
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function createApp(db, { staticDir } = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // ---------------------------------------------------------------- helpers

  const islandName = (id) => db.prepare('SELECT name FROM islands WHERE id = ?').get(id)?.name ?? 'another island';

  function requireUser(req, _res, next) {
    const user = userForRequest(db, req);
    if (!user) return next(new HttpError(401, 'Please sign in'));
    req.user = user;
    next();
  }

  const requireWrite = (req, _res, next) =>
    next(req.user.role === 'viewer' ? new HttpError(403, 'Your account is read-only') : undefined);

  const requireAdmin = (req, _res, next) =>
    next(req.user.role !== 'admin' ? new HttpError(403, 'Only admins can do that') : undefined);

  function assertIsland(req, islandId) {
    if (!db.prepare('SELECT 1 FROM islands WHERE id = ?').get(islandId)) throw bad('Unknown island');
    if (!req.user.islandIds.includes(islandId)) {
      throw new HttpError(403, `You don't have access to ${islandName(islandId)}`);
    }
  }

  function getTech(id) {
    const t = db.prepare('SELECT * FROM technicians WHERE id = ?').get(id);
    if (!t) throw new HttpError(404, 'Technician not found');
    return t;
  }

  function techEntries(techId) {
    return db
      .prepare('SELECT * FROM travel WHERE technician_id = ? ORDER BY start_date')
      .all(techId);
  }

  function skillsByTech() {
    const map = new Map();
    for (const r of db.prepare('SELECT technician_id, skill_id, level FROM technician_skills').all()) {
      if (!map.has(r.technician_id)) map.set(r.technician_id, []);
      map.get(r.technician_id).push({ skill_id: r.skill_id, level: r.level });
    }
    return map;
  }

  function serializeJobs(rows) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const skills = new Map();
    const q = db.prepare(
      `SELECT job_id, skill_id FROM job_skills WHERE job_id IN (${ids.map(() => '?').join(',')})`,
    );
    for (const r of q.all(...ids)) {
      if (!skills.has(r.job_id)) skills.set(r.job_id, []);
      skills.get(r.job_id).push(r.skill_id);
    }
    return rows.map((r) => ({ ...r, skill_ids: skills.get(r.id) ?? [] }));
  }

  function getJob(id) {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Job not found');
    return serializeJobs([row])[0];
  }

  /** Dates a job occupies (by its start and end). */
  function jobDates(job) {
    if (!job.start_at) return [];
    const s = job.start_at.slice(0, 10);
    const e = job.end_at ? job.end_at.slice(0, 10) : s;
    return dateRange(s, e < s ? s : e);
  }

  /**
   * Hard problems (tech on another island / off) and soft warnings
   * (missing skills, double-booked) for a job assignment.
   */
  function checkAssignment(job) {
    const blocking = [];
    const offDays = [];
    const warnings = [];
    if (!job.technician_id || !job.start_at || job.status === 'cancelled') return { blocking, offDays, warnings };
    const tech = getTech(job.technician_id);
    const entries = techEntries(tech.id);
    for (const d of jobDates(job)) {
      const loc = locationOn(tech, d, entries);
      if (loc.islandId !== job.island_id) {
        blocking.push(`${tech.name} is working on ${islandName(loc.islandId)} on ${fmtDate(d)}. Add travel first.`);
      } else if (loc.status === 'off') {
        offDays.push(`${tech.name} has time off on ${fmtDate(d)}.`);
      }
    }
    const have = new Set(
      db.prepare('SELECT skill_id FROM technician_skills WHERE technician_id = ?').all(tech.id).map((r) => r.skill_id),
    );
    const missing = job.skill_ids.filter((s) => !have.has(s));
    if (missing.length) {
      const names = db
        .prepare(`SELECT name FROM skills WHERE id IN (${missing.map(() => '?').join(',')}) ORDER BY name`)
        .all(...missing)
        .map((r) => r.name);
      warnings.push(`${tech.name} is missing: ${names.join(', ')}`);
    }
    if (job.end_at) {
      const overlaps = db
        .prepare(
          `SELECT id, title, start_at FROM jobs
            WHERE technician_id = ? AND id != ? AND status != 'cancelled'
              AND start_at IS NOT NULL AND end_at IS NOT NULL
              AND start_at < ? AND end_at > ?`,
        )
        .all(tech.id, job.id ?? -1, job.end_at, job.start_at);
      for (const o of overlaps) warnings.push(`Overlaps "${o.title}" at ${o.start_at.slice(11)}`);
    }
    return { blocking, offDays, warnings };
  }

  /** Jobs assigned to a tech that would conflict with where they are working. */
  function jobConflictsForTech(techId, from, to) {
    const tech = getTech(techId);
    const entries = techEntries(techId);
    const rows = db
      .prepare(
        `SELECT * FROM jobs WHERE technician_id = ? AND start_at IS NOT NULL
           AND status NOT IN ('cancelled', 'completed') AND start_at >= ? AND start_at < ?
         ORDER BY start_at`,
      )
      .all(techId, from, addDays(to, 1));
    const out = [];
    for (const j of rows) {
      const loc = locationOn(tech, j.start_at.slice(0, 10), entries);
      if (loc.islandId !== j.island_id) {
        out.push(`"${j.title}" on ${fmtDate(j.start_at.slice(0, 10))} is on ${islandName(j.island_id)} but ${tech.name} will be on ${islandName(loc.islandId)}`);
      } else if (loc.status === 'off') {
        out.push(`"${j.title}" on ${fmtDate(j.start_at.slice(0, 10))} falls on ${tech.name}'s time off`);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ auth

  app.post('/api/login', (req, res) => {
    const username = str(req.body?.username, 'Username', { required: true });
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!row || !row.active || !verifyPassword(password, row.password_hash)) {
      throw new HttpError(401, 'Wrong username or password');
    }
    const { token, maxAge } = createSession(db, row.id);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === '1',
      maxAge,
    });
    res.json(loadUserAccess(db, row));
  });

  app.post('/api/logout', (req, res) => {
    const user = userForRequest(db, req);
    if (user) destroySession(db, user.token);
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  app.use('/api', requireUser);

  app.get('/api/me', (req, res) => {
    const { token: _t, ...user } = req.user;
    res.json(user);
  });

  app.post('/api/me/password', (req, res) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(req.body?.current ?? ''), row.password_hash)) throw bad('Current password is wrong');
    const next = String(req.body?.next ?? '');
    if (next.length < 8) throw bad('New password must be at least 8 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
    res.json({ ok: true });
  });

  // ------------------------------------------------------- islands & skills

  app.get('/api/islands', (req, res) => {
    const rows = db.prepare('SELECT * FROM islands ORDER BY sort, name').all();
    res.json(rows.map((r) => ({ ...r, accessible: req.user.islandIds.includes(r.id) })));
  });

  function islandBody(body) {
    return {
      name: str(body?.name, 'Name', { required: true, max: 60 }),
      code: str(body?.code, 'Code', { max: 6 }).toUpperCase(),
      color: color(body?.color, '#2563eb'),
      sort: int(body?.sort, 'Sort') ?? 0,
    };
  }

  app.post('/api/islands', requireAdmin, (req, res) => {
    const b = islandBody(req.body);
    const r = db
      .prepare('INSERT INTO islands (name, code, color, sort) VALUES (?, ?, ?, ?)')
      .run(b.name, b.code, b.color, b.sort);
    res.status(201).json(db.prepare('SELECT * FROM islands WHERE id = ?').get(r.lastInsertRowid));
  });

  app.put('/api/islands/:id', requireAdmin, (req, res) => {
    const b = islandBody(req.body);
    db.prepare('UPDATE islands SET name = ?, code = ?, color = ?, sort = ? WHERE id = ?').run(
      b.name, b.code, b.color, b.sort, Number(req.params.id),
    );
    res.json(db.prepare('SELECT * FROM islands WHERE id = ?').get(Number(req.params.id)));
  });

  app.delete('/api/islands/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const used =
      db.prepare('SELECT 1 FROM technicians WHERE home_island_id = ? LIMIT 1').get(id) ||
      db.prepare('SELECT 1 FROM jobs WHERE island_id = ? LIMIT 1').get(id) ||
      db.prepare('SELECT 1 FROM travel WHERE island_id = ? LIMIT 1').get(id);
    if (used) throw bad('This island still has technicians, jobs or travel. Move them first.');
    db.prepare('DELETE FROM islands WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  app.get('/api/skills', (_req, res) => {
    res.json(db.prepare('SELECT * FROM skills ORDER BY category, name').all());
  });

  function skillBody(body) {
    return {
      name: str(body?.name, 'Name', { required: true, max: 60 }),
      category: str(body?.category, 'Category', { max: 60 }) || 'General',
    };
  }

  app.post('/api/skills', requireWrite, (req, res) => {
    const b = skillBody(req.body);
    if (db.prepare('SELECT 1 FROM skills WHERE name = ?').get(b.name)) throw bad('That skill already exists');
    const r = db.prepare('INSERT INTO skills (name, category) VALUES (?, ?)').run(b.name, b.category);
    res.status(201).json(db.prepare('SELECT * FROM skills WHERE id = ?').get(r.lastInsertRowid));
  });

  app.put('/api/skills/:id', requireAdmin, (req, res) => {
    const b = skillBody(req.body);
    db.prepare('UPDATE skills SET name = ?, category = ? WHERE id = ?').run(b.name, b.category, Number(req.params.id));
    res.json(db.prepare('SELECT * FROM skills WHERE id = ?').get(Number(req.params.id)));
  });

  app.delete('/api/skills/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM skills WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------ users

  function serializeUser(row) {
    const { password_hash: _p, ...rest } = row;
    return {
      ...rest,
      islandIds: db.prepare('SELECT island_id FROM user_islands WHERE user_id = ?').all(row.id).map((r) => r.island_id),
    };
  }

  app.get('/api/users', requireAdmin, (_req, res) => {
    res.json(db.prepare('SELECT * FROM users ORDER BY name').all().map(serializeUser));
  });

  function saveUser(req, id) {
    const b = req.body ?? {};
    const name = str(b.name, 'Name', { required: true, max: 80 });
    const username = str(b.username, 'Username', { required: true, max: 40 });
    const role = b.role;
    if (!['admin', 'dispatcher', 'viewer'].includes(role)) throw bad('Role must be admin, dispatcher or viewer');
    const islandIds = idList(b.islandIds, 'Islands');
    const password = b.password ? String(b.password) : '';
    if (!id && password.length < 8) throw bad('Password must be at least 8 characters');
    if (id && password && password.length < 8) throw bad('Password must be at least 8 characters');
    const active = b.active === false || b.active === 0 ? 0 : 1;
    if (id === req.user.id && (role !== 'admin' || !active)) throw bad("You can't remove your own admin access");
    const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id ?? -1);
    if (clash) throw bad('That username is taken');
    return tx(db, () => {
      if (id) {
        db.prepare('UPDATE users SET name = ?, username = ?, role = ?, active = ? WHERE id = ?').run(
          name, username, role, active, id,
        );
        if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
        if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      } else {
        id = Number(
          db
            .prepare('INSERT INTO users (name, username, role, active, password_hash) VALUES (?, ?, ?, ?, ?)')
            .run(name, username, role, active, hashPassword(password)).lastInsertRowid,
        );
      }
      db.prepare('DELETE FROM user_islands WHERE user_id = ?').run(id);
      const ins = db.prepare('INSERT INTO user_islands (user_id, island_id) VALUES (?, ?)');
      for (const i of islandIds) ins.run(id, i);
      return serializeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    });
  }

  app.post('/api/users', requireAdmin, (req, res) => res.status(201).json(saveUser(req, null)));
  app.put('/api/users/:id', requireAdmin, (req, res) => res.json(saveUser(req, Number(req.params.id))));

  // ------------------------------------------------------------ technicians

  function serializeTechs(rows) {
    const skills = skillsByTech();
    return rows.map((t) => ({ ...t, skills: skills.get(t.id) ?? [] }));
  }

  app.get('/api/technicians', (req, res) => {
    const rows = db
      .prepare(`SELECT * FROM technicians ${req.query.all ? '' : 'WHERE active = 1'} ORDER BY name`)
      .all();
    const today = typeof req.query.today === 'string' && isDate(req.query.today) ? req.query.today : null;
    const out = serializeTechs(rows).map((t) => {
      if (!today) return t;
      return { ...t, today: locationOn(t, today, techEntries(t.id)) };
    });
    res.json(out);
  });

  function saveTech(req, id) {
    const b = req.body ?? {};
    const home = int(b.home_island_id, 'Home island', { required: true });
    assertIsland(req, home);
    if (id) assertIsland(req, getTech(id).home_island_id);
    const fields = {
      name: str(b.name, 'Name', { required: true, max: 80 }),
      phone: str(b.phone, 'Phone', { max: 40 }),
      email: str(b.email, 'Email', { max: 120 }),
      color: color(b.color, '#0ea5e9'),
      notes: str(b.notes, 'Notes', { max: 2000 }),
      active: b.active === false || b.active === 0 ? 0 : 1,
    };
    if (!Array.isArray(b.skills)) throw bad('Skills must be a list');
    const skills = b.skills.map((s) => ({
      skill_id: int(s?.skill_id, 'Skill', { required: true }),
      level: Math.min(3, Math.max(1, int(s?.level, 'Skill level') ?? 2)),
    }));
    return tx(db, () => {
      if (id) {
        db.prepare(
          'UPDATE technicians SET name = ?, phone = ?, email = ?, home_island_id = ?, color = ?, notes = ?, active = ? WHERE id = ?',
        ).run(fields.name, fields.phone, fields.email, home, fields.color, fields.notes, fields.active, id);
      } else {
        id = Number(
          db
            .prepare(
              'INSERT INTO technicians (name, phone, email, home_island_id, color, notes, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
            )
            .run(fields.name, fields.phone, fields.email, home, fields.color, fields.notes, fields.active).lastInsertRowid,
        );
      }
      db.prepare('DELETE FROM technician_skills WHERE technician_id = ?').run(id);
      const ins = db.prepare('INSERT OR REPLACE INTO technician_skills (technician_id, skill_id, level) VALUES (?, ?, ?)');
      for (const s of skills) ins.run(id, s.skill_id, s.level);
      return serializeTechs([getTech(id)])[0];
    });
  }

  app.post('/api/technicians', requireWrite, (req, res) => res.status(201).json(saveTech(req, null)));
  app.put('/api/technicians/:id', requireWrite, (req, res) => res.json(saveTech(req, Number(req.params.id))));

  // ----------------------------------------------------------------- travel

  function serializeTravel(rows) {
    const islands = new Map(db.prepare('SELECT id, name FROM islands').all().map((r) => [r.id, r.name]));
    const techs = new Map(db.prepare('SELECT id, name, home_island_id FROM technicians').all().map((r) => [r.id, r]));
    return rows.map((r) => {
      const t = techs.get(r.technician_id);
      return {
        ...r,
        technician_name: t?.name ?? '',
        home_island_id: t?.home_island_id ?? null,
        home_island_name: islands.get(t?.home_island_id) ?? '',
        island_name: r.island_id ? islands.get(r.island_id) : null,
      };
    });
  }

  function canTouchTravel(req, tech, islandId) {
    const ids = req.user.islandIds;
    return ids.includes(tech.home_island_id) || (islandId != null && ids.includes(islandId));
  }

  app.get('/api/travel', (req, res) => {
    const from = req.query.from && isDate(req.query.from) ? req.query.from : '0000-01-01';
    const to = req.query.to && isDate(req.query.to) ? req.query.to : '9999-12-31';
    const techId = int(req.query.technician_id, 'Technician');
    const rows = db
      .prepare(
        `SELECT tr.* FROM travel tr JOIN technicians t ON t.id = tr.technician_id
          WHERE tr.end_date >= ? AND tr.start_date <= ? ${techId ? 'AND tr.technician_id = ?' : ''}
          ORDER BY tr.start_date, tr.id`,
      )
      .all(...[from, to, ...(techId ? [techId] : [])]);
    const visible = rows.filter((r) => canTouchTravel(req, getTech(r.technician_id), r.island_id));
    res.json(serializeTravel(visible));
  });

  function saveTravel(req, id) {
    const b = req.body ?? {};
    const tech = getTech(int(b.technician_id, 'Technician', { required: true }));
    const kind = b.kind === 'time_off' ? 'time_off' : 'travel';
    const islandId = kind === 'travel' ? int(b.island_id, 'Destination island', { required: true }) : null;
    const start = date(b.start_date, 'Start date');
    const end = date(b.end_date, 'End date');
    if (end < start) throw bad('End date is before start date');
    if (kind === 'travel') {
      if (!db.prepare('SELECT 1 FROM islands WHERE id = ?').get(islandId)) throw bad('Unknown island');
      if (islandId === tech.home_island_id) throw bad(`${islandName(islandId)} is ${tech.name}'s home island`);
    }
    if (!canTouchTravel(req, tech, islandId)) {
      throw new HttpError(403, `You need access to ${islandName(tech.home_island_id)} or the destination island`);
    }
    if (id) {
      const existing = db.prepare('SELECT * FROM travel WHERE id = ?').get(id);
      if (!existing) throw new HttpError(404, 'Travel not found');
      if (!canTouchTravel(req, getTech(existing.technician_id), existing.island_id)) {
        throw new HttpError(403, "You can't edit that entry");
      }
    }
    const clash = db
      .prepare(
        `SELECT * FROM travel WHERE technician_id = ? AND kind = ? AND id != ?
            AND start_date <= ? AND end_date >= ?`,
      )
      .get(tech.id, kind, id ?? -1, end, start);
    if (clash) {
      const what = clash.kind === 'travel' ? `a trip to ${islandName(clash.island_id)}` : 'time off';
      throw bad(`${tech.name} already has ${what} from ${fmtDate(clash.start_date)} to ${fmtDate(clash.end_date)}`);
    }
    const notes = str(b.notes, 'Notes', { max: 1000 });
    if (id) {
      db.prepare(
        'UPDATE travel SET technician_id = ?, kind = ?, island_id = ?, start_date = ?, end_date = ?, notes = ? WHERE id = ?',
      ).run(tech.id, kind, islandId, start, end, notes, id);
    } else {
      id = Number(
        db
          .prepare(
            'INSERT INTO travel (technician_id, kind, island_id, start_date, end_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(tech.id, kind, islandId, start, end, notes, req.user.id).lastInsertRowid,
      );
    }
    const row = db.prepare('SELECT * FROM travel WHERE id = ?').get(id);
    return { travel: serializeTravel([row])[0], warnings: jobConflictsForTech(tech.id, start, end) };
  }

  app.post('/api/travel', requireWrite, (req, res) => res.status(201).json(saveTravel(req, null)));
  app.put('/api/travel/:id', requireWrite, (req, res) => res.json(saveTravel(req, Number(req.params.id))));

  app.delete('/api/travel/:id', requireWrite, (req, res) => {
    const row = db.prepare('SELECT * FROM travel WHERE id = ?').get(Number(req.params.id));
    if (!row) throw new HttpError(404, 'Travel not found');
    const tech = getTech(row.technician_id);
    if (!canTouchTravel(req, tech, row.island_id)) throw new HttpError(403, "You can't delete that entry");
    db.prepare('DELETE FROM travel WHERE id = ?').run(row.id);
    res.json({ ok: true, warnings: jobConflictsForTech(tech.id, row.start_date, row.end_date) });
  });

  // ------------------------------------------------------------------- jobs

  app.get('/api/jobs', (req, res) => {
    const where = [];
    const args = [];
    const islandIds = req.user.islandIds;
    if (!islandIds.length) return res.json([]);
    where.push(`island_id IN (${islandIds.map(() => '?').join(',')})`);
    args.push(...islandIds);
    const island = int(req.query.island, 'Island');
    if (island) {
      where.push('island_id = ?');
      args.push(island);
    }
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const like = `%${req.query.q.trim()}%`;
      where.push('(title LIKE ? OR customer_name LIKE ? OR address LIKE ? OR customer_phone LIKE ? OR notes LIKE ?)');
      args.push(like, like, like, like, like);
    }
    if (typeof req.query.status === 'string' && STATUSES.includes(req.query.status)) {
      where.push('status = ?');
      args.push(req.query.status);
    }
    const rows = db
      .prepare(
        `SELECT * FROM jobs WHERE ${where.join(' AND ')}
          ORDER BY start_at IS NULL DESC, start_at DESC, id DESC LIMIT 200`,
      )
      .all(...args);
    res.json(serializeJobs(rows));
  });

  function readJob(req, existing) {
    const b = { ...(existing ?? {}), ...(req.body ?? {}) };
    const job = {
      id: existing?.id,
      island_id: int(b.island_id, 'Island', { required: true }),
      technician_id: int(b.technician_id, 'Technician', { nullable: true }),
      title: str(b.title, 'Job title', { required: true, max: 200 }),
      customer_name: str(b.customer_name, 'Customer', { max: 200 }),
      customer_phone: str(b.customer_phone, 'Phone', { max: 40 }),
      address: str(b.address, 'Address', { max: 300 }),
      job_type: str(b.job_type, 'Job type', { max: 60 }) || 'Service',
      priority: PRIORITIES.includes(b.priority) ? b.priority : 'normal',
      status: STATUSES.includes(b.status) ? b.status : 'scheduled',
      start_at: datetime(b.start_at, 'Start'),
      end_at: datetime(b.end_at, 'End'),
      duration_minutes: Math.max(15, Math.min(24 * 60 * 7, int(b.duration_minutes, 'Duration') ?? 120)),
      notes: str(b.notes, 'Notes', { max: 4000 }),
      skill_ids: idList(b.skill_ids, 'Required skills'),
    };
    assertIsland(req, job.island_id);
    if (existing && existing.island_id !== job.island_id) assertIsland(req, existing.island_id);
    if (job.technician_id) getTech(job.technician_id);
    if (!job.start_at) {
      job.end_at = null;
      if (job.status === 'scheduled' || job.status === 'in_progress') job.status = 'unscheduled';
    } else {
      if (job.status === 'unscheduled') job.status = 'scheduled';
      if (!job.end_at || job.end_at <= job.start_at) {
        const d = new Date(`${job.start_at}:00Z`);
        d.setUTCMinutes(d.getUTCMinutes() + job.duration_minutes);
        job.end_at = d.toISOString().slice(0, 16);
      } else {
        const mins = (new Date(`${job.end_at}:00Z`) - new Date(`${job.start_at}:00Z`)) / 60000;
        job.duration_minutes = mins;
      }
    }
    return job;
  }

  function saveJob(req, existing) {
    const job = readJob(req, existing);
    const check = checkAssignment(job);
    if (check.blocking.length) throw new HttpError(409, check.blocking[0], { blocking: check.blocking });
    if (check.offDays.length && !req.body?.force) {
      throw new HttpError(409, check.offDays[0], { needsConfirm: true, offDays: check.offDays });
    }
    const cols = [
      'island_id', 'technician_id', 'title', 'customer_name', 'customer_phone', 'address', 'job_type',
      'priority', 'status', 'start_at', 'end_at', 'duration_minutes', 'notes',
    ];
    const id = tx(db, () => {
      let id = existing?.id;
      if (id) {
        db.prepare(
          `UPDATE jobs SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
        ).run(...cols.map((c) => job[c]), id);
      } else {
        id = Number(
          db
            .prepare(`INSERT INTO jobs (${cols.join(', ')}, created_by) VALUES (${cols.map(() => '?').join(', ')}, ?)`)
            .run(...cols.map((c) => job[c]), req.user.id).lastInsertRowid,
        );
      }
      db.prepare('DELETE FROM job_skills WHERE job_id = ?').run(id);
      const ins = db.prepare('INSERT INTO job_skills (job_id, skill_id) VALUES (?, ?)');
      for (const s of job.skill_ids) ins.run(id, s);
      return id;
    });
    return { job: getJob(id), warnings: [...check.offDays, ...check.warnings] };
  }

  app.get('/api/jobs/:id', (req, res) => {
    const job = getJob(Number(req.params.id));
    assertIsland(req, job.island_id);
    res.json(job);
  });

  app.post('/api/jobs', requireWrite, (req, res) => res.status(201).json(saveJob(req, null)));

  app.put('/api/jobs/:id', requireWrite, (req, res) => {
    const existing = getJob(Number(req.params.id));
    assertIsland(req, existing.island_id);
    res.json(saveJob(req, existing));
  });

  app.delete('/api/jobs/:id', requireWrite, (req, res) => {
    const existing = getJob(Number(req.params.id));
    assertIsland(req, existing.island_id);
    db.prepare('DELETE FROM jobs WHERE id = ?').run(existing.id);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------ board

  /**
   * Everything the dispatch board needs for one island and date range:
   * the techs working there (with per-day location), their jobs, the island's
   * unscheduled jobs and the travel arriving/departing in the range.
   */
  app.get('/api/board', (req, res) => {
    const islandId = int(req.query.island, 'Island', { required: true });
    assertIsland(req, islandId);
    const start = date(req.query.start, 'Start');
    const end = date(req.query.end, 'End');
    if (end < start) throw bad('End is before start');
    const days = dateRange(start, end);
    if (days.length > MAX_BOARD_DAYS) throw bad(`Range too long (max ${MAX_BOARD_DAYS} days)`);

    const allEntries = db.prepare('SELECT * FROM travel WHERE end_date >= ? AND start_date <= ?').all(start, end);
    const entriesByTech = new Map();
    for (const e of allEntries) {
      if (!entriesByTech.has(e.technician_id)) entriesByTech.set(e.technician_id, []);
      entriesByTech.get(e.technician_id).push(e);
    }

    const jobs = serializeJobs(
      db
        .prepare(
          `SELECT * FROM jobs WHERE island_id = ? AND start_at IS NOT NULL AND start_at >= ? AND start_at < ?
            ORDER BY start_at`,
        )
        .all(islandId, start, addDays(end, 1)),
    );
    const techsWithJobs = new Set(jobs.map((j) => j.technician_id).filter(Boolean));

    const technicians = [];
    for (const t of serializeTechs(db.prepare('SELECT * FROM technicians ORDER BY name').all())) {
      const locs = locationsForRange(t, days, entriesByTech.get(t.id) ?? []);
      const presentHere = days.some((d) => locs[d].islandId === islandId);
      if ((t.active && presentHere) || techsWithJobs.has(t.id)) technicians.push({ ...t, days: locs });
    }
    const techById = new Map(technicians.map((t) => [t.id, t]));

    for (const j of jobs) {
      j.conflict = null;
      const t = techById.get(j.technician_id);
      if (!t || j.status === 'cancelled' || j.status === 'completed') continue;
      const loc = t.days[j.start_at.slice(0, 10)];
      if (loc.islandId !== islandId) j.conflict = `${t.name} is on ${islandName(loc.islandId)} this day`;
      else if (loc.status === 'off') j.conflict = `${t.name} is off this day`;
    }

    const unscheduled = serializeJobs(
      db
        .prepare(
          `SELECT * FROM jobs WHERE island_id = ? AND start_at IS NULL AND status NOT IN ('cancelled', 'completed')
            ORDER BY CASE priority WHEN 'emergency' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at`,
        )
        .all(islandId),
    );

    const travel = serializeTravel(
      allEntries.filter((e) => {
        const t = techById.get(e.technician_id);
        if (!t) return false;
        if (e.kind === 'time_off') {
          return days.some((d) => e.start_date <= d && e.end_date >= d && t.days[d].islandId === islandId);
        }
        return e.island_id === islandId || t.home_island_id === islandId;
      }),
    );

    res.json({ island_id: islandId, start, end, days, technicians, jobs, unscheduled, travel });
  });

  // ------------------------------------------------------------ static + errors

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra ?? {}) });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
