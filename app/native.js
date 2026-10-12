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
