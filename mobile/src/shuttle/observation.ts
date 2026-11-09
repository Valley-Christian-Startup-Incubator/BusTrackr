export type ObservationAge =
  | {kind: 'observed'; minutes: number; color: string}
  | {kind: 'missing' | 'clock-error'};

export function observationAge(eventAt: string | null | undefined, now: number): ObservationAge {
  const timestamp = eventAt ? Date.parse(eventAt) : NaN;
  if (!Number.isFinite(timestamp)) return {kind: 'missing'};
  if (timestamp > now) return {kind: 'clock-error'};
  const elapsed = (now - timestamp) / 60_000;
  const stops = [[22, 114, 72], [148, 98, 0], [179, 50, 43]];
  const progress = Math.min(10, elapsed) / 5;
  const index = Math.min(1, Math.floor(progress));
  const ratio = progress - index;
  const color = '#' + stops[index].map((channel, i) =>
    Math.round(channel + (stops[index + 1][i] - channel) * ratio).toString(16).padStart(2, '0')).join('');
  return {kind: 'observed', minutes: Math.floor(elapsed), color};
}

export function relativeObservationTime(minutes: number): {value: string; unit: string; label: string} {
  if (minutes < 1) return {value: '<1', unit: 'minute', label: 'Less than a minute ago'};
  const units = [
    {minutes: 525600, name: 'year'},
    {minutes: 43200, name: 'month'},
    {minutes: 1440, name: 'day'},
    {minutes: 60, name: 'hour'},
    {minutes: 1, name: 'minute'},
  ];
  const scale = units.find(unit => minutes >= unit.minutes)!;
  const count = Math.floor(minutes / scale.minutes);
  const value = count.toLocaleString('en-US');
  const unit = scale.name + (count === 1 ? '' : 's');
  return {value, unit, label: `${value} ${unit} ago`};
}

const pacificDay = (time: number) => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles'}).format(time);

// A sighting from an earlier Pacific day reads as "no bus yet today" rather than a large stale age.
export function earlierDaySighting(eventAt: string, now: number): string | null {
  const timestamp = Date.parse(eventAt);
  const days = Math.round((Date.parse(pacificDay(now)) - Date.parse(pacificDay(timestamp))) / 86_400_000);
  if (!(days > 0)) return null;
  const format = (options: Intl.DateTimeFormatOptions) => new Date(timestamp).toLocaleString('en-US', {timeZone: 'America/Los_Angeles', ...options});
  const time = format({hour: 'numeric', minute: '2-digit'});
  const day = days === 1 ? 'yesterday' : days < 7 ? format({weekday: 'long'}) : format({month: 'short', day: 'numeric'});
  return `Last seen ${day} at ${time}`;
}
