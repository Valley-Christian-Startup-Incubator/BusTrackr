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
