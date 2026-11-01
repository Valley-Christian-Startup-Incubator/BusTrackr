import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trustedForwarder} from './forwarded-auth.mjs';
import {parseAlert} from './alerts.mjs';
test('real camera timestamp accepts a missing terminal period',async()=>{
 const source='From: Avigilonalerts@vcs.net\r\nSubject: Camera\r\n\r\n[2026-Oct-30 02:35:43 PM (PDT)] BEI Bus has arrived\r\n';
 const alert=await parseAlert(source,{sender:'avigilonalerts@vcs.net',marker:'BEI Bus has arrived.',checkpoint:'BEI'},new Date('2026-10-30T21:35:52Z'));
 assert.equal(alert?.eventAt,'2026-10-30T21:35:43.000Z');
});
test('forwarded authentication requires verified Google ARC and aligned original DMARC',()=>{
 const good={status:{result:'pass'},signature:{signingDomain:'google.com'},authenticationResults:{mta:'mx.google.com',dmarc:{result:'pass',header:{from:'vcs.net'}}}};
 assert(trustedForwarder(good,'avigilonalerts@vcs.net'));
 for(const bad of [{...good,status:{result:'fail'}},{...good,signature:{signingDomain:'attacker.test'}},{...good,authenticationResults:{...good.authenticationResults,mta:'other.test'}},{...good,authenticationResults:{...good.authenticationResults,dmarc:{result:'pass',header:{from:'other.test'}}}}]) assert.equal(trustedForwarder(bad,'avigilonalerts@vcs.net'),false);
});
