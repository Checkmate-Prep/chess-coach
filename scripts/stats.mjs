// Usage stats from Workers Analytics Engine (written by worker/events.js): who uses the app, when, which screens.
//   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npm run stats [-- --env dev] [-- --days 7]
// The token needs "Account Analytics: Read". Times are UTC. Data is kept 3 months.
// Columns: blob1 screen, blob2 device id, blob3 Auth0 user id ('' when signed out), blob4 country.
const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };

/** The SQL for each report, over the last `days` days of `dataset`. */
export function queries(dataset, days) {
  const since = `FROM ${dataset} WHERE timestamp > NOW() - INTERVAL '${days}' DAY`;
  return {
    days: `SELECT formatDateTime(timestamp, '%Y-%m-%d') AS day, count(DISTINCT blob2) AS devices, SUM(_sample_interval) AS views ${since} GROUP BY day ORDER BY day`,
    accounts: `SELECT formatDateTime(timestamp, '%Y-%m-%d') AS day, count(DISTINCT blob3) AS accounts ${since} AND blob3 != '' GROUP BY day ORDER BY day`,
    screens: `SELECT blob1 AS screen, SUM(_sample_interval) AS views, count(DISTINCT blob2) AS devices ${since} GROUP BY screen ORDER BY views DESC`,
    hours: `SELECT formatDateTime(timestamp, '%H') AS hour, SUM(_sample_interval) AS views ${since} GROUP BY hour ORDER BY hour`,
    who: `SELECT blob2 AS device, blob3 AS account, blob4 AS country, MIN(timestamp) AS first, MAX(timestamp) AS last, SUM(_sample_interval) AS views ${since} GROUP BY device, account, country ORDER BY last DESC LIMIT 25`,
  };
}

async function main() {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
  if (!account || !token) throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (with Account Analytics: Read).');
  const env = arg('env', 'production'), days = Math.max(1, Math.min(90, parseInt(arg('days', '30'), 10) || 30));
  const sql = async (q) => {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: `${q} FORMAT JSON`,
    });
    if (!r.ok) throw new Error(`Analytics Engine answered ${r.status}: ${await r.text()}`);
    return (await r.json()).data;
  };
  const q = queries(`checkmate_events_${env}`, days);
  const [perDay, accounts, screens, hours, who] = await Promise.all(Object.values(q).map(sql));
  const signedIn = Object.fromEntries(accounts.map((a) => [a.day, +a.accounts]));
  const short = (s) => (s ? s.slice(0, 8) : '');

  console.log(`\nCheckmate Prep usage, ${env}, last ${days} days (UTC)\n\nPer day`);
  console.table(perDay.map((d) => ({ day: d.day, devices: +d.devices, 'signed-in accounts': signedIn[d.day] || 0, 'screens opened': +d.views })));
  console.log('Screens');
  console.table(screens.map((s) => ({ screen: s.screen, opened: +s.views, devices: +s.devices })));
  console.log('Hour of day (UTC)');
  const max = Math.max(1, ...hours.map((h) => +h.views));
  for (const h of hours) console.log(`${h.hour}h ${'█'.repeat(Math.round((30 * h.views) / max)).padEnd(30)} ${h.views}`);
  console.log('\nLatest devices (ids shortened; account = Auth0 user id, find it in the Auth0 dashboard)');
  console.table(who.map((w) => ({ device: short(w.device), account: w.account || '-', country: w.country, first: w.first, last: w.last, screens: +w.views })));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
