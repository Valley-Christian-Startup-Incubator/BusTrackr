import * as T from 'three';
import {assetUrl} from './asset-urls';

// Bound network waits so a stalled asset produces a retryable error, not an endless spinner.
export async function fetchAsset(path:string){
 try {
  const response=await fetch(assetUrl(path),{signal:AbortSignal.timeout(20_000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  return response;
 } catch(error){
  throw new Error(`Could not load ${path}: ${error instanceof Error?error.message:String(error)}`);
 }
}
export async function loadTexture(path:string){
 const response=await fetchAsset(path);
 const url=URL.createObjectURL(await response.blob()),image=new Image();
 try {
  image.src=url;await image.decode();
  const texture=new T.Texture(image);texture.needsUpdate=true;return texture;
 } finally {URL.revokeObjectURL(url);}
}
