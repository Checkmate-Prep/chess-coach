// Auth0 Action (Login flow, post-login trigger): a phone notification through ntfy.sh when someone signs in
// for the first time, that is, when a new account is created. Only for the production application, so test
// sign-ins on dev don't notify. Deployed by ops/auth0/deploy-actions.mjs; don't edit it in the Auth0 dashboard.
// Secrets (set by the deploy script): NTFY_TOPIC, a long random topic name (anyone who knows it can read it),
// and PROD_CLIENT_ID. It never blocks a sign-in.
exports.onExecutePostLogin = async (event) => {
  if (event.stats?.logins_count !== 1) return;
  if (!event.secrets.NTFY_TOPIC || event.client?.client_id !== event.secrets.PROD_CLIENT_ID) return;
  try {
    await fetch(`https://ntfy.sh/${event.secrets.NTFY_TOPIC}`, {
      method: 'POST',
      headers: { Title: 'New Checkmate Prep account', Tags: 'tada' },
      body: `${event.user.email || event.user.user_id} signed up with ${event.connection?.name || 'an unknown connection'}.`,
    });
  } catch (e) {
    console.log(`ntfy failed: ${e.message}`);
  }
};
