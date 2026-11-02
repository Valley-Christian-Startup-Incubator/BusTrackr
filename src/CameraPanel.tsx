import {useEffect,useState} from 'react';
export type EstimatedMarker={direction:'inbound'|'outbound';progress:number;lower:number;upper:number};
type Feed={status:string;lastCheckedAt:string|null;latest:{checkpoint:string;eventAt?:string;receivedAt:string}|null;eventCount:number;prediction:{status:string;generatedAt:string;reason?:string;anchor?:string;remainingSeconds?:number;rangeSeconds?:number[];historyCount?:number;marker:EstimatedMarker|null}};
const endpoint=import.meta.env.VITE_ALERT_API_URL || (import.meta.env.DEV?'/api/shuttle':'');
export function CameraPanel({onMarker,onLocate}:{onMarker:(marker:EstimatedMarker|null)=>void;onLocate:()=>void}){
 const [feed,setFeed]=useState<Feed|null>(null),[error,setError]=useState(''),[now,setNow]=useState(()=>Date.now());
 const [fetchedAt,setFetchedAt]=useState(0),[active,setActive]=useState(()=>!document.hidden);
 useEffect(()=>{
  let gone=false,timer:ReturnType<typeof setTimeout>;const abort=new AbortController();
  async function poll(){
   if(!endpoint){setError('Camera service is not configured.');return;}
   try{
    const response=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(10_000)])});
    if(!response.ok)throw new Error('Camera service unavailable.');
    const result:Feed=await response.json();
    if (!result.prediction || !['connected','sample','connecting','disconnected'].includes(result.status))throw new Error('Invalid camera response.');
    if(!gone){setFeed(result);setError('');setNow(Date.now());setFetchedAt(Date.now());}
   }catch{if(!gone)setError('Camera service unavailable. Last observation may be stale.');}
   finally{if(!gone)timer=setTimeout(poll,10_000);}
  }
  if(active)void poll();return()=>{gone=true;clearTimeout(timer);abort.abort();};
 },[active]);
 useEffect(()=>{
  const timer=setInterval(()=>setNow(Date.now()),1000);
  function visibility(){setActive(!document.hidden);setFetchedAt(0);setNow(Date.now());onMarker(null);}
  document.addEventListener('visibilitychange',visibility);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visibility);onMarker(null);};
 },[onMarker]);
 const prediction=feed?.prediction;
 const checkAge=feed?.lastCheckedAt?now-Date.parse(feed.lastCheckedAt):Infinity;
 const predictionAge=prediction?now-Date.parse(prediction.generatedAt):Infinity;
 const fresh=active&&fetchedAt>0&&now-fetchedAt<=45_000&&checkAge>=-30_000&&checkAge<=120_000&&predictionAge>=-30_000&&predictionAge<=45_000;
 const marker=!error&&fresh&&['connected','sample'].includes(feed?.status || '')&&prediction?.status==='estimated'?prediction.marker:null;
 useEffect(()=>onMarker(marker),[marker,onMarker]);
 const minutes=feed?.latest?.eventAt?Math.max(0,Math.floor((now-Date.parse(feed.latest.eventAt))/60_000)):null;
 const age=minutes===null?'':minutes===0?'Less than a minute':minutes<60?`${minutes} minute${minutes===1?'':'s'}`:minutes<1440?`${Math.floor(minutes/60)} hour${Math.floor(minutes/60)===1?'':'s'}`:`${Math.floor(minutes/1440)} day${Math.floor(minutes/1440)===1?'':'s'}`;
 return <aside className="camera-panel" aria-label="Camera arrival estimates">
  <div className="card-header"><div><span className="eyebrow">Camera checkpoint</span><h2>Where’s the shuttle?</h2></div><span className="demo-pill">{feed?.status==='sample'?'SAMPLE':'ESTIMATE'}</span></div>
  <p role="status">{error || (feed&&!fresh?'Feed update is stale. Estimates hidden.':feed?.status==='sample'?'Sample data · illustrative timetable':feed?.status==='connected'?'Feed connected':feed?.status==='disconnected'?'Feed offline · last observation may be stale':'Connecting to camera feed…')}</p>
  {feed?.latest?<div className="camera-observation"><strong>Vehicle detected at {feed.latest.checkpoint}</strong>{feed.latest.eventAt?<><p>{age} ago</p><time dateTime={feed.latest.eventAt}>{new Date(feed.latest.eventAt).toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})}</time></>:<p>Camera time unavailable. Email received {new Date(feed.latest.receivedAt).toLocaleString('en-US',{timeZone:'America/Los_Angeles'})} Pacific time.</p>}</div>:<p>No camera observations received yet.</p>}
  {marker?<div className="camera-estimate"><strong>Estimated position · {marker.direction==='inbound'?'To campus':'To Fehren'}</strong><p>Arrival in about {Math.max(1,Math.ceil(((prediction?.remainingSeconds || 0)-Math.max(0,predictionAge)/1000)/60))} min</p><small className="estimate-context">Approximate range: {Math.floor(Math.max(0,(prediction?.rangeSeconds?.[0] || 0)-Math.max(0,predictionAge)/1000)/60)}–{Math.ceil(Math.max(0,(prediction?.rangeSeconds?.[1] || 0)-Math.max(0,predictionAge)/1000)/60)} min · uncalibrated</small><p className="estimate-context">{prediction?.anchor==='camera'?'Anchored to a camera sighting':'Based on timetable and recent delays'}</p><button className="follow-button" onClick={onLocate}>Locate estimate</button></div>:<p>{error||!fresh?'Estimated marker hidden.':prediction?.reason || 'Waiting for an estimate.'}</p>}
  <p className="camera-note">The amber marker and highlighted route show an estimate, not GPS. A sighting does not establish identity, direction or departure. {feed?.eventCount || 0} camera emails saved.</p>
 </aside>;
}
