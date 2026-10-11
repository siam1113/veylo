import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpenSpace, Rhythm, Focus } from '../../app/components/TimePerspectives';
import { busyIntervals, mergeIntervals, occupiedMinutes, openIntervals, plannedIntervals, type ScheduledIntention } from '../../app/components/time-insights';
import type { SyncIntention } from '../../app/lib/sync.client';

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
  assert.match(unchecked, /Veylo plans only/);
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

test('focus shows the selected intention context and excludes completed intentions', () => {
  const completed = { ...item, id: 'done', title: 'Already complete', status: 'completed' };
  const html = renderToStaticMarkup(<Focus date={date} items={[completed, item]} scheduled={scheduled} onOpen={noop} onSchedule={noop} onComplete={noop} />);
  assert.match(html, /Sketch the planting beds/);
  assert.match(html, /Time outdoors/);
  assert.match(html, /Mark intention complete/);
  assert.doesNotMatch(html, /Already complete/);
  assert.match(renderToStaticMarkup(<Focus date={date} items={[completed]} scheduled={[]} onOpen={noop} onSchedule={noop} onComplete={noop} />), /Nothing waiting for your attention/);
});
