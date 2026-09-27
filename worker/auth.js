// Checks the Auth0 access token the app sends as "Authorization: Bearer <token>".
// Auth0 signs tokens with keys it publishes at /.well-known/jwks.json; jose fetches and caches them.
import { createRemoteJWKSet, createLocalJWKSet, jwtVerify } from 'jose';

let keys = null, keysFor = '';

/** The signed-in user's id (Auth0 `sub`), or null when the token is missing, expired or not ours. */
export async function userOf(request, env) {
  const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') || '')?.[1];
  if (!token || !env.AUTH0_DOMAIN || !env.AUTH0_AUDIENCE) return null;
  // AUTH0_JWKS (a key set as JSON) replaces Auth0's published keys, for local tests without a tenant.
  const source = env.AUTH0_JWKS || env.AUTH0_DOMAIN;
  if (keysFor !== source) {
    keys = env.AUTH0_JWKS ? createLocalJWKSet(JSON.parse(env.AUTH0_JWKS)) : createRemoteJWKSet(new URL(`https://${env.AUTH0_DOMAIN}/.well-known/jwks.json`));
    keysFor = source;
  }
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: `https://${env.AUTH0_DOMAIN}/`, audience: env.AUTH0_AUDIENCE, algorithms: ['RS256'] });
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}
