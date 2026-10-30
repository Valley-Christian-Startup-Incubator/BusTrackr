import {get, put, BlobPreconditionFailedError} from '@vercel/blob';
import {boundedText} from './resend.mjs';

export function createBlobState({read = get, write = put, path = 'alerts/state.json'} = {}) {
  async function snapshot() {
    const blob = await read(path, {access:'private', useCache:false});
    if (!blob) return {state:{latest:null, events:[], resendReceipts:[], pending:[]}, etag:null};
    return {state:JSON.parse(await boundedText(blob.stream, 20_000_000)), etag:blob.blob.etag};
  }
  return {
    async read() {return (await snapshot()).state;},
    async update(change) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const {state, etag} = await snapshot();
        const result = change(state);
        try {
          await write(path, JSON.stringify(state), {access:'private', addRandomSuffix:false,
            contentType:'application/json', ...(etag ? {ifMatch:etag} : {allowOverwrite:false})});
          return result;
        } catch (error) {
          // A competing writer may have created the first version or changed its ETag.
          if (etag && !(error instanceof BlobPreconditionFailedError)) throw error;
          if (attempt === 5) throw error;
        }
      }
    },
  };
}
