import {appendFile, mkdir, readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {z} from 'zod';
import {boundedText} from './resend.mjs';
import {requestLimiter} from './notifications.mjs';

const submission = z.object({
  id:z.string().uuid(),
  verdict:z.enum(['arrived','missing','wrong']),
  view:z.enum(['simple','map']),
  stop:z.enum(['fehren','campus']).nullable().default(null),
  release:z.string().regex(/^[0-9a-f]{7,40}$/).nullable().default(null),
});

export async function createFeedbackLog({path, prediction, commit=null, now=()=>new Date()}) {
  let text = '';
  try {text = await readFile(path,'utf8');}
  catch(error) {if(error.code!=='ENOENT')throw error;}
  // A crash mid-append leaves a partial last line: skip it, and start the next record on a fresh line.
  const entries = text.split('\n').flatMap(line=>{try {return [JSON.parse(line)];} catch {return [];}});
  const ids = new Set(entries.map(entry=>entry.id));
  const reports = entries.map(({receivedAt,verdict,stop})=>({receivedAt,verdict,stop:stop ?? null}));
  let separator = text && !text.endsWith('\n') ? '\n' : '';
  let queue = Promise.resolve();
  return {
    reports:()=>reports,
    record(input) {
      const parsed = submission.safeParse(input);
      if (!parsed.success) return Promise.reject(Object.assign(new Error('Invalid feedback'),{status:400}));
      const {id,verdict,view,stop,release} = parsed.data;
      const result = queue.then(async()=>{
        if (ids.has(id)) return {id};
        const entry = {id,receivedAt:now().toISOString(),verdict,view,stop,collector:{commit,release},prediction:prediction()};
        await mkdir(dirname(path),{recursive:true});
        await appendFile(path,separator+JSON.stringify(entry)+'\n',{mode:0o600});
        separator = '';ids.add(id);reports.push({receivedAt:entry.receivedAt,verdict,stop});
        return {id};
      });
      queue = result.catch(()=>{});
      return result;
    },
  };
}

export function feedbackRoutes(log,{allowedOrigins=[],now=Date.now}={}) {
  const allow = requestLimiter({max:10,now});
  return async(req,res)=>{
    if (req.url!=='/api/feedback') return false;
    const respond = (status,body)=>{res.writeHead(status);res.end(JSON.stringify(body));return true;};
    if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) return respond(403,{error:'Origin is not allowed'});
    if (req.method==='OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Content-Type');
      return respond(204,null);
    }
    if (req.method!=='POST') return respond(404,{error:'Not found'});
    if (!allow(req)) return respond(429,{error:'Try again later'});
    if (!req.headers['content-type']?.startsWith('application/json')) return respond(415,{error:'Use application/json'});
    let input;
    try {input = JSON.parse(await boundedText(req,2000));}
    catch {return respond(400,{error:'Invalid feedback'});}
    try {return respond(200,await log.record(input));}
    catch(error) {return respond(error.status || 503,{error:error.status?error.message:'Feedback storage unavailable'});}
  };
}
