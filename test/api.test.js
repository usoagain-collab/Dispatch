import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { locationOn } from '../server/location.js';

let server;
let base;
const ids = {};

async function login(username, password) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return async (method, path, body) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
}

before(async () => {
  const db = openDb(':memory:');
  const isl = db.prepare('INSERT INTO islands (name) VALUES (?)');
  ids.oahu = Number(isl.run('Oahu').lastInsertRowid);
  ids.maui = Number(isl.run('Maui').lastInsertRowid);
  ids.chillers = Number(db.prepare("INSERT INTO skills (name) VALUES ('Chillers')").run().lastInsertRowid);
  const pw = hashPassword('password123');
  db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('admin', 'Admin', 'admin', ?)").run(pw);
  const d = db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('mauidisp', 'Maui', 'dispatcher', ?)").run(pw);
  db.prepare('INSERT INTO user_islands (user_id, island_id) VALUES (?, ?)').run(d.lastInsertRowid, ids.maui);
  server = createApp(db).listen(0);
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

test('locationOn: home, travel and time off', () => {
  const tech = { home_island_id: 1 };
  const entries = [
    { id: 1, kind: 'travel', island_id: 2, start_date: '2026-01-05', end_date: '2026-01-07' },
    { id: 2, kind: 'time_off', island_id: null, start_date: '2026-01-07', end_date: '2026-01-08' },
  ];
  assert.deepEqual(locationOn(tech, '2026-01-04', entries), { islandId: 1, status: 'home', travelId: null, offId: null });
  assert.equal(locationOn(tech, '2026-01-05', entries).islandId, 2);
  assert.equal(locationOn(tech, '2026-01-05', entries).status, 'travel');
  assert.deepEqual(locationOn(tech, '2026-01-07', entries), { islandId: 2, status: 'off', travelId: 1, offId: 2 });
  assert.deepEqual(locationOn(tech, '2026-01-08', entries), { islandId: 1, status: 'off', travelId: null, offId: 2 });
});

test('rejects unauthenticated requests', async () => {
  const r = await fetch(`${base}/api/board?island=1&start=2026-01-01&end=2026-01-07`);
  assert.equal(r.status, 401);
});

test('travel moves a tech between island boards', async () => {
  const api = await login('admin', 'password123');
  const tech = await api('POST', '/api/technicians', {
    name: 'Kai', home_island_id: ids.oahu, skills: [{ skill_id: ids.chillers, level: 3 }],
  });
  assert.equal(tech.status, 201);
  ids.kai = tech.body.id;

  const trip = await api('POST', '/api/travel', {
    technician_id: ids.kai, kind: 'travel', island_id: ids.maui, start_date: '2026-03-03', end_date: '2026-03-04',
  });
  assert.equal(trip.status, 201);

  const oahu = await api('GET', `/api/board?island=${ids.oahu}&start=2026-03-03&end=2026-03-04`);
  assert.equal(oahu.body.technicians.length, 0, 'Kai is not on Oahu during the trip');

  const maui = await api('GET', `/api/board?island=${ids.maui}&start=2026-03-02&end=2026-03-04`);
  assert.equal(maui.body.technicians.length, 1);
  assert.equal(maui.body.technicians[0].days['2026-03-02'].islandId, ids.oahu);
  assert.equal(maui.body.technicians[0].days['2026-03-03'].islandId, ids.maui);

  const overlap = await api('POST', '/api/travel', {
    technician_id: ids.kai, kind: 'travel', island_id: ids.maui, start_date: '2026-03-04', end_date: '2026-03-06',
  });
  assert.equal(overlap.status, 400);
});

test('job assignment respects where the tech is working', async () => {
  const api = await login('admin', 'password123');
  const blocked = await api('POST', '/api/jobs', {
    island_id: ids.oahu, technician_id: ids.kai, title: 'PM', start_at: '2026-03-03T08:00', end_at: '2026-03-03T10:00',
  });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Maui/);

  const ok = await api('POST', '/api/jobs', {
    island_id: ids.maui, technician_id: ids.kai, title: 'Chiller', skill_ids: [ids.chillers],
    start_at: '2026-03-03T08:00', end_at: '2026-03-03T10:00',
  });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body.warnings, []);
  assert.equal(ok.body.job.status, 'scheduled');

  const dbl = await api('POST', '/api/jobs', {
    island_id: ids.maui, technician_id: ids.kai, title: 'Second', start_at: '2026-03-03T09:00', end_at: '2026-03-03T11:00',
  });
  assert.equal(dbl.status, 201);
  assert.match(dbl.body.warnings[0], /Overlaps/);

  // Cancelling the trip flags the Maui jobs as conflicts.
  const travel = await api('GET', `/api/travel?technician_id=${ids.kai}`);
  const del = await api('DELETE', `/api/travel/${travel.body[0].id}`);
  assert.equal(del.body.warnings.length, 2);
  const maui = await api('GET', `/api/board?island=${ids.maui}&start=2026-03-03&end=2026-03-03`);
  assert.ok(maui.body.jobs.every((j) => j.conflict));
});

test('time off needs confirmation', async () => {
  const api = await login('admin', 'password123');
  await api('POST', '/api/travel', {
    technician_id: ids.kai, kind: 'time_off', start_date: '2026-04-01', end_date: '2026-04-01',
  });
  const job = { island_id: ids.oahu, technician_id: ids.kai, title: 'X', start_at: '2026-04-01T08:00' };
  const first = await api('POST', '/api/jobs', job);
  assert.equal(first.status, 409);
  assert.equal(first.body.needsConfirm, true);
  const forced = await api('POST', '/api/jobs', { ...job, force: true });
  assert.equal(forced.status, 201);
  assert.equal(forced.body.job.end_at, '2026-04-01T10:00');
});

test('dispatchers only see their islands', async () => {
  const api = await login('mauidisp', 'password123');
  const oahu = await api('GET', `/api/board?island=${ids.oahu}&start=2026-03-03&end=2026-03-04`);
  assert.equal(oahu.status, 403);
  const jobs = await api('GET', '/api/jobs');
  assert.ok(jobs.body.every((j) => j.island_id === ids.maui));
  const create = await api('POST', '/api/jobs', { island_id: ids.oahu, title: 'Nope' });
  assert.equal(create.status, 403);
  // Maui dispatcher can book an Oahu tech onto Maui.
  const trip = await api('POST', '/api/travel', {
    technician_id: ids.kai, kind: 'travel', island_id: ids.maui, start_date: '2026-05-01', end_date: '2026-05-02',
  });
  assert.equal(trip.status, 201);
});
