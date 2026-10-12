// What /api/config tells the app about sign-in. All values are public (the app shows them to every browser).
// `nativeClientId` is the Auth0 Native application the iOS app signs in with (its own application, since a
// custom-scheme callback can't be registered on the web ones). Without it the iOS app hides accounts.
export function authConfig(env) {
  if (!(env.AUTH0_DOMAIN && env.AUTH0_CLIENT_ID && env.AUTH0_AUDIENCE)) return null;
  const auth = { domain: env.AUTH0_DOMAIN, clientId: env.AUTH0_CLIENT_ID, audience: env.AUTH0_AUDIENCE };
  if (env.AUTH0_NATIVE_CLIENT_ID) auth.nativeClientId = env.AUTH0_NATIVE_CLIENT_ID;
  return auth;
}
