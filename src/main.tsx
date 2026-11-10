import {lazy, Suspense, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {earlierDaySighting, observationAge, relativeObservationTime} from '../mobile/src/shuttle/observation';
import {useCameraFeed, type CameraFeed} from './useCameraFeed';
import {WebNotifications} from './WebNotifications';
import {useFeedbackReport} from './useFeedbackReport';
import './simple.css';

const MapApp = lazy(() => import('./MapApp'));
type Mode = 'simple' | 'map';
const modeKey = 'bustrackr.view.v1';
function initialMode(): Mode {
  try {return localStorage.getItem(modeKey) === 'map' ? 'map' : 'simple';} catch {return 'simple';}
}
function ModeControl({mode, onChange}: {mode: Mode; onChange: (mode: Mode) => void}) {
  return <div className="mode-control" role="group" aria-label="Display mode">
    <button data-analytics="mode_simple" type="button" aria-pressed={mode === 'simple'} onClick={() => onChange('simple')}>Simple</button>
    <button data-analytics="mode_map" type="button" aria-pressed={mode === 'map'} onClick={() => onChange('map')}>Map</button>
  </div>;
}
function SimpleReport() {
  const {state, send} = useFeedbackReport('simple');
  if (state === 'sent') return <p className="simple-report" role="status">Thanks. We saved your report.</p>;
  return <div className="simple-report">
    <span>The bus is here now:</span>
    <button data-analytics="feedback_arrived" type="button" disabled={state === 'sending'} onClick={() => send('arrived', 'fehren')}>At Fehren</button>
    <button data-analytics="feedback_arrived" type="button" disabled={state === 'sending'} onClick={() => send('arrived', 'campus')}>At campus</button>
    {state === 'failed' && <p role="alert">Couldn't send your report. Try again.</p>}
  </div>;
}
function SimpleScreen({camera, modeControl, settingError}: {camera: CameraFeed; modeControl: React.ReactNode; settingError: string}) {
  const {feed, fresh, error, now, refresh} = camera;
  const age = observationAge(feed?.latest?.eventAt, now);
  const relativeTime = age.kind === 'observed' ? relativeObservationTime(age.minutes) : null;
  const earlierDay = age.kind === 'observed' ? earlierDaySighting(feed!.latest!.eventAt!, now) : null;
  const sample = feed?.status === 'sample';
  const status = feed && !fresh ? 'Offline. A newer bus may have passed.' : error && !feed ? 'Feed unavailable. No saved sighting is available.' : error || (!feed ? 'Checking the feed…' : sample ? 'Sample data. Not a real bus sighting.' : `Live · checked ${new Date(feed.lastCheckedAt!).toLocaleTimeString('en-US', {timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit'})}`);
  return <main className="simple-screen" data-mode="simple">
    <header className="simple-header">
      <a data-analytics="home" className="simple-brand" href={import.meta.env.BASE_URL} aria-label="BusTrackr home">BusTrackr<span>Fehren ↔ Skyway</span></a>
      {modeControl}
    </header>
    <section className="simple-observation" aria-label="Last bus detection">
      {sample && <p className="simple-sample">Sample data</p>}
      {earlierDay ? <>
        <h1>No Fehren bus detected<br/>yet today</h1>
        <p className="simple-empty" data-testid="earlier-day-sighting">{earlierDay}</p>
        <p className="simple-checkpoint">{feed?.latest?.checkpoint}</p>
      </> : <>
      <h1>The last Fehren bus<br/>was detected</h1>
      {age.kind === 'observed' ? <div className="simple-age" aria-label={relativeTime!.label}>
        <span className="simple-number" data-digits={relativeTime!.value.length} data-testid="observation-age" style={{color: fresh ? age.color : '#003360'}}>{relativeTime!.value}</span>
        <span className="simple-unit">{relativeTime!.unit} ago</span>
      </div> : <p className="simple-empty">{age.kind === 'clock-error' ? 'Camera clock is ahead' : !feed && !error ? 'Checking the feed…' : feed?.latest ? 'Camera time unavailable' : !feed ? 'No observation available' : 'No bus detected yet'}</p>}
      {age.kind === 'observed' && <p className="simple-time"><time dateTime={feed!.latest!.eventAt!}>{new Date(feed!.latest!.eventAt!).toLocaleString('en-US', {timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'})}</time></p>}
      {age.kind === 'observed' && <p className="simple-checkpoint">{feed?.latest?.checkpoint}</p>}
      </>}
      {feed && !error && <SimpleReport/>}
    </section>
    <footer className="simple-footer">
      <div className="simple-feed-status"><p role="status">{status}</p><button data-analytics="feed_refresh" type="button" onClick={refresh} aria-label="Refresh feed">Refresh</button></div>
      {settingError && <p role="alert">{settingError}</p>}
    </footer>
  </main>;
}
function App() {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [settingError, setSettingError] = useState('');
  const [alertsOpen, setAlertsOpen] = useState(false);
  const camera = useCameraFeed();
  useEffect(() => {window.BusTrackrAnalytics?.track('app_view', mode);}, [mode]);
  function changeMode(next: Mode) {
    setMode(next);
    try {localStorage.setItem(modeKey, next); setSettingError('');} catch {setSettingError('This mode works now but could not be saved.');}
  }
  const modeControl = <div className="view-controls"><ModeControl mode={mode} onChange={changeMode}/>{mode === 'map' && <button data-analytics="alerts_toggle" type="button" className="alerts-button" aria-expanded={alertsOpen} onClick={() => setAlertsOpen(value => !value)}>Alerts</button>}</div>;
  return <div className="app-shell" data-mode={mode}>
    {mode === 'simple' ? <SimpleScreen camera={camera} modeControl={modeControl} settingError={settingError}/> : <Suspense fallback={<div className="map-opening">{modeControl}<p>Opening the map…</p></div>}><MapApp camera={camera} modeControl={modeControl}/></Suspense>}
    <div className="notification-dock" hidden={mode === 'map' && !alertsOpen}>
      <WebNotifications sample={camera.feed?.status === 'sample'}/>
      {mode === 'simple' && <><p className="simple-note">Time since camera detection, not an arrival estimate.</p><p className="simple-credit">A student project of BEI | Business, Entrepreneurship, &amp; Innovation at Valley Christian Schools.</p></>}
    </div>
  </div>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<App/>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
