// Loads demo islands, skills, technicians, users, travel and jobs.
// Usage: npm run seed            (refuses if data already exists)
//        npm run seed -- --reset (wipes the database first)
import fs from 'node:fs';
import path from 'node:path';
import { openDb, tx } from './db.js';
import { hashPassword } from './auth.js';
import { addDays } from './location.js';

const file = process.env.DB_FILE || path.resolve('data/dispatch.db');
if (process.argv.includes('--reset')) {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
}
const db = openDb(file);
if (db.prepare('SELECT 1 FROM technicians LIMIT 1').get()) {
  console.error('Database already has data. Run with --reset to wipe it and load demo data.');
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));

tx(db, () => {
  const island = db.prepare('INSERT INTO islands (name, code, color, sort) VALUES (?, ?, ?, ?)');
  const islands = {};
  [
    ['Oahu', 'OAH', '#2563eb'],
    ['Maui', 'MAU', '#16a34a'],
    ['Big Island', 'BIG', '#dc2626'],
    ['Kauai', 'KAU', '#9333ea'],
  ].forEach(([name, code, color], i) => {
    islands[name] = Number(island.run(name, code, color, i).lastInsertRowid);
  });

  const skill = db.prepare('INSERT INTO skills (name, category) VALUES (?, ?)');
  const skills = {};
  [
    ['EPA 608 Universal', 'Certification'],
    ['Refrigerant Recovery', 'Refrigeration'],
    ['Walk-in Cooler / Freezer', 'Refrigeration'],
    ['Ice Machines', 'Refrigeration'],
    ['Chillers', 'Commercial'],
    ['Rooftop Units (RTU)', 'Commercial'],
    ['VRF / Mini-split', 'Residential'],
    ['Split System', 'Residential'],
    ['Controls / BMS', 'Controls'],
    ['Ductwork', 'Install'],
    ['Electrical', 'General'],
    ['Preventive Maintenance', 'General'],
  ].forEach(([name, cat]) => {
    skills[name] = Number(skill.run(name, cat).lastInsertRowid);
  });

  const tech = db.prepare(
    'INSERT INTO technicians (name, phone, email, home_island_id, color) VALUES (?, ?, ?, ?, ?)',
  );
  const techSkill = db.prepare('INSERT INTO technician_skills (technician_id, skill_id, level) VALUES (?, ?, ?)');
  const techs = {};
  const roster = [
    ['Kai Kealoha', 'Oahu', '#0ea5e9', { 'EPA 608 Universal': 3, Chillers: 3, 'Controls / BMS': 3, 'Rooftop Units (RTU)': 2 }],
    ['Leilani Akana', 'Oahu', '#f97316', { 'EPA 608 Universal': 2, 'VRF / Mini-split': 3, 'Split System': 3, Electrical: 2 }],
    ['Marcus Silva', 'Oahu', '#14b8a6', { 'Walk-in Cooler / Freezer': 3, 'Ice Machines': 3, 'Refrigerant Recovery': 2 }],
    ['Noa Kahale', 'Oahu', '#a855f7', { 'Preventive Maintenance': 2, 'Split System': 1, Ductwork: 2 }],
    ['Keoni Palakiko', 'Maui', '#22c55e', { 'EPA 608 Universal': 3, 'Rooftop Units (RTU)': 3, Chillers: 2 }],
    ['Malia Kamaka', 'Maui', '#ec4899', { 'VRF / Mini-split': 2, 'Split System': 2, 'Preventive Maintenance': 3 }],
    ['Dane Ishikawa', 'Big Island', '#eab308', { 'Walk-in Cooler / Freezer': 2, 'Ice Machines': 2, Electrical: 3 }],
    ['Iolana Keawe', 'Big Island', '#ef4444', { 'Split System': 3, Ductwork: 3, 'Preventive Maintenance': 2 }],
    ['Ryan Tanaka', 'Kauai', '#6366f1', { 'EPA 608 Universal': 2, 'VRF / Mini-split': 3, 'Controls / BMS': 2 }],
  ];
  for (const [name, home, color, sk] of roster) {
    const phone = `808-555-${String(1000 + Object.keys(techs).length * 37).slice(-4)}`;
    const email = `${name.split(' ')[0].toLowerCase()}@example.com`;
    const id = Number(tech.run(name, phone, email, islands[home], color).lastInsertRowid);
    techs[name] = id;
    for (const [s, lvl] of Object.entries(sk)) techSkill.run(id, skills[s], lvl);
  }

  const travel = db.prepare(
    'INSERT INTO travel (technician_id, kind, island_id, start_date, end_date, notes) VALUES (?, ?, ?, ?, ?, ?)',
  );
  travel.run(techs['Kai Kealoha'], 'travel', islands.Maui, addDays(monday, 2), addDays(monday, 4), 'Chiller overhaul at resort');
  travel.run(techs['Marcus Silva'], 'travel', islands.Kauai, addDays(monday, 8), addDays(monday, 10), 'Walk-in install');
  travel.run(techs['Malia Kamaka'], 'time_off', null, addDays(monday, 4), addDays(monday, 5), 'Vacation');
  travel.run(techs['Dane Ishikawa'], 'travel', islands.Oahu, addDays(monday, 1), addDays(monday, 1), 'Parts pickup + service');

  const job = db.prepare(
    `INSERT INTO jobs (island_id, technician_id, title, customer_name, customer_phone, address, job_type, priority, status,
                       start_at, end_at, duration_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const jobSkill = db.prepare('INSERT INTO job_skills (job_id, skill_id) VALUES (?, ?)');
  const addJob = (isl, techName, title, customer, address, type, priority, dayOffset, startHour, hours, req = []) => {
    const d = dayOffset == null ? null : addDays(monday, dayOffset);
    const pad = (n) => String(n).padStart(2, '0');
    const start = d ? `${d}T${pad(Math.floor(startHour))}:${startHour % 1 ? '30' : '00'}` : null;
    const endH = startHour + hours;
    const end = d ? `${d}T${pad(Math.floor(endH))}:${endH % 1 ? '30' : '00'}` : null;
    const id = Number(
      job.run(
        islands[isl], techName ? techs[techName] : null, title, customer, '808-555-0100', address, type, priority,
        d ? 'scheduled' : 'unscheduled', start, end, hours * 60,
      ).lastInsertRowid,
    );
    for (const s of req) jobSkill.run(id, skills[s]);
  };

  addJob('Oahu', 'Kai Kealoha', 'Chiller PM', 'Ala Moana Tower', '1450 Ala Moana Blvd, Honolulu', 'Maintenance', 'normal', 0, 8, 4, ['Chillers']);
  addJob('Oahu', 'Leilani Akana', 'Mini-split not cooling', 'Kahala residence', '4500 Kahala Ave, Honolulu', 'Service', 'high', 0, 9, 2, ['VRF / Mini-split']);
  addJob('Oahu', 'Marcus Silva', 'Walk-in freezer alarm', 'Poke Shack', '98-1005 Moanalua Rd, Aiea', 'Service', 'emergency', 0, 7, 3, ['Walk-in Cooler / Freezer']);
  addJob('Oahu', 'Noa Kahale', 'Quarterly PM - 6 units', 'Kapolei Commons', '4450 Kapolei Pkwy, Kapolei', 'Maintenance', 'normal', 1, 8, 6, ['Preventive Maintenance']);
  addJob('Oahu', 'Dane Ishikawa', 'Ice machine repair', 'Waikiki Beach Hotel', '2570 Kalakaua Ave, Honolulu', 'Service', 'high', 1, 10, 3, ['Ice Machines']);
  addJob('Oahu', 'Kai Kealoha', 'BMS controls upgrade', 'Queens Medical', '1301 Punchbowl St, Honolulu', 'Install', 'normal', 1, 8, 8, ['Controls / BMS']);
  addJob('Oahu', 'Leilani Akana', 'Split system install', 'Mililani home', '95-1050 Meheula Pkwy, Mililani', 'Install', 'normal', 2, 8, 8, ['Split System']);
  addJob('Oahu', 'Marcus Silva', 'Ice machine PM', 'Kailua Deli', '600 Kailua Rd, Kailua', 'Maintenance', 'low', 3, 13, 2, ['Ice Machines']);
  addJob('Maui', 'Kai Kealoha', 'Chiller overhaul', 'Wailea Resort', '3850 Wailea Alanui Dr, Kihei', 'Repair', 'high', 2, 7, 9, ['Chillers', 'EPA 608 Universal']);
  addJob('Maui', 'Keoni Palakiko', 'RTU replacement', 'Kahului Shopping Center', '65 W Kaahumanu Ave, Kahului', 'Install', 'normal', 2, 7, 9, ['Rooftop Units (RTU)']);
  addJob('Maui', 'Malia Kamaka', 'Mini-split service', 'Lahaina condo', '10 Kapalua Dr, Lahaina', 'Service', 'normal', 1, 9, 2, ['VRF / Mini-split']);
  addJob('Big Island', 'Iolana Keawe', 'Ductwork repair', 'Hilo Medical Office', '1190 Waianuenue Ave, Hilo', 'Repair', 'normal', 0, 8, 5, ['Ductwork']);
  addJob('Kauai', 'Ryan Tanaka', 'VRF commissioning', 'Lihue Airport', '3901 Mokulele Loop, Lihue', 'Install', 'high', 0, 8, 8, ['VRF / Mini-split', 'Controls / BMS']);
  addJob('Oahu', null, 'AC blowing warm air', 'Manoa residence', '2800 Oahu Ave, Honolulu', 'Service', 'high', null, 0, 2, ['Split System']);
  addJob('Oahu', null, 'Annual PM', 'Pearl City Dental', '850 Kamehameha Hwy, Pearl City', 'Maintenance', 'low', null, 0, 1.5, ['Preventive Maintenance']);
  addJob('Oahu', null, 'Cooler not holding temp', 'Chinatown Market', '1120 Maunakea St, Honolulu', 'Service', 'emergency', null, 0, 3, ['Walk-in Cooler / Freezer']);
  addJob('Maui', null, 'Thermostat replacement', 'Paia home', '120 Hana Hwy, Paia', 'Service', 'normal', null, 0, 1, []);

  const user = db.prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)');
  const ui = db.prepare('INSERT INTO user_islands (user_id, island_id) VALUES (?, ?)');
  const pw = hashPassword('dispatch123');
  if (!db.prepare("SELECT 1 FROM users WHERE username = 'admin'").get()) {
    user.run('admin', 'Administrator', 'admin', hashPassword('changeme123'));
  }
  const oahu = Number(user.run('oahu', 'Oahu Dispatch', 'dispatcher', pw).lastInsertRowid);
  ui.run(oahu, islands.Oahu);
  const neighbor = Number(user.run('neighbor', 'Neighbor Islands Dispatch', 'dispatcher', pw).lastInsertRowid);
  for (const i of ['Maui', 'Big Island', 'Kauai']) ui.run(neighbor, islands[i]);
});

console.log('Demo data loaded.');
console.log('  admin    / changeme123  (all islands)');
console.log('  oahu     / dispatch123  (Oahu only)');
console.log('  neighbor / dispatch123  (Maui, Big Island, Kauai)');
