import {z} from 'zod';
import {type RequestState, type ShuttleFeed} from './feed';

export const scenarioSchema = z.enum(['estimated', 'inbound', 'unconfigured', 'ambiguous', 'stale', 'offline', 'loading', 'empty', 'scheduled']);
export type Scenario = z.infer<typeof scenarioSchema>;
export const scenarios: {id: Scenario; label: string}[] = [
  {id: 'estimated', label: 'To Fehren'}, {id: 'inbound', label: 'To campus'},
  {id: 'unconfigured', label: 'Learning'}, {id: 'ambiguous', label: 'Ambiguous'},
  {id: 'stale', label: 'Stale feed'}, {id: 'offline', label: 'Unavailable'},
  {id: 'loading', label: 'Loading'}, {id: 'empty', label: 'No observations'},
  {id: 'scheduled', label: 'Scheduled'},
];
export const sourceSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('sample'), scenario: scenarioSchema}),
  z.object({kind: z.literal('api'), endpoint: z.string()}),
]);
export type Source = z.infer<typeof sourceSchema>;
export function sourceKey(source: Source): string {
  return source.kind === 'api' ? source.endpoint : `sample:${source.scenario}`;
}
export function sampleState(scenario: Scenario, now: number): RequestState {
  const key = `sample:${scenario}`;
  if (scenario === 'loading') return {kind: 'loading', sourceKey: key, feed: null};
  const stamp = (offset: number) => new Date(now + offset).toISOString();
  const direction = scenario === 'inbound' ? 'inbound' : 'outbound';
  const feed: ShuttleFeed = {
    status: 'sample', lastCheckedAt: stamp(scenario === 'stale' ? -300_000 : 0),
    latest: {checkpoint: 'BEI campus corner', eventAt: stamp(-120_000), receivedAt: stamp(-110_000)},
    eventCount: 12,
    prediction: {
      status: 'estimated', generatedAt: stamp(0), direction, anchor: 'camera',
      rangeSeconds: [180, 420], rangeKind: 'heuristic-not-calibrated',
      estimatedArrivalAt: stamp(300_000), historyCount: 0,
      marker: {direction, progress: .38, lower: .2, upper: .6},
    },
  };
  if (scenario === 'unconfigured' || scenario === 'ambiguous' || scenario === 'empty' || scenario === 'scheduled') {
    feed.prediction = {
      status: scenario === 'empty' ? 'unknown' : scenario,
      generatedAt: stamp(0), marker: null,
      nextCrossingAt: scenario === 'scheduled' ? stamp(900_000) : null,
    };
  }
  if (scenario === 'empty') {feed.latest = null; feed.eventCount = 0;}
  if (scenario === 'offline') return {kind: 'failed', sourceKey: key, feed};
  return {kind: 'ready', sourceKey: key, feed, fetchedAt: now};
}
