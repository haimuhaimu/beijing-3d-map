import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';

const root = new URL('../', import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  return specifier === 'three' ? { url: new URL('vendor/three.module.min.js', root).href, shortCircuit: true } : next(specifier, context);
} });
const { GLTFLoader } = await import('../vendor/loaders/GLTFLoader.js');
const THREE = await import('../vendor/three.module.min.js');
const { Box3, Vector3, Raycaster, PerspectiveCamera } = THREE;
const { createDisplayWorld, applyMapLayout, mapPoint } = await import('../map-layout.mjs');
const field = await import('../state.mjs');
const { cameraPoseFor, placeIdForObject } = field;
const { collectOverviewPoints, fitOverview } = await import('../overview-view.mjs');
const catalog = JSON.parse(fs.readFileSync(new URL('places.json', root)));
const bytes = fs.readFileSync(new URL('beijing-world.glb', root));
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
gltf.scene.updateMatrixWorld(true);
const bounds = new Map();
gltf.scene.traverse(object => {
  if (!object.userData.place) return;
  const box = new Box3().setFromObject(object);
  if (box.isEmpty()) return;
  if (!bounds.has(object.userData.place)) bounds.set(object.userData.place, box);
  else bounds.get(object.userData.place).union(box);
});

test('all twelve original-map destinations have actual selectable 3D geometry', () => {
  assert.deepEqual([...bounds.keys()].sort(), catalog.places.map(place => place.id).sort());
  for (const place of catalog.places) {
    const box = bounds.get(place.id), size = box.getSize(new Vector3());
    assert.ok(size.x > 4 && size.y > 1 && size.z > 4, `${place.id} needs a real landmark`);
    const target = new Vector3(...place.target);
    // Framing may be above a low venue, but must aim into the correct neighborhood.
    assert.ok(target.x >= box.min.x && target.x <= box.max.x, `${place.id}: focus X`);
    assert.ok(target.z >= box.min.z && target.z <= box.max.z, `${place.id}: focus Z`);
  }
});

test('responsive overview contains the actual exported city and every destination', () => {
  const world=createDisplayWorld(catalog), model=gltf.scene.clone(true);
  applyMapLayout(THREE,model,world.mapLayout);
  const points=collectOverviewPoints(THREE,model), point=new Vector3();
  assert.ok(points instanceof Float32Array && points.length>10000);
  for(const aspect of [.58,.9,1.7,3.3]) {
    const pose=fitOverview(points,aspect), camera=new PerspectiveCamera(35,aspect,.1,900);
    camera.position.set(...pose.position);camera.lookAt(...pose.target);camera.updateMatrixWorld();
    for(let i=0;i<points.length;i+=3) {
      point.fromArray(points,i).project(camera);
      assert.ok(Math.abs(point.x)<=.90001 && Math.abs(point.y)<=.90001 && point.z<1,`model clipped at aspect ${aspect}`);
    }
    for(const place of world.places) {
      point.set(...place.target).project(camera);
      assert.ok(Math.abs(point.x)<.96 && Math.abs(point.y)<.96,`${place.id} outside overview at ${aspect}`);
    }
  }
});

test('the GLB is self-contained and stays inside the advertised map footprint', () => {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.ok(json.buffers.every(buffer => !buffer.uri));
  assert.ok((json.images ?? []).every(image => !image.uri));
  const box = new Box3().setFromObject(gltf.scene);
  const size = box.getSize(new Vector3());
  assert.ok(size.x <= catalog.bounds.width + .2);
  assert.ok(size.z <= catalog.bounds.depth + .2);
  assert.ok(box.max.y <= catalog.bounds.height, 'bounds.height is height above ground');
  assert.ok(box.min.y >= -1.5, 'base fits the overview camera lower bound');
  // v20 measured 18,345,564 bytes: 125,280 bytes over v19 (+0.69%).
  // Add 0.1 MB to the cap for modeled factory glazing and courtyards;
  // keep only 54 KB of headroom so future passes still have to budget detail.
  assert.ok(bytes.length < 18_400_000, 'the detailed city should remain under 18.4 MB');
});

test('residential building foundations do not intrude into the road surface', () => {
  const roads=[];
  gltf.scene.traverse(object=>{if(object.isMesh && object.material?.name==='Road_Asphalt')roads.push(object);});
  assert.ok(roads.length>=2,'existing avenues and added lanes have modeled asphalt');
  const ray=new Raycaster(),point=new Vector3();let checked=0;
  gltf.scene.traverse(object=>{
    if(!object.isMesh||!/^City_(Neighborhoods|ResidentialLayers|Hutongs|V15Homes|V16Courtyard)__/.test(object.name))return;
    const positions=object.geometry.attributes.position;
    for(let i=0;i<positions.count;i++){
      point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);
      if(Math.abs(point.y-.23)>.001)continue;
      checked++;
      ray.set(new Vector3(point.x,.26,point.z),new Vector3(0,-1,0));
      assert.equal(ray.intersectObjects(roads,true).length,0,`${object.name} foundation intersects asphalt at ${point.toArray()}`);
    }
  });
  assert.ok(checked>100,'check actual exported residential foundations');
});

test('winter snow and the permanent alpine snow are separate materials', () => {
  assert.ok(json.materials.some(material => material.name === 'Snow'));
  assert.ok(json.materials.some(material => material.name === 'Alpine_Ice'));
  const alpine = gltf.scene.getObjectByName('chongli_Terrain__Mountain_Slate');
  assert.ok(alpine?.userData.place === 'chongli', 'multi-material alpine group carries its place id');
});

test('798 clerestories have separated glass panes and readable steel divisions', () => {
  const panes=[],frames=[];
  gltf.scene.traverse(o=>{
    if(!o.isMesh||o.userData.place!=='798')return;
    assert.notEqual(o.material.name,'Park_Cyan','solid cyan strips must be replaced in the factory');
    if(/^Factory_Clerestory/.test(o.material.name))panes.push(o);
    if(o.name.startsWith('798_V20Roof__Factory_Steel'))frames.push(o);
  });
  assert.ok(panes.length>=2 && frames.length,'glass has tonal variation and structural frames');
  const ray=new Raycaster();
  // Across one real exported roof: mullion at y=19, pane beside it.
  for(const [y,glass] of [[19,false],[19.2,true]]){
    ray.set(new Vector3(26.5,2.66,-y),new Vector3(-1,0,0));ray.far=.4;
    assert.equal(ray.intersectObjects(panes,true).length>0,glass,`pane separation at ${y}`);
    if(!glass)assert.ok(ray.intersectObjects(frames,true).length,'mullion occupies the separation');
  }
});

test('798 outdoor seating and visitors occupy paved courtyards instead of factory interiors or roads', () => {
  const floors=[],roads=[],furniture=[];
  const halls=[[24.5,31.9,16.9,21.1],[24.45,29.95,13.65,15.95],[31.95,34.45,13.7,16.5]];
  gltf.scene.traverse(o=>{
    if(!o.isMesh)return;
    if(o.material.name==='Road_Asphalt')roads.push(o);
    if(o.userData.place==='798' && /^(City_V13Paving|Ground_Factory)/.test(o.material.name))floors.push(o);
    if(/^798_V20(Seating|Visitors)__/.test(o.name))furniture.push(o);
  });
  assert.ok(furniture.length>=3,'courtyard furniture and visitors are exported');
  const ray=new Raycaster();let checked=0;
  for(const o of furniture){const a=o.geometry.attributes.position;
    for(let i=0;i<a.count;i+=3){
      const p=new Vector3().fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);
      for(const [x0,x1,y0,y1] of halls)assert.ok(!(p.x>x0&&p.x<x1&&-p.z>y0&&-p.z<y1),'outdoor detail is inside a hall');
      ray.set(new Vector3(p.x,.30,p.z),new Vector3(0,-1,0));ray.far=.2;
      assert.ok(ray.intersectObjects(floors,true).length,'outdoor detail has paving below');
      assert.equal(ray.intersectObjects(roads,true).length,0,'outdoor detail blocks asphalt');checked++;
    }
  }
  assert.ok(checked>30);
});

test('packed normals decode through the bundled loader without changing their length', () => {
  assert.ok(json.extensionsRequired.includes('KHR_mesh_quantization'));
  let count=0;
  gltf.scene.traverse(object=>{
    if(!object.isMesh)return;
    const normal=object.geometry.attributes.normal;
    assert.ok(normal.normalized && normal.array instanceof Int16Array);
    for(let i=0;i<normal.count;i++){
      const length=Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i));
      assert.ok(Number.isFinite(length) && (length<.0001 || Math.abs(length-1)<.0001));
      count++;
    }
  });
  assert.ok(count>1000);
});

test('ground lighting and shadows retain smooth alpha falloff in the exported model', () => {
  let count=0;
  gltf.scene.traverse(object=>{
    if(!object.isMesh||!/^Road_(LampWash|ContactShadow)$/.test(object.material.name))return;
    assert.ok(object.material.transparent);
    assert.ok(object.material.opacity>0 && object.material.opacity<.5);
    const colors=object.geometry.attributes.color;
    assert.equal(colors.itemSize,4);
    let minimum=1,maximum=0;
    for(let i=0;i<colors.count;i++){minimum=Math.min(minimum,colors.getW(i));maximum=Math.max(maximum,colors.getW(i));}
    assert.equal(minimum,0);assert.equal(maximum,1);count++;
  });
  assert.ok(count>=4);
});

test('light effect coordinates remain aligned with the actual stadium lamps', () => {
  const lamps = gltf.scene.getObjectByName('workers_Stadium_Floodlights__StadiumLamp');
  assert.ok(lamps);
  const box = new Box3().setFromObject(lamps).expandByScalar(.35);
  for (const position of catalog.lampPositions) assert.ok(box.containsPoint(new Vector3(...position)));
});

test('all twenty gondola cabins clear the actual mountain range', () => {
  const cabins = ['chongli_WanlongLift__Temple_Vermilion','chongli_ThaiwooLift__Chongli_ThaiwooLift','chongli_GentingLift__Chongli_GentingLift'].map(name=>gltf.scene.getObjectByName(name));
  const terrain = gltf.scene.getObjectByName('chongli_Terrain__Mountain_Slate');
  assert.ok(cabins.every(Boolean) && terrain);
  // Weld split normal vertices before finding connected hulls. This checks
  // the exported geometry, rather than trusting the generator's height math.
  const points=[], parents=[], welded=new Map();
  const find=i=>parents[i]===i?i:(parents[i]=find(parents[i]));
  const join=(a,b)=>{parents[find(a)]=find(b);};
  cabins.forEach(group=>group.traverse(object=>{
    if(!object.isMesh)return;
    const positions=object.geometry.attributes.position, ids=[];
    for(let i=0;i<positions.count;i++){
      const p=new Vector3().fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);
      const key=p.toArray().map(v=>v.toFixed(4)).join(',');
      if(!welded.has(key)){welded.set(key,points.length);parents.push(points.length);points.push(p);}
      ids.push(welded.get(key));
    }
    const index=object.geometry.index;
    for(let i=0;i<(index?.count??positions.count);i+=3){
      const a=ids[index?index.getX(i):i],b=ids[index?index.getX(i+1):i+1],c=ids[index?index.getX(i+2):i+2];
      join(a,b);join(b,c);
    }
  }));
  const hulls=new Map();
  points.forEach((point,i)=>{const id=find(i);if(!hulls.has(id))hulls.set(id,new Box3());hulls.get(id).expandByPoint(point);});
  assert.equal(hulls.size,20);
  const ray=new Raycaster();
  for(const box of hulls.values()){
    for(const x of [box.min.x,(box.min.x+box.max.x)/2,box.max.x])for(const z of [box.min.z,(box.min.z+box.max.z)/2,box.max.z]){
      ray.set(new Vector3(x,catalog.bounds.height+1,z),new Vector3(0,-1,0));
      const ground=ray.intersectObject(terrain,true)[0];
      assert.ok(ground,'cabin should be above modeled terrain');
      assert.ok(box.min.y-ground.point.y>.8,'refined rock ridge intersects a gondola cabin');
    }
  }
});


test('the complete Chongli massif fits the composed overview and destination cameras', () => {
  const original=bounds.get('chongli');
  assert.ok(original.max.x-original.min.x>35 && original.max.z-original.min.z>30, 'the editable region retains broad modeled terrain');
  const world=createDisplayWorld(catalog), model=gltf.scene.clone(true);
  applyMapLayout(THREE,model,world.mapLayout);
  const box=new Box3().setFromObject(model.getObjectByName('MapRegion_chongli'));
  for(const id of ['all','chongli'])for(const aspect of [.62,1,1.9,3.2]){
    const pose=cameraPoseFor(world,id,aspect),camera=new PerspectiveCamera(35,aspect,.1,900);
    camera.position.set(...pose.position);camera.lookAt(...pose.target);camera.updateMatrixWorld();
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const p=new Vector3(x,y,z).project(camera);
      assert.ok(Math.abs(p.x)<=1 && Math.abs(p.y)<=1 && p.z>-1 && p.z<1, `${id} clips Chongli at ${aspect}: ${p.toArray()}`);
    }
  }
});

test('ski runs follow the exported mountain instead of floating above its slopes', () => {
  const terrain=gltf.scene.getObjectByName('chongli_Terrain__Mountain_Slate');
  const pistes=['Wanlong','Thaiwoo','Genting'].map(name=>gltf.scene.getObjectByName(`chongli_${name}Pistes__Chongli_PisteSnow`));
  assert.ok(terrain && pistes.every(Boolean));
  const ray=new Raycaster(),p=new Vector3();let checked=0;
  pistes.forEach(piste=>piste.traverse(object=>{
    if(!object.isMesh)return;
    const positions=object.geometry.attributes.position;
    for(let i=0;i<positions.count;i+=7){
      p.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);
      ray.set(new Vector3(p.x,catalog.bounds.height+1,p.z),new Vector3(0,-1,0));
      const hit=ray.intersectObject(terrain,true)[0];
      assert.ok(hit, 'every piste sample has mountain below it');
      const gap=p.y-hit.point.y;
      assert.ok(gap>.02 && gap<.2, `piste surface gap ${gap}`);checked++;
    }
  }));
  assert.ok(checked>250);
});


test('map composition keeps all twelve landmarks, cameras and picking aligned without changing city geometry', () => {
  const source=structuredClone(catalog),world=createDisplayWorld(source),model=gltf.scene.clone(true);
  assert.deepEqual(source,catalog,'layout must not mutate the editable-source contract');
  applyMapLayout(THREE,model,world.mapLayout);
  const mappedBounds=new Map();
  model.traverse(object=>{
    if(!object.userData.place)return;
    const id=object.userData.place,box=new Box3().setFromObject(object);
    if(!mappedBounds.has(id))mappedBounds.set(id,box);else mappedBounds.get(id).union(box);
  });
  assert.equal(mappedBounds.size,12);
  for(const place of world.places){
    const box=mappedBounds.get(place.id);
    if(place.id!=='chongli')assert.ok(box.equals(bounds.get(place.id)),`${place.id} moved`);
    for(const preset of [place,...(place.resorts||[])]){
      assert.ok(preset.target[0]>=box.min.x && preset.target[0]<=box.max.x);
      assert.ok(preset.target[2]>=box.min.z && preset.target[2]<=box.max.z);
    }
    for(const aspect of [.62,1,1.9,3.2]){
      const pose=cameraPoseFor(world,'all',aspect),camera=new PerspectiveCamera(35,aspect,.1,900);
      camera.position.set(...pose.position);camera.lookAt(...pose.target);camera.updateMatrixWorld();
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
        const p=new Vector3(x,y,z).project(camera);
        assert.ok(Math.abs(p.x)<=1 && Math.abs(p.y)<=1,`${place.id} clipped in overview at ${aspect}`);
      }
    }
  }
  const region=model.getObjectByName('MapRegion_chongli');
  const before=region.matrixWorld.clone();applyMapLayout(THREE,model,world.mapLayout);
  assert.ok(region.matrixWorld.equals(before),'retry must not apply the compression twice');
  const terrain=model.getObjectByName('chongli_Terrain__Mountain_Slate');
  const originalTerrain=gltf.scene.getObjectByName(terrain.name);
  let sample,originalSample;
  terrain.traverse(object=>{if(object.isMesh && !sample)sample=object;});
  originalTerrain.traverse(object=>{if(object.isMesh && !originalSample)originalSample=object;});
  const p=new Vector3().fromBufferAttribute(sample.geometry.attributes.position,400).applyMatrix4(originalSample.matrixWorld);
  const expected=new Vector3(...mapPoint(p.toArray(),catalog.mapLayout.regions.chongli));
  const actual=new Vector3().fromBufferAttribute(sample.geometry.attributes.position,400).applyMatrix4(sample.matrixWorld);
  assert.ok(actual.distanceTo(expected)<1e-5,'geometry and camera use the same transform');
  const ray=new Raycaster(new Vector3(actual.x,30,actual.z),new Vector3(0,-1,0));
  assert.equal(placeIdForObject(ray.intersectObject(terrain,true)[0]?.object,world),'chongli');
});

test('the Workers Stadium focus camera sees its stands and pitch without another destination in front', () => {
  const world=createDisplayWorld(catalog),model=gltf.scene.clone(true);
  applyMapLayout(THREE,model,world.mapLayout);
  const pose=cameraPoseFor(world,'workers',1.9),origin=new Vector3(...pose.position);
  const ray=new Raycaster();
  for(const [x,y,z] of [[19.7,.28,1],[21,.28,2],[22.3,.28,3],[17.8,2.12,3],[18.5,2.12,4.2],[20,2.12,5.2],[23,2.12,4.5]]){
    const point=new Vector3(x+catalog.stadiumCenter[0]-21,y,z+catalog.stadiumCenter[2]-2);ray.set(origin,point.clone().sub(origin).normalize());
    const hits=ray.intersectObject(model,true).filter(hit=>hit.distance<origin.distanceTo(point)+.3);
    const {placeFromHits}=field;
    assert.equal(placeFromHits(hits,world),'workers',`stadium surface at ${x},${z} hidden by a different landmark`);
  }
});

test('the taller office campus fits its destination camera including the roof crowns', () => {
  const world = createDisplayWorld(catalog);
  for (const id of ['xierqi', 'zhichun']) {
    const campus = new Box3();
    gltf.scene.traverse(object => {
      if (object.isMesh && object.name.startsWith(id === 'xierqi' ? 'xierqi_V13Campus__' : 'zhichun_V13Offices__')) campus.union(new Box3().setFromObject(object));
    });
    assert.ok(!campus.isEmpty());
    for (const aspect of [.62, 1, 1.9, 3.2]) {
      const pose = cameraPoseFor(world, id, aspect);
      const camera = new PerspectiveCamera(35, aspect, .1, 1000);
      camera.position.fromArray(pose.position);camera.lookAt(new Vector3(...pose.target));camera.updateMatrixWorld();
      for (const x of [campus.min.x, campus.max.x]) for (const y of [campus.min.y, campus.max.y]) for (const z of [campus.min.z, campus.max.z]) {
        const projected = new Vector3(x,y,z).project(camera);
        assert.ok(Math.abs(projected.x) < .98 && Math.abs(projected.y) < .98, `${id} office campus clipped at aspect ${aspect}: ${projected.toArray()}`);
      }
    }
  }
});

test('replaced office groves do not leave floating winter tree caps', () => {
  const retiredSites = [
    ...[-14.5,-3].flatMap(x => [10,12,14,16,18].map(y => [x-7,-y-11])),
    ...[-14.8,-4].flatMap(x => [-12,-15,-18,-20].map(y => [x+3,-y-24])),
  ];
  const snow = gltf.scene.getObjectByName('Season_Snow__Snow');
  assert.ok(snow, 'winter snow remains available');
  const p = new Vector3();let orphanVertices = 0;
  snow.traverse(object => {
    if (!object.isMesh) return;
    const vertices = object.geometry.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      p.fromBufferAttribute(vertices,i).applyMatrix4(object.matrixWorld);
      if (p.y < 1.04 || p.y > 1.45) continue;
      if (retiredSites.some(([x,z]) => Math.hypot(p.x-x,p.z-z) < .18)) orphanVertices++;
    }
  });
  assert.equal(orphanVertices,0,'removed pine groves must also remove their separate seasonal tips');
});


test('exported CBD geometry matches the geographic sites and is separate from 798', () => {
  const factory = bounds.get('798');
  for (const site of catalog.supportingLandmarks) {
    const box = new Box3();
    gltf.scene.traverse(object => {
      if (object.isMesh && object.name.startsWith(site.collection + '__')) box.union(new Box3().setFromObject(object));
    });
    assert.ok(!box.isEmpty(), `${site.id} has actual geometry`);
    const center = box.getCenter(new Vector3());
    assert.ok(Math.abs(center.x-site.position[0]) < 2 && Math.abs(center.z+site.position[1]) < 2, `${site.id} geometry is at its geographic site`);
    assert.ok(!box.intersectsBox(factory), `${site.id} must not be attached to 798`);
  }
});


test('the Water Cube is west of the Birds Nest and Universal shops remain in Tongzhou', () => {
  const cube = new Box3(), nest = new Box3();let shopVertices=0;
  gltf.scene.traverse(object => {
    if(!object.isMesh)return;
    if(object.name.startsWith('olympic_CubeDetails__'))cube.union(new Box3().setFromObject(object));
    if(object.name.startsWith('olympic_V13Nest__'))nest.union(new Box3().setFromObject(object));
    if(object.name.startsWith('universal_Hogsmeade__')) {
      const box = new Box3().setFromObject(object);
      const site = catalog.places.find(p=>p.id==='universal').position;
      assert.ok(box.min.x>site[0]-7 && box.max.x<site[0]+7, `${object.name} detached from Universal`);
      assert.ok(box.min.z>-site[1]-7 && box.max.z<-site[1]+9);
      assert.ok(box.min.y>=.05, `${object.name} must not collapse below ground`);
      shopVertices+=object.geometry.attributes.position.count;
    }
  });
  assert.ok(cube.getCenter(new Vector3()).x < nest.getCenter(new Vector3()).x-4);
  assert.ok(shopVertices>1000);
});

test('city infill supplies actual housing, connected lanes and five neighborhood parks', () => {
  const groups = new Map();
  gltf.scene.traverse(object => {
    if (!object.isMesh || !object.name.startsWith('City_V15')) return;
    const group = object.name.split('__')[0];
    if (!groups.has(group)) groups.set(group, new Box3());
    groups.get(group).union(new Box3().setFromObject(object));
    assert.equal(placeIdForObject(object, catalog), null, 'public streets do not hijack landmark selection');
  });
  const homes = groups.get('City_V15Homes');
  assert.ok(homes && homes.getSize(new Vector3()).x > 65 && homes.getSize(new Vector3()).z > 60, 'housing spans the city');
  assert.ok(groups.get('City_V15Lanes'), 'secondary streets have modeled geometry');
  for (const id of ['NorthGarden','WestCourt','LakesideWalk','EastGarden','TempleGarden']) {
    const park = groups.get('City_V15Park_' + id);
    assert.ok(park && park.getSize(new Vector3()).y > 1, `${id} includes planting and furniture`);
  }
});

test('the connecting neighborhood has grounded paving and public courtyard architecture', () => {
  const court=new Box3(), ground=new Box3();
  gltf.scene.traverse(object=>{
    if(!object.isMesh)return;
    if(object.name.startsWith('City_V16Courtyard__'))court.union(new Box3().setFromObject(object));
    if(object.name.startsWith('City_V16Ground__'))ground.union(new Box3().setFromObject(object));
  });
  assert.ok(!court.isEmpty() && court.min.x < -10 && court.max.x < -4, 'courtyard occupies the actual gap west of Beihai');
  assert.ok(court.min.y >= .15 && court.max.y < 3, 'new street frontage keeps the lake sightline open');
  assert.ok(ground.getSize(new Vector3()).x > 60 && ground.max.y < .23, 'ground stays below roads and building foundations');
  assert.ok(catalog.atmosphere?.lights.length > 50, 'lighting anchors cover real entries and lamps');
  for (const light of catalog.atmosphere.lights) {
    assert.ok(light.position.every(Number.isFinite) && light.radius.every(v=>Number.isFinite(v)&&v>0));
  }
});

test('Olympic public spaces connect the venues while keeping the lake and sports fields visible', () => {
  const plaza=[],venueSurfaces=[];
  gltf.scene.traverse(object=>{
    if(!object.isMesh)return;
    if(object.name.startsWith('olympic_V17'))plaza.push(object);
    if(object.userData.place==='olympic')venueSurfaces.push(object);
  });
  assert.ok(plaza.length>5,'Olympic grounds need exported public-space geometry');
  const ray=new Raycaster();
  for(const [x,z] of [[5.3,-14],[5.3,-16],[5.3,-19.4],[5.3,-22],[2.7,-16.8],[12.1,-23]]){
    ray.set(new Vector3(x,.7,z),new Vector3(0,-1,0));
    const hit=ray.intersectObjects(plaza,true).find(h=>/^Ground_Olympic/.test(h.object.material.name));
    assert.ok(hit,`continuous public ground required at ${x},${z}`);
    assert.ok(hit.point.y>=.14 && hit.point.y<.5,'walkways stay at pedestrian ground level');
  }
  for(const [x,z,name] of [[6,-26,'Water_Lake'],[8.2,-15.3,'Pitch_Grass'],[10,-19.4,'Pitch_Grass']]){
    ray.set(new Vector3(x,1,z),new Vector3(0,-1,0));
    const hit=ray.intersectObjects(venueSurfaces,true).find(h=>!h.object.material.transparent);
    assert.equal(hit?.object.material.name,name,`${name} must remain visible above the new paving`);
  }
});

test('the stepped Olympic garden has a clear walkable floor without the retired raised park trace', () => {
  const candidates=[];
  gltf.scene.traverse(object=>{if(object.isMesh && object.userData.place==='olympic')candidates.push(object);});
  const ray=new Raycaster(new Vector3(7,.8,-23.18),new Vector3(0,-1,0));
  const hit=ray.intersectObjects(candidates,true).find(h=>!h.object.material.transparent);
  assert.ok(hit,'garden entry has a modeled floor');
  assert.ok(hit.point.y<.20,`old raised trace obstructs the lower garden at height ${hit.point.y}`);
});

test('Olympic planting stays clear of the street and its pedestrian bridge crosses real water', () => {
  const roads=[],trunks=[],waters=[];let bridge=null;
  gltf.scene.traverse(object=>{
    if(!object.isMesh)return;
    if(object.material.name==='Road_Asphalt')roads.push(object);
    if(object.name.startsWith('olympic_V17Planting__Tree_Bark'))trunks.push(object);
    if(object.name.startsWith('olympic_V17Water__'))waters.push(object);
    if(object.name==='olympic_V17Bridge__Ground_OlympicTimber')bridge=object;
  });
  assert.ok(trunks.length && waters.length && bridge,'planted ground and modeled bridge/water are required');
  const ray=new Raycaster(),point=new Vector3();let roots=0;
  for(const mesh of trunks){
    const positions=mesh.geometry.attributes.position;
    for(let i=0;i<positions.count;i++){
      point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
      if(Math.abs(point.y-.20)>.001)continue;
      roots++;ray.set(new Vector3(point.x,.3,point.z),new Vector3(0,-1,0));
      assert.equal(ray.intersectObjects(roads,true).length,0,'new tree roots must not occupy asphalt');
    }
  }
  assert.ok(roots>60);
  const box=new Box3().setFromObject(bridge),center=box.getCenter(new Vector3());
  ray.set(new Vector3(center.x,2,center.z),new Vector3(0,-1,0));
  const water=ray.intersectObjects(waters,true)[0];
  assert.ok(water,'footbridge spans the actual canal');
  assert.ok(box.min.y-water.point.y>.06,'footbridge deck clears the water');
});

test('Workers Stadium has a continuous public concourse with open entrance paths', () => {
  const outer=[],all=[];
  gltf.scene.traverse(o=>{if(o.isMesh&&o.userData.place==='workers'){all.push(o);if(o.name.startsWith('workers_V18'))outer.push(o);}});
  assert.ok(outer.length>5,'the outer stadium needs actual exported public-space geometry');
  const ray=new Raycaster();
  for(const [x,z] of [[21.2,-.7],[16.3,4],[27.7,4],[22,8.6],[20.6,-3.2],[29,-1]]){
    ray.set(new Vector3(x,.7,z),new Vector3(0,-1,0));
    const hit=ray.intersectObjects(outer,true).find(h=>/^Ground_Workers/.test(h.object.material.name));
    assert.ok(hit,`public ground missing at ${x},${z}`);
    assert.ok(hit.point.y>.14&&hit.point.y<.4,'outer paths must meet the existing ground');
  }
  ray.set(new Vector3(22.8,1,4.2),new Vector3(0,-1,0));
  const turf=ray.intersectObjects(all,true).find(h=>!h.object.material.transparent);
  assert.match(turf?.object.material.name??'',/^Pitch_/,'the playing field must remain visible');
});

test('Workers Stadium places its welcome sculpture north and its small lake south of the pitch', () => {
  let sculpture=null,water=null;
  gltf.scene.traverse(o=>{if(!o.isMesh)return;
    if(o.name==='workers_V18Welcome__Workers_Bronze')sculpture=o;
    if(o.material.name==='Water_WorkersLake')water=o;
  });
  assert.ok(sculpture&&water,'north welcome sculpture and south lake must be modeled');
  const a=new Box3().setFromObject(sculpture),b=new Box3().setFromObject(water);
  assert.ok(a.max.z<0&&a.max.y<1.7,'north entry stays low enough to retain stadium sightlines');
  assert.ok(b.min.z>8.4&&b.max.z<10,'lake fits south of stadium, before the existing road');
  const ray=new Raycaster(new Vector3(b.getCenter(new Vector3()).x,.7,b.getCenter(new Vector3()).z),new Vector3(0,-1,0));
  assert.ok(ray.intersectObject(water,true).length,'lake has a visible upward-facing water surface');
});

test('Workers Stadium trees, visitors and shop foundations stay off the asphalt and out of the pitch', () => {
  const roads=[],pieces=[];const ray=new Raycaster(),p=new Vector3();let checked=0;
  gltf.scene.traverse(o=>{if(!o.isMesh)return;
    if(o.material.name==='Road_Asphalt')roads.push(o);
    if(/^workers_V18(Planting|Visitors|Shops)__/.test(o.name))pieces.push(o);
  });
  assert.ok(pieces.length>3,'new public-space details must exist');
  for(const o of pieces){const pos=o.geometry.attributes.position;
    for(let i=0;i<pos.count;i++){
      p.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);
      if(p.y>.255||p.y<.15)continue;checked++;
      ray.set(new Vector3(p.x,.28,p.z),new Vector3(0,-1,0));
      assert.equal(ray.intersectObjects(roads,true).length,0,`outer detail on asphalt at ${p.toArray()}`);
      assert.ok(((p.x-22)/5.05)**2+((p.z-4)/3.97)**2>1,'new details cannot enter stadium');
    }
  }
  assert.ok(checked>100,'check actual exported ground-level vertices');
});

test('Beihai east shore connects the waterfront, garden and city without filling the lake', () => {
  const ground=[],all=[];
  gltf.scene.traverse(o=>{if(!o.isMesh)return;if(o.userData.place==='beihai')all.push(o);
    if(o.name.startsWith('beihai_V19')&&/^Ground_Beihai/.test(o.material.name))ground.push(o);
  });
  assert.ok(ground.length>2,'east-bank public ground must be exported');
  const ray=new Raycaster();
  for(const [x,z] of [[8.6,7],[8.2,10],[7.2,2.4],[9.7,-.3],[11.7,4.5]]){
    ray.set(new Vector3(x,.7,z),new Vector3(0,-1,0));
    const hits=ray.intersectObjects(ground,true);
    assert.ok(hits.length,`shore/garden ground missing at ${x},${z}`);
    assert.ok(hits[0].point.y<.4,'public floors remain at shore height');
  }
  ray.set(new Vector3(6,1,8),new Vector3(0,-1,0));
  const lake=ray.intersectObjects(all,true).find(h=>!h.object.material.transparent);
  assert.equal(lake?.object.material.name,'Water_Beihai','existing open water must not be covered by new shore paving');
});

test('Beihai east-bank architecture stays low and planting remains off the road', () => {
  const garden=new Box3(),roads=[],trees=[];
  gltf.scene.traverse(o=>{if(!o.isMesh)return;
    if(o.name.startsWith('beihai_V19Court__'))garden.union(new Box3().setFromObject(o));
    if(o.material.name==='Road_Asphalt')roads.push(o);
    if(o.name.startsWith('beihai_V19Planting__Tree_Bark'))trees.push(o);
  });
  assert.ok(!garden.isEmpty()&&garden.min.x>7.9,'garden belongs to the eastern bank');
  assert.ok(garden.max.y<2,'garden roof stays well below the white pagoda');
  assert.ok(trees.length,'new bank trees must be modeled');
  const ray=new Raycaster(),p=new Vector3();let n=0;
  for(const o of trees){const a=o.geometry.attributes.position;
    for(let i=0;i<a.count;i++){p.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);
      if(Math.abs(p.y-.2)>.001)continue;n++;
      ray.set(new Vector3(p.x,.3,p.z),new Vector3(0,-1,0));
      assert.equal(ray.intersectObjects(roads,true).length,0,`new tree occupies road at ${p.toArray()}`);
    }
  }
  assert.ok(n>30);
});

test('Beihai reflection anchors correspond to actual shoreline lamps', () => {
  const anchors=catalog.beihaiShore?.reflectionLights;
  assert.ok(anchors?.length>=17&&anchors.length<=24,'reflection lights must come from the physical shore lamps');
  const lamps=[];
  gltf.scene.traverse(o=>{if(o.isMesh&&o.userData.place==='beihai'&&o.material.name==='City_Windows')lamps.push(o);});
  const p=new Vector3();
  for(const anchor of anchors){
    let distance=Infinity;
    for(const o of lamps){const a=o.geometry.attributes.position;
      for(let i=0;i<a.count;i++){p.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);distance=Math.min(distance,Math.hypot(p.x-anchor.position[0],p.z-anchor.position[1]));}
    }
    assert.ok(distance<.16,`reflection source has no lamp at ${anchor.position}`);
  }
});
