// The one-time note before the first AI plan: what is sent, and to whom. The answer stays on this device
// (localStorage, not synced: each device asks once, and nothing is sent from a device that hasn't agreed).
// Raise VERSION when what is sent changes in a way the note doesn't cover, so everyone is asked again.
import { ls } from './store.js';

const KEY = 'aiconsent', VERSION = 1;

export const hasAiConsent = () => ls.get(KEY, null)?.v === VERSION;
export const giveAiConsent = () => ls.set(KEY, { v: VERSION, at: Date.now() });
