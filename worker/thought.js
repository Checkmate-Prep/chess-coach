// Turns Claude's streaming thinking summary into a short line the app can show while a plan is written.

/** The last complete sentence or two of a thinking summary, at most about 200 characters. */
export function lastSentences(text, max = 200) {
  const done = String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter((x) => /[.!?]$/.test(x));
  let out = '';
  for (let i = done.length - 1; i >= 0; i--) {
    const next = out ? `${done[i]} ${out}` : done[i];
    if (next.length > max) break;
    out = next;
  }
  return out || (done.length ? `${done[done.length - 1].slice(0, max - 1)}…` : '');
}
