import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.argv[2] || 'http://127.0.0.1:4174/BusTrackr/';
const browser=await chromium.launch({channel: 'chromium'});
try {
  const context=await browser.newContext();
  await context.grantPermissions(['notifications'],{origin:new URL(url).origin});
  const page=await context.newPage();
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.evaluate(async()=>{
    const scope=new URL('.',location.href).pathname;
    await navigator.serviceWorker.register(scope+'notifications-sw.js',{scope});
    await navigator.serviceWorker.ready;
  });
  const worker=context.serviceWorkers().find(item=>item.url().endsWith('/notifications-sw.js'));
  assert(worker,'worker registered in the app scope');
  await page.close();
  await worker.evaluate(()=>self.dispatchEvent(new PushEvent('push',{data:JSON.stringify({
    title:'Fehren bus detected',body:'Local service worker verification.',eventId:'local-verification',url:'https://example.invalid/'
  })})));
  let notifications=[];
  for(let i=0;i<20;i++) {
    notifications=await worker.evaluate(async()=>(await self.registration.getNotifications()).map(item=>({title:item.title,tag:item.tag,url:item.data?.url})));
    if(notifications.length)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(notifications[0]?.title,'Fehren bus detected');
  assert.equal(notifications[0]?.tag,'local-verification');
  assert.equal(notifications[0]?.url,url);
  await worker.evaluate(async()=>{for(const item of await self.registration.getNotifications())item.close();});
  console.log('PASS real service worker displays a synthetic push after the page closes, with event tag and app-scoped click destination. This does not verify provider delivery.');
}finally{await browser.close();}
