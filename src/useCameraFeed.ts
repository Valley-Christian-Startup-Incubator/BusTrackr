import {useEffect, useState} from 'react';
import {feedSchema, type ShuttleFeed} from '../mobile/src/shuttle/feed';

export const feedEndpoint = import.meta.env.VITE_ALERT_API_URL || (import.meta.env.DEV ? '/api/shuttle' : 'https://bustrackr.valleychristianai.com/api/shuttle');
export type CameraFeed = ReturnType<typeof useCameraFeed>;

export function useCameraFeed() {
  const [feed, setFeed] = useState<ShuttleFeed | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [active, setActive] = useState(() => !document.hidden);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const visibility = () => {setActive(!document.hidden); setFetchedAt(0); setNow(Date.now());};
    document.addEventListener('visibilitychange', visibility);
    return () => {clearInterval(timer); document.removeEventListener('visibilitychange', visibility);};
  }, []);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function poll() {
      try {
        const response = await fetch(feedEndpoint, {cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)])});
        if (!response.ok) throw new Error('Feed unavailable');
        const result = feedSchema.parse(await response.json());
        if (!disposed) {setFeed(result); setError(''); setNow(Date.now()); setFetchedAt(Date.now());}
      } catch {
        if (!disposed) setError('Feed unavailable. Showing the last saved sighting.');
      } finally {
        if (!disposed) timer = setTimeout(poll, 10_000);
      }
    }
    void poll();
    return () => {disposed = true; clearTimeout(timer); abort.abort();};
  }, [active, revision]);
  const checkedAge = feed?.lastCheckedAt ? now - Date.parse(feed.lastCheckedAt) : Infinity;
  const fresh = active && !error && fetchedAt > 0 && now - fetchedAt <= 45_000 && checkedAge >= -30_000 && checkedAge <= 120_000 && ['connected', 'sample'].includes(feed?.status || '');
  return {feed, error, now, active, fresh, refresh: () => setRevision(value => value + 1)};
}
