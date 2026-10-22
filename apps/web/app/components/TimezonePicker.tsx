import { zoneCityName } from './time-timeline';
import { UiIcon } from './UiIcon';

const FALLBACK_ZONES = [
  'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Sao_Paulo', 'Atlantic/Reykjavik', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Africa/Cairo', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok',
  'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland',
];

function availableZones(): string[] {
  try { return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : FALLBACK_ZONES; }
  catch { return FALLBACK_ZONES; }
}

/** Pins a short list of other timezones to show alongside the day timeline. */
export function TimezonePicker({ value, max = 3, onChange }: { value: string[]; max?: number; onChange: (next: string[]) => void }) {
  const options = availableZones().filter((zone) => !value.includes(zone)).sort((a, b) => zoneCityName(a).localeCompare(zoneCityName(b)));
  return <div className="timezone-picker">
    <div className="timezone-chips">
      {value.length ? value.map((zone) => <span className="timezone-chip" key={zone}>{zoneCityName(zone)}<button type="button" aria-label={`Remove ${zoneCityName(zone)}`} onClick={() => onChange(value.filter((item) => item !== zone))}>×</button></span>)
        : <span className="timezone-empty">None pinned yet</span>}
    </div>
    {value.length < max ? <span className="select-field-control"><select aria-label="Pin a timezone" value="" onChange={(event) => { const zone = event.target.value; if (zone) onChange([...value, zone]); }}>
      <option value="">+ Add a city…</option>
      {options.map((zone) => <option key={zone} value={zone}>{zoneCityName(zone)} ({zone})</option>)}
    </select><UiIcon name="chevron-down" className="select-field-chevron" /></span> : <p className="timezone-limit">Up to {max} pinned at a time. Remove one to add another.</p>}
  </div>;
}
