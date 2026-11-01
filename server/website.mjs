import {readFile, realpath} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.ico':'image/x-icon'};
export async function serveWebsite(req,res,root) {
  if (!['GET','HEAD'].includes(req.method)) return false;
  let path;
  try {path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{return false;}
  if (path.split('/').some(part=>part.startsWith('.')) || path.includes('\\') || path.includes('\0')) return false;
  if (path==='/' || path.endsWith('/')) path+='index.html';
  if (!extname(path)) path+='.html';
  const type=types[extname(path)];if(!type)return false;
  try {
    const base=await realpath(root),file=await realpath(resolve(base,'.'+path));
    if (!file.startsWith(base+sep)) return false;
    const data=await readFile(file);
    res.setHeader('Content-Type',type);res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','public, max-age=300');res.setHeader('Content-Length',data.length);
    res.end(req.method==='HEAD'?undefined:data);return true;
  }catch(error){if(['ENOENT','ENOTDIR','EISDIR'].includes(error.code))return false;throw error;}
}
