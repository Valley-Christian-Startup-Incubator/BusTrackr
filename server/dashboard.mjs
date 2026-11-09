// Mirrors sightings into an Umami website so the analytics dashboard shows them. The SQLite history stays the source of truth.
export function umamiSink({url, website, hostname = 'bustrackr.valleychristianai.com', fetchImpl = fetch}) {
  return async sighting => {
    const delaySeconds = Number.isFinite(Date.parse(sighting.eventAt)) ? Math.round((Date.parse(sighting.receivedAt) - Date.parse(sighting.eventAt)) / 1000) : null;
    const response = await fetchImpl(new URL('/api/send', url), {
      method:'POST', signal:AbortSignal.timeout(15_000), redirect:'error',
      // Umami drops requests whose User-Agent looks like a bot.
      headers:{'Content-Type':'application/json', 'User-Agent':'Mozilla/5.0 BusTrackr-Camera-Worker/1.0'},
      body:JSON.stringify({type:'event', payload:{
        website, hostname, url:'/camera', name:'camera_sighting',
        timestamp:Math.floor(Date.parse(sighting.eventAt || sighting.receivedAt) / 1000),
        data:{
          checkpoint:sighting.checkpoint, duplicate:Boolean(sighting.duplicateOf), delaySeconds,
          commit:sighting.collector?.commit || 'unknown', source:sighting.collector?.source || 'unknown', parser:sighting.collector?.parser || 'unknown',
        },
      }}),
    });
    const body = await response.text();
    if (!response.ok || body.includes('beep')) throw new Error(`Umami rejected sighting (HTTP ${response.status})`);
  };
}

export function dashboardSync(history, send) {
  let running = null;
  return () => running ??= (async () => {
    try {
      for (const sighting of history.unsent()) {
        await send(sighting);
        history.markSent(sighting.id);
      }
    } finally {running = null;}
  })();
}
