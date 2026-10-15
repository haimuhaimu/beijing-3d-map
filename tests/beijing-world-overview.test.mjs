import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from '../vendor/three.module.min.js';
import { fitOverview, restoreMapView } from '../overview-view.mjs';

const points = [[-52,0,-62],[-39,17,-46],[-34,0,-28],[42,0,-24],[47,9,33],[-35,0,30],[0,18,0],[53,0,39]];
test('the full map fits its actual silhouette and uses the available viewport',()=>{
  for(const aspect of [.58,.9,1.7,3.3]){
    const pose=fitOverview(points,aspect);
    assert.ok(pose);
    const camera=new PerspectiveCamera(35,aspect,.1,700);
    camera.position.set(...pose.position);camera.lookAt(...pose.target);camera.updateMatrixWorld();
    let extent=0;
    for(const point of points){
      const projected=new Vector3(...point).project(camera);
      assert.ok(Math.abs(projected.x)<=.90001 && Math.abs(projected.y)<=.90001,`clipped at ${aspect}`);
      extent=Math.max(extent,Math.abs(projected.x),Math.abs(projected.y));
    }
    assert.ok(extent>.88,'one edge should fill the map frame');
    assert.equal(pose.position[0],pose.target[0],'north stays at the top');
  }
  assert.equal(fitOverview([],1),null);
});

test('perspective framing uses both opposing edges instead of leaving one side empty',()=>{
  // A far-west mountain and a near-east city have asymmetric perspective depth.
  // A world-space bounding-box center leaves the city small and off-center.
  for(const aspect of [.58,1.7,2.5,3.3]) {
    const pose=fitOverview(points,aspect),camera=new PerspectiveCamera(35,aspect,.1,700);
    camera.position.set(...pose.position);camera.lookAt(...pose.target);camera.updateMatrixWorld();
    const projected=points.map(point=>new Vector3(...point).project(camera));
    const x=projected.map(p=>p.x),y=projected.map(p=>p.y);
    const fullWidth=Math.min(...x)<-.899 && Math.max(...x)>.899;
    const fullHeight=Math.min(...y)<-.899 && Math.max(...y)>.899;
    assert.ok(fullWidth||fullHeight,`unused framing space at aspect ${aspect}`);
  }
});

test('returning to the map keeps its location and relative zoom after resizing',()=>{
  const saved={position:[12,61,59],target:[12,1,-1],fitDistance:100,free:false};
  const before=structuredClone(saved);
  assert.deepEqual(restoreMapView(saved,100),{position:[12,61,59],target:[12,1,-1]});
  assert.deepEqual(restoreMapView(saved,150),{position:[12,91,89],target:[12,1,-1]});
  assert.deepEqual(saved,before);
});

test('guided map resizing adopts the new framing angle without losing its pan or zoom',()=>{
  const saved={position:[12,31,29],target:[12,1,-1],fitDistance:Math.hypot(60,60),free:false,fitPose:{position:[0,61,59],target:[0,1,-1]}};
  const next={position:[0,47,58],target:[0,2,-2]},distance=Math.hypot(45,60);
  assert.deepEqual(restoreMapView(saved,distance,next),{position:[12,24.5,28],target:[12,2,-2]});
});
