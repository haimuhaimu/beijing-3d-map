// Keep north up. Fit the exported scene rather than the old rectangular
// framing box, whose empty elevated corners pushed the city too far away.
export function fitOverview(points, aspect) {
  if (!points.length) return null;
  const safeAspect = Math.max(.35,Number.isFinite(aspect)?aspect:1);
  // A steeper portrait view separates north/south landmarks on narrow screens.
  const angle = (60-32*Math.max(0,Math.min(1,(safeAspect-1)/1.2)))*Math.PI/180;
  const up = Math.sin(angle), forward = Math.cos(angle);
  const tanV = Math.tan(35*Math.PI/360)*.9, tanH = tanV*safeAspect;
  const sides = [-Infinity,-Infinity,-Infinity,-Infinity];
  let maxDepth=-Infinity;
  const flat = ArrayBuffer.isView(points), count = flat ? points.length/3 : points.length;
  for(let i=0;i<count;i++) {
    const x=flat?points[i*3]:points[i][0], y=flat?points[i*3+1]:points[i][1], z=flat?points[i*3+2]:points[i][2];
    const vertical=y*forward-z*up, depth=y*up+z*forward;
    sides[0]=Math.max(sides[0],depth+x/tanH);
    sides[1]=Math.max(sides[1],depth-x/tanH);
    sides[2]=Math.max(sides[2],depth+vertical/tanV);
    sides[3]=Math.max(sides[3],depth-vertical/tanV);
    maxDepth=Math.max(maxDepth,depth);
  }
  // Solve the opposing perspective-frustum planes together. Centering the
  // world bounds first wastes space when the skyline and foreground differ
  // in depth. This is the closest north-up camera that contains every point.
  const center=[(sides[0]-sides[1])*tanH/2,(sides[2]-sides[3])*tanV/2];
  const cameraDepth=Math.max((sides[0]+sides[1])/2,(sides[2]+sides[3])/2,maxDepth+5);
  // Keep the solved pose, but put the orbit target on the ground along its
  // viewing ray. A bounds-depth midpoint can put it underground, so zooming
  // toward that point would eventually take the camera under the city.
  const target=[center[0],0,-center[1]/up];
  return {target,position:[center[0],center[1]*forward+cameraDepth*up,cameraDepth*forward-center[1]*up]};
}

export function restoreMapView(saved, fitDistance, fitPose = null) {
  if (!saved.free && saved.fitPose && fitPose) {
    const zoom = Math.hypot(...saved.position.map((value,i)=>value-saved.target[i]))/saved.fitDistance;
    const target = fitPose.target.map((value,i)=>value+saved.target[i]-saved.fitPose.target[i]);
    return {target,position:target.map((value,i)=>value+(fitPose.position[i]-fitPose.target[i])*zoom)};
  }
  const ratio = fitDistance/saved.fitDistance;
  return {target:saved.target.slice(),position:saved.position.map((value,i)=>saved.target[i]+(value-saved.target[i])*ratio)};
}

export function collectOverviewPoints(T, model) {
  model.updateMatrixWorld(true);
  const meshes=[];
  let count=0;
  model.traverse(mesh=>{
    if (!mesh.isMesh || mesh.name.startsWith('World_Base')) return;
    const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    if (materials.every(material=>/^Snow(?:[_.]|$)/.test(material.name))) return;
    meshes.push(mesh);count+=mesh.geometry.attributes.position.count;
  });
  // A compact buffer avoids creating hundreds of thousands of Vector3 objects.
  // Read once after layout transforms; fitting results are cached by the viewer.
  const points=new Float32Array(count*3), point=new T.Vector3();
  let cursor=0;
  for(const mesh of meshes) {
    const positions=mesh.geometry.attributes.position;
    for(let i=0;i<positions.count;i++) {
      point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
      points[cursor++]=point.x;points[cursor++]=point.y;points[cursor++]=point.z;
    }
  }
  return points;
}
