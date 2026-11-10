import {useRef, useState} from 'react';
import {feedEndpoint} from './useCameraFeed';

const feedbackEndpoint = feedEndpoint.replace(/\/api\/shuttle$/, '/api/feedback');
export type Verdict = 'arrived' | 'false-alarm' | 'wrong';
export type Stop = 'fehren' | 'campus';

export function useFeedbackReport(view: 'simple' | 'map') {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  // One id per verdict and stop, so a retry after a lost response is stored once.
  const ids = useRef<Record<string, string>>({});
  async function send(verdict: Verdict, stop: Stop | null = null) {
    setState('sending');
    const release = document.querySelector<HTMLMetaElement>('meta[name="bustrackr-release"]')?.content || null;
    try {
      const response = await fetch(feedbackEndpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({id: ids.current[`${verdict}:${stop}`] ??= crypto.randomUUID(), verdict, view, stop, release})});
      setState(response.ok ? 'sent' : 'failed');
    } catch {setState('failed');}
  }
  return {state, send};
}
