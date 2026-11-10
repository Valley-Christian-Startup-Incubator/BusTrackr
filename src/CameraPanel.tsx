import {useEffect} from 'react';
import type {CameraFeed} from './useCameraFeed';
import {useFeedbackReport} from './useFeedbackReport';
import {observationAge, relativeObservationTime} from '../mobile/src/shuttle/observation';
export type EstimatedMarker = {direction: 'inbound' | 'outbound'; progress: number; lower: number; upper: number};
const reasons = {
  unconfigured: 'Still learning. A pass is predicted once the camera has seen it on two days.',
  ambiguous: 'More than one run could match this sighting. Position hidden.',
  scheduled: 'Next pass learned from past sightings.',
  unknown: 'No active journey is confirmed.',
  offline: 'The feed is offline. Estimates are hidden.',
};
function PredictionFeedback({estimated}: {estimated: boolean}) {
  const {state, send} = useFeedbackReport('map');
  if (state === 'sent') return <p className="prediction-feedback" role="status">Thanks. Your report is saved with this estimate.</p>;
  return <div className="prediction-feedback" role="group" aria-label="Report on this estimate">
    <span>{estimated ? 'Is this estimate right? The bus is here:' : 'Seeing the bus? It is here:'}</span>
    <div><button data-analytics="feedback_arrived" type="button" disabled={state === 'sending'} onClick={() => send('arrived', 'fehren')}>At Fehren</button>
    <button data-analytics="feedback_arrived" type="button" disabled={state === 'sending'} onClick={() => send('arrived', 'campus')}>At campus</button>
    {estimated && <button data-analytics="feedback_wrong" type="button" disabled={state === 'sending'} onClick={() => send('wrong')}>Looks wrong</button>}</div>
    {state === 'failed' && <p role="alert">Couldn't send your report. Try again.</p>}
  </div>;
}
export function CameraPanel({camera, onMarker, onLocate}: {camera: CameraFeed; onMarker: (marker: EstimatedMarker | null) => void; onLocate: () => void}) {
  const {feed, error, now, fresh} = camera;
  const prediction = feed?.prediction;
  const predictionAge = prediction ? now - Date.parse(prediction.generatedAt) : Infinity;
  const estimated = !error && fresh && predictionAge >= -30_000 && predictionAge <= 45_000 && prediction?.status === 'estimated' && Date.parse(prediction.estimatedArrivalAt) > now ? prediction : null;
  const marker = estimated?.marker ?? null;
  useEffect(() => {onMarker(marker); return () => onMarker(null);}, [marker, onMarker]);
  const observation = observationAge(feed?.latest?.eventAt, now);
  const minutes = observation.kind === 'observed' ? observation.minutes : null;
  const age = minutes === null ? '' : relativeObservationTime(minutes).label;
  return <aside className="camera-panel" aria-label="Camera arrival estimates">
    <div className="card-header"><div><span className="eyebrow">Camera checkpoint</span><h2>Where's the shuttle?</h2></div><span className="demo-pill">{feed?.status === 'sample' ? 'SAMPLE' : 'ESTIMATE'}</span></div>
    <p role="status">{error || (feed && !fresh ? 'Feed update is stale. Estimates hidden.' : feed?.status === 'sample' ? 'Sample data · illustrative history' : feed?.status === 'connected' ? 'Feed connected' : feed?.status === 'disconnected' ? 'Feed offline · last observation may be stale' : 'Connecting to camera feed…')}</p>
    {feed?.latest ? <div className="camera-observation"><strong>Vehicle detected at {feed.latest.checkpoint}</strong>{feed.latest.eventAt ? <><p>{observation.kind === 'clock-error' ? 'Camera clock is ahead' : age}</p><time dateTime={feed.latest.eventAt}>{new Date(feed.latest.eventAt).toLocaleString('en-US', {timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'})}</time></> : <p>Camera time unavailable. Email received {new Date(feed.latest.receivedAt).toLocaleString('en-US', {timeZone: 'America/Los_Angeles'})} Pacific time.</p>}</div> : <p>No camera observations received yet.</p>}
    {estimated ? <div className="camera-estimate"><strong>Estimated position · {estimated.direction === 'inbound' ? 'To campus' : 'To Fehren'}</strong><p>Arrival in about {Math.max(1, Math.ceil((Date.parse(estimated.estimatedArrivalAt) - now) / 60_000))} min</p><small className="estimate-context">Approximate range: {Math.floor(Math.max(0, estimated.rangeSeconds[0] - Math.max(0, predictionAge) / 1000) / 60)}–{Math.ceil(Math.max(0, estimated.rangeSeconds[1] - Math.max(0, predictionAge) / 1000) / 60)} min · uncalibrated</small><p className="estimate-context">{estimated.anchor === 'camera' ? 'Camera sighting plus the trip time riders reported' : 'Based on the pattern learned from past sightings'}</p><button data-analytics="estimate_locate" className="follow-button" onClick={onLocate}>Locate estimate</button></div> : <p>{error || !fresh ? 'Estimated marker hidden.' : prediction?.status === 'scheduled' && prediction.nextCrossingAt ? `Next pass expected around ${new Date(prediction.nextCrossingAt).toLocaleString('en-US', {timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit'})}, learned from past sightings.` : prediction?.status && prediction.status !== 'estimated' ? reasons[prediction.status] : 'Waiting for an estimate.'}</p>}
    {!error && fresh && <PredictionFeedback estimated={!!estimated}/>}
    <p className="camera-note">The amber marker and highlighted route show an estimate, not GPS. A sighting does not establish identity, direction or departure. {feed?.eventCount || 0} camera emails saved.</p>
  </aside>;
}
