import assert from 'node:assert/strict';
import test from 'node:test';
import { hasRequiredScopes } from '../src/google-scopes.js';

const calendarScopes = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events.owned',
];

test('Google Calendar connection requires both availability and event-write scopes', () => {
  assert.equal(hasRequiredScopes(calendarScopes.join(' '), calendarScopes), true);
  assert.equal(hasRequiredScopes(`${calendarScopes[0]} openid email`, calendarScopes), false);
  assert.equal(hasRequiredScopes(calendarScopes[1]!, calendarScopes), false);
  assert.equal(hasRequiredScopes('', calendarScopes), false);
});
