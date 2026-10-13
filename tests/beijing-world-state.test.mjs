import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDisplayWorld } from '../map-layout.mjs';
import * as field from '../state.mjs';
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from '../vendor/three.module.min.js';

const world = createDisplayWorld(JSON.parse(await readFile(new URL('../places.json', import.meta.url), 'utf8')));
const ids = ['xierqi', 'beihai', 'workers', '798', 'zhongguancun', 'olympic', 'chongli', 'universal', 'happy-valley', 'zhichun', 'xiangshan', 'sanfeng'];
const reduce = (state, action) => field.reduceFieldState(state, action, world);
const readyState = () => reduce(field.createFieldState(), { type: 'ready', loadId: 1 });

test('the full-map contract has all 12 original places and finite camera/anchor vectors', () => {
  assert.equal(typeof field.validateWorld, 'function');
  assert.equal(field.validateWorld(world), world);
  assert.deepEqual(world.places.map((place) => place.id), ids);
  for (const place of world.places) {
    for (const key of ['target', 'anchor', 'offset']) assert.ok(place[key].length === 3 && place[key].every(Number.isFinite));
  }
});

test('invalid contracts fail before camera math or navigation is constructed', () => {
  assert.equal(typeof field.validateWorld, 'function');
  const duplicate = structuredClone(world); duplicate.places[1].id = duplicate.places[0].id;
  assert.throws(() => field.validateWorld(duplicate), /unique/i);
  const malformed = structuredClone(world); malformed.places[0].offset[2] = null;
  assert.throws(() => field.validateWorld(malformed), /offset/i);
  const missing = structuredClone(world); missing.places.pop();
  assert.throws(() => field.validateWorld(missing), /12/);
  const badFrame = structuredClone(world); badFrame.overview.frame.center = [0, NaN, 0];
  assert.throws(() => field.validateWorld(badFrame), /framing center/);
});

test('every contract place can be focused and unknown ids cannot change the scene', () => {
  let state = readyState();
  for (const id of ids) { state = reduce(state, { type: 'focus', place: id }); assert.equal(state.focus, id); }
  for (const id of ['stadium', 'unknown', '', '__proto__']) assert.equal(reduce(state, { type: 'focus', place: id }), state);
  state = reduce(state, { type: 'focus', place: 'all' });
  assert.equal(state.focus, 'all');
});

test('switching location preserves winter, lights and pause; restore preserves motion preference', () => {
  let state = field.createFieldState({ reducedMotion: true });
  for (const type of ['winter', 'lights', 'pause']) state = reduce(state, { type });
  state = reduce(state, { type: 'focus', place: 'workers' });
  assert.equal(state.winter, true); assert.equal(state.lights, true); assert.equal(state.paused, true);
  state = reduce(state, { type: 'restore' });
  assert.equal(state.focus, 'all'); assert.equal(state.winter, false); assert.equal(state.lights, false);
  assert.equal(state.paused, true); assert.equal(state.reducedMotion, true);
  assert.equal(field.transitionDuration(state, 900), 0);
});

test('every camera comes from the contract and portrait framing increases overview distance', () => {
  assert.equal(typeof field.cameraPoseFor, 'function');
  for (const place of world.places) {
    const pose = field.cameraPoseFor(world, place.id, 1.6);
    assert.deepEqual(pose.target, place.target);
    if (!place.frame) assert.deepEqual(pose.position, place.target.map((value, index) => value + place.offset[index]));
    else assert.ok(Math.hypot(...pose.position.map((v,i)=>v-place.target[i])) >= Math.hypot(...place.offset));
  }
  const desktop = field.cameraPoseFor(world, 'all', 1.8), portrait = field.cameraPoseFor(world, 'all', .68);
  assert.deepEqual(desktop.target, world.overview.target);
  const distance = (pose) => Math.hypot(...pose.position.map((value, index) => value - pose.target[index]));
  assert.ok(distance(portrait) > distance(desktop) * 1.5);
  assert.ok(distance(portrait) < Math.hypot(world.bounds.width, world.bounds.depth) * 4);
  assert.equal(field.cameraPoseFor(world, 'missing', 1.6), null);
});

test('only places with a supplied card are called card previews; other places show factual descriptions', () => {
  for (const place of world.places) {
    const state = reduce(readyState(), { type: 'focus', place: place.id });
    const preview = field.locationCardForState(state, world);
    assert.equal(preview.place, place.id);
    assert.deepEqual(preview.anchor, place.anchor);
    assert.equal(preview.name, place.card?.name || place.name);
    assert.equal(preview.line, place.card?.line || place.description);
    assert.equal(preview.label, place.card ? '地点卡预览' : '地点信息');
  }
  assert.equal(field.locationCardForState(readyState(), world), null);
  assert.equal(field.locationCardForState(reduce(field.createFieldState(), { type: 'focus', place: 'beihai' }), world), null);
});

test('night composition keeps the landmark frame and all twelve destinations inside wide and portrait cameras', () => {
  assert.equal(typeof field.cameraPoseFor, 'function');
  for (const aspect of [.62, 1, 1.9, 3.2]) {
    const pose = field.cameraPoseFor(world, 'all', aspect);
    const camera = new PerspectiveCamera(35, aspect, .1, 700);
    camera.position.set(...pose.position); camera.lookAt(...pose.target); camera.updateMatrixWorld();
    const frame = world.overview.frame || world.bounds;
    for (const x of [-frame.width/2, frame.width/2]) for (const y of [-1.5, frame.height]) for (const z of [-frame.depth/2, frame.depth/2]) {
      const projected = new Vector3(x, y, z).add(new Vector3(...(frame.center || [0,0,0]))).project(camera);
      assert.ok(Math.abs(projected.x) <= .96 && Math.abs(projected.y) <= .96, `composition clipped at aspect ${aspect}`);
    }
    for (const place of world.places) {
      for (const point of [place.target,place.anchor]) {
        const p=new Vector3(...point).project(camera);
        assert.ok(Math.abs(p.x)<1 && Math.abs(p.y)<1 && p.z>-1 && p.z<1,`${place.id} clipped at aspect ${aspect}`);
      }
    }
  }
});

test('cards stay clear of selected landmark bounds or dock outside a small stage', () => {
  const landmark = { left: 320, top: 140, right: 640, bottom: 390 };
  const card = { width: 150, height: 140 };
  const position = field.placeCardLayout({ x: 480, y: 250 }, { width: 960, height: 520 }, card, landmark);
  assert.equal(position.docked, false);
  assert.ok(position.x + card.width <= landmark.left || position.x >= landmark.right || position.y + card.height <= landmark.top || position.y >= landmark.bottom);
  const mobile = field.placeCardLayout({ x: 146, y: 170 }, { width: 292, height: 310 }, { width: 118, height: 130 }, { left: 55, top: 80, right: 240, bottom: 275 });
  assert.equal(mobile.docked, true);
});

test('a drag, long press, secondary button or multitouch cannot select a landmark', () => {
  assert.equal(typeof field.isSceneTap, 'function');
  const start = { x: 100, y: 100, time: 0, button: 0 };
  assert.equal(field.isSceneTap(start, { x: 103, y: 102, time: 180 }, { moved: 4 }), true);
  assert.equal(field.isSceneTap(start, { x: 100, y: 100, time: 200 }, { moved: 50 }), false);
  assert.equal(field.isSceneTap(start, { x: 112, y: 100, time: 150 }), false);
  assert.equal(field.isSceneTap(start, { x: 100, y: 100, time: 800 }), false);
  assert.equal(field.isSceneTap(start, { x: 100, y: 100, time: 100 }, { multiTouch: true }), false);
  assert.equal(field.isSceneTap({ ...start, button: 2 }, { x: 100, y: 100, time: 100 }), false);
});

test('seasonal snow and permanent Alpine ice remain distinct', () => {
  assert.equal(typeof field.materialKind, 'function');
  assert.equal(field.materialKind('Snow'), 'snow');
  assert.equal(field.materialKind('Snow.001'), 'snow');
  assert.equal(field.materialKind('Alpine_Ice'), 'base');
  assert.equal(field.materialKind('Foliage_Pine'), 'foliage');
  assert.equal(field.materialKind('Water_Lake'), 'water');
  assert.equal(field.materialKind('StadiumLamp'), 'lamp');
});

function hitMesh({ place, name = '', material = 'Stone_Ivory' } = {}) {
  const mesh = new Mesh(undefined, new MeshBasicMaterial());
  mesh.name = name;
  mesh.material.name = material;
  if (place) mesh.userData.place = place;
  return mesh;
}

test('the nearest visible building or base blocks selection of landmarks behind it', () => {
  const rear = hitMesh({ place: 'xierqi' });
  for (const name of ['City_Connections__Office_Glass', 'City_Connections__Stone_Ivory', 'World_Base']) {
    assert.equal(field.placeFromHits([{ object: hitMesh({ name }) }, { object: rear }], world), null);
  }
  assert.equal(field.placeFromHits([{ object: rear }, { object: hitMesh({ place: '798' }) }], world), 'xierqi');
  assert.equal(field.placeFromHits([], world), null);
});

test('selection resolves a valid place on the nearest mesh or its containing group', () => {
  const mountain = new Group(); mountain.userData.place = 'chongli';
  const ice = hitMesh({ material: 'Alpine_Ice' }); mountain.add(ice);
  assert.equal(field.placeIdForObject(ice, world), 'chongli');
  assert.equal(field.placeFromHits([{ object: ice }, { object: hitMesh({ place: 'beihai' }) }], world), 'chongli');
  const unknown = hitMesh({ place: 'unknown' });
  assert.equal(field.placeFromHits([{ object: unknown }, { object: ice }], world), null);
});

test('invisible meshes, ancestors and materials do not intercept scene selection', () => {
  const hidden = hitMesh(); hidden.visible = false;
  const hiddenGroup = new Group(); hiddenGroup.visible = false;
  const child = hitMesh(); hiddenGroup.add(child);
  const hiddenMaterial = hitMesh(); hiddenMaterial.material.visible = false;
  const transparent = hitMesh(); transparent.material.transparent = true; transparent.material.opacity = 0;
  const landmark = hitMesh({ place: 'beihai' });
  assert.equal(field.placeFromHits([hidden, child, hiddenMaterial, transparent, landmark].map((object) => ({ object })), world), 'beihai');
});

test('visible seasonal snow is decorative, while permanent Alpine ice remains selectable', () => {
  const snow = hitMesh({ name: 'Season_Snow__Snow', material: 'Snow' });
  const renamedSnowMaterial = hitMesh();
  const seasonalLayer = new Group(); seasonalLayer.name = 'Season_Snow'; seasonalLayer.add(renamedSnowMaterial);
  const roof = hitMesh({ place: 'workers' });
  assert.equal(field.placeFromHits([{ object: snow }, { object: renamedSnowMaterial }, { object: roof }], world), 'workers');
  const ice = hitMesh({ place: 'chongli', material: 'Alpine_Ice' });
  assert.equal(field.placeFromHits([{ object: snow }, { object: ice }, { object: roof }], world), 'chongli');
});

test('soft road lighting and contact shadows cannot intercept a landmark click', () => {
  const light = hitMesh({ material: 'Road_LampWash' });
  const shadow = hitMesh({ material: 'Road_ContactShadow' });
  const landmark = hitMesh({ place: 'beihai' });
  assert.equal(field.placeFromHits([light, shadow, landmark].map(object => ({ object })), world), 'beihai');
  const asphalt = hitMesh({ material: 'Road_Asphalt' });
  assert.equal(field.placeFromHits([light, asphalt, landmark].map(object => ({ object })), world), null);
});

test('multi-material hits use the hit face material without skipping an opaque face', () => {
  const cover = hitMesh();
  const snow = new MeshBasicMaterial(); snow.name = 'Snow.001';
  cover.material = [cover.material, snow];
  const rear = { object: hitMesh({ place: '798' }) };
  assert.equal(field.placeFromHits([{ object: cover, face: { materialIndex: 1 } }, rear], world), '798');
  assert.equal(field.placeFromHits([{ object: cover, face: { materialIndex: 0 } }, rear], world), null);
});

test('failure and retry reject late results from old loads and retain existing WebGL fallback', () => {
  let state = reduce(field.createFieldState(), { type: 'failed', loadId: 1, reason: 'webgl' });
  assert.equal(reduce(state, { type: 'ready', loadId: 1 }), state);
  state = reduce(state, { type: 'retry' });
  assert.equal(state.loadId, 2); assert.equal(state.status, 'loading');
  assert.equal(reduce(state, { type: 'failed', loadId: 1, reason: 'model' }), state);
  assert.equal(reduce(state, { type: 'progress', loadId: 1, progress: 85 }), state);
});

test('the watchdog reveals a retryable fallback even if an import never settles', async () => {
  let state = field.createFieldState();
  const controller = new AbortController();
  const stop = field.createLoadWatchdog({ loadId: 1, getState: () => state, controller, timeoutMs: 5, onTimeout: () => { state = reduce(state, { type: 'failed', loadId: 1, reason: 'model' }); } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  stop();
  assert.equal(state.status, 'fallback'); assert.equal(controller.signal.aborted, true);
});


test('Chongli resort views preserve effects and reset when leaving the region', () => {
  let state=readyState();
  state=reduce(state,{type:'focus',place:'chongli'});
  for(const type of ['winter','lights','pause'])state=reduce(state,{type});
  const resorts=world.places.find(p=>p.id==='chongli').resorts;
  assert.deepEqual(resorts.map(p=>p.id),['wanlong','thaiwoo','genting']);
  for(const resort of resorts){
    state=reduce(state,{type:'resort',resort:resort.id});
    assert.equal(state.resort,resort.id);assert.equal(state.focus,'chongli');
    assert.ok(state.winter && state.lights && state.paused);
    const card=field.locationCardForState(state,world);
    assert.equal(card.name,resort.name);assert.deepEqual(card.anchor,resort.anchor);
    for(const aspect of [.62,1,1.9,3.2]){
      const pose=field.cameraPoseFor(world,'chongli',aspect,resort.id);
      const camera=new PerspectiveCamera(35,aspect,.1,900);
      camera.position.set(...pose.position);camera.lookAt(...pose.target);camera.updateMatrixWorld();
      const frame=resort.frame;
      for(const x of [-frame.width/2,frame.width/2])for(const y of [-1.5,frame.height])for(const z of [-frame.depth/2,frame.depth/2]){
        const p=new Vector3(x,y,z).add(new Vector3(...frame.center)).project(camera);
        assert.ok(Math.abs(p.x)<.96 && Math.abs(p.y)<.96,`${resort.id} clipped at ${aspect}`);
      }
    }
  }
  assert.equal(reduce(state,{type:'resort',resort:'unknown'}),state);
  state=reduce(state,{type:'resort',resort:null});assert.equal(state.resort,null);
  state=reduce(state,{type:'resort',resort:'thaiwoo'});
  state=reduce(state,{type:'focus',place:'beihai'});assert.equal(state.resort,null);
  assert.equal(reduce(state,{type:'resort',resort:'thaiwoo'}),state);
  assert.equal(field.cameraPoseFor(world,'chongli',1.6,'unknown'),null);
});

test('invalid resort camera contracts fail validation', () => {
  for(const corrupt of [r=>{r[1].id=r[0].id;},r=>{r[0].frame.center[0]=NaN;},r=>{r[2].offset=[0,0,0];}]){
    const data=structuredClone(world);corrupt(data.places.find(p=>p.id==='chongli').resorts);
    assert.throws(()=>field.validateWorld(data),/resort/i);
  }
});
