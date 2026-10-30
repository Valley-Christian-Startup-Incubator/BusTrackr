import {verifyReceivingEvent, receivedAlert} from './resend.mjs';
import {recordAlert} from './alerts.mjs';

export async function receiveCloudEmail({raw, headers, config, api, store}) {
  const verified = verifyReceivingEvent(raw, headers, config);
  if (!verified.id) return verified;
  const {id} = verified;
  try {
    const duplicate = await store.update(state => {
      if (state.resendReceipts?.includes(id)) return true;
      state.pending = [...new Set([...(state.pending || []), id])];
      return false;
    });
    if (duplicate) return {status:200, body:{duplicate:true}};
    const mail = await api(`/emails/receiving/${id}?html_format=cid`);
    if (mail.id !== id) throw new Error('Received email ID mismatch');
    const alert = await receivedAlert(mail, config);
    const stored = await store.update(state => {
      let stored = false;
      if (!state.resendReceipts?.includes(id)) {
        stored = recordAlert(state, alert, config.cooldownSeconds);
        state.resendReceipts = [...(state.resendReceipts || []), id];
      }
      state.pending = (state.pending || []).filter(value => value !== id);
      return stored;
    });
    return {status:200, body:{stored}};
  } catch {return {status:503, body:{error:'Email processing failed; retry later'}};}
}
