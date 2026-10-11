import { useEffect, useState } from 'react';
import type { SyncIntention } from '../lib/sync.client';
import { busyIntervals, clockLabel, clockValue, durationLabel, intentionDuration, localDayKey, occupiedMinutes, openIntervals, plannedIntervals, type BusyWindow, type ScheduledIntention } from './time-insights';

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
  const waiting = items.filter((item) => item.status !== 'completed' && item.status !== 'archived' && !item.blocks?.length);
  const energies = [...new Set(waiting.map((item) => item.energyContext?.trim()).filter((value): value is string => Boolean(value)))];
  const candidates = waiting.filter((item) => !energy || item.energyContext?.trim() === energy);
  const selected = candidates.find((item) => item.id === selectedId);
  const minutes = selected ? intentionDuration(selected) : duration;
  const dayGaps = days.map((date) => ({ date, gaps: openIntervals(date, [...plannedIntervals(date, scheduled), ...busyIntervals(date, busyWindows)], from, to, now) }));
  const fittingIds = new Set(candidates.filter((item) => dayGaps.some(({ gaps }) => gaps.some((gap) => gap.end - gap.start >= intentionDuration(item)))).map((item) => item.id));
  const visibleGaps = dayGaps.map(({ date, gaps }) => ({ date, gaps: gaps.filter((gap) => gap.end - gap.start >= minutes) }));
  function chooseGap(date: Date, start: number) {
    // Recheck the clock at the click: an open tab must not offer a time that has passed.
    const current = new Date();
    if (!openIntervals(date, [...plannedIntervals(date, scheduled), ...busyIntervals(date, busyWindows)], from, to, current).some((gap) => gap.start <= start && gap.end >= start + minutes)) { setNow(current); return; }
    onSchedule(selected?.id, localDayKey(date), clockValue(start), minutes);
  }
  return <section className="time-perspective" aria-label="Open space">
    <div className="time-perspective-intro"><h2>Find a little room.</h2><p>Choose an intention, then a gap that gives it enough time. Leaving space is welcome, too.</p></div>
    <div className="space-controls"><label>From<select value={from} onChange={(event) => setFrom(Number(event.target.value))}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour * 60}>{clockLabel(hour * 60)}</option>)}</select></label><label>Until<select value={to} onChange={(event) => setTo(Number(event.target.value))}>{Array.from({ length: 24 }, (_, index) => <option key={index} value={(index + 1) * 60}>{index === 23 ? 'Midnight' : clockLabel((index + 1) * 60)}</option>)}</select></label><label>Time needed<select value={minutes} disabled={Boolean(selected)} onChange={(event) => setDuration(Number(event.target.value))}>{[...new Set([15, 30, 45, 60, 90, minutes])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{durationLabel(value)}</option>)}</select></label><label>Energy / context<select value={energy} onChange={(event) => { setEnergy(event.target.value); setSelectedId(''); }}><option value="">Any context</option>{energies.map((value) => <option key={value}>{value}</option>)}</select></label></div>
    <p className="time-perspective-note">{availabilityChecked ? 'Uses your planned time and the latest checked Google busy times.' : 'Uses Veylo plans only. Other calendar commitments may still occupy these gaps.'} Times use your device’s timezone.</p>
    <div className="open-space-layout"><aside className="space-intentions"><h3>Looking for a moment</h3><button className={`space-intention ${!selected ? 'selected' : ''}`} aria-pressed={!selected} onClick={() => setSelectedId('')}><b>Choose an intention later</b><small>Pick a gap first</small></button>{candidates.map((item) => <button className={`space-intention ${selected?.id === item.id ? 'selected' : ''}`} key={item.id} aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><b>{item.title}</b><small>{durationLabel(intentionDuration(item))}{!item.effortEstimate ? ' · suggested duration' : ''}{item.energyContext ? ` · ${item.energyContext}` : ''}</small><small>{fittingIds.has(item.id) ? 'Fits an opening' : 'Needs a larger opening'}</small></button>)}{!candidates.length ? <p className="time-perspective-note">{waiting.length ? 'No waiting intentions match this context.' : 'No unscheduled intentions. You can still choose a gap to plan another session.'}</p> : null}{selected ? <button className="outline-button" onClick={() => onOpen(selected.id)}>Open selected intention</button> : null}</aside>
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
    <div className="rhythm-summary"><div><b>{durationLabel(rows.reduce((sum, row) => sum + row.planned, 0))}</b><span>Planned across the week, all hours</span></div><div><b>{durationLabel(rows.reduce((sum, row) => sum + row.open, 0))}</b><span>Unplanned between 9am and 5pm</span></div><div><b>{rows.filter((row) => !row.planned).length} days</b><span>Without a Veylo commitment</span></div></div>
    <div className="rhythm-legend"><span><i className="rhythm-planned" />Planned</span>{availabilityChecked ? <span><i className="rhythm-busy" />Other busy time</span> : null}<span><i className="rhythm-open" />Unplanned</span></div>
    <div className="rhythm-chart">{rows.map((row) => <button key={localDayKey(row.date)} className="rhythm-row" onClick={() => onChooseDay(row.date)} aria-label={`${row.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}: ${durationLabel(row.planned)} planned across the day, ${durationLabel(row.open)} unplanned between 9am and 5pm. Open day calendar.`}><span className="rhythm-date"><b>{row.date.toLocaleDateString(undefined, { weekday: 'short' })}</b><small>{row.date.getDate()}</small></span><span className="rhythm-bar" aria-hidden="true"><i className="rhythm-planned" style={{ width: `${row.daytime / 480 * 100}%` }} /><i className="rhythm-busy" style={{ width: `${row.busy / 480 * 100}%` }} /><i className="rhythm-open" style={{ width: `${row.open / 480 * 100}%` }} /></span><span className="rhythm-row-copy">{durationLabel(row.open)} unplanned</span></button>)}</div>
    <p className="time-perspective-note">Bars summarize 9am–5pm; they do not show exact start times. Overlapping commitments count once. {availabilityChecked ? 'Includes checked Google busy times.' : 'Google availability has not been checked for this week.'}</p>
    <div className="rhythm-purpose"><h3>What you’re making room for</h3><p className="time-perspective-note">Scheduled session time grouped by each intention’s purpose. This is planned time, not tracked activity.</p>{purposes.length ? purposes.map(([purpose, minutes]) => <div key={purpose}><span>{purpose}</span><b>{durationLabel(minutes)}</b></div>) : <p className="time-perspective-empty">Your week is open. Add a little time when an intention feels ready.</p>}</div>
  </section>;
}

export function Focus({ date, items, scheduled, onOpen, onSchedule, onComplete }: PerspectiveProps & { date: Date; items: SyncIntention[]; onComplete: (id: string) => void }) {
  const [selectedId, setSelectedId] = useState('');
  const dayScheduled = scheduled.filter(({ item, block }) => item.status !== 'completed' && block.date === localDayKey(date));
  const available = items.filter((item) => item.status !== 'completed' && item.status !== 'archived');
  const ordered = [...new Map([...dayScheduled.map(({ item }) => item), ...available].map((item) => [item.id, item])).values()];
  const selected = ordered.find((item) => item.id === selectedId) ?? ordered[0];
  const sessions = dayScheduled.filter(({ item }) => item.id === selected?.id);
  return <section className="time-perspective focus-perspective" aria-label="Focus"><div className="time-perspective-intro"><h2>One intention, a little attention.</h2><p>Keep what matters and your next step in sight.</p></div>{selected ? <><label className="focus-picker">Bring into focus<select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{ordered.map((item) => <option key={item.id} value={item.id}>{item.title}{dayScheduled.some(({ item: planned }) => planned.id === item.id) ? ' · planned this day' : ''}</option>)}</select></label><article className="focus-intention"><div className="focus-allocation">{sessions.length ? sessions.map(({ block }) => <span key={block.id}>{block.time} · {durationLabel(block.duration)}</span>) : <span>{durationLabel(intentionDuration(selected))}{selected.effortEstimate ? ' estimated' : ' suggested'} · no time set aside this day</span>}{selected.energyContext ? <span>{selected.energyContext}</span> : null}</div><h3>{selected.title}</h3><dl><div><dt>Why it matters</dt><dd>{selected.purpose?.trim() || selected.intent?.trim() || 'What makes this worth your attention? You can add a purpose in the intention.'}</dd></div><div><dt>Your next step</dt><dd>{selected.roughPlan?.trim() || 'Choose one small action to begin. Open this intention to give it a plan.'}</dd></div>{selected.desiredOutcome?.trim() ? <div><dt>What you’re working toward</dt><dd>{selected.desiredOutcome}</dd></div> : null}</dl><div className="focus-actions"><button className="capture-button" onClick={() => onComplete(selected.id)}>Mark intention complete</button><button className="outline-button" onClick={() => onOpen(selected.id)}>Open intention</button><button className="outline-button" onClick={() => onSchedule(selected.id, localDayKey(date), undefined, intentionDuration(selected))}>Set aside time</button></div><p className="time-perspective-note">Complete marks the whole intention done, including intentions with more than one session.</p></article></> : <div className="time-perspective-empty"><h3>Nothing waiting for your attention.</h3><p>Capture a thought in Your space when something comes to mind.</p></div>}</section>;
}
