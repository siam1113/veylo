import assert from 'node:assert/strict';
import test from 'node:test';
import { icloudUrl, parseDavXml, icloudCredentialsSchema, expandedIcloudEvents, discoverIcloudCalendars, readIcloudEntries } from '../src/icloud-calendar.js';

const credentials = { appleId: 'test@example.com', appPassword: 'aaaa-bbbb-cccc-dddd' };
const calendar = { url: 'https://p01-caldav.icloud.com/123/calendars/work/', name: 'Work' };
const multistatus = (body: string) => `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`;
const prop = (href: string, properties: string) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const event = (properties: string) => `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n${properties}\r\nEND:VEVENT\r\nEND:VCALENDAR`;

test('iCloud accepts app-specific passwords and restricts credential destinations', () => {
  assert.deepEqual(icloudCredentialsSchema.parse(credentials), credentials);
  assert.equal(icloudCredentialsSchema.safeParse({ ...credentials, appPassword: 'MainPassword1!' }).success, false);
  assert.equal(icloudUrl('/123/calendars/', calendar.url), 'https://p01-caldav.icloud.com/123/calendars/');
  for (const url of ['https://evil.test/', 'http://caldav.icloud.com/', 'https://caldav.icloud.com.evil.test/', 'https://user:pass@caldav.icloud.com/', 'https://caldav.icloud.com:444/', 'https://localhost/']) assert.throws(() => icloudUrl(url), /unexpected calendar address/);
  assert.throws(() => parseDavXml('<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><x/>'), /unsupported calendar data/);
  assert.throws(() => parseDavXml('<html/>'), /unreadable calendar data/);
  assert.throws(() => parseDavXml(multistatus('<d:response>')), /unreadable calendar data/);
});

test('expanded iCloud events preserve recurrence instances, UTC times, all-day dates and folded titles', () => {
  const ics = event('UID:meeting\r\nRECURRENCE-ID:20261012T090000Z\r\nDTSTART:20261012T100000Z\r\nSUMMARY:Plan\\, review\r\n and discuss\r\nBEGIN:VALARM\r\nSUMMARY:Alarm title\r\nEND:VALARM')
    + '\r\n' + event('UID:meeting\r\nRECURRENCE-ID:20261013T090000Z\r\nDTSTART:20261013T090000Z\r\nSUMMARY:Next meeting')
    + '\r\n' + event('UID:day\r\nDTSTART;VALUE=DATE:20261014\r\nSUMMARY:All day')
    + '\r\n' + event('UID:gone\r\nDTSTART:20261015T090000Z\r\nSTATUS:CANCELLED');
  const entries = expandedIcloudEvents(ics, calendar);
  assert.equal(entries.length, 3); assert.equal(new Set(entries.map((entry) => entry.id)).size, 3);
  assert.equal(entries[0].title, 'Plan, reviewand discuss');
  assert.equal(entries[0].date, '2026-10-12T10:00:00Z'); assert.equal(entries[2].date, '2026-10-14');
  assert.throws(() => expandedIcloudEvents(event('UID:r\r\nDTSTART:20261012T100000Z\r\nRRULE:FREQ=DAILY'), calendar), /did not expand/);
  assert.throws(() => expandedIcloudEvents(event('UID:t\r\nDTSTART;TZID=America/New_York:20261012T100000'), calendar), /could not be expanded/);
  assert.throws(() => expandedIcloudEvents('BEGIN:VEVENT\r\nUID:partial', calendar), /incomplete event/);
});

test('CalDAV discovery follows trusted redirects and REPORT requests expanded event data', async () => {
  const original = globalThis.fetch; const calls: Array<{ url: string; method?: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push({ url, method: init?.method });
    assert.equal(new Headers(init?.headers).get('Authorization'), `Basic ${Buffer.from(`${credentials.appleId}:${credentials.appPassword}`).toString('base64')}`);
    assert.equal(init?.redirect, 'manual');
    if (url === 'https://caldav.icloud.com/') return new Response(null, { status: 307, headers: { location: 'https://p01-caldav.icloud.com/' } });
    let xml: string;
    if (url === 'https://p01-caldav.icloud.com/') xml = prop('/', '<d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>');
    else if (url.endsWith('/principal/')) xml = prop('/123/principal/', '<c:calendar-home-set><d:href>/123/calendars/</d:href></c:calendar-home-set>');
    else if (url.endsWith('/calendars/')) xml = prop('/123/calendars/', '<d:resourcetype><d:collection/></d:resourcetype>')
      + prop(calendar.url, '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>')
      + prop('/123/calendars/reminders/', '<d:resourcetype><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>');
    else {
      assert.equal(url, calendar.url); assert.equal(init?.method, 'REPORT');
      assert.match(String(init?.body), /<c:expand start="\d{8}T\d{6}Z" end="\d{8}T\d{6}Z"/);
      xml = prop(`${calendar.url}event.ics`, `<c:calendar-data><![CDATA[${event('UID:meeting\r\nDTSTART:20261012T100000Z\r\nSUMMARY:Review')}]]></c:calendar-data>`);
    }
    return new Response(multistatus(xml), { status: 207 });
  };
  try {
    const preview = await readIcloudEntries(credentials);
    assert.equal(calls.length, 5); assert.equal(preview.entries.length, 1);
    assert.equal(preview.entries[0].title, 'Review'); assert.equal(preview.entries[0].context, 'Work'); assert.equal(preview.hasMore, false);
    assert.deepEqual(calls.map((call) => call.method), ['PROPFIND', 'PROPFIND', 'PROPFIND', 'PROPFIND', 'REPORT']);
  } finally { globalThis.fetch = original; }
});

test('untrusted redirects and authentication errors never expose iCloud credentials', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://evil.test/collect' } }); };
  try {
    await assert.rejects(discoverIcloudCalendars(credentials), /unexpected calendar address/); assert.equal(calls, 1);
    globalThis.fetch = async () => new Response('secret echo should not escape', { status: 401 });
    await assert.rejects(discoverIcloudCalendars(credentials), (error: Error) => {
      assert.match(error.message, /app-specific password/); assert.equal(error.message.includes(credentials.appPassword), false); assert.equal(error.message.includes('secret echo'), false); return true;
    });
  } finally { globalThis.fetch = original; }
});
