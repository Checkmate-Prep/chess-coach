// Remove a chess.com player from the shared game store (worker/games.js) and keep them out of it,
// for an erasure request. Usage: npm run forget-player -- <username> [--env production|test|dev]
// Needs Wrangler signed in to the Cloudflare account (npx wrangler login, or CLOUDFLARE_API_TOKEN).
//
// First puts `deny:<user>` in the environment's PREP KV namespace, so the Worker stops storing them, then deletes
// their files. The app only asks for a player's last 12 months and files expire 180 days after they're written,
// so the files that can exist are the archive list and the months of the last 19 months.
// To undo the deny-list: npx wrangler kv key delete deny:<user> --binding PREP --env <env> --remote
import { execFileSync } from 'node:child_process';
import { keyOf } from '../worker/games.js';

const args = process.argv.slice(2);
const at = args.indexOf('--env');
const env = at >= 0 ? args[at + 1] : 'production';
const user = args.find((a, i) => !a.startsWith('--') && i !== at + 1)?.toLowerCase();
if (!user || !/^[a-z0-9_-]{2,30}$/.test(user) || !['production', 'test', 'dev'].includes(env)) {
  console.error('Usage: npm run forget-player -- <chess.com username> [--env production|test|dev]');
  process.exit(1);
}
const bucket = `chess-coach-games-${env === 'production' ? 'prod' : env}`;
const wrangler = (...a) => execFileSync('npx', ['wrangler', ...a], { stdio: ['ignore', 'pipe', 'inherit'] });

wrangler('kv', 'key', 'put', `deny:${user}`, '1', '--binding', 'PREP', '--env', env, '--remote');
console.log(`${user} is on the deny-list of ${env}.`);

const now = new Date(), months = [null];
for (let i = 0; i < 19; i++) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
  months.push(`${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
}
for (const m of months) {
  const key = keyOf(user, m);
  try { wrangler('r2', 'object', 'delete', `${bucket}/${key}`, '--remote'); console.log(`deleted ${key}`); } catch { /* not stored */ }
}
console.log(`Done: ${user} removed from ${bucket}.`);
