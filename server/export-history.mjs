import {openHistory} from './history.mjs';
const statePath=process.env.ALERT_STATE_FILE || '.data/alerts.json';
const history=openHistory(statePath.replace(/\.json$/, '')+'.sqlite',{legacyPath:statePath});
for(const sighting of history.all())process.stdout.write(JSON.stringify(sighting)+'\n');
