import assert from 'node:assert/strict';
import test from 'node:test';
import { createRetryScheduler } from '../../app/lib/sync.client.ts';

test('sync retry stays scheduled while offline and flushes after connectivity returns', () => {
  let online = false;
  let flushes = 0;
  let nextId = 0;
  const timers = new Map<number, () => void>();
  const runTimer = (id: number) => { const callback = timers.get(id); timers.delete(id); callback?.(); };
  const retry = createRetryScheduler({
    flush: () => { flushes += 1; },
    isOnline: () => online,
    setTimer: (callback) => { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimer: (id) => { timers.delete(id as number); },
  });

  retry.schedule();
  assert.equal(timers.size, 1);
  runTimer(1);
  assert.equal(flushes, 0);
  assert.equal(timers.size, 1, 'a failed offline attempt must schedule another check');

  online = true;
  runTimer(2);
  assert.equal(flushes, 1, 'the retry should flush after the connection returns');
  assert.equal(timers.size, 0);
  retry.dispose();
});
