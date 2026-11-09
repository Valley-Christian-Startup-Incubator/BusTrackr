import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const out='.audit/simple-mode';
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  let minutes=2, offline=false, missing=false, future=false;
  await page.route('**/api/shuttle',route=>offline?route.abort():route.fulfill({json:{
    status:'connected',lastCheckedAt:new Date().toISOString(),
    latest:missing?null:{checkpoint:'BEI campus corner',eventAt:new Date(Date.now()+(future?60_000:-minutes*60_000-2000)).toISOString(),receivedAt:new Date().toISOString()},
    eventCount:2,prediction:{status:'unconfigured',generatedAt:new Date().toISOString(),marker:null},
  }}));
  await page.goto(process.env.MOBILE_URL || 'http://127.0.0.1:8087',{waitUntil:'domcontentloaded',timeout:60000});
  const numeral=page.getByTestId('observation-age');
  await numeral.waitFor({timeout:60000});
  assert.equal(await numeral.innerText(),'2');
  assert.equal(await page.locator('iframe').count(),0);
  await page.screenshot({path:`${out}/mobile-green.png`});
  minutes=10;await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="observation-age"]')?.textContent==='10');
  assert.equal(await numeral.evaluate(el=>getComputedStyle(el).color),'rgb(179, 50, 43)');
  await page.screenshot({path:`${out}/mobile-red.png`});
  offline=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByText(/A newer bus may have passed/).waitFor();
  assert.equal(await numeral.innerText(),'10');
  assert.equal(await numeral.evaluate(el=>getComputedStyle(el).color),'rgb(0, 51, 96)');
  await page.screenshot({path:`${out}/mobile-offline.png`});
  offline=false;missing=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByText('No detections yet',{exact:true}).waitFor();
  assert.equal(await numeral.count(),0);
  missing=false;future=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByText('Camera time is ahead. Waiting for a valid sighting.').waitFor();
  assert.equal(await numeral.count(),0);
  for (const width of [320,768,1440]) {
    future=false;minutes=12000;await page.setViewportSize({width,height:900});
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await numeral.waitFor();
    await page.waitForFunction(()=>document.querySelector('[data-testid="observation-age"]')?.textContent==='8');
    await page.getByText('days ago', {exact: true}).waitFor();
    assert(await numeral.evaluate(el=>{const style=getComputedStyle(el);const canvas=document.createElement('canvas');const ctx=canvas.getContext('2d');ctx.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;return ctx.measureText(el.textContent).width<=el.clientWidth;}), `minute numeral is clipped at ${width}`);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`overflow at ${width}`);
    await page.screenshot({path:`${out}/mobile-${width}.png`});
  }
  console.log('PASS mobile Simple mode fresh/red/offline retention/missing/future/long ages and responsive widths.');
} finally {await browser.close();}
