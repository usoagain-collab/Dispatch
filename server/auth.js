import crypto from 'node:crypto';

const SESSION_DAYS = 14;
export const COOKIE = 'dispatch_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  return { token, maxAge: SESSION_DAYS * 86400_000 };
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Load the user (with island access) for a request, or null. */
export function userForRequest(db, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.name, u.role, u.active, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`,
    )
    .get(token);
  if (!row || !row.active || row.expires_at < new Date().toISOString()) return null;
  return { ...loadUserAccess(db, row), token };
}

/** Attach the list of island ids the user may see. Admins see every island. */
export function loadUserAccess(db, user) {
  const islandIds =
    user.role === 'admin'
      ? db.prepare('SELECT id FROM islands ORDER BY sort, name').all().map((r) => r.id)
      : db
          .prepare('SELECT island_id FROM user_islands WHERE user_id = ? ORDER BY island_id')
          .all(user.id)
          .map((r) => r.island_id);
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    islandIds,
  };
}
