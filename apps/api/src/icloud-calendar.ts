import { createHash } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { z } from 'zod';
import type { ConnectionEntries, ConnectionEntry } from './connection-providers.js';

export const icloudCredentialsSchema = z.object({
  appleId: z.string().trim().email().max(255),
  appPassword: z.string().trim().regex(/^(?:[a-z]{4}-){3}[a-z]{4}$/i, 'Enter an Apple app-specific password in xxxx-xxxx-xxxx-xxxx format.'),
});
export type IcloudCredentials = z.infer<typeof icloudCredentialsSchema>;
const DAV = 'DAV:'; const CALDAV = 'urn:ietf:params:xml:ns:caldav';
const ROOT = 'https://caldav.icloud.com/'; const MAX_XML_BYTES = 2 * 1024 * 1024;
const problem = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode });

export function icloudUrl(href: string, base = ROOT) {
  let url: URL;
  try { url = new URL(href, base); } catch { throw problem('iCloud returned an invalid calendar address.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || !/^(?:caldav|p\d+-caldav)\.icloud\.com$/.test(url.hostname)) {
    throw problem('iCloud returned an unexpected calendar address. Reconnect and try again.');
  }
  return url.toString();
}
export function parseDavXml(xml: string) {
  if (Buffer.byteLength(xml) > MAX_XML_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw problem('iCloud returned unsupported calendar data.');
  const fail = () => { throw problem('iCloud returned unreadable calendar data.'); };
  const doc = new DOMParser({ errorHandler: { warning: fail, error: fail, fatalError: fail } }).parseFromString(xml, 'application/xml');
  if (!doc.documentElement || doc.documentElement.localName !== 'multistatus' || doc.documentElement.namespaceURI !== DAV) fail();
  return doc;
}
const elements = (node: Document | Element, namespace: string, name: string) => Array.from(node.getElementsByTagNameNS(namespace, name));
function successfulProps(response: Element) {
  return elements(response, DAV, 'propstat').filter((propstat) => /\s200\s/.test(elements(propstat, DAV, 'status')[0]?.textContent ?? ''))
    .flatMap((propstat) => elements(propstat, DAV, 'prop'));
}
function discoveryHref(doc: Document, namespace: string, property: string) {
  for (const response of elements(doc, DAV, 'response')) for (const prop of successfulProps(response)) {
    const value = elements(prop, namespace, property)[0];
    const href = value && elements(value, DAV, 'href')[0]?.textContent;
    if (href) return href.trim();
  }
  throw problem('iCloud did not return a calendar account. Check that iCloud Calendar is enabled.');
}
async function davRequest(url: string, credentials: IcloudCredentials, method: 'PROPFIND' | 'REPORT', body: string, depth: string, signal: AbortSignal, redirects = 0): Promise<{ doc: Document; url: string }> {
  const target = icloudUrl(url);
  const response = await fetch(target, { method, body, redirect: 'manual', signal, headers: {
    Authorization: `Basic ${Buffer.from(`${credentials.appleId}:${credentials.appPassword}`).toString('base64')}`,
    'Content-Type': 'application/xml; charset=utf-8', Depth: depth,
  } });
  if ([301, 302, 307, 308].includes(response.status)) {
    const location = response.headers.get('location'); await response.body?.cancel();
    if (!location || redirects >= 3) throw problem('iCloud calendar discovery could not complete. Try again.');
    return davRequest(icloudUrl(location, target), credentials, method, body, depth, signal, redirects + 1);
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw problem('iCloud declined access. Check your Apple Account email and app-specific password.');
  }
  if (!response.ok) { await response.body?.cancel(); throw problem('iCloud Calendar could not respond. Try again shortly.'); }
  const reader = response.body?.getReader(); if (!reader) throw problem('iCloud returned no calendar data.');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > MAX_XML_BYTES) { await reader.cancel(); throw problem('This iCloud calendar is too large to preview. Open Calendar to see its events.'); }
    chunks.push(value);
  }
  return { doc: parseDavXml(Buffer.concat(chunks).toString('utf8')), url: target };
}
const propfind = (property: string) => `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV}"><d:prop>${property}</d:prop></d:propfind>`;
export async function discoverIcloudCalendars(credentials: IcloudCredentials, signal = AbortSignal.timeout(20_000)) {
  const principal = await davRequest(ROOT, credentials, 'PROPFIND', propfind('<d:current-user-principal/>'), '0', signal);
  const principalUrl = icloudUrl(discoveryHref(principal.doc, DAV, 'current-user-principal'), principal.url);
  const home = await davRequest(principalUrl, credentials, 'PROPFIND', propfind('<c:calendar-home-set/>'), '0', signal);
  const homeUrl = icloudUrl(discoveryHref(home.doc, CALDAV, 'calendar-home-set'), home.url);
  const result = await davRequest(homeUrl, credentials, 'PROPFIND', propfind('<d:resourcetype/><d:displayname/><c:supported-calendar-component-set/>'), '1', signal);
  const calendars: Array<{ url: string; name: string }> = [];
  for (const response of elements(result.doc, DAV, 'response')) for (const prop of successfulProps(response)) {
    if (!elements(prop, CALDAV, 'calendar').length) continue;
    const components = elements(prop, CALDAV, 'comp');
    if (components.length && !components.some((component) => component.getAttribute('name') === 'VEVENT')) continue;
    const href = elements(response, DAV, 'href')[0]?.textContent?.trim();
    if (href) calendars.push({ url: icloudUrl(href, result.url), name: elements(prop, DAV, 'displayname')[0]?.textContent || 'iCloud Calendar' });
  }
  return Array.from(new Map(calendars.map((calendar) => [calendar.url, calendar])).values());
}
function icalDate(value: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(value);
  if (!match) throw problem('iCloud returned calendar times that could not be expanded. Open Calendar to view these events.');
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return match[4] ? `${date}T${match[4]}:${match[5]}:${match[6]}Z` : date;
}
export function expandedIcloudEvents(ical: string, calendar: { name: string; url: string }): ConnectionEntry[] {
  // CALDAV:expand asks the server to resolve recurrence and time zones (RFC 4791 §9.6.5).
  // Reject unexpanded input instead of inventing local times or losing recurring instances.
  const entries: ConnectionEntry[] = []; let event: Record<string, string> | null = null; let depth = 0;
  const calendarId = createHash('sha256').update(calendar.url).digest('hex').slice(0, 16);
  for (const line of ical.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    const colon = line.indexOf(':'); if (colon < 0) continue;
    const key = line.slice(0, colon).split(';')[0]!.toUpperCase(); const value = line.slice(colon + 1);
    if (key === 'BEGIN' && value === 'VEVENT') { event = {}; depth = 1; continue; }
    if (!event) continue;
    if (key === 'BEGIN') { depth++; continue; }
    if (key === 'END') {
      if (--depth > 0) continue;
      if (value !== 'VEVENT') throw problem('iCloud returned unreadable events.');
      if (event.STATUS !== 'CANCELLED' && event.DTSTART && event.UID) {
        if (event.RRULE || event.RDATE || event.EXDATE || event.EXRULE) throw problem('iCloud did not expand recurring events. Open Calendar to view them.');
        entries.push({ id: `${calendarId}:${event.UID}:${event['RECURRENCE-ID'] ?? event.DTSTART}`,
          title: (event.SUMMARY || 'Untitled event').replace(/\\([nN,;\\])/g, (_match, character: string) => /n/i.test(character) ? '\n' : character),
          date: icalDate(event.DTSTART), context: calendar.name,
        });
      }
      event = null; continue;
    }
    if (depth === 1) event[key] = value;
  }
  if (event) throw problem('iCloud returned an incomplete event.');
  return entries;
}
export async function readIcloudEntries(credentials: IcloudCredentials): Promise<ConnectionEntries> {
  const signal = AbortSignal.timeout(25_000);
  const calendars = await discoverIcloudCalendars(credentials, signal);
  const start = new Date(); const end = new Date(start.getTime() + 30 * 86400_000);
  const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const body = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="${CALDAV}"><d:prop><c:calendar-data><c:expand start="${stamp(start)}" end="${stamp(end)}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(start)}" end="${stamp(end)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const pages = await Promise.all(calendars.slice(0, 5).map(async (calendar) => {
    const { doc } = await davRequest(calendar.url, credentials, 'REPORT', body, '1', signal);
    const entries: ConnectionEntry[] = [];
    for (const response of elements(doc, DAV, 'response')) {
      const props = successfulProps(response);
      const data = props.flatMap((prop) => elements(prop, CALDAV, 'calendar-data'));
      if (!data.length) throw problem('Some iCloud events could not be read. Open Calendar to see the full schedule.');
      for (const value of data) entries.push(...expandedIcloudEvents(value.textContent ?? '', calendar));
    }
    return entries;
  }));
  const entries = pages.flat().sort((left, right) => (left.date ?? '').localeCompare(right.date ?? ''));
  return { entries: entries.slice(0, 100), hasMore: entries.length > 100 || calendars.length > 5, notice: 'Upcoming 30 days from up to five iCloud calendars. Veylo only reads your events.' };
}
