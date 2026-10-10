// Creates or updates the Auth0 Actions in this folder and adds them to the Login flow, and sets the favicon
// of the hosted login page (login.checkmateprep.com), through the Management API, so nothing is set up by hand in the Auth0 dashboard. Safe to run again: when the code is
// already deployed and bound, it changes nothing (pass --force to redeploy anyway, e.g. for a new topic).
//   link-accounts   (link-accounts.js)  links a login to the existing user with the same verified email; runs first
//   notify-signup   (notify-signup.js)  the phone notification for new accounts; skipped without NTFY_TOPIC
// With --branding-only it only sets the login page favicon and needs no NTFY_TOPIC.
//   AUTH0_MGMT_CLIENT_ID, AUTH0_MGMT_CLIENT_SECRET  a Machine-to-Machine application authorized on the
//       Management API with read:actions, create:actions, update:actions, read:branding, update:branding.
//       link-accounts also uses them at login, so they need read:users and update:users too
//   NTFY_TOPIC        the ntfy.sh topic to notify
//   AUTH0_MGMT_DOMAIN the tenant's own domain (default checkmateprep.us.auth0.com; not the custom domain)
// The production application's Client ID is read from wrangler.toml.
// Runs in .github/workflows/deploy.yml after the production deploy, or by hand: node ops/auth0/deploy-actions.mjs
import { readFileSync } from 'node:fs';

const TRIGGER = { id: 'post-login', version: 'v3' }, RUNTIME = 'node22';
const LINK = 'link-accounts', NOTIFY = 'notify-signup';
const here = (f) => new URL(f, import.meta.url);

/** The production AUTH0_CLIENT_ID in wrangler.toml. */
export function prodClientId(toml) {
  const prod = toml.slice(toml.indexOf('[env.production]'));
  return /AUTH0_CLIENT_ID\s*=\s*"([^"]+)"/.exec(prod)?.[1] || null;
}

const FAVICON = 'https://checkmateprep.com/icon-192.png';

/** The branding change that gives the login page its favicon, or null when it already has it. */
export function brandingPatch(branding) {
  return branding?.favicon_url === FAVICON ? null : { favicon_url: FAVICON };
}

/**
 * The bindings to send so the Login flow runs `id` once: after the actions already in it, or, with `beforeId`,
 * right before that one when it is bound. Returns null when `id` is already bound.
 */
export function withBinding(bindings, id, name = NOTIFY, beforeId = null) {
  const refs = bindings.map((b) => ({ ref: { type: 'action_id', value: b.action.id }, display_name: b.display_name }));
  if (bindings.some((b) => b.action.id === id)) return null;
  const mine = { ref: { type: 'action_id', value: id }, display_name: name };
  const at = beforeId ? bindings.findIndex((b) => b.action.id === beforeId) : -1;
  return at < 0 ? [...refs, mine] : [...refs.slice(0, at), mine, ...refs.slice(at)];
}

async function main() {
  const env = process.env, force = process.argv.includes('--force'), brandingOnly = process.argv.includes('--branding-only');
  const domain = env.AUTH0_MGMT_DOMAIN || 'checkmateprep.us.auth0.com';
  const missing = ['AUTH0_MGMT_CLIENT_ID', 'AUTH0_MGMT_CLIENT_SECRET'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}.`);
  const clientId = brandingOnly ? null : prodClientId(readFileSync(here('../../wrangler.toml'), 'utf8'));
  if (!brandingOnly && !clientId) throw new Error('No production AUTH0_CLIENT_ID in wrangler.toml.');

  const tok = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: env.AUTH0_MGMT_CLIENT_ID, client_secret: env.AUTH0_MGMT_CLIENT_SECRET, audience: `https://${domain}/api/v2/` }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error(`Auth0 refused the Management API token: ${tok.error_description || tok.error}`);
  const api = async (method, path, body) => {
    const r = await fetch(`https://${domain}/api/v2/${path}`, {
      method, headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${out.message || ''}`);
    return out;
  };
  const find = async (name) => (await api('GET', `actions/actions?actionName=${name}`)).actions?.find((a) => a.name === name);

  // Creates or updates, builds and deploys one Action, then binds it to the Login flow. Returns true if anything changed.
  async function ensure(name, file, secrets, before) {
    const code = readFileSync(here(file), 'utf8');
    let action = await find(name), changed = false;
    if (!action) {
      action = await api('POST', 'actions/actions', { name, supported_triggers: [TRIGGER], code, runtime: RUNTIME, secrets });
      console.log(`Created the Action ${name}.`); changed = true;
    } else if (force || action.code !== code || action.runtime !== RUNTIME || !action.all_changes_deployed) {
      action = await api('PATCH', `actions/actions/${action.id}`, { code, runtime: RUNTIME, secrets });
      console.log(`Updated the Action ${name}.`); changed = true;
    }
    if (changed) {
      for (let i = 0; action.status !== 'built'; i++) {
        if (action.status === 'failed' || i > 30) throw new Error(`The Action ${name} didn't build (status ${action.status}).`);
        await new Promise((ok) => setTimeout(ok, 1000));
        action = await api('GET', `actions/actions/${action.id}`);
      }
      await api('POST', `actions/actions/${action.id}/deploy`);
      console.log(`Deployed the Action ${name}.`);
    }
    const beforeId = before ? (await find(before))?.id : null;
    const bindings = withBinding((await api('GET', `actions/triggers/${TRIGGER.id}/bindings`)).bindings || [], action.id, name, beforeId);
    if (bindings) { await api('PATCH', `actions/triggers/${TRIGGER.id}/bindings`, { bindings }); console.log(`Added ${name} to the Login flow.`); changed = true; }
    return changed;
  }

  let changed = false;
  if (!brandingOnly) {
    // Linking first, so the sign-up notification sees the user the login ends up as.
    changed = await ensure(LINK, 'link-accounts.js', [
      { name: 'MGMT_DOMAIN', value: domain },
      { name: 'MGMT_CLIENT_ID', value: env.AUTH0_MGMT_CLIENT_ID },
      { name: 'MGMT_CLIENT_SECRET', value: env.AUTH0_MGMT_CLIENT_SECRET },
    ], NOTIFY);
    if (env.NTFY_TOPIC) changed = (await ensure(NOTIFY, 'notify-signup.js', [{ name: 'NTFY_TOPIC', value: env.NTFY_TOPIC }, { name: 'PROD_CLIENT_ID', value: clientId }])) || changed;
    else console.log('No NTFY_TOPIC: the sign-up notification Action was left alone.');
  }

  const patch = brandingPatch(await api('GET', 'branding'));
  if (patch) { await api('PATCH', 'branding', patch); console.log('Set the login page favicon.'); changed = true; }
  if (!changed) console.log('Already up to date.');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
