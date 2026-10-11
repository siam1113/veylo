import { useEffect, useRef } from 'react';
import type { SyncIntention, SyncBlock } from '../lib/sync.client';
import { arrangeIntervals, dayInterval } from './time-timeline';

const HOUR_HEIGHT = 96;
const clockTime = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const timeLabel = (minutes: number) => new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function DayTimeline({ date, dateKey, scheduled, busyWindows, onOpen, onSchedule }: {
  date: Date; dateKey: string;
  scheduled: Array<{ item: SyncIntention; block: SyncBlock }>;
  busyWindows: Array<{ start: string; end: string }>;
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
  // Open near the first morning session; earlier and later hours remain scrollable.
  const initialMinute = useRef(8 * 60);
  initialMinute.current = Math.min(8 * 60, entries[0]?.start ?? 8 * 60);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, initialMinute.current * HOUR_HEIGHT / 60 - 16);
    // Preserve a user's scroll position when tasks sync or are edited.
  }, [dateKey]);

  return <section className="time-day-timeline" aria-label="Day calendar">
    <div className="time-day-caption"><span>{date.toLocaleDateString(undefined, { weekday: 'long' })}</span><span>Select an empty time to make room</span></div>
    <div className="time-day-scroll" ref={scrollRef} tabIndex={0} aria-label="24-hour timeline">
      <div className="time-day-track" style={{ height: HOUR_HEIGHT * 24 + 32 }}>
        <div className="time-hour-labels" aria-hidden="true">{Array.from({ length: 25 }, (_, hour) => <span key={hour} style={{ top: hour * HOUR_HEIGHT + 16 }}>{timeLabel(hour * 60)}</span>)}</div>
        <div className="time-day-lane" style={{ height: HOUR_HEIGHT * 24 }}>
          {busy.map((interval, index) => <div key={index} className="time-day-busy" style={{ top: interval.start * HOUR_HEIGHT / 60, height: (interval.end - interval.start) * HOUR_HEIGHT / 60 }}><span>Busy · {timeLabel(interval.start)}–{timeLabel(interval.end)}</span></div>)}
          <div className="time-day-slots">{Array.from({ length: 48 }, (_, index) => <button key={index} className={`time-day-slot ${index % 2 ? 'half-hour' : ''}`} style={{ height: HOUR_HEIGHT / 2 }} aria-label={`Plan time on ${dateKey} at ${timeLabel(index * 30)}`} onClick={() => onSchedule(dateKey, clockTime(index * 30))}><span>＋ {timeLabel(index * 30)}</span></button>)}</div>
          {entries.map(({ item, block, start, end, lane, lanes }) => <button key={block.id} className={`time-event time-positioned-event ${end - start <= 30 ? 'is-short' : ''} ${item.status === 'completed' ? 'is-complete' : ''}`} style={{ top: start * HOUR_HEIGHT / 60, height: Math.max(22, (end - start) * HOUR_HEIGHT / 60 - 2), left: `calc(${lane / lanes * 100}% + 4px)`, width: `calc(${100 / lanes}% - 12px)` }} onClick={() => onOpen(item.id)} aria-label={`${item.title}, ${timeLabel(start)} to ${timeLabel(end)}, ${block.duration} minutes${item.status === 'completed' ? ', completed' : ''}`} title={`${item.title} · ${timeLabel(start)}–${timeLabel(end)} · ${block.duration} min`}>
            <span className="time-event-title">{item.title}</span><span className="time-event-meta">{timeLabel(start)}–{timeLabel(end)} · {block.duration} min</span>
          </button>)}
        </div>
      </div>
    </div>
  </section>;
}
