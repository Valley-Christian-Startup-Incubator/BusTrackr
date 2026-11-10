import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {appendFile, mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createFeedbackLog, feedbackRoutes} from './feedback.mjs';

const prediction = {model:'learned-runs-v1',status:'estimated',runId:'am-1',estimatedArrivalAt:'2026-11-09T15:10:00.000Z'};
async function serve(t, log) {
  const routes = feedbackRoutes(log,{allowedOrigins:['https://bustrackr.valleychristianai.com']});
  const server = createServer(async(req,res)=>{if(!await routes(req,res)){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return (body,headers={})=>fetch(`http://127.0.0.1:${server.address().port}/api/feedback`,{method:'POST',
    headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
}
async function records(path) {return (await readFile(path,'utf8')).trim().split('\n').map(line=>JSON.parse(line));}

test('a rider report is saved with the prediction it judges and the code that made it', async t=>{
  const dir = await mkdtemp(join(tmpdir(),'bustrackr-feedback-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path = join(dir,'feedback.jsonl');
  const options = {path,prediction:()=>prediction,commit:'f15017a',now:()=>new Date('2026-11-09T15:08:00Z')};
  const post = await serve(t,await createFeedbackLog(options));
  const report = {id:randomUUID(),verdict:'arrived',view:'simple',release:'f15017a8c2d1'};
  assert.equal((await post(report,{Origin:'https://bustrackr.valleychristianai.com'})).status,200);
  assert.equal((await post(report)).status,200,'a retried report is accepted');
  assert.deepEqual(await records(path),[{id:report.id,receivedAt:'2026-11-09T15:08:00.000Z',verdict:'arrived',view:'simple',
    collector:{commit:'f15017a',release:'f15017a8c2d1'},prediction}],'a retry does not add a second record');

  const restarted = await serve(t,await createFeedbackLog(options));
  assert.equal((await restarted(report)).status,200);
  assert.equal((await records(path)).length,1,'retries stay deduplicated across restarts');
});

test('a report after a torn write starts on its own line', async t=>{
  const dir = await mkdtemp(join(tmpdir(),'bustrackr-feedback-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path = join(dir,'feedback.jsonl');
  await appendFile(path,'{"id":"torn"');
  const post = await serve(t,await createFeedbackLog({path,prediction:()=>prediction}));
  const id = randomUUID();
  assert.equal((await post({id,verdict:'wrong',view:'map'})).status,200);
  const lines = (await readFile(path,'utf8')).split('\n');
  assert.equal(lines[0],'{"id":"torn"');
  assert.deepEqual(JSON.parse(lines[1]).collector,{commit:null,release:null});
  assert.equal(JSON.parse(lines[1]).id,id);
});

test('invalid or foreign reports are refused without writing', async t=>{
  const dir = await mkdtemp(join(tmpdir(),'bustrackr-feedback-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path = join(dir,'feedback.jsonl');
  const post = await serve(t,await createFeedbackLog({path,prediction:()=>prediction}));
  assert.equal((await post({id:randomUUID(),verdict:'great',view:'map'})).status,400);
  assert.equal((await post({id:randomUUID(),verdict:'wrong'})).status,400,'view is required');
  assert.equal((await post({id:'not-a-uuid',verdict:'wrong',view:'map'})).status,400);
  assert.equal((await post({id:randomUUID(),verdict:'wrong',view:'map',release:'<script>'})).status,400);
  assert.equal((await post('{')).status,400);
  assert.equal((await post({id:randomUUID(),verdict:'wrong',view:'map'},{'Content-Type':'text/plain'})).status,415);
  assert.equal((await post({id:randomUUID(),verdict:'wrong',view:'map'},{Origin:'https://evil.example'})).status,403);
  await assert.rejects(readFile(path),{code:'ENOENT'});
});
