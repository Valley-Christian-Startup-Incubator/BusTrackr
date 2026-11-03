import {createServer, request} from 'node:http';
import {readFile, realpath, stat} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';

const types = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon',
  '.glb':'model/gltf-binary', '.bin':'application/octet-stream', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf',
};
const hopHeaders = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
function forwardedHeaders(headers) {
  const excluded = new Set([...hopHeaders, ...(headers.connection || '').toLowerCase().split(',').map(value=>value.trim())]);
  return Object.fromEntries(Object.entries(headers).filter(([name])=>!excluded.has(name.toLowerCase())));
}
function unavailable(res) {
  if (res.headersSent) {res.destroy();return;}
  res.writeHead(503, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
  res.end('Service temporarily unavailable');
}
function proxy(req,res,hostname,port) {
  const upstream = request({hostname,port,path:req.url,method:req.method,headers:forwardedHeaders(req.headers)}, response=>{
    res.writeHead(response.statusCode,forwardedHeaders(response.headers));
    response.on('error',()=>res.destroy());
    response.pipe(res);
  });
  upstream.on('error',()=>unavailable(res));
  upstream.setTimeout(60_000,()=>upstream.destroy());
  req.on('aborted',()=>upstream.destroy());
  req.on('error',()=>upstream.destroy());
  res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});
  req.pipe(upstream);
}
async function staticFile(req,res,root) {
  if (!['GET','HEAD'].includes(req.method)) return false;
  let path;
  try {path=decodeURIComponent(req.url.split('?')[0]);} catch {return false;}
  if (!path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some(part=>part.startsWith('.'))) return false;
  const base=await realpath(root);
  if (!extname(path) && !path.endsWith('/')) {
    try {
      if ((await stat(resolve(base,'.'+path))).isDirectory()) {
        const query=req.url.includes('?')?req.url.slice(req.url.indexOf('?')):'';
        res.writeHead(308, {Location:path+'/'+query,'Cache-Control':'no-store'});res.end();return true;
      }
    } catch(error) {if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;}
    path+='.html';
  }
  if(path.endsWith('/'))path+='index.html';
  const type=types[extname(path).toLowerCase()];
  if(!type)return false;
  try {
    const file=await realpath(resolve(base,'.'+path));
    if(!file.startsWith(base+sep))return false;
    const data=await readFile(file);
    const immutable=/\.[a-f0-9]{16}\.(css|js)$/.test(path) || /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(path);
    res.writeHead(200, {'Content-Type':type,'X-Content-Type-Options':'nosniff','Content-Length':data.length,
      'Cache-Control':extname(path)==='.html'?'no-store':immutable?'public, max-age=31536000, immutable':'no-cache'});
    res.end(req.method==='HEAD'?undefined:data);return true;
  } catch(error) {if(['ENOENT','ENOTDIR','EISDIR'].includes(error.code))return false;throw error;}
}
export function createFrontend({root,upstreamHost='127.0.0.1',upstreamPort=18787}) {
  return createServer(async(req,res)=>{
    if(req.url.split('?')[0].startsWith('/api/')) {proxy(req,res,upstreamHost,upstreamPort);return;}
    try {
      if (['GET','HEAD'].includes(req.method) && /^\/BusTrackr\/?(?:\?|$)/.test(req.url) && await stat(resolve(root,'manifest.webmanifest')).then(()=>true,()=>false)) {
        const query=req.url.includes('?')?req.url.slice(req.url.indexOf('?')):'';
        res.writeHead(308, {Location:'/'+query,'Cache-Control':'no-store'});res.end();return;
      }
      if(await staticFile(req,res,root))return;
      res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('Not found');
    } catch {unavailable(res);}
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const port=Number(process.env.FRONTEND_PORT || 18788);
  if(!Number.isInteger(port) || port<1 || port>65535)throw new Error('Invalid frontend port');
  const server=createFrontend({root:process.env.WEBSITE_ROOT || resolve(homedir(),'apps/bustrackr/website')});
  server.listen(port,'127.0.0.1',()=>console.log(`BusTrackr frontend on loopback port ${port}`));
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close());
}
