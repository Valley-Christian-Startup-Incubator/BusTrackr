import {useEffect} from 'react';
import type {CameraFeed} from './useCameraFeed';
import {observationAge} from '../mobile/src/shuttle/observation';
export type EstimatedMarker = {direction: 'inbound' | 'outbound'; progress: number; lower: number; upper: number};
const reasons = {
  unconfigured: 'Waiting for a confirmed timetable and checkpoint direction.',
  ambiguous: 'More than one run could match this sighting. Position hidden.',
  scheduled: 'Waiting for the next scheduled run.',
  unknown: 'No active journey is confirmed.',
  offline: 'The feed is offline. Estimates are hidden.',
};
export function CameraPanel({camera, onMarker, onLocate}: {camera: CameraFeed; onMarker: (marker: EstimatedMarker | null) => void; onLocate: () => void}) {
  const {feed, error, now, fresh} = camera;
  const prediction = feed?.prediction;
  const predictionAge = prediction ? now - Date.parse(prediction.generatedAt) : Infinity;
  const estimated = !error && fresh && predictionAge >= -30_000 && predictionAge <= 45_000 && prediction?.status === 'estimated' && Date.parse(prediction.estimatedArrivalAt) > now ? prediction : null;
  const marker = estimated?.marker ?? null;
  useEffect(() => {onMarker(marker); return () => onMarker(null);}, [marker, onMarker]);
  const observation = observationAge(feed?.latest?.eventAt, now);
  const minutes = observation.kind === 'observed' ? observation.minutes : null;
  const age = minutes === null ? '' : minutes === 0 ? 'Less than a minute' : `${minutes.toLocaleString()} minute${minutes === 1 ? '' : 's'}`;
  return <aside className="camera-panel" aria-label="Camera arrival estimates">
    <div className="card-header"><div><span className="eyebrow">Camera checkpoint</span><h2>Where's the shuttle?</h2></div><span className="demo-pill">{feed?.status === 'sample' ? 'SAMPLE' : 'ESTIMATE'}</span></div>
    <p role="status">{error || (feed && !fresh ? 'Feed update is stale. Estimates hidden.' : feed?.status === 'sample' ? 'Sample data · illustrative timetable' : feed?.status === 'connected' ? 'Feed connected' : feed?.status === 'disconnected' ? 'Feed offline · last observation may be stale' : 'Connecting to camera feed…')}</p>
    {feed?.latest ? <div className="camera-observation"><strong>Vehicle detected at {feed.latest.checkpoint}</strong>{feed.latest.eventAt ? <><p>{observation.kind === 'clock-error' ? 'Camera clock is ahead' : `${age} ago`}</p><time dateTime={feed.latest.eventAt}>{new Date(feed.latest.eventAt).toLocaleString('en-US', {timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'})}</time></> : <p>Camera time unavailable. Email received {new Date(feed.latest.receivedAt).toLocaleString('en-US', {timeZone: 'America/Los_Angeles'})} Pacific time.</p>}</div> : <p>No camera observations received yet.</p>}
    {estimated ? <div className="camera-estimate"><strong>Estimated position · {estimated.direction === 'inbound' ? 'To campus' : 'To Fehren'}</strong><p>Arrival in about {Math.max(1, Math.ceil((Date.parse(estimated.estimatedArrivalAt) - now) / 60_000))} min</p><small className="estimate-context">Approximate range: {Math.floor(Math.max(0, estimated.rangeSeconds[0] - Math.max(0, predictionAge) / 1000) / 60)}–{Math.ceil(Math.max(0, estimated.rangeSeconds[1] - Math.max(0, predictionAge) / 1000) / 60)} min · uncalibrated</small><p className="estimate-context">{estimated.anchor === 'camera' ? 'Anchored to a camera sighting' : 'Based on timetable and recent delays'}</p><button className="follow-button" onClick={onLocate}>Locate estimate</button></div> : <p>{error || !fresh ? 'Estimated marker hidden.' : prediction?.status && prediction.status !== 'estimated' ? reasons[prediction.status] : 'Waiting for an estimate.'}</p>}
    <p className="camera-note">The amber marker and highlighted route show an estimate, not GPS. A sighting does not establish identity, direction or departure. {feed?.eventCount || 0} camera emails saved.</p>
  </aside>;
}
