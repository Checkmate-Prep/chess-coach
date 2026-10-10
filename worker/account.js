// Deletes a user from Auth0 (Management API), the last step of "Delete account" (worker/sync.js).
// Needs a Machine-to-Machine application authorized on the Management API with the delete:users scope, whose
// credentials are the Worker secrets AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET. Without them (dev, local
// runs) nothing is called and the Auth0 user stays; the caller says so.
// The Management API lives on the tenant's own domain, not on the custom login domain (AUTH0_DOMAIN in production).

const TENANT = 'checkmateprep.us.auth0.com';

/** True when this Worker can delete Auth0 users. */
export const canDeleteUsers = (env) => !!(env.AUTH0_MGMT_CLIENT_ID && env.AUTH0_MGMT_CLIENT_SECRET);

/** Delete the Auth0 user `sub`. A user that's already gone counts as deleted. Throws when Auth0 refuses. */
export async function deleteAuth0User(env, sub, fetcher = fetch) {
  const domain = env.AUTH0_MGMT_DOMAIN || TENANT;
  const tok = await fetcher(`https://${domain}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: env.AUTH0_MGMT_CLIENT_ID, client_secret: env.AUTH0_MGMT_CLIENT_SECRET, audience: `https://${domain}/api/v2/` }),
  }).then((r) => r.json()).catch(() => ({}));
  if (!tok.access_token) throw new Error("Couldn't reach the sign-in service. Try again.");
  const r = await fetcher(`https://${domain}/api/v2/users/${encodeURIComponent(sub)}`, { method: 'DELETE', headers: { authorization: `Bearer ${tok.access_token}` } });
  if (!r.ok && r.status !== 404) throw new Error("The sign-in service didn't delete your account. Try again.");
}
