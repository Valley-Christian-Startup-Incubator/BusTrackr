import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';

const url = new URL(process.argv[2] || 'https://bustrackr.valleychristianai.com/');
const campaign = `analytics-verification-${randomUUID()}`;
url.searchParams.set('utm_source', 'verification');
url.searchParams.set('utm_campaign', campaign);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'});
  const collected = page.waitForResponse(response => {
    const request = response.request();
    if (request.method() !== 'POST' || response.url() !== 'https://analytics.valleychristianai.com/api/send') return false;
    const event = request.postDataJSON();
    return event.type === 'event' && !event.payload.name && event.payload.url.includes(campaign);
  }, {timeout: 30_000});
  await page.goto(url.href, {waitUntil: 'domcontentloaded'});
  const response = await collected;
  assert.equal(response.status(), 200, 'Umami must accept the pageview');
  const result = await response.json();
  assert(!result.disabled, 'Umami must not disable tracking');
  const event = response.request().postDataJSON();
  assert.equal(event.payload.website, '5eaf2f91-0cd8-48ce-84b1-1cc3244cf436');
  const landing = new URL(event.payload.url);
  assert.equal(landing.searchParams.get('utm_source'), 'verification');
  assert.equal(landing.searchParams.get('utm_campaign'), campaign);
  console.log(JSON.stringify({status: response.status(), hostname: event.payload.hostname, campaign, website: event.payload.website}));
} finally {
  await browser.close();
}
