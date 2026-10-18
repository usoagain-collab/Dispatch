import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const db = openDb();

// First run: create an admin account so someone can sign in.
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const password = process.env.ADMIN_PASSWORD || 'changeme123';
  db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('admin', 'Administrator', 'admin', ?)").run(
    hashPassword(password),
  );
  console.log(`Created admin user "admin"${process.env.ADMIN_PASSWORD ? '' : ' with password "changeme123" — change it after signing in'}.`);
}

const app = createApp(db, { staticDir: path.resolve(here, '../dist') });
const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`Dispatch server listening on http://localhost:${port}`));
