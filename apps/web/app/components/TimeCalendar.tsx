import { DayTimeline } from './DayTimeline';
import { WeekTimeline } from './WeekTimeline';
import { ProviderBadge } from './ProviderBadge';
import { AccountBadge } from './AccountBadge';
import type { SyncIntention, SyncBlock } from '../lib/sync.client';

export type TimePeriod = 'day' | 'week' | 'month' | 'year';
type Scheduled = { item: SyncIntention; block: SyncBlock };
const dateKey = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const shift = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
const fullDate = (date: Date) => date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export function TimeCalendar({ period, date, today, scheduled, busyWindows, pinnedTimezones = [], onOpen, onChoose, onSchedule }: {
  period: TimePeriod; date: Date; today: string; scheduled: Scheduled[]; busyWindows: Array<{ start: string; end: string }>;
  pinnedTimezones?: string[];
  onOpen: (id: string) => void; onChoose: (date: Date, period: TimePeriod) => void; onSchedule: (date: string, time?: string) => void;
}) {
  if (period === 'day') return <DayTimeline date={date} dateKey={dateKey(date)} scheduled={scheduled} busyWindows={busyWindows} pinnedTimezones={pinnedTimezones} onOpen={onOpen} onSchedule={onSchedule} />;
  if (period === 'week') {
    const weekStart = shift(date, -date.getDay());
    const days = Array.from({ length: 7 }, (_, index) => shift(weekStart, index));
    return <WeekTimeline days={days} today={today} scheduled={scheduled} busyWindows={busyWindows} pinnedTimezones={pinnedTimezones} onOpen={onOpen} onChoose={(day) => onChoose(day, 'day')} onSchedule={onSchedule} />;
  }
  const byDay = new Map<string, Scheduled[]>();
  for (const entry of scheduled) byDay.set(entry.block.date, [...(byDay.get(entry.block.date) ?? []), entry]);
  function event({ item, block }: Scheduled, showDate = false) {
    return <button className={`time-event ${item.status === 'completed' ? 'is-complete' : ''}`} key={block.id} onClick={() => onOpen(item.id)} title={`${item.title} · ${block.date} · ${block.time} · ${block.duration} minutes`}>
      <span className="time-event-meta">{showDate ? `${new Date(`${block.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ` : ''}{block.time}</span>
      <span className="time-event-title"><ProviderBadge provider={block.externalProvider} className="time-event-provider" /><AccountBadge accountLabel={block.externalAccountLabel} />{item.title}</span>
    </button>;
  }
  if (period === 'year') return <div className="time-year" aria-label="Year calendar">{Array.from({ length: 12 }, (_, index) => {
    const month = new Date(date.getFullYear(), index, 1);
    const entries = scheduled.filter(({ block }) => block.date.startsWith(`${date.getFullYear()}-${String(index + 1).padStart(2, '0')}`));
    return <section className="time-year-month" key={index}>
      <button className="time-month-heading" onClick={() => onChoose(month, 'month')} aria-label={`Open ${month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`}><b>{month.toLocaleDateString(undefined, { month: 'long' })}</b><span>{entries.length} planned <span aria-hidden="true">↗</span></span></button>
      <div className="time-cell-events">{entries.length ? entries.map((entry) => event(entry, true)) : <span className="time-open-space">Room to plan</span>}</div>
    </section>;
  })}</div>;

  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = shift(first, -first.getDay());
  const count = Math.ceil((first.getDay() + new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()) / 7) * 7;
  return <div className="time-calendar-scroll"><div className="time-calendar time-calendar-month" aria-label="Month calendar">
    <div className="time-weekdays">{Array.from({ length: 7 }, (_, index) => <span key={index}>{shift(start, index).toLocaleDateString(undefined, { weekday: 'short' })}</span>)}</div>
    <div className="time-calendar-cells" style={{ gridTemplateRows: `repeat(${count / 7}, minmax(120px, 1fr))` }}>{Array.from({ length: count }, (_, index) => {
      const day = shift(start, index); const key = dateKey(day); const entries = byDay.get(key) ?? [];
      const busyCount = busyWindows.filter((window) => dateKey(new Date(window.start)) === key).length;
      return <section className={`time-calendar-cell ${key === today ? 'is-today' : ''} ${day.getMonth() !== date.getMonth() ? 'is-outside' : ''}`} key={key} aria-label={fullDate(day)}>
        <div className="time-cell-heading"><button className="time-date-button" onClick={() => onChoose(day, 'day')} aria-label={`Open ${fullDate(day)}`} aria-current={key === today ? 'date' : undefined}><b>{day.getDate()}</b>{key === today ? <small>Today</small> : null}</button><button className="time-cell-add" onClick={() => onSchedule(key)} aria-label={`Plan time on ${fullDate(day)}`}>+</button></div>
        {busyCount ? <span className="time-busy-count">{busyCount} busy window{busyCount === 1 ? '' : 's'}</span> : null}
        <div className="time-cell-events">{entries.map((entry) => event(entry))}</div>
      </section>;
    })}</div>
  </div></div>;
}
