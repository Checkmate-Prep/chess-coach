// Minimal Chrome DevTools client (Node 22 has WebSocket built in), a 360x640 phone at 3x: 1080x1920 screenshots.
import { writeFileSync } from 'node:fs';
export async function connect(port = 9333) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const waiting = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { const { resolve, reject } = waiting.get(m.id); waiting.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; waiting.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
  const run = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.data, 'base64')); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  return { send, run, shot, sleep, close: () => ws.close() };
}
