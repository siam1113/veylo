import assert from 'node:assert/strict';
import test from 'node:test';
import { quietUntil } from '../src/quiet-hours.ts';

test('daytime quiet hours defer to their end in the account timezone', () => {
  const now = new Date('2026-10-10T19:15:00.000Z'); // 15:15 in New York
  assert.equal(quietUntil(now, 'America/New_York', '09:00', '17:00')?.toISOString(), '2026-10-10T21:00:00.000Z');
});

test('overnight quiet hours defer to the following morning', () => {
  const now = new Date('2026-10-10T03:30:00.000Z'); // 23:30 on October 9 in New York
  assert.equal(quietUntil(now, 'America/New_York', '22:00', '07:00')?.toISOString(), '2026-10-10T11:00:00.000Z');
});

test('quiet-hour end inside a daylight-saving gap resolves to the first valid local minute after it', () => {
  const now = new Date('2026-03-08T06:30:00.000Z'); // 01:30 before the spring-forward jump
  assert.equal(quietUntil(now, 'America/New_York', '22:00', '02:30')?.toISOString(), '2026-03-08T07:00:00.000Z');
});

test('returns no deferral outside quiet hours or when no range is configured', () => {
  const now = new Date('2026-10-10T14:00:00.000Z'); // 10:00 in New York
  assert.equal(quietUntil(now, 'America/New_York', '22:00', '07:00'), null);
  assert.equal(quietUntil(now, 'America/New_York', '09:00', '09:00'), null);
  assert.equal(quietUntil(now, null, '22:00', '07:00'), null);
});
