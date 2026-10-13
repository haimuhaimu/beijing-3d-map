import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PerspectiveCamera, Vector3 } from '../vendor/three.module.min.js';
import { BEIHAI_VIEWS, guidedCameraPose, viewPolicy } from '../guided-view.mjs';
const world=JSON.parse(fs.readFileSync(new URL('../places.json',import.meta.url)));

test('overview pans without losing north; curated Beihai is stable; free view unlocks the model',()=>{
 assert.deepEqual(viewPolicy('all',false),{rotate:false,pan:true,cursorZoom:true});
 assert.deepEqual(viewPolicy('beihai',false),{rotate:false,pan:false,cursorZoom:false});
 assert.deepEqual(viewPolicy('beihai',true),{rotate:true,pan:true,cursorZoom:true});
});

test('every Beihai composition keeps its intended area inside wide and narrow viewports',()=>{
 assert.equal(BEIHAI_VIEWS.length,3);
 for(const view of BEIHAI_VIEWS)for(const aspect of [.58,.8,1.8,2.7]){
  const pose=guidedCameraPose(world,'beihai',aspect,view.id);
  const camera=new PerspectiveCamera(35,aspect,.1,700);
  camera.position.set(...pose.position);camera.lookAt(...pose.target);camera.updateMatrixWorld();
  for(const x of [-view.frame.width/2,view.frame.width/2])for(const y of [0,view.frame.height])for(const z of [-view.frame.depth/2,view.frame.depth/2]){
   const p=new Vector3(x,y,z).add(new Vector3(...view.frame.center)).project(camera);
   assert.ok(Math.abs(p.x)<.96&&Math.abs(p.y)<.96,`${view.id} clipped at ${aspect}`);
  }
 }
});

test('a curated pose never mutates place data, and unknown shots safely return to the lake',()=>{
 const before=JSON.stringify(world);
 const a=guidedCameraPose(world,'beihai',.7,'island'),b=guidedCameraPose(world,'beihai',.7,'missing');
 assert.deepEqual(a,b);assert.equal(JSON.stringify(world),before);
 assert.notDeepEqual(a,guidedCameraPose(world,'beihai',.7,'shore'));
 assert.equal(guidedCameraPose(world,'missing',1),null);
});
