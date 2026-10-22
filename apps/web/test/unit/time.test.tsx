import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpenSpace, Rhythm } from '../../app/components/TimePerspectives';
import { DayTimeline } from '../../app/components/DayTimeline';
import { WeekTimeline } from '../../app/components/WeekTimeline';
import { busyIntervals, mergeIntervals, occupiedMinutes, openIntervals, plannedIntervals, type ScheduledIntention } from '../../app/components/time-insights';
import { zoneCityName, zoneDayOffset } from '../../app/components/time-timeline';
import type { SyncIntention } from '../../app/lib/sync.client';

/** Date/Intl read process.env.TZ live, so tests that need a known "local" zone set it for the
 * duration of the test body only, restoring it so later tests see the original environment. */
function withTimeZone<T>(zone: string, run: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = zone;
  try { return run(); } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
}

const date = new Date(2030, 0, 7);
const before = new Date(2030, 0, 6);
const item: SyncIntention = { id: 'garden', title: 'Plan the garden', rawCapture: 'Plan the garden', kind: 'action', status: 'ready', createdAt: before.toISOString(), updatedAt: before.toISOString(), purpose: 'Time outdoors', roughPlan: 'Sketch the planting beds', effortEstimate: 45, energyContext: 'Quiet thinking' };
const scheduled: ScheduledIntention[] = [{ item, block: { id: 'morning', date: '2030-01-07', time: '09:00', duration: 90 } }, { item, block: { id: 'overlap', date: '2030-01-07', time: '10:00', duration: 60 } }];
const noop = () => {};

test('open space merges overlapping plans and busy times without inventing a gap', () => {
  const planned = plannedIntervals(date, scheduled);
  const busy = busyIntervals(date, [{ start: new Date(2030, 0, 7, 10, 30).toISOString(), end: new Date(2030, 0, 7, 12).toISOString() }]);
  assert.equal(occupiedMinutes(planned), 120);
  assert.deepEqual(mergeIntervals([...planned, ...busy]), [{ start: 540, end: 720 }]);
  assert.deepEqual(openIntervals(date, [...planned, ...busy], 540, 1020, before), [{ start: 720, end: 1020 }]);
});

test('open space excludes past days and elapsed time and honors chosen hours', () => {
  assert.deepEqual(openIntervals(date, [], 540, 1020, new Date(2030, 0, 7, 10, 7)), [{ start: 615, end: 1020 }]);
  assert.deepEqual(openIntervals(date, [], 540, 1020, new Date(2030, 0, 7, 10, 15, 1)), [{ start: 630, end: 1020 }]);
  assert.deepEqual(openIntervals(date, [], 540, 1020, new Date(2030, 0, 8)), []);
  assert.deepEqual(openIntervals(date, [], 540, 1020, new Date(2030, 0, 7, 18)), []);
  assert.deepEqual(openIntervals(date, [], 1020, 540, before), []);
});

test('overnight sessions occupy only their portion of the selected day', () => {
  const night = [{ item, block: { id: 'night', date: '2030-01-06', time: '23:30', duration: 120 } }];
  assert.deepEqual(plannedIntervals(date, night), [{ start: 0, end: 90 }]);
  assert.deepEqual(openIntervals(date, plannedIntervals(date, night), 0, 180, before), [{ start: 90, end: 180 }]);
});

test('unavailable external availability is clearly distinguished from checked availability', () => {
  const props = { days: [date], items: [item], scheduled: [], busyWindows: [], onOpen: noop, onSchedule: noop };
  const unchecked = renderToStaticMarkup(<OpenSpace {...props} availabilityChecked={false} />);
  assert.match(unchecked, /ClearHead plans only/);
  assert.match(unchecked, /Plan the garden/);
  assert.match(unchecked, /Quiet thinking/);
  assert.match(unchecked, /Fits an opening/);
  assert.match(renderToStaticMarkup(<OpenSpace {...props} availabilityChecked />), /latest checked Google busy times/);
});

test('rhythm counts overlapping time once and shows purpose separately as session time', () => {
  const html = renderToStaticMarkup(<Rhythm days={[date]} scheduled={scheduled} busyWindows={[]} availabilityChecked={false} onChooseDay={noop} />);
  assert.match(html, /2h<\/b><span>Planned across/);
  assert.match(html, /6h<\/b><span>Unplanned/);
  assert.match(html, /Time outdoors<\/span><b>2h 30m/);
});

test('zoneCityName turns an IANA zone into a short, human label', () => {
  assert.equal(zoneCityName('Asia/Tokyo'), 'Tokyo');
  assert.equal(zoneCityName('America/New_York'), 'New York');
  assert.equal(zoneCityName('America/Argentina/Buenos_Aires'), 'Buenos Aires');
});

test('zoneDayOffset flags only the pinned cities already on a different calendar day', () => withTimeZone('America/New_York', () => {
  const evening = new Date(2030, 0, 7, 20, 0); // 8pm local, Jan 7
  assert.equal(zoneDayOffset(evening, 'Asia/Tokyo'), 1); // already Jan 8 there
  assert.equal(zoneDayOffset(evening, 'America/Los_Angeles'), 0); // still Jan 7 there
}));

test('day timeline shows pinned timezones as a second line per hour, flagging a day difference', () => withTimeZone('America/New_York', () => {
  const html = renderToStaticMarkup(<DayTimeline date={new Date(2030, 0, 7)} dateKey="2030-01-07" scheduled={[]} busyWindows={[]} pinnedTimezones={['Asia/Tokyo']} onOpen={noop} onSchedule={noop} />);
  assert.match(html, /time-zone-legend-item"[^>]*><i class="time-zone-dot"><\/i>Tokyo/); // the city name appears once, in the legend
  assert.match(html, /time-hour-secondary"[^>]*><i class="time-zone-dot"><\/i>10:00\sAM<span class="time-zone-day"[^>]*>Tue<\/span>/); // 8pm local Jan 7 is 10am Jan 8 (Tuesday) in Tokyo
  assert.match(html, /time-hour-secondary"[^>]*><i class="time-zone-dot"><\/i>2:00\sPM<\/span>/); // midnight local Jan 7 is still 2pm Jan 7 in Tokyo, no day marker
}));

test('week timeline lists weekdays as rows with one shared hour axis, and stacks overlapping events into separate lanes', () => {
  const days = Array.from({ length: 7 }, (_, index) => new Date(2030, 0, 6 + index)); // Sun Jan 6 - Sat Jan 12
  const scheduled = [
    { item, block: { id: 'mon', date: '2030-01-07', time: '09:00', duration: 30 } },
    { item, block: { id: 'overlap-a', date: '2030-01-11', time: '10:00', duration: 60 } },
    { item, block: { id: 'overlap-b', date: '2030-01-11', time: '10:30', duration: 60 } },
  ];
  const html = renderToStaticMarkup(<WeekTimeline days={days} today="2030-01-07" scheduled={scheduled} busyWindows={[]} onOpen={noop} onChoose={noop} onSchedule={noop} />);
  // Weekday rows down the left, hour ticks across a single shared top axis.
  assert.match(html, /time-week-row-label"[^>]*><span>Mon<\/span><b>7<\/b>/);
  assert.match(html, /time-week-hour-tick" style="left:48px"><span class="time-week-hour-primary">12:00\sAM/); // offset by AXIS_BUFFER so the centered label isn't clipped at the track's edge
  // Two events overlapping on Friday get distinct lane offsets within that row (not
  // stacked on top of each other) - unlike Monday's unrelated event, which legitimately
  // shares lane 0 with Friday's first event since they're on different rows entirely.
  const fridayRow = html.match(/Open Friday[\s\S]*?time-week-row-lane[\s\S]*?(?=<div class="time-week-row)/)?.[0] ?? '';
  const fridayLaneTops = [...fridayRow.matchAll(/time-week-event [^"]*" style="left:\d+(?:\.\d+)?px;width:[\d.]+px;top:(\d+)px/g)].map((match) => match[1]);
  assert.equal(fridayLaneTops.length, 2);
  assert.equal(new Set(fridayLaneTops).size, 2);
});

test('week timeline shows pinned timezones as a legend and a second line on the shared hour axis', () => withTimeZone('America/New_York', () => {
  const days = Array.from({ length: 7 }, (_, index) => new Date(2030, 0, 6 + index)); // Sun Jan 6 - Sat Jan 12
  const html = renderToStaticMarkup(<WeekTimeline days={days} today="2030-01-07" scheduled={[]} busyWindows={[]} pinnedTimezones={['Asia/Tokyo']} onOpen={noop} onChoose={noop} onSchedule={noop} />);
  assert.match(html, /time-zone-legend-item"[^>]*><i class="time-zone-dot"><\/i>Tokyo/); // legend outside the scroll region
  assert.match(html, /time-week-hour-primary">8:00\sAM<\/span><span class="time-week-hour-secondary"[^>]*><i class="time-zone-dot"><\/i>10:00\sPM/); // 8am local (today) is 10pm Tokyo
}));
