// Auth0 Action (Login flow, post-login trigger): one person, one account. When someone signs in with a verified
// email that already belongs to another user (say a password account, and now "Continue with Google"), this
// links the new identity to the existing user, the primary, and makes the primary the user of this login. The
// token's `sub`, which keys all synced data (worker/sync.js), is then the primary's, whichever way they sign in.
//
// Never links when the email is not verified on both sides: anyone can type someone else's address into the
// password sign-up form, and only a verified address proves its owner. It never blocks a sign-in: on any
// error it logs and lets the login continue as the user it was (a duplicate, which a later login can still fix).
//
// Deployed by ops/auth0/deploy-actions.mjs; don't edit it in the Auth0 dashboard. It runs before notify-signup.
// Secrets (set by the deploy script): MGMT_DOMAIN (the tenant's own domain), MGMT_CLIENT_ID and
// MGMT_CLIENT_SECRET, a Machine-to-Machine application authorized on the Management API with read:users and
// update:users. Pure helpers are exported (and tested in tests/linking.test.mjs); Auth0 only calls onExecutePostLogin.

const sameEmail = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

/** True when this login may be linked at all: a verified email, on a user that isn't linked to anything yet. */
function linkable(user) {
  return !!(user && user.email && user.email_verified === true && user.user_id && (user.identities || []).length <= 1);
}

/**
 * The existing user to link `user` to, or null. Candidates come from the Management API's users-by-email.
 * Only other users with the same address, verified, not blocked; the oldest wins, so the account that
 * already has data stays the primary. Two or more candidates is unusual and is linked to the oldest only.
 */
function pickPrimary(user, candidates) {
  if (!linkable(user) || !Array.isArray(candidates)) return null;
  const found = candidates
    .filter((c) => c && c.user_id !== user.user_id && c.email_verified === true && !c.blocked && sameEmail(c.email, user.email))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.user_id).localeCompare(String(b.user_id)));
  return found[0] || null;
}

/** The body for POST /users/{primary}/identities: the identity this login signed in with. */
function identityToLink(user) {
  const id = (user.identities || [])[0];
  if (id && id.provider && id.user_id) return { provider: id.provider, user_id: id.user_id };
  const [provider, ...rest] = String(user.user_id || '').split('|');
  return provider && rest.length ? { provider, user_id: rest.join('|') } : null;
}

exports.linkable = linkable;
exports.pickPrimary = pickPrimary;
exports.identityToLink = identityToLink;

exports.onExecutePostLogin = async (event, api) => {
  const user = event.user;
  if (!linkable(user)) return;
  const { MGMT_DOMAIN, MGMT_CLIENT_ID, MGMT_CLIENT_SECRET } = event.secrets || {};
  if (!MGMT_DOMAIN || !MGMT_CLIENT_ID || !MGMT_CLIENT_SECRET) return;
  try {
    const tok = await (await fetch(`https://${MGMT_DOMAIN}/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: MGMT_CLIENT_ID, client_secret: MGMT_CLIENT_SECRET, audience: `https://${MGMT_DOMAIN}/api/v2/` }),
    })).json();
    if (!tok.access_token) throw new Error('no Management API token');
    const headers = { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' };

    const found = await fetch(`https://${MGMT_DOMAIN}/api/v2/users-by-email?email=${encodeURIComponent(user.email)}`, { headers });
    if (!found.ok) throw new Error(`users-by-email: ${found.status}`);
    const primary = pickPrimary(user, await found.json());
    const link = identityToLink(user);
    if (!primary || !link) return;

    const res = await fetch(`https://${MGMT_DOMAIN}/api/v2/users/${encodeURIComponent(primary.user_id)}/identities`, { method: 'POST', headers, body: JSON.stringify(link) });
    if (!res.ok) throw new Error(`link: ${res.status}`);
    // Tells notify-signup.js, later in this flow, that this is a link and not a new account.
    try { api.user.setAppMetadata('linked_to', primary.user_id); } catch { /* only a hint */ }
    // From here on this login is the primary's: its id ends up in the token.
    api.authentication.setPrimaryUser(primary.user_id);
  } catch (e) {
    console.log(`account linking skipped: ${e.message}`);
  }
};
