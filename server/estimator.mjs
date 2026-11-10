const zone = 'America/Los_Angeles';
const day = 86_400_000;
export const MODEL = 'learned-runs-v1';
export const settings = {
  gapMinutes:20,          // sightings closer than this in time of day belong to the same run
  maxWidthMinutes:45,     // a run wider than this is split at its largest gap
  minDays:2,              // a pass seen on fewer distinct days is treated as noise, not a run
  halfLifeDays:21,        // older days count half as much after this long, so the model follows schedule changes
  minLikelihood:.5,       // predict a run on a weekday only when it ran on at least half of those days
  matchMinutes:20,        // a sighting this close to a predicted pass counts as that pass
  horizonDays:7,
};

const formatter = new Intl.DateTimeFormat('en-CA', {timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'});
function parts(date) { return Object.fromEntries(formatter.formatToParts(date).map(p=>[p.type,p.value])); }
export function serviceDate(date) { const p = parts(date); return `${p.year}-${p.month}-${p.day}`; }
const weekdayOf = date => new Date(`${date}T12:00:00Z`).getUTCDay();
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n*day).toISOString().slice(0, 10);
export function scheduledTime(date, time) {
  // Test both Pacific offsets, then round-trip: nonexistent/ambiguous DST times are rejected.
  const candidates = [7,8].map(offset=>new Date(Date.parse(`${date}T${time}:00Z`)+offset*3600_000)).filter(at=>{
    const p = parts(at); return serviceDate(at) === date && `${p.hour}:${p.minute}` === time;
  });
  return candidates.length === 1 ? candidates[0].getTime() : null;
}
function passAt(date, minute) {
  const whole = Math.floor(minute);
  const start = scheduledTime(date, `${String(Math.floor(whole/60)).padStart(2,'0')}:${String(whole%60).padStart(2,'0')}`);
  return start === null ? null : start + (minute-whole)*60_000;
}
function weightedMedian(items) {
  const sorted = [...items].sort((a,b)=>a.value-b.value), half = sorted.reduce((sum,item)=>sum+item.weight,0)/2;
  let seen = 0;
  for (const item of sorted) { seen += item.weight; if (seen >= half) return item.value; }
  return sorted.at(-1).value;
}

export function sightingsAt(events, checkpoint, now) {
  const time = now.getTime(), today = serviceDate(now);
  return events.filter(e=>e.eventAt && !e.duplicateOf && e.checkpoint === checkpoint && Date.parse(e.eventAt)<=time && Date.parse(e.receivedAt)<=time).map(e=>{
    const at = Date.parse(e.eventAt), date = serviceDate(new Date(at)), p = parts(new Date(at));
    const ageDays = (Date.parse(`${today}T12:00:00Z`)-Date.parse(`${date}T12:00:00Z`))/day;
    return {id:e.id, at, date, weekday:weekdayOf(date), minute:+p.hour*60 + +p.minute + +p.second/60, weight:.5**(ageDays/settings.halfLifeDays)};
  });
}
function split(group) {
  const width = group.at(-1).minute - group[0].minute;
  if (width <= settings.maxWidthMinutes || group.length < 2) return [group];
  let cut = 1;
  for (let i = 1; i < group.length; i++) if (group[i].minute-group[i-1].minute > group[cut].minute-group[cut-1].minute) cut = i;
  return [...split(group.slice(0, cut)), ...split(group.slice(cut))];
}

// Learns recurring checkpoint passes from sightings alone. Days count from the first sighting through yesterday,
// so a weekday with no sightings (weekends, holidays) lowers that run's likelihood instead of being ignored.
export function learn(events, {checkpoint, now = new Date()}) {
  const sightings = sightingsAt(events, checkpoint, now).sort((a,b)=>a.minute-b.minute);
  const today = serviceDate(now);
  const past = sightings.filter(s=>s.date < today);
  const observed = Array(7).fill(0);
  if (past.length) for (let date = past.reduce((min,s)=>s.date<min?s.date:min, past[0].date); date < today; date = addDays(date,1)) {
    observed[weekdayOf(date)] += .5**((Date.parse(`${today}T12:00:00Z`)-Date.parse(`${date}T12:00:00Z`))/day/settings.halfLifeDays);
  }
  const groups = [];
  for (const s of sightings) {
    const last = groups.at(-1);
    if (last && s.minute - last.at(-1).minute <= settings.gapMinutes) last.push(s); else groups.push([s]);
  }
  const runs = [], noise = [];
  for (const group of groups.flatMap(split)) {
    const dates = new Set(group.map(s=>s.date));
    if (dates.size < settings.minDays) { noise.push(...group); continue; }
    const minute = weightedMedian(group.map(s=>({value:s.minute, weight:s.weight})));
    const spread = Math.max(2, 1.4826*weightedMedian(group.map(s=>({value:Math.abs(s.minute-minute), weight:s.weight}))));
    const seen = Array(7).fill(0);
    for (const date of new Set(group.filter(s=>s.date < today).map(s=>s.date))) seen[weekdayOf(date)] += group.find(s=>s.date===date).weight;
    const pooled = seen.reduce((a,b)=>a+b,0) / Math.max(1e-9, observed.reduce((a,b)=>a+b,0));
    // One pseudo-day at the pooled rate keeps a weekday with little history from swinging to 0 or 1.
    const likelihood = seen.map((count, w)=>Math.min(1, (count + pooled)/(observed[w] + 1)));
    const label = `${String(Math.floor(minute/60)).padStart(2,'0')}${String(Math.floor(minute%60)).padStart(2,'0')}`;
    runs.push({id:`run-${label}`, minute, spreadMinutes:spread, days:dates.size, sightings:group.length, likelihood});
  }
  return {runs, noise:noise.length, sightings:sightings.length, trainedThrough:now.toISOString()};
}

function passes(model, date) {
  return model.runs.filter(run=>run.likelihood[weekdayOf(date)] >= settings.minLikelihood).map(run=>{
    const at = passAt(date, run.minute), margin = Math.max(5, 2*run.spreadMinutes)*60_000;
    return at === null ? null : {run, date, at, window:[at-margin, at+margin], likelihood:run.likelihood[weekdayOf(date)]};
  }).filter(Boolean);
}

// Replays history day by day: each day is predicted from sightings delivered before it began, then scored against what the camera saw.
export function backtest(events, {checkpoint, now = new Date()}) {
  const today = serviceDate(now), all = sightingsAt(events, checkpoint, now);
  const dates = [...new Set(all.map(s=>s.date))].sort().filter(date=>date < today);
  let hits = 0, misses = 0, falseAlarms = 0, covered = 0, errorMinutes = 0, scoredDays = 0;
  for (let date = dates[0]; date && date < today; date = addDays(date,1)) {
    const start = passAt(date, 0);
    const model = learn(events, {checkpoint, now:new Date(start - 1)});
    if (!model.runs.length) continue;
    scoredDays++;
    const predicted = passes(model, date), actual = all.filter(s=>s.date===date);
    const used = new Set();
    for (const s of actual) {
      const nearest = predicted.map((p,i)=>({p,i,gap:Math.abs(s.at-p.at)})).sort((a,b)=>a.gap-b.gap)[0];
      if (!nearest || nearest.gap > settings.matchMinutes*60_000) { misses++; continue; }
      hits++; used.add(nearest.i); errorMinutes += nearest.gap/60_000;
      if (s.at >= nearest.p.window[0] && s.at <= nearest.p.window[1]) covered++;
    }
    falseAlarms += predicted.filter((_,i)=>!used.has(i)).length;
  }
  const round = value => Math.round(value*10)/10;
  return {days:scoredDays, hits, misses, falseAlarms,
    meanErrorMinutes:hits ? round(errorMinutes/hits) : null, windowCoverage:hits ? round(covered/hits) : null};
}

const iso = at => new Date(at).toISOString();
export function estimate(events, {checkpoint, trip = null, now = new Date(), quality = null}) {
  const base = {model:MODEL, generatedAt:now.toISOString(), timeZone:zone, quality};
  const model = learn(events, {checkpoint, now});
  const learned = {runs:model.runs.length, sightings:model.sightings, noise:model.noise};
  if (!model.runs.length) return {...base, status:'unconfigured', marker:null, learned,
    reason:`Learning the bus pattern: a pass has to be seen on at least ${settings.minDays} days before it is predicted.`};
  const time = now.getTime(), today = serviceDate(now);
  const seenToday = sightingsAt(events, checkpoint, now).filter(s=>s.date===today);
  const upcoming = [];
  for (let offset = 0; offset <= settings.horizonDays; offset++) upcoming.push(...passes(model, addDays(today, offset)));
  const todays = upcoming.filter(p=>p.date===today).map(p=>({...p, observed:seenToday.filter(s=>Math.abs(s.at-p.at)<=settings.matchMinutes*60_000)}));

  if (trip) {
    const span = p => {
      const crossing = p.observed?.length === 1 ? p.observed[0].at : p.at;
      const start = crossing - trip.checkpointProgress*trip.durationSeconds*1000;
      return {...p, crossing, start, end:start + trip.durationSeconds*1000};
    };
    const active = todays.map(span).filter(p=>time>=p.start && time<=p.end);
    if (active.length > 1 || active.some(p=>p.observed.length > 1)) return {...base, status:'ambiguous', marker:null, learned,
      reason:'More than one learned run or sighting could match. No vehicle position assigned.'};
    if (active.length) {
      const p = active[0], anchored = p.observed.length === 1;
      const progress = Math.min(1, Math.max(0, (time-p.start)/(p.end-p.start)));
      const remainingSeconds = Math.max(0, (p.end-time)/1000);
      const uncertaintySeconds = anchored ? 120 + (time-p.crossing)/1000*.2 : (p.window[1]-p.at)/1000;
      return {...base, status:'estimated', runId:p.run.id, serviceDate:today, direction:trip.direction, checkpoint,
        anchor:anchored?'camera':'schedule', eventId:anchored?p.observed[0].id:null, historyCount:p.run.days, likelihood:p.likelihood,
        estimatedArrivalAt:iso(p.end), remainingSeconds,
        rangeSeconds:[Math.max(0,remainingSeconds-uncertaintySeconds), remainingSeconds+uncertaintySeconds], rangeKind:'heuristic-not-calibrated',
        marker:{direction:trip.direction, progress, lower:Math.max(0,progress-uncertaintySeconds/trip.durationSeconds), upper:Math.min(1,progress+uncertaintySeconds/trip.durationSeconds)}, learned};
    }
  }
  const done = new Set(todays.filter(p=>p.observed.length).map(p=>p.at));
  const next = upcoming.filter(p=>p.window[1] >= time && !done.has(p.at)).sort((a,b)=>a.at-b.at)[0];
  if (!next) return {...base, status:'unknown', marker:null, nextCrossingAt:null, learned, reason:'No learned run is expected in the next week.'};
  return {...base, status:'scheduled', marker:null, runId:next.run.id, nextCrossingAt:iso(next.at), window:next.window.map(iso),
    likelihood:Math.round(next.likelihood*100)/100, historyCount:next.run.days, learned,
    reason:'Next pass predicted from sighting history, not a published timetable.'};
}
