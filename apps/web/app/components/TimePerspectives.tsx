import { useEffect, useState } from 'react';
import type { SyncIntention } from '../lib/sync.client';
import { busyIntervals, clockLabel, clockValue, durationLabel, intentionDuration, localDayKey, occupiedMinutes, openIntervals, plannedIntervals, type BusyWindow, type ScheduledIntention } from './time-insights';
import { UiIcon } from './UiIcon';

type Schedule = (id?: string, date?: string, time?: string, duration?: number) => void;
type PerspectiveProps = { scheduled: ScheduledIntention[]; onOpen: (id: string) => void; onSchedule: Schedule };

export function OpenSpace({ days, items, scheduled, busyWindows, availabilityChecked, onSchedule, onOpen }: PerspectiveProps & {
  days: Date[]; items: SyncIntention[]; busyWindows: BusyWindow[]; availabilityChecked: boolean;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [energy, setEnergy] = useState('');
  const [duration, setDuration] = useState(30);
  const [from, setFrom] = useState(9 * 60);
  const [to, setTo] = useState(17 * 60);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(timer); }, []);
  const waiting = items.filter((item) => item.status !== 'completed' && !['archived', 'trashed'].includes(item.status) && !item.blocks?.length);
  const energies = [...new Set(waiting.map((item) => item.energyContext?.trim()).filter((value): value is string => Boolean(value)))];
  const candidates = waiting.filter((item) => !energy || item.energyContext?.trim() === energy);
  const selected = candidates.find((item) => item.id === selectedId);
  const minutes = selected ? intentionDuration(selected) : duration;
  const dayGaps = days.map((date) => ({ date, gaps: openIntervals(date, [...plannedIntervals(date, scheduled), ...busyIntervals(date, busyWindows)], from, to, now) }));
  // The earliest gap that fits an intention's own duration — drives both the "Fits an
  // opening" read-out and the one-click "Suggest HH:MM" action, so there's one list
  // instead of a picker list duplicated by a separate quick-plan list.
  function earliestFit(item: SyncIntention) {
    const need = intentionDuration(item);
    for (const { date, gaps } of dayGaps) {
      const gap = gaps.find((candidate) => candidate.end - candidate.start >= need);
      if (gap) return { date, start: gap.start, duration: need };
    }
    return null;
  }
  const visibleGaps = dayGaps.map(({ date, gaps }) => ({ date, gaps: gaps.filter((gap) => gap.end - gap.start >= minutes) }));
  function chooseGap(date: Date, start: number) {
    // Recheck the clock at the click: an open tab must not offer a time that has passed.
    const current = new Date();
    if (!openIntervals(date, [...plannedIntervals(date, scheduled), ...busyIntervals(date, busyWindows)], from, to, current).some((gap) => gap.start <= start && gap.end >= start + minutes)) { setNow(current); return; }
    onSchedule(selected?.id, localDayKey(date), clockValue(start), minutes);
  }
  function quickSchedule(item: SyncIntention) {
    const fit = earliestFit(item);
    if (fit) onSchedule(item.id, localDayKey(fit.date), clockValue(fit.start), fit.duration);
  }
  return <section className="time-perspective" aria-label="Open space">
    <div className="time-perspective-intro"><h2>Find a little room.</h2><p>Choose an intention, then a gap that gives it enough time. Leaving space is welcome, too.</p></div>
    <div className="space-controls">
      <label className="select-field">From<span className="select-field-control"><select value={from} onChange={(event) => setFrom(Number(event.target.value))}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour * 60}>{clockLabel(hour * 60)}</option>)}</select><UiIcon name="chevron-down" className="select-field-chevron" /></span></label>
      <label className="select-field">Until<span className="select-field-control"><select value={to} onChange={(event) => setTo(Number(event.target.value))}>{Array.from({ length: 24 }, (_, index) => <option key={index} value={(index + 1) * 60}>{index === 23 ? 'Midnight' : clockLabel((index + 1) * 60)}</option>)}</select><UiIcon name="chevron-down" className="select-field-chevron" /></span></label>
      <label className="select-field">Time needed<span className="select-field-control"><select value={minutes} disabled={Boolean(selected)} onChange={(event) => setDuration(Number(event.target.value))}>{[...new Set([15, 30, 45, 60, 90, minutes])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{durationLabel(value)}</option>)}</select><UiIcon name="chevron-down" className="select-field-chevron" /></span></label>
      <label className="select-field">Energy / context<span className="select-field-control"><select value={energy} onChange={(event) => { setEnergy(event.target.value); setSelectedId(''); }}><option value="">Any context</option>{energies.map((value) => <option key={value}>{value}</option>)}</select><UiIcon name="chevron-down" className="select-field-chevron" /></span></label>
    </div>
    <p className="time-perspective-note">{availabilityChecked ? 'Uses your planned time and the latest checked Google busy times.' : 'Uses ClearHead plans only. Other calendar commitments may still occupy these gaps.'} Times use your device’s timezone.</p>
    <div className="open-space-layout"><aside className="space-intentions"><h3>Looking for a moment</h3>
    <div className="space-intention-row"><button className={`space-intention ${!selected ? 'selected' : ''}`} aria-pressed={!selected} onClick={() => setSelectedId('')}><b>Choose an intention later</b><small>Pick a gap first</small></button></div>
    {candidates.map((item) => { const fit = earliestFit(item); return <div className="space-intention-row" key={item.id}><button className={`space-intention ${selected?.id === item.id ? 'selected' : ''}`} aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><b>{item.title}</b><small>{durationLabel(intentionDuration(item))}{!item.effortEstimate ? ' · suggested duration' : ''}{item.energyContext ? ` · ${item.energyContext}` : ''}</small></button>{fit ? <button className="space-suggest" onClick={() => quickSchedule(item)}>Suggest {clockLabel(fit.start)}</button> : <span className="space-no-fit">Needs more room</span>}</div>; })}
    {!candidates.length ? <p className="time-perspective-note">{waiting.length ? 'No waiting intentions match this context.' : 'No unscheduled intentions. You can still choose a gap to plan another session.'}</p> : null}{selected ? <button className="outline-button" onClick={() => onOpen(selected.id)}>Open selected intention</button> : null}</aside>
    <div className="space-gaps" aria-live="polite">{from >= to ? <p className="time-perspective-empty">Choose an end time later than the start.</p> : visibleGaps.every(({ gaps }) => !gaps.length) ? <div className="time-perspective-empty"><h3>No openings of {durationLabel(minutes)} in this range.</h3><p>Try another day, widen the hours, or choose a shorter intention.</p></div> : visibleGaps.map(({ date, gaps }) => <section className="space-gap-day" key={localDayKey(date)}><h3>{date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</h3>{gaps.length ? gaps.map((gap) => <button className="space-gap" key={gap.start} onClick={() => chooseGap(date, gap.start)} aria-label={`Plan ${selected?.title ?? 'an intention'} on ${localDayKey(date)} at ${clockLabel(gap.start)} for ${minutes} minutes`}><span><b>{clockLabel(gap.start)} – {gap.end === 1440 ? 'midnight' : clockLabel(gap.end)}</b><small>{durationLabel(gap.end - gap.start)} unplanned</small></span><span>Set aside {durationLabel(minutes)} <span aria-hidden="true">＋</span></span></button>) : <p className="time-perspective-note">No remaining gap long enough.</p>}</section>)}</div></div>
  </section>;
}

export function Rhythm({ days, scheduled, busyWindows, availabilityChecked, onChooseDay }: {
  days: Date[]; scheduled: ScheduledIntention[]; busyWindows: BusyWindow[]; availabilityChecked: boolean; onChooseDay: (date: Date) => void;
}) {
  const rows = days.map((date) => {
    const planned = plannedIntervals(date, scheduled); const busy = busyIntervals(date, busyWindows);
    const plannedDaytime = occupiedMinutes(planned, 540, 1020);
    const occupied = occupiedMinutes([...planned, ...busy], 540, 1020);
    return { date, planned: occupiedMinutes(planned), daytime: plannedDaytime, busy: occupied - plannedDaytime, open: 480 - occupied };
  });
  const purposeTotals = new Map<string, number>();
  for (const { item, block } of scheduled) {
    const minutes = days.reduce((total, date) => total + occupiedMinutes(plannedIntervals(date, [{ item, block }])), 0);
    if (minutes) { const purpose = item.purpose?.trim() || 'Without a purpose yet'; purposeTotals.set(purpose, (purposeTotals.get(purpose) ?? 0) + minutes); }
  }
  const purposes = [...purposeTotals].sort((a, b) => b[1] - a[1]);
  return <section className="time-perspective" aria-label="Rhythm"><div className="time-perspective-intro"><h2>A week with room to breathe.</h2><p>See how your commitments fall across the week, and leave space where you need it.</p></div>
    <div className="rhythm-summary"><div><b>{durationLabel(rows.reduce((sum, row) => sum + row.planned, 0))}</b><span>Planned across the week, all hours</span></div><div><b>{durationLabel(rows.reduce((sum, row) => sum + row.open, 0))}</b><span>Unplanned between 9am and 5pm</span></div><div><b>{rows.filter((row) => !row.planned).length} days</b><span>Without a ClearHead commitment</span></div></div>
    <div className="rhythm-legend"><span><i className="rhythm-planned" />Planned</span>{availabilityChecked ? <span><i className="rhythm-busy" />Other busy time</span> : null}<span><i className="rhythm-open" />Unplanned</span></div>
    <div className="rhythm-chart">{rows.map((row) => <button key={localDayKey(row.date)} className="rhythm-row" onClick={() => onChooseDay(row.date)} aria-label={`${row.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}: ${durationLabel(row.planned)} planned across the day, ${durationLabel(row.open)} unplanned between 9am and 5pm. Open day calendar.`}><span className="rhythm-date"><b>{row.date.toLocaleDateString(undefined, { weekday: 'short' })}</b><small>{row.date.getDate()}</small></span><span className="rhythm-bar" aria-hidden="true"><i className="rhythm-planned" style={{ width: `${row.daytime / 480 * 100}%` }} /><i className="rhythm-busy" style={{ width: `${row.busy / 480 * 100}%` }} /><i className="rhythm-open" style={{ width: `${row.open / 480 * 100}%` }} /></span><span className="rhythm-row-copy">{durationLabel(row.open)} unplanned</span></button>)}</div>
    <p className="time-perspective-note">Bars summarize 9am–5pm; they do not show exact start times. Overlapping commitments count once. {availabilityChecked ? 'Includes checked Google busy times.' : 'Google availability has not been checked for this week.'}</p>
    <div className="rhythm-purpose"><h3>What you’re making room for</h3><p className="time-perspective-note">Scheduled session time grouped by each intention’s purpose. This is planned time, not tracked activity.</p>{purposes.length ? purposes.map(([purpose, minutes]) => <div key={purpose}><span>{purpose}</span><b>{durationLabel(minutes)}</b></div>) : <p className="time-perspective-empty">Your week is open. Add a little time when an intention feels ready.</p>}</div>
  </section>;
}
