import { useEffect, useRef, type CSSProperties } from 'react';
import type { SyncIntention, SyncBlock } from '../lib/sync.client';
import { arrangeIntervals, dayInterval, zoneCityName, zoneDayOffset, zoneHue, zoneTimeLabel, zoneWeekday } from './time-timeline';
import { ProviderBadge } from './ProviderBadge';
import { AccountBadge } from './AccountBadge';

const HOUR_HEIGHT = 96;
const GUTTER_BASE = 80; const GUTTER_PER_ZONE = 34;
const GUTTER_BASE_MOBILE = 64; const GUTTER_PER_ZONE_MOBILE = 26;
const clockTime = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const timeLabel = (minutes: number) => new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function DayTimeline({ date, dateKey, scheduled, busyWindows, pinnedTimezones = [], onOpen, onSchedule }: {
  date: Date; dateKey: string;
  scheduled: Array<{ item: SyncIntention; block: SyncBlock }>;
  busyWindows: Array<{ start: string; end: string }>;
  pinnedTimezones?: string[];
  onOpen: (id: string) => void; onSchedule: (date: string, time?: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const entries = arrangeIntervals(scheduled.flatMap(({ item, block }) => {
    const start = new Date(`${block.date}T${block.time}`);
    const end = new Date(start.getTime() + block.duration * 60_000);
    const interval = dayInterval(date, start, end);
    return interval ? [{ ...interval, item, block }] : [];
  }));
  const busy = busyWindows.flatMap((window) => {
    const interval = dayInterval(date, new Date(window.start), new Date(window.end));
    return interval ? [interval] : [];
  });
  const now = new Date();
  const isToday = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  // Each pinned zone adds a ~12px line to the hour label, which is vertically
  // centered on its hour mark — so the label needs proportionally more clearance
  // above hour 0 and below hour 24, or its centered text runs past the scrollable
  // track's edges into space that can never be scrolled into view.
  const labelBuffer = 16 + pinnedTimezones.length * 12;
  // Open near the first morning session; earlier and later hours remain scrollable.
  const initialMinute = useRef(8 * 60);
  initialMinute.current = Math.min(8 * 60, entries[0]?.start ?? 8 * 60);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, initialMinute.current * HOUR_HEIGHT / 60 - labelBuffer);
    // Preserve a user's scroll position when tasks sync or are edited.
  }, [dateKey, labelBuffer]);
  const gutterStyle = {
    height: HOUR_HEIGHT * 24 + labelBuffer * 2,
    '--time-gutter': `${GUTTER_BASE + pinnedTimezones.length * GUTTER_PER_ZONE}px`,
    '--time-gutter-mobile': `${GUTTER_BASE_MOBILE + pinnedTimezones.length * GUTTER_PER_ZONE_MOBILE}px`,
  } as CSSProperties;
  return <section className="time-day-timeline" aria-label="Day calendar">
    <div className="time-day-caption">
      <span className="time-day-caption-left">
        <span>{date.toLocaleDateString(undefined, { weekday: 'long' })}</span>
        {pinnedTimezones.length ? <span className="time-zone-legend">{pinnedTimezones.map((zone) => <span key={zone} className="time-zone-legend-item" style={{ '--zone-hue': zoneHue(zone) } as CSSProperties}><i className="time-zone-dot" />{zoneCityName(zone)}</span>)}</span> : null}
      </span>
      <span>Select an empty time to make room</span>
    </div>
    <div className="time-day-scroll" ref={scrollRef} tabIndex={0} aria-label="24-hour timeline">
      <div className="time-day-track" style={gutterStyle}>
        <div className="time-hour-labels" aria-hidden="true">{Array.from({ length: 25 }, (_, hour) => {
          const instant = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour);
          return <div key={hour} className="time-hour-label" style={{ top: hour * HOUR_HEIGHT + labelBuffer }}>
            <span className="time-hour-primary">{timeLabel(hour * 60)}</span>
            {pinnedTimezones.map((zone) => {
              const offset = zoneDayOffset(instant, zone);
              return <span key={zone} className="time-hour-secondary" style={{ '--zone-hue': zoneHue(zone) } as CSSProperties}><i className="time-zone-dot" />{zoneTimeLabel(instant, zone)}{offset ? <span className="time-zone-day" title={`${offset > 0 ? 'Next' : 'Previous'} day in ${zoneCityName(zone)}`}>{zoneWeekday(instant, zone)}</span> : null}</span>;
            })}
          </div>;
        })}</div>
        <div className="time-day-lane" style={{ height: HOUR_HEIGHT * 24, top: labelBuffer }}>
          {busy.map((interval, index) => <div key={index} className="time-day-busy" style={{ top: interval.start * HOUR_HEIGHT / 60, height: (interval.end - interval.start) * HOUR_HEIGHT / 60 }}><span>Busy · {timeLabel(interval.start)}–{timeLabel(interval.end)}</span></div>)}
          {isToday ? <div className="time-now-line" style={{ top: nowMinutes * HOUR_HEIGHT / 60 }} aria-hidden="true"><i className="time-now-dot" /></div> : null}
          <div className="time-day-slots">{Array.from({ length: 48 }, (_, index) => <button key={index} className={`time-day-slot ${index % 2 ? 'half-hour' : ''}`} style={{ height: HOUR_HEIGHT / 2 }} aria-label={`Plan time on ${dateKey} at ${timeLabel(index * 30)}`} onClick={() => onSchedule(dateKey, clockTime(index * 30))}><span>＋ {timeLabel(index * 30)}</span></button>)}</div>
          {entries.map(({ item, block, start, end, lane, lanes }) => <button key={block.id} className={`time-event time-positioned-event ${end - start <= 30 ? 'is-short' : ''} ${item.status === 'completed' ? 'is-complete' : ''}`} style={{ top: start * HOUR_HEIGHT / 60, height: Math.max(22, (end - start) * HOUR_HEIGHT / 60 - 2), left: `calc(${lane / lanes * 100}% + 4px)`, width: `calc(${100 / lanes}% - 12px)` }} onClick={() => onOpen(item.id)} aria-label={`${item.title}, ${timeLabel(start)} to ${timeLabel(end)}, ${block.duration} minutes${item.status === 'completed' ? ', completed' : ''}`} title={`${item.title} · ${timeLabel(start)}–${timeLabel(end)} · ${block.duration} min`}>
            <span className="time-event-title"><ProviderBadge provider={block.externalProvider} className="time-event-provider" /><AccountBadge accountLabel={block.externalAccountLabel} />{item.title}</span><span className="time-event-meta">{timeLabel(start)}–{timeLabel(end)} · {block.duration} min</span>
          </button>)}
        </div>
      </div>
    </div>
  </section>;
}
