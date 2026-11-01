import {dkimVerify, arc} from 'mailauth';
import {Resolver} from 'node:dns/promises';

export function trustedForwarder(result, sender) {
  return result?.status?.result === 'pass' &&
    result.signature?.signingDomain === 'google.com' &&
    result.authenticationResults?.mta === 'mx.google.com' &&
    result.authenticationResults?.dmarc?.result === 'pass' &&
    result.authenticationResults?.dmarc?.header?.from?.toLowerCase() === sender.split('@')[1]?.toLowerCase();
}
export async function verifyForwardedRaw(raw, sender) {
  const dns = new Resolver({timeout:2000,tries:1});
  const resolver = (name,type) => dns.resolve(name,type);
  const verified = await dkimVerify(raw,{resolver});
  const result = await arc(verified.arc,{resolver});
  return trustedForwarder(result,sender);
}
