// One-off: merges the synced data of a duplicate account into the account it was linked to, for people who
// signed in two ways before link-accounts.js existed and so have two Auth0 users, each with its own data in D1.
// Linking in Auth0 fixes only future logins; this moves the rows keyed on the secondary `sub` onto the primary.
//
//   1. Link the two users in Auth0 (Dashboard -> User Management -> Users -> the secondary -> Link, or the
//      Management API's POST /users/{primary}/identities). The primary is the user the token's `sub` will be.
//   2. node ops/auth0/merge-accounts.mjs <secondary-sub> <primary-sub> [--env production] > merge.sql
//      It reads both accounts through `wrangler d1 execute` (read only) and prints the SQL, nothing is changed.
//   3. Read merge.sql, then apply it: npx wrangler d1 execute DB --remote --env production --file merge.sql
//
// The rules are the app's own: the synced doc through merge() of app/syncdoc.js (latest change per entry wins,
// drill progress is the union), results as /api/results stores them (a review is kept once, a trap scan or plan
// replaces the other only with a higher rank, see worker/results.js). The secondary's rows are then removed.
import { execFileSync } from 'node:child_process';
import { merge, clean, EMPTY } from '../../app/syncdoc.js';

const SUB = /^[A-Za-z0-9_-]+\|[A-Za-z0-9._-]+$/;
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

/**
 * The SQL statements (strings) that move everything of `from` onto `to`. `fromDoc` and `toDoc` are the parsed
 * synced docs (or null when an account has none). Applying it twice changes nothing the second time.
 */
export function mergeSql(from, to, fromDoc, toDoc, now = Date.now()) {
  if (!SUB.test(from) || !SUB.test(to)) throw new Error('Both ids must look like provider|id.');
  if (from === to) throw new Error('Same account twice.');
  const out = [];
  if (fromDoc) {
    const merged = merge(toDoc ? clean(toDoc, now) : EMPTY, clean(fromDoc, now));
    out.push(`INSERT INTO docs (sub, doc, ver, updated) VALUES (${q(to)}, ${q(JSON.stringify(merged))}, 1, ${now}) `
      + 'ON CONFLICT (sub) DO UPDATE SET doc = excluded.doc, ver = docs.ver + 1, updated = excluded.updated');
  }
  const cols = 'sub, player, item, rank, data, updated';
  const pick = `SELECT ${q(to)}, player, item, rank, data, ${now} FROM results WHERE sub = ${q(from)}`;
  out.push(`INSERT INTO results (${cols}) ${pick} AND item LIKE 'review:%' ON CONFLICT (sub, player, item) DO NOTHING`);
  out.push(`INSERT INTO results (${cols}) ${pick} AND item NOT LIKE 'review:%' ON CONFLICT (sub, player, item) DO UPDATE `
    + 'SET rank = excluded.rank, data = excluded.data, updated = excluded.updated WHERE excluded.rank > results.rank');
  out.push(`DELETE FROM results WHERE sub = ${q(from)}`);
  out.push(`DELETE FROM docs WHERE sub = ${q(from)}`);
  return out;
}

function main() {
  const [from, to] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const e = process.argv.indexOf('--env'), env = e > 0 ? process.argv[e + 1] : 'production';
  if (!from || !to) throw new Error('Usage: node ops/auth0/merge-accounts.mjs <secondary-sub> <primary-sub> [--env production]');
  if (!SUB.test(from) || !SUB.test(to)) throw new Error('Both ids must look like provider|id.');
  const doc = (sub) => {
    const res = JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--remote', '--env', env, '--json',
      '--command', `SELECT doc FROM docs WHERE sub = ${q(sub)}`], { encoding: 'utf8' }));
    const row = res[0]?.results?.[0];
    return row ? JSON.parse(row.doc) : null;
  };
  console.log(`-- Merge ${from} into ${to} (${env}). Review, then apply with wrangler d1 execute --file.`);
  for (const s of mergeSql(from, to, doc(from), doc(to))) console.log(`${s};`);
}

if (import.meta.url === `file://${process.argv[1]}`) try { main(); } catch (err) { console.error(err.message); process.exit(1); }
