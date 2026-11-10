import test from 'node:test';
import assert from 'node:assert/strict';
import {renderEmail} from './email.mjs';

test('an email renders the same words as text and as self-contained HTML', () => {
  const email = renderEmail({subject: 'Sign in', paragraphs: ['First.', 'Second.'], button: {label: 'Open BusTrackr', url: 'https://bustrackr.example/api/session/verify?token=a&b'}});
  assert.equal(email.text, 'First.\n\nSecond.\n\nOpen BusTrackr: https://bustrackr.example/api/session/verify?token=a&b\n\nBusTrackr, a student project of BEI at Valley Christian Schools');
  assert.match(email.html, /<a href="https:\/\/bustrackr\.example\/api\/session\/verify\?token=a&#38;b"[^>]*>Open BusTrackr<\/a>/);
  assert.doesNotMatch(email.html, /<style|<link|<img|src=/);
});

test('interpolated text cannot inject markup', () => {
  const {html} = renderEmail({subject: '<b>', paragraphs: ['<script>alert(1)</script> & "quotes"'], button: {label: '<i>', url: 'https://x.example/"onmouseover="x'}});
  assert.doesNotMatch(html, /<script|<b>|<i>|"onmouseover/);
  assert.match(html, /&#60;script&#62;alert\(1\)&#60;\/script&#62; &#38; &#34;quotes&#34;/);
});
