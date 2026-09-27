import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, engine, analyseSafe, whileAwake } from '../app/engine.js';
import { installBrowserGlobals, FakeWorker, flush } from './helpers.mjs';

installBrowserGlobals();
beforeEach(() => { FakeWorker.reset(); document.hidden = false; });

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('Engine.analyse', () => {
  test('starts the engine with uci, hash and isready', async () => {
    await new Engine().analyse(FEN, 1000);
    assert.deepEqual(FakeWorker.posted.slice(0, 3), ['uci', 'setoption name Hash value 16', 'isready']);
    assert.deepEqual(FakeWorker.posted.slice(3), [`position fen ${FEN}`, 'go nodes 1000']);
  });

  test('reads centipawns, best move and principal variation', async () => {
    FakeWorker.script = () => ({ cp: -35, pv: ['e2e4', 'e7e5'] });
    assert.deepEqual(await new Engine().analyse(FEN), { cp: -35, best: 'e2e4', pv: ['e2e4', 'e7e5'] });
  });

  test('turns mate scores into large centipawn values', async () => {
    const e = new Engine();
    FakeWorker.script = () => ({ mate: 3, pv: ['d1h5'] });
    assert.equal((await e.analyse(FEN)).cp, 9997);
    FakeWorker.script = () => ({ mate: -2, pv: ['e1e2'] });
    assert.equal((await e.analyse(FEN)).cp, -9998);
    FakeWorker.script = () => ({ lines: ['info depth 0 score mate 0', 'bestmove (none)'] }); // already mated
    assert.deepEqual(await e.analyse(FEN), { cp: 0, best: null, pv: [] });
    FakeWorker.script = () => ({ lines: ['info depth 1 score mate 0 pv a1a1', 'bestmove (none)'] });
    assert.equal((await e.analyse(FEN)).cp, -10000);
  });

  test('keeps the last main line and ignores the second-best line', async () => {
    FakeWorker.script = () => ({ lines: [
      'info depth 1 score cp 10 pv d2d4',
      'info depth 2 multipv 1 score cp 50 pv e2e4 e7e5',
      'info depth 2 multipv 2 score cp -20 pv a2a3',
      'info depth 2 currmove g1f3 currmovenumber 3',
      'bestmove e2e4 ponder e7e5',
    ] });
    assert.deepEqual(await new Engine().analyse(FEN), { cp: 50, best: 'e2e4', pv: ['e2e4', 'e7e5'] });
  });

  test('runs one search at a time, in order', async () => {
    const e = new Engine();
    const order = [];
    let firstDone = false;
    FakeWorker.script = (fen) => { order.push([fen, firstDone]); return { cp: fen === 'A' ? 1 : 2, pv: ['a2a3'] }; };
    const a = e.analyse('A').then((r) => { firstDone = true; return r.cp; });
    const b = e.analyse('B').then((r) => r.cp);
    assert.deepEqual(await Promise.all([a, b]), [1, 2]);
    assert.deepEqual(order, [['A', false], ['B', true]]);
  });

  test('a crashed worker rejects the search and every later one', async () => {
    const e = new Engine();
    FakeWorker.script = () => 'crash';
    await assert.rejects(e.analyse(FEN), /Stockfish stopped/);
    assert.equal(e.dead, true);
    assert.equal(FakeWorker.instances[0].terminated, true);
    await assert.rejects(e.analyse(FEN), /Stockfish stopped/);
  });
});

describe('timeouts count only visible time', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setInterval', 'Date'] }));
  afterEach(() => mock.timers.reset());
  const tick = async (seconds) => { for (let i = 0; i < seconds; i++) { mock.timers.tick(1000); await flush(); } };

  test('a search that never answers is killed after its time budget', async () => {
    const e = new Engine();
    await e.analyse(FEN, 1000); // ready
    FakeWorker.script = () => 'hang';
    let err = null;
    e.analyse(FEN, 1000).catch((x) => { err = x; });
    await flush();
    await tick(15); // budget is 15 s + nodes / 5 ms = 15.2 s
    assert.equal(err, null);
    await tick(1);
    assert.match(err?.message, /did not answer/);
    assert.equal(e.dead, true);
  });

  test('time while the page is hidden does not count', async () => {
    const e = new Engine();
    await e.analyse(FEN, 1000);
    FakeWorker.script = () => 'hang';
    let err = null;
    e.analyse(FEN, 1000).catch((x) => { err = x; });
    await flush();
    document.hidden = true;
    await tick(60);
    assert.equal(err, null);
    document.hidden = false;
    await tick(17);
    assert.ok(err);
  });

  test('a long gap (device asleep) does not count', async () => {
    const e = new Engine();
    await e.analyse(FEN, 1000);
    FakeWorker.script = () => 'hang';
    let err = null;
    e.analyse(FEN, 1000).catch((x) => { err = x; });
    await flush();
    mock.timers.setTime(Date.now() + 3600_000); // one hour passes at once
    await tick(10);
    assert.equal(err, null);
  });
});

describe('engine() and analyseSafe', () => {
  test('engine() is shared, and replaced once dead', async () => {
    const a = engine();
    assert.equal(engine(), a);
    await a.queue; // started
    a.kill();
    assert.notEqual(engine(), a);
  });

  test('retries once on a fresh engine', async () => {
    let calls = 0;
    FakeWorker.script = () => (++calls === 1 ? 'crash' : { cp: 42, pv: ['e2e4'] });
    engine().kill(); FakeWorker.reset(FakeWorker.script);
    assert.equal((await analyseSafe(FEN, 1000)).cp, 42);
    assert.equal(FakeWorker.instances.length, 2);
  });

  test('a second failure is reported', async () => {
    FakeWorker.script = () => 'crash';
    await assert.rejects(analyseSafe(FEN, 1000), /Stockfish stopped/);
  });
});

describe('whileAwake', () => {
  const setWakeLock = (wakeLock) => Object.defineProperty(globalThis, 'navigator', { value: { wakeLock }, configurable: true });

  test('holds a screen lock while the job runs and releases it after', async () => {
    const log = [];
    setWakeLock({ request: async (type) => { log.push(`request ${type}`); return { release: async () => log.push('release') }; } });
    const out = await whileAwake(async () => { log.push('job'); return 7; });
    assert.equal(out, 7);
    assert.deepEqual(log, ['request screen', 'job', 'release']);
  });

  test('releases the lock when the job fails', async () => {
    const log = [];
    setWakeLock({ request: async () => ({ release: async () => log.push('release') }) });
    await assert.rejects(whileAwake(async () => { throw new Error('boom'); }), /boom/);
    assert.deepEqual(log, ['release']);
  });

  test('runs the job when wake lock is unsupported or refused', async () => {
    setWakeLock(undefined);
    assert.equal(await whileAwake(async () => 1), 1);
    setWakeLock({ request: async () => { throw new Error('denied'); } });
    assert.equal(await whileAwake(async () => 2), 2);
  });
});
