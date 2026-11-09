import type {EstimatedMarker} from './CameraPanel';
import * as T from 'three';
import {fetchAsset,loadTexture} from './local/assets';
import {createBuildingShell} from './local/building-shell';
import {buildCampus,createCampusRoofMaterial} from './local/campus';
import {createRoadsideBuildings,type RoofLevels} from './local/buildings';
import {buildGrounds} from './local/grounds';
import {createParkingLayout} from './local/parking';
import {addMeadow} from './local/meadow';
import {createModeledTerrain} from './local/modeled-terrain';
import {buildLandscape,type LandscapeData} from './local/landscape';
import {buildRoads,roadNormal,laneOffset,roundRoadPath,type RoadProfile} from './local/roads';
import {addVegetation} from './local/vegetation';
import {buildStreetDetails} from './local/street-details';
import {createDaylightBackdrop} from './local/daylight';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

export type Geo={lat:number;lon:number};
export type Snapshot={progress:number[];distance:number[];fps:number;selected:number;loaded:boolean;pending:number;mode:string;speedMph:number;location:string};
type DEM={width:number;height:number;west:number;north:number;dx:number;dy:number;values:number[]};
type Building={id:number;ring:number[][];height:number;heightSource?:string;kind:string;campus:boolean};
const BASE=import.meta.env.BASE_URL;
const ORIGIN={lat:37.278,lon:-121.832};
const local=(p:Geo)=>new T.Vector2((p.lon-ORIGIN.lon)*88400,(ORIGIN.lat-p.lat)*111000);
const geo=(x:number,z:number)=>({lon:ORIGIN.lon+x/88400,lat:ORIGIN.lat-z/111000});
function inRing(x:number,z:number,ring:T.Vector2[]){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>z)!==(b.y>z)&&x<(b.x-a.x)*(z-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
function distanceSegment(p:T.Vector2,a:T.Vector2,b:T.Vector2){const dx=b.x-a.x,dz=b.y-a.y,t=T.MathUtils.clamp(((p.x-a.x)*dx+(p.y-a.y)*dz)/(dx*dx+dz*dz||1),0,1);return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dz*t);}
const quadPad=[[830,417],[967,430],[962,524],[818,504]].map(([x,y])=>local({lon:-121.8294+x/2048*.0078,lat:37.2774-y/1200*.0036}));
function groundHeight(d:DEM,x:number,z:number){const p=geo(x,z),xx=T.MathUtils.clamp((p.lon-d.west)/d.dx,0,d.width-1),yy=T.MathUtils.clamp((d.north-p.lat)/d.dy,0,d.height-1),ix=Math.min(d.width-2,Math.floor(xx)),iy=Math.min(d.height-2,Math.floor(yy)),fx=xx-ix,fy=yy-iy;const row=(r:number)=>d.values[r*d.width+ix]*(1-fx)+d.values[r*d.width+ix+1]*fx;const sampled=row(iy)*(1-fy)+row(iy+1)*fy;if(inRing(x,z,quadPad)){const p=new T.Vector2(x,z),edge=Math.min(...quadPad.map((a,i)=>distanceSegment(p,a,quadPad[(i+1)%quadPad.length])));return T.MathUtils.lerp(sampled,99.25,T.MathUtils.clamp(edge/2,0,1));}return sampled;}
let seed=84129;
function random(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
function noiseTexture(color:number[],size=128){const c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d')!,data=ctx.createImageData(size,size);for(let i=0;i<data.data.length;i+=4){const n=(random()-.5)*24;for(let k=0;k<3;k++)data.data[i+k]=color[k]+n;data.data[i+3]=255;}ctx.putImageData(data,0,0);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(3,3);return t;}


function labelTexture(text:string){const c=document.createElement('canvas');c.width=512;c.height=80;const ctx=c.getContext('2d')!;ctx.fillStyle='#003360dd';ctx.beginPath();ctx.roundRect(0,0,512,80,14);ctx.fill();ctx.font='600 42px Montserrat, Arial, sans-serif';ctx.textAlign='center';ctx.fillStyle='#f3f2e7';ctx.fillText(text,256,55);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;}

export async function createWorld(host:HTMLDivElement,onTick:(s:Snapshot)=>void,onError:(s:string)=>void,options:{tracking?:boolean;embedded?:boolean}={}){
 const startupAt=performance.now();let worldFirstRenderMs:number|null=null;
 seed=84129;
 const startupStages:Record<string,number>={};const mark=(name:string)=>{startupStages[name]=Math.round(performance.now()-startupAt);};
 const read=async(path:string)=>(await fetchAsset(path)).json();
 const [data,textures,busGLTF]=await Promise.all([
  Promise.all([read('data/routes.json'),read('local-scene/elevation.json'),read('local-scene/footprints.json'),read('local-scene/ground-bounds.json'),read('data/corridor.json'),read('local-scene/road-profiles.json'),read('local-scene/roadside-roofs.json'),read('local-scene/landscape.json')]),
  Promise.all(['grass-detail-albedo.webp','shingles-albedo.webp','stone-albedo.webp','broadleaf-albedo.webp'].map(name=>loadTexture('local-scene/'+name))),
  fetchAsset('models/valley-bus.glb').then(r=>r.arrayBuffer()).then(buffer=>new GLTFLoader().parseAsync(buffer,BASE+'models/')),
 ]);
 const [routes,dem,footprints,bounds,corridor,roadProfiles,roofData,landscapeData]=data as [{inbound:Geo[];outbound:Geo[]},DEM,{buildings:Building[];exclusions:number[][][]},any,number[][][],{inbound:RoadProfile[];outbound:RoadProfile[]},{profiles:RoofLevels[]},LandscapeData];
 const [grassDetail,shingles,stoneMap,branchMap]=textures;
 mark('assets');
 const extent=bounds.extent||bounds;
 const mobile=()=>host.clientWidth<650;
 const renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,mobile()?1:1.4));renderer.setSize(host.clientWidth,host.clientHeight);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;host.appendChild(renderer.domElement);
 const scene=new T.Scene(),daylight=createDaylightBackdrop(),overviewBackground=new T.Color('#003360');scene.background=daylight;const atmosphere=new T.Fog('#d9e1db',3500,8500);scene.fog=atmosphere;
 const camera=new T.PerspectiveCamera(42,host.clientWidth/host.clientHeight,1,12000);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.1;controls.maxPolarAngle=Math.PI*.485;controls.minDistance=12;controls.maxDistance=9000;controls.enablePan=true;controls.screenSpacePanning=false;controls.mouseButtons={LEFT:T.MOUSE.PAN,MIDDLE:T.MOUSE.DOLLY,RIGHT:T.MOUSE.ROTATE};controls.touches={ONE:T.TOUCH.PAN,TWO:T.TOUCH.DOLLY_ROTATE};
 const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;scene.environmentIntensity=.5;pmrem.dispose();room.dispose();
 scene.add(new T.HemisphereLight('#dbeaf4','#6f6751',.9));
 const sun=new T.DirectionalLight('#fff0d4',2.8);sun.castShadow=true;sun.shadow.mapSize.set(mobile()?1024:2048,mobile()?1024:2048);sun.shadow.normalBias=.15;sun.shadow.bias=-.00015;sun.shadow.camera.left=-270;sun.shadow.camera.right=270;sun.shadow.camera.top=270;sun.shadow.camera.bottom=-270;sun.shadow.camera.near=10;sun.shadow.camera.far=1400;scene.add(sun,sun.target);
 mark('renderer');
 const rings=corridor.map(r=>r.map(p=>local({lon:p[0],lat:p[1]})));
 const campusRing=[[-121.8291,37.2768],[-121.828,37.2772],[-121.8243,37.2770],[-121.8218,37.2757],[-121.8222,37.2740],[-121.825,37.2741],[-121.8288,37.2752]].map(p=>local({lon:p[0],lat:p[1]}));rings.push(campusRing);
 const ringBoxes=rings.map(r=>new T.Box2().setFromPoints(r));
 const inside=(x:number,z:number)=>rings.some((r,i)=>x>=ringBoxes[i].min.x&&x<=ringBoxes[i].max.x&&z>=ringBoxes[i].min.y&&z<=ringBoxes[i].max.y&&inRing(x,z,r));
 const min=local({lon:extent.xmin,lat:extent.ymax}),max=local({lon:extent.xmax,lat:extent.ymin});
 const nx=300,nz=256,pos:number[]=[];
 for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){const x=T.MathUtils.lerp(min.x,max.x,i/nx),z=T.MathUtils.lerp(min.y,max.y,j/nz);pos.push(x,groundHeight(dem,x,z),z);}
 // Roads must follow the triangles actually rendered, not a separate DEM interpolation.
 const surfaceHeight=(x:number,z:number)=>{const gx=T.MathUtils.clamp((x-min.x)/(max.x-min.x)*nx,0,nx-.000001),gz=T.MathUtils.clamp((z-min.y)/(max.y-min.y)*nz,0,nz-.000001),ix=Math.floor(gx),iz=Math.floor(gz),fx=gx-ix,fz=gz-iz,a=iz*(nx+1)+ix,y=(index:number)=>pos[index*3+1];return fx+fz<=1?y(a)+(y(a+1)-y(a))*fx+(y(a+nx+1)-y(a))*fz:y(a+nx+2)+(y(a+nx+1)-y(a+nx+2))*(1-fx)+(y(a+1)-y(a+nx+2))*(1-fz);};
 const terrainGrid={minX:min.x,minZ:min.y,stepX:(max.x-min.x)/nx,stepZ:(max.y-min.y)/nz,columns:nx,rows:nz};
 const groundGeo=createModeledTerrain(landscapeData.boundary,terrainGrid,surfaceHeight);
 grassDetail.colorSpace=T.SRGBColorSpace;grassDetail.wrapS=grassDetail.wrapT=T.RepeatWrapping;grassDetail.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);
 // Meter-scaled grass/thatch material on measured geometry. No geographic image
 // contributes color, baked shadows, roof detail, or tree positions at runtime.
 const groundMat=new T.MeshStandardMaterial({map:grassDetail,bumpMap:grassDetail,bumpScale:.025,vertexColors:true,roughness:1});
 groundMat.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
  vec4 detailA=texture2D(map, vMapUv);
  vec4 detailB=texture2D(map, mat2(0.8,-0.6,0.6,0.8)*vMapUv*0.37+vec2(0.23,0.67));
  diffuseColor*=mix(detailA,detailB,0.48);
 #endif`);};
 groundMat.customProgramCacheKey=()=> 'modeled-meadow-v1';
 const terrain=new T.Mesh(groundGeo,groundMat);terrain.receiveShadow=true;scene.add(terrain);
 const parking=createParkingLayout(local,landscapeData.roads);
 const landscape=buildLandscape(scene,surfaceHeight,terrainGrid,inside,landscapeData,local,parking);
 mark('terrain');
 const wallTex=noiseTexture([180,170,146]);const wallMat=new T.MeshStandardMaterial({map:wallTex,bumpMap:wallTex,bumpScale:.025,roughness:.88,side:T.DoubleSide});
 const trimMat=new T.MeshStandardMaterial({color:'#d8d6c8',roughness:.7});const glassMat=new T.MeshPhysicalMaterial({color:'#547587',metalness:.62,roughness:.16,clearcoat:1,envMapIntensity:1.7});
 const shadedGlass=glassMat.clone();shadedGlass.color.set('#2a4658');shadedGlass.roughness=.23;
 const paleGlass=glassMat.clone();paleGlass.color.set('#829a9b');paleGlass.roughness=.19;
 const campusGlass=[glassMat,shadedGlass,paleGlass];
 const revealMat=new T.MeshStandardMaterial({color:'#414c4c',roughness:.92});
 const foundationMat=new T.MeshStandardMaterial({map:wallTex,color:'#a19a85',roughness:.95});
 const metalMat=new T.MeshStandardMaterial({color:'#a7aaa2',metalness:.55,roughness:.6});
 const batches=new Map<T.Material,T.BufferGeometry[]>();const addGeometry=(g:T.BufferGeometry,m:T.Material)=>{const list=batches.get(m)||[];list.push(g.index?g.toNonIndexed():g);batches.set(m,list);};
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,m:T.Material,rotation=0)=>{const g=new T.BoxGeometry(w,h,d);g.rotateY(rotation);g.translate(x,y,z);addGeometry(g,m);};
 const buildingRings:T.Vector2[][]=[];
 const buildingRouteLines=[routes.inbound,routes.outbound].map(r=>r.map(local));
 const nearestRoad=(p:T.Vector2)=>{let best=new T.Vector2(),distance=Infinity;for(const line of buildingRouteLines)for(let i=1;i<line.length;i++){const a=line[i-1],delta=line[i].clone().sub(a),t=T.MathUtils.clamp(p.clone().sub(a).dot(delta)/(delta.lengthSq()||1),0,1),candidate=a.clone().addScaledVector(delta,t),d=candidate.distanceToSquared(p);if(d<distance){distance=d;best=candidate;}}return best;};
 const roadside=await createRoadsideBuildings(scene,surfaceHeight,nearestRoad,new Map(roofData.profiles.map(p=>[p.id,p])),shingles);

 // Architectural envelopes replace the rejected noisy lidar surface mesh.
 // Elevations are calibrated against that data; forms follow the campus orthophoto.
 const campusEaves:Record<number,number>={250869139:106,643481605:106.5,643481608:109.6};
 const campusRoofMat=createCampusRoofMaterial();
 const campusFlatRoofMat=new T.MeshStandardMaterial({map:wallTex,bumpMap:wallTex,bumpScale:.008,color:'#dadbd4',roughness:.96});
 const towerCenter=local({lon:-121.82620,lat:37.276257}),towerYaw=-.237;
 const towerAxis=(p:T.Vector2)=>(p.x-towerCenter.x)*Math.cos(towerYaw)-(p.y-towerCenter.y)*Math.sin(towerYaw);
 function classroomRing(ring:T.Vector2[]){const clipped:T.Vector2[]=[];for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],da=towerAxis(a)+5.4,db=towerAxis(b)+5.4;if(da<=0)clipped.push(a);if((da<=0)!==(db<=0))clipped.push(a.clone().lerp(b,da/(da-db)));}return clipped;}
 // Cut the glazed entrance out of the opaque conservatory envelope.
 const conservatoryAnchor=local({lon:-121.825733,lat:37.275996}),cy=Math.cos(-.237),sy=Math.sin(-.237);
 const conservatoryPoint=(x:number,z:number)=>new T.Vector2(conservatoryAnchor.x+cy*x+sy*z,conservatoryAnchor.y-sy*x+cy*z);
 function conservatoryRing(ring:T.Vector2[]){return ring.flatMap(p=>p.distanceTo(conservatoryPoint(.9,8.9))<.8?[conservatoryPoint(.9,-6.4),conservatoryPoint(14.3,-6.4),conservatoryPoint(14.3,8.9)]:[p]);}
 for(const building of footprints.buildings){let ring=building.ring.map(p=>local({lon:p[0],lat:p[1]}));if(ring.length<3||!ring.every(p=>inside(p.x,p.y)))continue;buildingRings.push(ring);if(!building.campus&&building.kind!=='roof'){roadside.build(building,ring);continue;}if(building.id===250869139)ring=classroomRing(ring);if(building.id===643481608)ring=conservatoryRing(ring);if(ring.length<3)continue;
  const center=ring.reduce((a,p)=>a.add(p),new T.Vector2()).multiplyScalar(1/ring.length),campusRoof=campusEaves[building.id];
  const base=campusRoof?Math.min(...ring.map(p=>groundHeight(dem,p.x,p.y)))-.2:groundHeight(dem,center.x,center.y)-.4;
  const h=campusRoof?campusRoof-base:building.height,roofOnly=building.kind==='roof';
  const shape=new T.Shape(ring.map(p=>new T.Vector2(p.x,-p.y)));
  const extrusion=createBuildingShell(shape,roofOnly?.18:h);extrusion.rotateX(-Math.PI/2);extrusion.translate(0,roofOnly?base+h:base,0);addGeometry(extrusion,wallMat);
  const roof=new T.ShapeGeometry(shape);roof.rotateX(-Math.PI/2);roof.translate(0,base+h+.025,0);
  const p=roof.getAttribute('position'),roofUV=[];for(let i=0;i<p.count;i++)roofUV.push(campusRoof?(Math.cos(-.237)*p.getX(i)-Math.sin(-.237)*p.getZ(i))/1.2:p.getX(i)/6,campusRoof?(Math.sin(-.237)*p.getX(i)+Math.cos(-.237)*p.getZ(i))/4:p.getZ(i)/6);roof.setAttribute('uv',new T.Float32BufferAttribute(roofUV,2));addGeometry(roof,campusRoof&&building.id!==643481608?campusRoofMat:roofOnly?metalMat:campusFlatRoofMat);
  if(roofOnly){for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],len=a.distanceTo(b);for(let d=1;d<len;d+=6){const p=a.clone().lerp(b,d/len);box(p.x,base+h/2,p.y,.16,h,.16,metalMat);}}}
  // School photos show sparse groups of openings, not a floor-by-floor window grid.
  // The conservatory has its own curtain wall; do not add classroom windows there.
  if(building.campus&&!roofOnly&&building.id!==643481608){
   const winding=Math.sign(ring.reduce((sum,p,i)=>sum+p.x*ring[(i+1)%ring.length].y-ring[(i+1)%ring.length].x*p.y,0))||1;
   const facadeEdges=ring.map((a,i)=>({i,len:a.distanceTo(ring[(i+1)%ring.length])})).filter(e=>e.len>12).sort((a,b)=>b.len-a.len).slice(0,3).map(e=>e.i);
   for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=b.y-a.y,len=Math.hypot(dx,dz);if(len<2)continue;
    const yaw=-Math.atan2(dz,dx),nx=winding*dz/len,nz=-winding*dx/len,mx=(a.x+b.x)/2,mz=(a.y+b.y)/2;
    box(mx+nx*.09,base+.48,mz+nz*.09,len,.96,.18,foundationMat,yaw);
    if(!campusRoof)box(mx,base+h+.3,mz,len,.6,.4,trimMat,yaw);
    box(mx+nx*.16,base+h-.13,mz+nz*.16,len,.22,.44,trimMat,yaw);
    if(!campusRoof||!facadeEdges.includes(i))continue;
    for(const fraction of (len>22?[.27,.74]:[.5])){
     const x=a.x+dx*fraction,z=a.y+dz*fraction,y=campusRoof-(len>22?5.1:2.5),w=len>22?4.8:3.2;
     const opening=(along:number,up:number,out:number,width:number,hh:number,d:number,m:T.Material)=>box(x+dx/len*along+nx*out,y+up,z+dz/len*along+nz*out,width,hh,d,m,yaw);
     opening(0,0,.04,w+.2,1.4,.09,revealMat);
     opening(0,0,.095,w,1.2,.05,campusGlass[(building.id+i)%3]);
     for(const side of [-1,1])opening(side*(w/2+.04),0,.15,.09,1.4,.18,trimMat);
     opening(0,.66,.15,w+.2,.08,.18,trimMat);opening(0,-.66,.22,w+.3,.1,.32,trimMat);
     for(let divider=1;divider<4;divider++)opening(-w/2+w*divider/4,0,.15,.06,1.2,.12,trimMat);
    }
   }
  }

 }
 for(const [material,list] of batches){if(!list.length)continue;const merged=mergeGeometries(list,false)!;const mesh=new T.Mesh(merged,material);mesh.castShadow=!campusGlass.includes(material as T.MeshPhysicalMaterial);mesh.receiveShadow=true;scene.add(mesh);list.forEach(g=>g.dispose());}
 mark('buildings');
 const roadsideStats=roadside.finish();
 await buildCampus(scene,local,(x,z)=>groundHeight(dem,x,z),campusRoofMat,stoneMap);
 const grounds=buildGrounds(scene,local,surfaceHeight,parking);
 const meadow=addMeadow(scene,surfaceHeight,landscape.naturalAt,buildingRings,min,max);
 const treePositions=landscapeData.trees.map(([x,z,h])=>({x,z,h,y:surfaceHeight(x,z)}));
 const routeLines=buildingRouteLines;
 mark('campus');
 branchMap.colorSpace=T.SRGBColorSpace;branchMap.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),4);
 const vegetation=addVegetation(scene,treePositions,random,branchMap,renderer);
 const paths=routeLines.map((rawPoints,index)=>{const {points,profiles}=roundRoadPath(rawPoints,index===0?roadProfiles.inbound:roadProfiles.outbound);const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+points[i].distanceTo(points[i-1]));return {points,normals:points.map((_,i)=>roadNormal(points,i)),profiles,lengths,length:lengths.at(-1)!};});
 function at(path:typeof paths[number],t:number){
  const d=t*path.length;let i=1;while(i<path.lengths.length-1&&path.lengths[i]<d)i++;
  const a=path.points[i-1],b=path.points[i],segmentLength=path.lengths[i]-path.lengths[i-1],f=(d-path.lengths[i-1])/(segmentLength||1),normal=path.normals[i-1].clone().lerp(path.normals[i],f).normalize();
  const current=laneOffset(path.profiles[i-1]),previous=laneOffset(path.profiles[Math.max(0,i-2)]),next=laneOffset(path.profiles[Math.min(path.profiles.length-1,i)]);
  const fromStart=T.MathUtils.clamp(f*segmentLength/10,0,1),toEnd=T.MathUtils.clamp((1-f)*segmentLength/10,0,1);
  const offset=current+(previous-current)*.5*(1-fromStart)+(next-current)*.5*(1-toEnd),p=a.clone().lerp(b,f).add(normal.clone().multiplyScalar(offset));
  return {x:p.x,z:p.y,heading:Math.atan2(normal.y,-normal.x),y:surfaceHeight(p.x,p.y)+.17};
 }
 const roadStats=buildRoads(scene,paths,surfaceHeight,{minX:min.x,minZ:min.y,stepX:(max.x-min.x)/nx,stepZ:(max.y-min.y)/nz,columns:nx,rows:nz});
 const streetDetails=buildStreetDetails(scene,paths,surfaceHeight);
 const routeObjects=paths.map((path,i)=>{const geometry=new LineGeometry().setPositions(path.points.flatMap(p=>[p.x,groundHeight(dem,p.x,p.y)+.3,p.y]));const line=new Line2(geometry,new LineMaterial({color:i===0?'#8cd2f4':'#ffcc33',linewidth:2.5,transparent:true,opacity:.9,depthWrite:false,depthTest:false}));line.renderOrder=2;scene.add(line);return line;});
 mark('roads');
 const buses=[0,1,2].map(i=>{const root=busGLTF.scene.clone(true);root.traverse(o=>{if(o instanceof T.Mesh){o.castShadow=true;o.receiveShadow=true;}});root.userData.busIndex=i;scene.add(root);return root;});
 mark('bus');
 // Local reflections are only needed for close architectural views. Keep the
 // shared environment during startup instead of rendering the entire scene six times.
 const probeTarget=new T.WebGLCubeRenderTarget(128,{generateMipmaps:true,minFilter:T.LinearMipmapLinearFilter});
 const probe=new T.CubeCamera(1,2500,probeTarget),probePoint=local({lon:-121.82586,lat:37.27594});probe.position.set(probePoint.x,groundHeight(dem,probePoint.x,probePoint.y)+8,probePoint.y);
 sun.target.position.copy(probe.position);sun.position.copy(probe.position).add(new T.Vector3(-420,470,240));
 let reflectionState:'idle'|'building'|'ready'='idle';
 async function prepareReflections(){
  if(reflectionState!=='idle'||disposed)return;
  reflectionState='building';
  await renderer.compileAsync(scene,probe.children[0] as T.PerspectiveCamera);
  if(disposed)return;
  // Screen-space labels are UI, so keep them out of the architectural reflection.
  const sprites=[...labels,...busLabels],visible=sprites.map(sprite=>sprite.visible);
  sprites.forEach(sprite=>{sprite.visible=false;});
  try {vegetation.update(probe);meadow.update(probe);probe.update(renderer,scene);}
  finally {sprites.forEach((sprite,i)=>{sprite.visible=visible[i];});}
  scene.environment=probeTarget.texture;scene.environmentIntensity=.8;
  reflectionState='ready';dirty=true;
 }
 mark('reflectionSetup');
 const labels=[{p:local(routes.inbound[0]),text:'FEHREN LOT'},{p:local(routes.outbound[0]),text:'SKYWAY CAMPUS'}].map(({p,text})=>{const sprite=new T.Sprite(new T.SpriteMaterial({map:labelTexture(text),depthTest:false,transparent:true}));sprite.position.set(p.x,groundHeight(dem,p.x,p.y)+12,p.y);sprite.scale.set(74,11.6,1);scene.add(sprite);return sprite;});
 const busLabels=buses.map((_,i)=>{const label=new T.Sprite(new T.SpriteMaterial({map:labelTexture('SHUTTLE '+String(i+1).padStart(2,'0')),depthTest:false,transparent:true}));label.scale.set(30,4.7,1);scene.add(label);return label;});
 let selected=0,paused=false,speed=1,elapsed=0,mode='campus',disposed=false,frame=0,last=performance.now(),lastDraw=0,lastTick=0,fpsAt=performance.now(),frames=0,fps=0,totalFrames=0,dirty=true;
 const fpsHistory:number[]=[];let measuredMode=mode;
 let shadowRange=270;
 let tracking=options.tracking??false;
 paused=tracking;
 let renderingActive=true;
 const estimateDot=new T.Mesh(new T.SphereGeometry(3.5,16,12),new T.MeshBasicMaterial({color:'#ffc75c',depthTest:false,transparent:true,opacity:.85}));estimateDot.renderOrder=20;estimateDot.visible=false;scene.add(estimateDot);
 const estimateLabel=new T.Sprite(new T.SpriteMaterial({map:labelTexture('ESTIMATED'),depthTest:false,transparent:true}));estimateLabel.scale.set(45,7,1);estimateLabel.visible=false;scene.add(estimateLabel);
 const estimateBand=new T.Line(new T.BufferGeometry(),new T.LineBasicMaterial({color:'#ffc75c',depthTest:false,transparent:true,opacity:.65}));estimateBand.renderOrder=19;estimateBand.visible=false;scene.add(estimateBand);
 function setEstimate(marker:EstimatedMarker|null){
  const visible=tracking&&!!marker;
  estimateDot.visible=visible;estimateLabel.visible=visible;estimateBand.visible=visible;
  if(visible&&marker){const path=paths[marker.direction==='inbound'?0:1],p=at(path,T.MathUtils.clamp(marker.progress,0,1));estimateDot.position.set(p.x,p.y+6,p.z);estimateLabel.position.set(p.x,p.y+15,p.z);const points=Array.from({length:41},(_,i)=>{const a=at(path,marker.lower+(marker.upper-marker.lower)*i/40);return new T.Vector3(a.x,a.y+2,a.z);});estimateBand.geometry.dispose();estimateBand.geometry=new T.BufferGeometry().setFromPoints(points);}
  dirty=true;
 }
 const starts=[.9,.16,.44],target=new T.Vector3(),desiredCamera=new T.Vector3();
 let flight:{from:T.Vector3;to:T.Vector3;lookFrom:T.Vector3;lookTo:T.Vector3;start:number}|null=null;
 function fly(center:T.Vector3,offset:T.Vector3,nextMode:string){mode=nextMode;if(nextMode==='architecture'||nextMode==='quad')void prepareReflections().catch(()=>{reflectionState='idle';});flight={from:camera.position.clone(),to:center.clone().add(offset),lookFrom:controls.target.clone(),lookTo:center,start:performance.now()};dirty=true;}
 function focus(where:'campus'|'lot'){const p=local(where==='campus'?{lon:-121.8264,lat:37.2759}:routes.inbound[0]);const c=new T.Vector3(p.x,groundHeight(dem,p.x,p.y)+10,p.y);fly(c,where==='campus'?new T.Vector3(-220,175,280).multiplyScalar(mobile()?1.35:1):new T.Vector3(150,250,-330),where);}
 function overview(flat=false){
  const points=paths.flatMap(p=>p.points.map(v=>new T.Vector3(v.x,groundHeight(dem,v.x,v.y),v.y))),box=new T.Box3().setFromPoints(points),sphere=box.getBoundingSphere(new T.Sphere());
  const halfVertical=T.MathUtils.degToRad(camera.fov/2),halfHorizontal=Math.atan(Math.tan(halfVertical)*camera.aspect);
  const direction=(flat?new T.Vector3(0,1,.001):mobile()?new T.Vector3(-1050,2500,-500):new T.Vector3(-1050,1400,1500)).normalize();
  // Fit projected route points, including their depth, into the space around the controls.
  const right=new T.Vector3().crossVectors(camera.up,direction).normalize(),up=new T.Vector3().crossVectors(direction,right);
  const horizontal=Math.tan(halfHorizontal)*(options.embedded ? .85 : mobile()?Math.max(.3,1-124/host.clientWidth):.82),vertical=Math.tan(halfVertical)*(options.embedded ? .85 : mobile()?Math.max(.3,1-270/host.clientHeight):.55);
  const distance=Math.max(...points.map(p=>{const v=p.clone().sub(sphere.center),depth=v.dot(direction);return Math.max((Math.abs(v.dot(right))+80)/horizontal,(Math.abs(v.dot(up))+80)/vertical)+depth;}))*1.04;
  const center=sphere.center.clone();if(!mobile())center.addScaledVector(up,-distance*2*Math.tan(halfVertical)*.05);
  fly(center,direction.multiplyScalar(distance),flat?'map':'overview');
 }
 const initial=local({lon:-121.8264,lat:37.2759});controls.target.set(initial.x,groundHeight(dem,initial.x,initial.y)+10,initial.y);camera.position.copy(controls.target).add(new T.Vector3(-220,175,280).multiplyScalar(mobile()?1.35:1));controls.update();
 const startExplore=()=>{flight=null;if(mode==='bus'||mode==='follow'||mode==='estimate')mode='explore';dirty=true;};controls.addEventListener('start',startExplore);controls.addEventListener('change',()=>{dirty=true;});
 const raycaster=new T.Raycaster(),pointer=new T.Vector2();let downX=0,downY=0;
 const pointerDown=(e:PointerEvent)=>{downX=e.clientX;downY=e.clientY;};
 const pickBus=(e:PointerEvent)=>{if(tracking)return;if(Math.hypot(e.clientX-downX,e.clientY-downY)>5)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(buses,true)[0];if(hit){let object:T.Object3D|null=hit.object;while(object&&object.userData.busIndex===undefined)object=object.parent;if(object){selected=object.userData.busIndex;mode='follow';dirty=true;}}};
 renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pickBus);
 function tick(now:number){if(disposed||!renderingActive)return;frame=requestAnimationFrame(tick);const dt=Math.min((now-last)/1000,.1);last=now;if(!paused){elapsed+=dt*speed;dirty=true;}const progress=starts.map(s=>(s+elapsed/480)%1);
  buses.forEach((bus,i)=>{bus.visible=!tracking;const path=paths[i===1?1:0],p=at(path,progress[i]),sin=Math.sin(p.heading),cos=Math.cos(p.heading);
   // Fit the bus to its four wheel contact points, including the road's cross slope.
   const wheel=(x:number,z:number)=>surfaceHeight(p.x+x*cos+z*sin,p.z-x*sin+z*cos)+.16;
   const fl=wheel(-1.14,2.69),fr=wheel(1.14,2.69),rl=wheel(-1.14,-3.22),rr=wheel(1.14,-3.22),slope=Math.atan2((fl+fr-rl-rr)/2,5.91),roll=Math.atan2((fr+rr-fl-rl)/2,2.28);
   bus.position.set(p.x,(fl+fr+rl+rr)/4+Math.tan(slope)*.265-.01,p.z);bus.rotation.set(-slope,p.heading,roll,'YXZ');busLabels[i].position.copy(bus.position).add(new T.Vector3(0,9,0));busLabels[i].visible=!tracking&&!['bus','architecture','quad','facilities'].includes(mode)&&!(mobile()&&['overview','map'].includes(mode));});
  if(flight){const t=Math.min(1,(now-flight.start)/1200),ease=t*t*(3-2*t);camera.position.lerpVectors(flight.from,flight.to,ease);controls.target.lerpVectors(flight.lookFrom,flight.lookTo,ease);dirty=true;if(t===1)flight=null;}
  if(mode==='estimate'&&estimateDot.visible&&!flight){target.copy(estimateDot.position);desiredCamera.copy(target).add(new T.Vector3(-90,130,160));if(camera.position.distanceTo(desiredCamera)>.02||controls.target.distanceTo(target)>.02){camera.position.lerp(desiredCamera,.13);controls.target.lerp(target,.2);dirty=true;}}
  if(mode==='follow'||mode==='bus'){const bus=buses[selected],angle=bus.rotation.y+(mode==='bus'?Math.PI+.55:Math.PI+.4),range=mode==='bus'?22:55;target.copy(bus.position).add(new T.Vector3(0,mode==='bus'?2:1,0));desiredCamera.set(target.x+Math.sin(angle)*range,target.y+(mode==='bus'?13:35),target.z+Math.cos(angle)*range);if(camera.position.distanceTo(desiredCamera)>.02||controls.target.distanceTo(target)>.02){camera.position.lerp(desiredCamera,.13);controls.target.lerp(target,.2);dirty=true;}}
  controls.update();vegetation.update(camera);meadow.update(camera);roadside.update(camera);routeObjects.forEach(o=>{o.visible=mode!=='bus'&&mode!=='architecture'&&mode!=='facilities'&&mode!=='quad';o.material.depthTest=mode!=='overview'&&mode!=='map';});labels.forEach(l=>l.visible=!['bus','architecture','quad','facilities'].includes(mode));[...labels,...busLabels,estimateLabel].forEach(l=>{const distance=camera.position.distanceTo(l.position),pixels=labels.includes(l)?(mobile()?100:140):110,width=distance*2*Math.tan(T.MathUtils.degToRad(camera.fov/2))/host.clientHeight*pixels;l.scale.set(width,width*80/512,1);});
  const shadowTarget=(mode==='bus'||mode==='follow')?buses[selected].position:controls.target;sun.target.position.copy(shadowTarget);sun.position.copy(shadowTarget).add(new T.Vector3(-420,470,240));
  const nextShadowRange=mode==='bus'?45:mode==='follow'?90:['architecture','quad'].includes(mode)?65:mode==='facilities'?150:270;if(nextShadowRange!==shadowRange){shadowRange=nextShadowRange;sun.shadow.camera.left=-shadowRange;sun.shadow.camera.right=shadowRange;sun.shadow.camera.top=shadowRange;sun.shadow.camera.bottom=-shadowRange;sun.shadow.camera.updateProjectionMatrix();sun.shadow.normalBias=mode==='bus'?.025:nextShadowRange<=90?.04:.15;}
  const mapBackground=mode==='overview'||mode==='map',nextBackground=mapBackground?overviewBackground:daylight;
  if(scene.background!==nextBackground){scene.background=nextBackground;atmosphere.color.set(mapBackground?'#003360':'#d9e1db');atmosphere.near=mapBackground?5500:3500;atmosphere.far=mapBackground?11000:8500;dirty=true;}
  const drawInterval=1000/30,sinceDraw=now-lastDraw;
  if(dirty&&sinceDraw>=drawInterval){renderer.render(scene,camera);if(worldFirstRenderMs===null)worldFirstRenderMs=Math.round(performance.now()-startupAt);dirty=false;lastDraw=now-(sinceDraw%drawInterval);frames++;totalFrames++;}
  if(now-fpsAt>1000){const sample=frames*1000/(now-fpsAt);fps=Math.round(sample);if(measuredMode!==mode){fpsHistory.length=0;measuredMode=mode;}if(!paused&&totalFrames>90){fpsHistory.push(sample);if(fpsHistory.length>30)fpsHistory.shift();}frames=0;fpsAt=now;}
  if(now-lastTick>350){const info={tracking,estimateVisible:estimateDot.visible,estimatedPosition:estimateDot.visible?{x:estimateDot.position.x,z:estimateDot.position.z}:null,visibleDemoBuses:buses.filter(b=>b.visible).length,renderer:'Three.js / local geometry',worldFirstRenderMs,startupStages,reflections:reflectionState,mode,loaded:true,fps,paused,viewport:{width:innerWidth,height:innerHeight},drawingBuffer:{width:renderer.domElement.width,height:renderer.domElement.height},pixelRatio:renderer.getPixelRatio(),fpsSamples:fpsHistory.length,averageFps:fpsHistory.length?Math.round(fpsHistory.reduce((a,b)=>a+b,0)/fpsHistory.length*10)/10:0,minimumFps:fpsHistory.length?Math.round(Math.min(...fpsHistory)*10)/10:0,totalFrames,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,buildings:buildingRings.length,authoredCampusRoofs:Object.keys(campusEaves).length,trees:treePositions.length,parkedCars:grounds.parkedCars,fenceMeters:grounds.fenceMeters,streetLights:streetDetails.streetLights,roadMeters:roadStats.meters,roadMinimumClearance:roadStats.minimumClearance,roadWorstPoint:roadStats.worstPoint,roadsideRoofs:roadsideStats.pitchedRoofs,roadsideFacades:roadsideStats.detailedFacades,maximumRoadsideRoofRise:roadsideStats.maximumRoofRise,terrainAdjustedIds:roadsideStats.terrainAdjustedIds,terrainIntrusionIds:roadsideStats.terrainIntrusionIds,measuredRoadsideRoofs:roadsideStats.measuredRoofs,rejectedRoofProfiles:roadsideStats.rejectedRoofProfiles,maximumBuildingGroundSpan:roadsideStats.maximumGroundSpan,terrainGrid:{width:dem.width,height:dem.height},meadowClumps:meadow.count,landscapePatches:landscape.patches,landscapeDrawCalls:landscape.drawCalls,aerialTextures:0,sceneSource:'modeled terrain and surfaces'};host.dataset.diagnostics=JSON.stringify(info);onTick({progress,distance:paths.map(p=>p.length),fps,selected,loaded:true,pending:0,mode,speedMph:paused?0:Math.round(paths[selected===1?1:0].length/480*2.237),location:mode==='quad'?'CAMPUS QUAD':mode==='facilities'?'CAMPUS ATHLETICS':mode==='architecture'?'CONSERVATORY':mode==='campus'?'SKYWAY CAMPUS':mode==='lot'?'FEHREN LOT':selected===1?'SKYWAY → FEHREN':'FEHREN → SKYWAY'});lastTick=now;}
 }
 const resize=new ResizeObserver(()=>{fpsHistory.length=0;frames=0;fpsAt=performance.now();camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();renderer.setSize(host.clientWidth,host.clientHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,mobile()?1:1.4));if(mode==='overview'||mode==='map')overview(mode==='map');dirty=true;});resize.observe(host);
 const visibility=()=>{cancelAnimationFrame(frame);if(!document.hidden&&renderingActive){last=performance.now();dirty=true;frame=requestAnimationFrame(tick);}};document.addEventListener('visibilitychange',visibility);
 const contextLost=(e:Event)=>{e.preventDefault();onError('The graphics context was lost. Reload the local scene.');};renderer.domElement.addEventListener('webglcontextlost',contextLost);
 await renderer.compileAsync(scene,camera);mark('shaders');
 frame=requestAnimationFrame(tick);
 return {setRenderingActive(active:boolean){renderingActive=active;cancelAnimationFrame(frame);if(active&&!disposed&&!document.hidden){last=performance.now();dirty=true;frame=requestAnimationFrame(tick);}},setEstimate,focusEstimate(){if(estimateDot.visible)fly(estimateDot.position.clone(),new T.Vector3(-90,130,160),'estimate');},setTracking(enabled:boolean){tracking=enabled;paused=enabled;buses.forEach(b=>b.visible=!enabled);busLabels.forEach(b=>b.visible=!enabled);if(!enabled)setEstimate(null);if(enabled||mode==='follow'||mode==='bus')overview();dirty=true;},setOrbitMode(orbit:boolean){controls.mouseButtons.LEFT=orbit?T.MOUSE.ROTATE:T.MOUSE.PAN;controls.mouseButtons.RIGHT=T.MOUSE.ROTATE;controls.touches.ONE=orbit?T.TOUCH.ROTATE:T.TOUCH.PAN;controls.touches.TWO=orbit?T.TOUCH.DOLLY_PAN:T.TOUCH.DOLLY_ROTATE;},inspectQuad(){const p=local({lon:-121.82620,lat:37.276257});fly(new T.Vector3(p.x,groundHeight(dem,p.x,p.y)+6,p.y),new T.Vector3(23,10,58).multiplyScalar(mobile()?1.25:1),'quad');},inspectFacilities(){const p=local({lon:-121.823954,lat:37.275144});fly(new T.Vector3(p.x,groundHeight(dem,p.x,p.y)+4,p.y),new T.Vector3(-100,100,115).multiplyScalar(mobile()?1.3:1),'facilities');},inspectCampus(){const p=conservatoryPoint(7.6,1.25);fly(new T.Vector3(p.x,104.8,p.y),new T.Vector3(-43,16,39).multiplyScalar(mobile()?1.65:1),'architecture');},setSelected(i:number){selected=i;dirty=true;},setFollow(v:boolean){flight=null;if(v){mode='follow';dirty=true;}else overview();},seek(progress:number){if(!Number.isFinite(progress))return;elapsed=((T.MathUtils.clamp(progress,0,.999999)-starts[selected]+1)%1)*480;dirty=true;},setPaused(v:boolean){paused=v;dirty=true;},setSpeed(v:number){speed=v;},setFlat(v:boolean){overview(v);},reset(){overview();},zoom(f:number){startExplore();camera.position.sub(controls.target).multiplyScalar(f).add(controls.target);dirty=true;},inspect(){flight=null;mode='bus';dirty=true;},focusStop:focus,setRoute(i:number){routeObjects.forEach((o,j)=>o.material.opacity=i===j?.95:.5);dirty=true;},stats:{buildings:buildingRings.length},dispose(){disposed=true;cancelAnimationFrame(frame);resize.disconnect();document.removeEventListener('visibilitychange',visibility);renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',pickBus);controls.dispose();vegetation.dispose();const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),textures=new Set<T.Texture>();scene.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Line||o instanceof T.Sprite){if('geometry'in o)geometries.add(o.geometry);if(o instanceof T.InstancedMesh)o.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));}});materials.forEach(m=>{for(const v of Object.values(m))if(v instanceof T.Texture&&v!==vegetation.crownTexture)textures.add(v);m.dispose();});geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());daylight.dispose();probeTarget.dispose();environment.dispose();renderer.dispose();renderer.domElement.remove();}};
}
