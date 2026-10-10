// Running inside the iOS app (a Capacitor shell, see capacitor.config.json) instead of in a browser.
// Capacitor puts `window.Capacitor` in the page; nothing is imported, so the app keeps its no-build-step rule.
// In the shell the files come from the device (capacitor://localhost), so `api/...` has to point at the site.

/** Where the Worker lives. Permanent: see CLAUDE.md ("checkmateprep.com is permanent"). */
export const SITE = 'https://checkmateprep.com/';

/** True inside the native app. Checked on every call so tests can switch it. */
export const isNative = () => {
  const c = globalThis.Capacitor;
  return !!c && (typeof c.isNativePlatform === 'function' ? !!c.isNativePlatform() : true);
};

/** The prefix for /api calls: empty in a browser (same origin), the site's address in the native app. */
export const API_BASE = () => (isNative() ? SITE : '');

/** `apiUrl('api/sync')` -> 'api/sync' in a browser, 'https://checkmateprep.com/api/sync' in the native app. */
export const apiUrl = (path) => API_BASE() + path;

// ---------- sign-in from the native app (sync.js) ----------
// Auth0 runs in the system browser (@capacitor/browser) and sends the user back to a custom URL scheme, which
// the app receives through @capacitor/app (`appUrlOpen`). The plugins come with the shell as
// `Capacitor.Plugins`, so nothing is imported. The scheme is registered in ios/App/App/Info.plist.

/** The app's bundle id, also its URL scheme. Never changes (it is the store listing's identity). */
export const BUNDLE_ID = 'com.checkmateprep.app';

/** Where Auth0 returns to after sign-in and sign-out; must be listed in the Native application's URLs. */
export const callbackUrl = (domain) => `${BUNDLE_ID}://${domain}/capacitor/${BUNDLE_ID}/callback`;

/** The native plugin called `name` (App, Browser), or null outside the shell or when it isn't installed. */
export const plugin = (name) => (isNative() && globalThis.Capacitor.Plugins?.[name]) || null;

/** True for the URL Auth0 sends back after sign-in (code and state, or an error and state). */
export function isAuthCallbackUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(`${BUNDLE_ID}://`)) return false;
  const q = new URLSearchParams(url.split('#')[0].split('?')[1] || '');
  return q.has('state') && (q.has('code') || q.has('error'));
}

/** The Auth0 application id to use here: the Native application's inside the shell, the web one elsewhere. */
export const clientIdFor = (cfg) => (isNative() ? cfg.nativeClientId : cfg.clientId) || null;
