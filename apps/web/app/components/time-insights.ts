import type { SyncBlock, SyncIntention } from '../lib/sync.client';
import { dayInterval } from './time-timeline';

export type ScheduledIntention = { item: SyncIntention; block: SyncBlock };
export type BusyWindow = { start: string; end: string };
export type MinuteRange = { start: number; end: number };
export const localDayKey = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
export const clockValue = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const clockLabel = (minutes: number) => new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const durationLabel = (minutes: number) => minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
export const intentionDuration = (item: SyncIntention) => item.effortEstimate && item.effortEstimate > 0 ? Math.ceil(item.effortEstimate) : 30;

export function plannedIntervals(date: Date, scheduled: ScheduledIntention[]) {
  return scheduled.flatMap(({ block }) => {
    const start = new Date(`${block.date}T${block.time}`);
    const interval = dayInterval(date, start, new Date(start.getTime() + block.duration * 60_000));
    return interval ? [interval] : [];
  });
}
export function busyIntervals(date: Date, busy: BusyWindow[]) {
  return busy.flatMap((window) => {
    const interval = dayInterval(date, new Date(window.start), new Date(window.end));
    return interval ? [interval] : [];
  });
}
export function mergeIntervals(intervals: MinuteRange[], from = 0, to = 1440): MinuteRange[] {
  const sorted = intervals.map(({ start, end }) => ({ start: Math.max(from, start), end: Math.min(to, end) })).filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start).sort((a, b) => a.start - b.start);
  const merged: MinuteRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}
export const occupiedMinutes = (intervals: MinuteRange[], from = 0, to = 1440) => mergeIntervals(intervals, from, to).reduce((sum, range) => sum + range.end - range.start, 0);

export function openIntervals(date: Date, intervals: MinuteRange[], from: number, to: number, now = new Date()): MinuteRange[] {
  const key = localDayKey(date);
  if (key < localDayKey(now) || from >= to) return [];
  let cursor = key === localDayKey(now) ? Math.max(from, Math.ceil((now.getHours() * 60 + now.getMinutes() + (now.getSeconds() || now.getMilliseconds() ? 1 : 0)) / 15) * 15) : from;
  const gaps: MinuteRange[] = [];
  for (const range of mergeIntervals(intervals, cursor, to)) {
    if (range.start > cursor) gaps.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < to) gaps.push({ start: cursor, end: to });
  return gaps;
}
