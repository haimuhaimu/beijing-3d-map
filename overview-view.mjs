// Keep north up. Fit the exported scene rather than the old rectangular
// framing box, whose empty elevated corners pushed the city too far away.
export function fitOverview(points, aspect) {
  if (!points.length) return null;
  const safeAspect = Math.max(.35,Number.isFinite(aspect)?aspect:1);
  const angle = (45-17*Math.max(0,Math.min(1,(safeAspect-1)/1.2)))*Math.PI/180;
  const up = Math.sin(angle), forward = Math.cos(angle);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const flat = ArrayBuffer.isView(points), count = flat ? points.length/3 : points.length;
  for(let i=0;i<count;i++) {
    const x=flat?points[i*3]:points[i][0], y=flat?points[i*3+1]:points[i][1], z=flat?points[i*3+2]:points[i][2];
    const vertical=y*forward-z*up, depth=y*up+z*forward;
    min[0]=Math.min(min[0],x);max[0]=Math.max(max[0],x);
    min[1]=Math.min(min[1],vertical);max[1]=Math.max(max[1],vertical);
    min[2]=Math.min(min[2],depth);max[2]=Math.max(max[2],depth);
  }
  const center = min.map((value,i)=>(value+max[i])/2);
  const tanV = Math.tan(35*Math.PI/360)*.9, tanH = tanV*safeAspect;
  let distance = 5;
  for(let i=0;i<count;i++) {
    const x=flat?points[i*3]:points[i][0], y=flat?points[i*3+1]:points[i][1], z=flat?points[i*3+2]:points[i][2];
    distance=Math.max(distance,y*up+z*forward-center[2]+Math.max(Math.abs(x-center[0])/tanH,Math.abs(y*forward-z*up-center[1])/tanV));
  }
  const target=[center[0],center[1]*forward+center[2]*up,center[2]*forward-center[1]*up];
  return {target,position:[target[0],target[1]+distance*up,target[2]+distance*forward]};
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
