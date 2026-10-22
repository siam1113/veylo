import { useEffect, useRef, type CSSProperties } from 'react';
import type { SyncIntention, SyncBlock } from '../lib/sync.client';
import { arrangeIntervals, dayInterval, zoneCityName, zoneDayOffset, zoneHue, zoneTimeLabel, zoneWeekday } from './time-timeline';
import { ProviderBadge } from './ProviderBadge';
import { AccountBadge } from './AccountBadge';

const HOUR_WIDTH = 480;
const LABEL_WIDTH = 64;
const LANE_HEIGHT = 64;
const LANE_GAP = 6;
const ROW_PADDING = 10;
// Hour ticks are centered on their mark (translateX(-50%)), so the very first (12:00 AM)
// and very last tick would otherwise have half their label clipped past the track's own
// edges, in space no amount of scrolling can reach - the same class of bug the day view's
// vertical labelBuffer fixes, just horizontal here. A fixed buffer covers it since, unlike
// the day view, pinned zones stack as extra lines (taller), not extra width.
const AXIS_BUFFER = 48;
const clockTime = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const timeLabel = (minutes: number) => new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dateKey = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** A week laid out like the day view rotated 90°: weekdays stacked as rows on the left,
 * one shared hour axis running horizontally across the top. Events are positioned by
 * time along each row instead of listed, so a busy day extends further along the axis
 * rather than growing a cramped vertical list — and the hour axis plus weekday labels
 * stay pinned (CSS position:sticky, no manual scroll-sync) while the grid scrolls. */
export function WeekTimeline({ days, today, scheduled, busyWindows, pinnedTimezones = [], onOpen, onChoose, onSchedule }: {
  days: Date[]; today: string;
  scheduled: Array<{ item: SyncIntention; block: SyncBlock }>;
  busyWindows: Array<{ start: string; end: string }>;
  pinnedTimezones?: string[];
  onOpen: (id: string) => void; onChoose: (date: Date, period: 'day') => void; onSchedule: (date: string, time?: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const weekKey = days[0] ? dateKey(days[0]) : '';
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, AXIS_BUFFER + 8 * HOUR_WIDTH - LABEL_WIDTH);
    // Reset to a sensible morning start when the displayed week changes, same as the
    // day view's one-time scroll-near-morning on mount.
  }, [weekKey]);
  // The shared top axis needs one reference date to convert each hour tick into a
  // pinned zone's clock time — any day in the visible week works, since the offset
  // only shifts at a DST boundary. Prefer the visible week's "today" when present.
  const axisDay = days.find((day) => dateKey(day) === today) ?? days[0] ?? new Date();
  const axisHeight = 36 + pinnedTimezones.length * 14;

  return <div className="time-week-timeline" aria-label="Week calendar">
    {pinnedTimezones.length ? <div className="time-week-caption"><span className="time-zone-legend">{pinnedTimezones.map((zone) => <span key={zone} className="time-zone-legend-item" style={{ '--zone-hue': zoneHue(zone) } as CSSProperties}><i className="time-zone-dot" />{zoneCityName(zone)}</span>)}</span></div> : null}
    <div className="time-week-scroll" ref={scrollRef}>
      <div className="time-week-grid" style={{ width: LABEL_WIDTH + HOUR_WIDTH * 24 + AXIS_BUFFER * 2 }}>
        <div className="time-week-hours">
          <div className="time-week-corner" style={{ width: LABEL_WIDTH, height: axisHeight }} />
          <div className="time-week-hour-ticks" style={{ width: HOUR_WIDTH * 24 + AXIS_BUFFER * 2, height: axisHeight }} aria-hidden="true">
            {Array.from({ length: 25 }, (_, hour) => {
              const instant = new Date(axisDay.getFullYear(), axisDay.getMonth(), axisDay.getDate(), hour);
              return <div key={hour} className="time-week-hour-tick" style={{ left: AXIS_BUFFER + hour * HOUR_WIDTH }}>
                <span className="time-week-hour-primary">{timeLabel(hour * 60)}</span>
                {pinnedTimezones.map((zone) => {
                  const offset = zoneDayOffset(instant, zone);
                  return <span key={zone} className="time-week-hour-secondary" style={{ '--zone-hue': zoneHue(zone) } as CSSProperties}><i className="time-zone-dot" />{zoneTimeLabel(instant, zone)}{offset ? <span className="time-zone-day" title={`${offset > 0 ? 'Next' : 'Previous'} day in ${zoneCityName(zone)}`}>{zoneWeekday(instant, zone)}</span> : null}</span>;
                })}
              </div>;
            })}
          </div>
        </div>
        {days.map((day) => {
          const key = dateKey(day);
          const daySchedule = scheduled.filter(({ block }) => block.date === key);
          const entries = arrangeIntervals(daySchedule.flatMap(({ item, block }) => {
            const start = new Date(`${block.date}T${block.time}`);
            const end = new Date(start.getTime() + block.duration * 60_000);
            const interval = dayInterval(day, start, end);
            return interval ? [{ ...interval, item, block }] : [];
          }));
          const dayBusy = busyWindows.flatMap((window) => {
            const interval = dayInterval(day, new Date(window.start), new Date(window.end));
            return interval ? [interval] : [];
          });
          const lanes = Math.max(1, ...entries.map((entry) => entry.lanes));
          const rowHeight = lanes * LANE_HEIGHT + (lanes - 1) * LANE_GAP + ROW_PADDING * 2;
          const isToday = key === today;
          return <div className={`time-week-row ${isToday ? 'is-today' : ''}`} key={key} style={{ height: rowHeight }}>
            <button className="time-week-row-label" style={{ width: LABEL_WIDTH }} onClick={() => onChoose(day, 'day')} aria-label={`Open ${day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`}>
              <span>{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <b>{day.getDate()}</b>
            </button>
            <div className="time-week-row-lane" style={{ width: HOUR_WIDTH * 24 + AXIS_BUFFER * 2 }}>
              <div className="time-week-track" style={{ left: AXIS_BUFFER, width: HOUR_WIDTH * 24 }}>
                {dayBusy.map((interval, index) => <div key={index} className="time-week-busy" style={{ left: interval.start * HOUR_WIDTH / 60, width: (interval.end - interval.start) * HOUR_WIDTH / 60 }} />)}
                <div className="time-week-slots">{Array.from({ length: 48 }, (_, index) => <button key={index} className={`time-week-slot ${index % 2 ? 'half-hour' : ''}`} style={{ width: HOUR_WIDTH / 2 }} aria-label={`Plan time on ${key} at ${timeLabel(index * 30)}`} onClick={() => onSchedule(key, clockTime(index * 30))} />)}</div>
                {isToday ? <div className="time-week-now-line" style={{ left: nowMinutes * HOUR_WIDTH / 60 }} aria-hidden="true"><i /></div> : null}
                {entries.map(({ item, block, start, end, lane }) => {
                  const instant = new Date(`${block.date}T${block.time}`);
                  const zoneTitles = pinnedTimezones.map((zone) => `${zoneTimeLabel(instant, zone)} ${zoneCityName(zone)}`).join(', ');
                  return <button key={block.id} className={`time-week-event ${item.status === 'completed' ? 'is-complete' : ''}`} style={{ left: start * HOUR_WIDTH / 60, width: Math.max(48, (end - start) * HOUR_WIDTH / 60 - 2), top: ROW_PADDING + lane * (LANE_HEIGHT + LANE_GAP), height: LANE_HEIGHT }} onClick={() => onOpen(item.id)} aria-label={`${item.title}, ${timeLabel(start)} to ${timeLabel(end)}, ${block.duration} minutes${item.status === 'completed' ? ', completed' : ''}`} title={`${item.title} · ${timeLabel(start)}–${timeLabel(end)} · ${block.duration} min${zoneTitles ? ` · ${zoneTitles}` : ''}`}>
                    <span className="time-week-event-head"><ProviderBadge provider={block.externalProvider} className="time-event-provider" /><AccountBadge accountLabel={block.externalAccountLabel} /><span className="time-week-event-time">{timeLabel(start)}–{timeLabel(end)}</span></span>
                    <span className="time-week-event-title">{item.title}</span>
                  </button>;
                })}
              </div>
            </div>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
