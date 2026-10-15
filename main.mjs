import { createCityLighting, applyCityLighting } from './city-lighting.mjs?v=panorama25';
let cityLighting = null;
import { createFieldState, reduceFieldState, transitionDuration, lampLevel, createLoadWatchdog, locationCardForState, placeCardLayout, validateWorld, cameraPoseFor, isSceneTap, materialKind, placeIdForObject, placeFromHits } from './state.mjs?v=panorama25';
import { createNightScenery, createNightPostEffect } from './night-scene.mjs?v=panorama25';
import { createDisplayWorld, applyMapLayout } from './map-layout.mjs?v=panorama25';
import { beihaiReflectionAnchors } from './beihai-reflections.mjs?v=panorama25';
import { applyCitySurface } from './city-surfaces.mjs?v=panorama25';
import { visualRole, viewDetail, applyViewHierarchy } from './view-hierarchy.mjs?v=panorama25';
import { BEIHAI_VIEWS, guidedCameraPose, viewPolicy, applyVisitFocus } from './guided-view.mjs?v=panorama25';
import { fitOverview, restoreMapView, collectOverviewPoints } from './overview-view.mjs?v=panorama25';
let freeView = false, beihaiShot = 'island';
let overviewPoints = [], overviewMemory = null, viewportFitDistance = 0, viewportFitPose = null, overviewCache = null;
const visitFocus = { value: 0 };
const mapViewDetail = { value: 0 };
let contourMaterials = [];

const $ = (selector) => document.querySelector(selector);
const stage = $('#stage');
const host = $('#canvas-host');
const media = window.matchMedia('(prefers-reduced-motion: reduce)');
let state = createFieldState({ reducedMotion: media.matches });
let world = null;
let lampPositions = [];
let THREE, OrbitControls, GLTFLoader;
let renderer, scene, camera, controls, model, resizeObserver;
let nightEffect, nightScenery;
let requestId = 0, lastTime = 0, loadController, cancelLoadWatchdog;
let cameraTween = null, seasonTween = null, lightTween = null;
let seasonAmount = 0, lightAmount = 0, lightLevels = [];
let materials = [], snowMeshes = [], cones = [], snow, stadiumFill;
let snowPositions, snowSeeds, snowPhase = 0;
let locationCardKey = null, locationCardAnimation = null, locationDocked = false;
let raycaster, modelMeshes = [], placeBounds = new Map();
let pointerStart = null, pointerMoved = 0, gestureMultiTouch = false;
const activePointers = new Set();
let dragMode = 'rotate', hoverTimer = 0, hoverPoint = null;

function setDragMode(mode) {
  dragMode = mode;
  stage.dataset.dragMode = mode;
  for (const button of document.querySelectorAll('button[data-drag-mode]')) button.setAttribute('aria-pressed', String(button.dataset.dragMode === mode));
  if (controls) {
    controls.mouseButtons.LEFT = mode === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.touches.ONE = mode === 'pan' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  }
  $('#gesture-hint .desktop-gesture').textContent = mode === 'pan' ? '拖动平移 · 滚轮靠近指针 · 点击地标' : '拖动旋转 · 右键平移 · 滚轮靠近指针';
  $('#touch-drag-hint').textContent = `单指${mode === 'pan' ? '平移' : '旋转'}`;
  if (freeView) $('#visit-status').textContent = mode === 'pan' ? '拖动平移 · 点击地标' : '拖动旋转 · 右键平移';
  clearHover();
}

function configureView() {
  if (!controls) return;
  const policy = viewPolicy(state.focus, freeView);
  controls.enableRotate = policy.rotate;
  controls.enablePan = policy.pan;
  controls.zoomToCursor = policy.cursorZoom;
  setDragMode(freeView ? dragMode : 'pan');
  renderer.domElement.setAttribute('aria-label', freeView ? '北京立体地图。拖动旋转，右键平移，滚轮或双指缩放。' : '北京导览地图。全景可拖动平移和缩放，点击地标走近。北海可从下方选择湖岛、白塔或东岸。Home 返回全景。');
  const fit = cameraPose('all');
  controls.minDistance = 5;
  controls.maxDistance = fit.position.distanceTo(fit.target) * 1.3;
  if (!freeView && state.focus === 'beihai') {
    const pose = cameraPose('beihai'), distance = pose.position.distanceTo(pose.target);
    controls.minDistance = cameraTween ? Math.min(distance * .78, camera.position.distanceTo(controls.target)) : distance * .78;
    // During a flight the overview must not be clamped into the destination.
    controls.maxDistance = cameraTween ? Math.max(controls.maxDistance, camera.position.distanceTo(controls.target)) : distance * 1.2;
  }
}

function syncVisitUI() {
  const ready = state.status === 'ready', beihai = state.focus === 'beihai';
  const shot = BEIHAI_VIEWS.find(view => view.id === beihaiShot);
  stage.dataset.viewMode = freeView ? 'free' : 'guided';
  stage.dataset.shot = beihai ? beihaiShot : '';
  $('.spell-card').dataset.viewMode = stage.dataset.viewMode;
  $('#free-view-controls').hidden = !freeView;
  $('#view-mode').textContent = freeView ? '返回导览' : '自由看';
  $('#view-mode').setAttribute('aria-pressed', String(freeView));
  $('#visit-back').hidden = state.focus === 'all';
  $('#visit-status').hidden = state.focus !== 'all';
  $('#visit-status').textContent = freeView ? (dragMode === 'pan' ? '拖动平移 · 点击地标' : '拖动旋转 · 右键平移') : '拖动平移 · 点选地标';
  $('#start-beihai').hidden = state.focus !== 'all';
  $('#beihai-views').hidden = !beihai || freeView;
  for (const button of document.querySelectorAll('button[data-shot]')) button.setAttribute('aria-pressed', String(button.dataset.shot === beihaiShot));
  for (const button of document.querySelectorAll('.visit-toolbar button, .visit-entry, .beihai-views button')) button.disabled = !ready;
  if (beihai && !freeView) {
    $('#caption-title').textContent = `北海 · ${shot.name}`;
    $('#caption-detail').textContent = shot.detail;
  }
}

function buildNavigation() {
  const list = $('#place-list'), select = $('#place-select');
  list.replaceChildren();
  select.replaceChildren(new Option('北京全景', 'all'));
  const groups = new Map();
  for (const place of world.places) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.focus = place.id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `${place.number} ${place.name}，${place.group}`);
    const number = document.createElement('span'); number.className = 'place-number'; number.textContent = place.number;
    const name = document.createElement('span'); name.textContent = place.name;
    button.append(number, name); list.append(button);
    if (!groups.has(place.group)) { const group = document.createElement('optgroup'); group.label = place.group; groups.set(place.group, group); select.append(group); }
    groups.get(place.group).append(new Option(`${place.number} ${place.name}`, place.id));
  }
  $('#field-title').textContent = world.title;
  const resorts = world.places.find((place) => place.id === 'chongli')?.resorts || [];
  const resortNav = $('#resort-navigation');
  resortNav.replaceChildren();
  for (const resort of [{ id: '', name: '崇礼群山' }, ...resorts]) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.resort = resort.id; button.textContent = resort.name;
    button.setAttribute('aria-pressed', String(!resort.id)); resortNav.append(button);
  }
  syncUI();
}

function announce(message) { $('#status').textContent = message; }

function syncUI() {
  stage.dataset.ready = String(state.status === 'ready');
  stage.dataset.fallback = String(state.status === 'fallback');
  stage.dataset.season = state.winter ? 'winter' : 'night';
  stage.dataset.lights = String(state.lights);
  stage.dataset.paused = String(state.paused);
  stage.dataset.focus = state.focus;
  stage.dataset.resort = state.resort || '';
  stage.dataset.reducedMotion = String(state.reducedMotion);
  $('#load-panel').hidden = state.status === 'ready';
  $('#retry').hidden = state.status !== 'fallback';
  $('#load-progress').hidden = state.status !== 'loading';
  if (state.progress > 0) $('#load-progress').value = state.progress;
  else $('#load-progress').removeAttribute('value');
  if (state.status === 'loading') {
    $('#load-title').textContent = '北京，正在入夜';
    $('#load-detail').textContent = state.progress ? `正在展开十二个坐标 · ${Math.floor(state.progress)}%` : '正在展开十二个坐标…';
  } else if (state.status === 'fallback') {
    $('#load-title').textContent = '先看一眼北京夜景';
    $('#load-detail').textContent = state.reason === 'webgl'
      ? '此设备暂时无法显示立体场景，已为你保留场景预览。'
      : '立体场景暂时没有载入，已为你保留场景预览。';
  }
  for (const button of document.querySelectorAll('button[data-focus]')) button.setAttribute('aria-pressed', String(button.dataset.focus === state.focus));
  $('#winter').setAttribute('aria-pressed', String(state.winter));
  $('#lights').setAttribute('aria-pressed', String(state.lights));
  $('#pause').setAttribute('aria-pressed', String(state.paused));
  $('#pause').textContent = state.paused ? '继续动效' : '暂停动效';
  $('#reduce-motion').setAttribute('aria-pressed', String(state.reducedMotion));
  $('#winter span:last-child').textContent = state.winter ? '回到秋夜' : '冬日降临';
  $('#lights span:last-child').textContent = state.lights ? '熄灭灯光' : '点亮工体';
  for (const button of document.querySelectorAll('.place-navigation button, .field-actions button, .camera-controls button, .navigation-tools button')) button.disabled = state.status !== 'ready';
  $('#place-select').disabled = state.status !== 'ready';
  $('#place-select').value = state.focus;
  const place = world?.places.find((item) => item.id === state.focus);
  const resort = place?.resorts?.find((item) => item.id === state.resort);
  $('#resort-navigation').hidden = state.status !== 'ready' || !place?.resorts;
  for (const button of document.querySelectorAll('button[data-resort]')) button.setAttribute('aria-pressed', String(button.dataset.resort === (state.resort || '')));
  $('#caption-title').textContent = resort ? `崇礼 · ${resort.name} · ${resort.subtitle}` : place ? `${place.number} ${place.name} · ${place.subtitle}` : '北京，灯火铺展开来';
  $('#caption-detail').textContent = resort?.description || place?.description || '点击地标，或从下方选择一个地点。';
  $('#field-note').textContent = state.winter ? '全图换上冬装 · 崇礼雪帽四季保留' : state.lights ? '工体灯光已亮起 · 选择工体走近球场' : '遵循北京地理方位 · 距离与尺度经过压缩';
  $('#gesture-hint').hidden = state.status !== 'ready';
  $('#scene-caption').hidden = state.status !== 'ready';
  syncVisitUI();
  syncLocationCard();
}

function projectedPlaceBounds(id) {
  const box = placeBounds.get(id);
  if (!box) return null;
  const points = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const point = new THREE.Vector3(x, y, z).project(camera);
    if (point.z < -1 || point.z > 1) return null;
    points.push({ x: (point.x + 1) * stage.clientWidth / 2, y: (1 - point.y) * stage.clientHeight / 2 });
  }
  return { left: Math.min(...points.map((point) => point.x)), right: Math.max(...points.map((point) => point.x)), top: Math.min(...points.map((point) => point.y)), bottom: Math.max(...points.map((point) => point.y)) };
}

function positionLocationCard() {
  const data = locationCardForState(state, world);
  if (!data || !camera) return;
  const card = $('#location-card'), tether = $('#location-tether');
  if (!freeView) {
    card.style.visibility = 'hidden'; card.setAttribute('aria-hidden', 'true');
    tether.style.visibility = 'hidden';
    $('#location-dock').hidden = state.focus === 'beihai';
    return;
  }
  camera.updateMatrixWorld();
  const projected = new THREE.Vector3(...data.anchor).project(camera);
  const inView = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.15 && Math.abs(projected.y) < 1.15;
  const anchor = { x: (projected.x + 1) * stage.clientWidth / 2, y: (1 - projected.y) * stage.clientHeight / 2 };
  const position = placeCardLayout(anchor, { width: stage.clientWidth, height: stage.clientHeight }, { width: card.offsetWidth, height: card.offsetHeight }, projectedPlaceBounds(data.place));
  // Once docked, keep the information stable until a new place or width is chosen.
  const cannotFloat = position.docked || !inView;
  if (!cameraTween) locationDocked ||= cannotFloat;
  card.style.visibility = locationDocked || cannotFloat ? 'hidden' : 'visible';
  card.setAttribute('aria-hidden', String(locationDocked || cannotFloat));
  tether.style.visibility = locationDocked || cannotFloat ? 'hidden' : 'visible';
  $('#location-dock').hidden = !locationDocked;
  stage.dataset.cardDocked = String(locationDocked);
  if (locationDocked || cannotFloat) return;
  card.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
  const endX = position.x > anchor.x ? position.x : position.x + card.offsetWidth;
  const endY = Math.max(position.y + 16, Math.min(position.y + card.offsetHeight - 16, anchor.y));
  tether.style.width = `${Math.hypot(endX - anchor.x, endY - anchor.y)}px`;
  tether.style.transform = `translate(${anchor.x}px, ${anchor.y}px) rotate(${Math.atan2(endY - anchor.y, endX - anchor.x)}rad)`;
}

function syncLocationCard() {
  const data = locationCardForState(state, world);
  const card = $('#location-card'), tether = $('#location-tether');
  card.hidden = !data;
  tether.hidden = !data;
  if (!data) { locationCardAnimation?.cancel(); locationCardAnimation = null; locationCardKey = null; locationDocked = false; $('#location-dock').hidden = true; return; }
  if (locationCardKey !== (data.key || data.place)) {
    locationCardAnimation?.cancel();
    locationCardKey = data.key || data.place;
    locationDocked = false;
    card.dataset.kind = data.kind;
    card.dataset.place = data.place;
    $('#location-card-title').textContent = data.name;
    $('#location-card-type').textContent = data.type;
    $('#location-card-line').textContent = data.line;
    $('#location-card-label').textContent = `${data.number} · ${data.label}`;
    $('#dock-label').textContent = `${data.number} · ${data.label}`;
    $('#dock-title').textContent = data.name;
    $('#dock-type').textContent = data.type;
    $('#dock-line').textContent = data.line;
    card.style.visibility = 'hidden';
    tether.style.visibility = 'hidden';
    const duration = transitionDuration(state, 560);
    locationCardAnimation = duration ? $('#location-card-surface').animate([
      { opacity: 0, transform: 'translateY(24px) scale(.94)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], { duration, easing: 'cubic-bezier(.18,.7,.2,1)', fill: 'none' }) : null;
  }
  if ((state.paused || state.reducedMotion) && locationCardAnimation?.playState === 'running') locationCardAnimation.finish();
}

function dispatch(action) {
  state = reduceFieldState(state, action, world);
  syncUI();
}

function scheduleRender() {
  if (!requestId && renderer && state.status === 'ready' && !document.hidden) requestId = requestAnimationFrame(render);
}

function smooth(value) { return value * value * (3 - 2 * value); }

function cameraPose(place) {
  const aspect = stage.clientWidth / Math.max(1, stage.clientHeight), resort = place === state.focus ? state.resort : null;
  if (place === 'all' && overviewPoints.length && overviewCache?.aspect !== aspect) overviewCache = {aspect,pose:fitOverview(overviewPoints,aspect)};
  const preset = place === 'all' && overviewPoints.length ? overviewCache.pose : freeView ? cameraPoseFor(world, place, aspect, resort) : guidedCameraPose(world, place, aspect, beihaiShot, resort);
  return { target: new THREE.Vector3(...preset.target), position: new THREE.Vector3(...preset.position) };
}

function animateCamera(pose, duration, intent = 'focus') {
  clearHover();
  const focusAmount = !freeView && state.focus === 'beihai' ? 1 : 0;
  cameraTween = duration ? { from: camera.position.clone(), fromTarget: controls.target.clone(), ...pose, fromFocus: visitFocus.value, focusAmount, started: performance.now(), duration, intent, fitPose:overviewCache?.pose } : null;
  configureView();
  if (!duration) { visitFocus.value = focusAmount; camera.position.copy(pose.position); controls.target.copy(pose.target); controls.update(); }
  scheduleRender();
}

function focusScene(place, immediately = false) {
  if (!camera || !controls) return;
  locationDocked = false;
  animateCamera(cameraPose(place), immediately ? 0 : transitionDuration(state, 480));
}

function applySeason(value) {
  seasonAmount = value;
  if (cityLighting) cityLighting.season.value = value;
  for (const record of materials) {
    if (record.kind === 'water') {
      record.material.color.copy(record.color).lerp(record.winterColor, value);
      if (record.material.userData.reflectionStrength) record.material.userData.reflectionStrength.value = 1 - value * .92;
    }
    if (record.kind === 'foliage') record.material.color.copy(record.color).lerp(record.winterColor, value * .88);
    if (record.kind === 'snow') record.material.opacity = value;
  }
  for (const mesh of snowMeshes) mesh.visible = value > .002;
  if (snow) { snow.visible = value > .02; snow.material.opacity = .75 * value; }
}

function changeSeason(immediately = false) {
  const target = state.winter ? 1 : 0;
  const duration = immediately ? 0 : transitionDuration(state, 1500);
  seasonTween = duration ? { from: seasonAmount, target, elapsed: 0, duration } : null;
  if (!duration) applySeason(target);
  scheduleRender();
}

function applyLights(levels) {
  lightLevels = levels;
  lightAmount = levels.length ? levels.reduce((sum, value) => sum + value, 0) / levels.length : 0;
  for (const record of materials) {
    if (record.kind === 'lamp') {
      record.material.emissive.copy(record.emissive).lerp(new THREE.Color('#ffe6a2'), lightAmount);
      record.material.emissiveIntensity = record.emissiveIntensity + lightAmount * 2.1;
    }
  }
  cones.forEach((cone, index) => { cone.visible = levels[index] > .001; cone.material.opacity = levels[index] * .105; });
  if (stadiumFill) stadiumFill.intensity = lightAmount * 26;
}

function changeLights(immediately = false) {
  const duration = immediately ? 0 : transitionDuration(state, state.lights ? 1050 : 500);
  lightTween = duration ? { from: lightLevels.slice(), on: state.lights, elapsed: 0, duration } : null;
  if (!duration) applyLights(lampPositions.map(() => state.lights ? 1 : 0));
  scheduleRender();
}

function finishTransitions() {
  if (cameraTween) { visitFocus.value = cameraTween.focusAmount; camera.position.copy(cameraTween.position); controls.target.copy(cameraTween.target); cameraTween = null; configureView(); controls.update(); }
  changeSeason(true);
  changeLights(true);
}

function render(now) {
  requestId = 0;
  if (!renderer || document.hidden || state.status !== 'ready') return;
  const delta = lastTime ? Math.min(50, now - lastTime) : 16;
  lastTime = now;
  if (cameraTween) {
    const progress = Math.min(1, (now - cameraTween.started) / cameraTween.duration);
    visitFocus.value = cameraTween.fromFocus + (cameraTween.focusAmount - cameraTween.fromFocus) * smooth(progress);
    camera.position.lerpVectors(cameraTween.from, cameraTween.position, smooth(progress));
    controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.target, smooth(progress));
    controls.update();
    if (progress === 1) { cameraTween = null; configureView(); }
  }
  if (seasonTween) {
    seasonTween.elapsed += delta;
    const progress = Math.min(1, seasonTween.elapsed / seasonTween.duration);
    applySeason(seasonTween.from + (seasonTween.target - seasonTween.from) * smooth(progress));
    if (progress === 1) seasonTween = null;
  }
  if (lightTween) {
    lightTween.elapsed += delta;
    const progress = Math.min(1, lightTween.elapsed / lightTween.duration);
    applyLights(lightTween.from.map((value, index) => lightTween.on
      ? value + (1 - value) * lampLevel(lightTween.elapsed, index, lampPositions.length)
      : value * (1 - smooth(progress))));
    if (progress === 1) { applyLights(lampPositions.map(() => state.lights ? 1 : 0)); lightTween = null; }
  }
  const snowfall = snow && state.winter && !state.paused && !state.reducedMotion;
  if (snowfall) {
    snowPhase += delta * .001;
    const ceiling = world.bounds.height + 7;
    for (let index = 0; index < snowSeeds.length / 3; index++) {
      const offset = index * 3;
      snowPositions[offset] = snowSeeds[offset] + Math.sin(snowPhase * .4 + index) * .3;
      snowPositions[offset + 1] = ((snowSeeds[offset + 1] - snowPhase * (1.6 + (index % 7) * .1)) % ceiling + ceiling) % ceiling;
    }
    snow.geometry.attributes.position.needsUpdate = true;
  }
  // Keep the map itself clear when portrait framing pulls the camera back.
  const viewingDistance = camera.position.distanceTo(controls.target);
  updateViewHierarchy();
  scene.fog.near = viewingDistance + 26;
  scene.fog.far = viewingDistance + 165;
  nightEffect.render(scene, camera);
  positionLocationCard();
  stage.dataset.rendered = 'true';
  if (cameraTween || seasonTween || lightTween || snowfall) scheduleRender();
}

function createAtmosphere() {
  const count = window.matchMedia('(max-width: 767px)').matches ? 500 : 950;
  snowSeeds = new Float32Array(count * 3);
  let seed = 1127;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const center = world.bounds.center || [0, 0, 0];
  for (let index = 0; index < count; index++) snowSeeds.set([center[0] + (random() - .5) * (world.bounds.width + 4), random() * (world.bounds.height + 7), center[2] + (random() - .5) * (world.bounds.depth + 4)], index * 3);
  snowPositions = new Float32Array(snowSeeds);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
  const snowMaterial = new THREE.PointsMaterial({ color: '#e5f5ff', size: .1, transparent: true, opacity: .8, depthWrite: false, sizeAttenuation: true });
  snow = new THREE.Points(geometry, snowMaterial);
  snow.visible = false;
  scene.add(snow);
  stadiumFill = new THREE.PointLight('#ffdea1', 0, 14, 2);
  stadiumFill.position.set(world.stadiumCenter[0], world.stadiumCenter[1] + 5.5, world.stadiumCenter[2]);
  scene.add(stadiumFill);
  cones = lampPositions.map((position) => {
    const tip = new THREE.Vector3(...position);
    const center = world.stadiumCenter;
    const destination = new THREE.Vector3(center[0] + (position[0] < center[0] ? -1 : 1), center[1] + .16, center[2] + (position[2] < center[2] ? -.65 : .65));
    const direction = tip.clone().sub(destination);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.25, direction.length(), 16, 1, true), new THREE.MeshBasicMaterial({ color: '#ffe7a0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    cone.position.copy(tip).add(destination).multiplyScalar(.5);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    cone.visible = false;
    scene.add(cone);
    return cone;
  });
}

function styleModel(object) {
  const gradient = new THREE.DataTexture(new Uint8Array([38, 88, 163, 245]), 4, 1, THREE.RedFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  const converted = new Map();
  const outlines = [];
  object.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const role = visualRole(mesh);
    const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const result = sourceMaterials.map((source) => {
      // A shared GLB material may paint both a landmark and ordinary housing.
      // Give each role its own display material without mutating the source.
      if (converted.get(source)?.has(role)) return converted.get(source).get(role);
      const name = source.name || '';
      const kind = materialKind(name);
      const material = new THREE.MeshToonMaterial({ color: source.color, map: source.map, emissive: source.emissive, emissiveMap: source.emissiveMap, emissiveIntensity: source.emissiveIntensity ?? 1, gradientMap: gradient, side: source.side, transparent: source.transparent || kind === 'snow', opacity: kind === 'snow' ? 0 : source.opacity, alphaTest: source.alphaTest, depthWrite: kind !== 'snow' && source.depthWrite, vertexColors: source.vertexColors });
      if (/^(Roof_DeepTeal|City_GreyRoofTile|City_RoofRidge|City_V13Paving|City_V13WarmStone)$/.test(name)) material.color.multiplyScalar(1.2);
      if (name === 'Road_StoneCurb') material.color.multiplyScalar(.53);
      if (name === 'Road_Paint') material.color.multiplyScalar(.65);
      if (name === 'Road_Asphalt') material.color.multiplyScalar(1.32);
      if (name === 'Road_Sidewalk') material.color.multiplyScalar(.91);
      // Broad lit surfaces carry the landmark silhouette; small office windows
      // remain accents. This display palette leaves the licensed GLB unchanged.
      if (role === 'landmark' && /^(Ground_.*(Paving|Path|Court|Steps)|Stone_Promenade|Beihai_Stone|Universal_Paving)$/.test(name)) {
        material.color.lerp(new THREE.Color(.50,.35,.18),.42);
        material.emissive.add(new THREE.Color(.026,.013,.004));
      }
      if (name === 'Water_Beihai') {
        material.color.setRGB(.014,.21,.43);
        material.emissive.setRGB(.002,.026,.065);
      }
      if (name === 'White_Stupa' || name === 'Beihai_WhiteLime') material.emissive.add(new THREE.Color(.06,.047,.028));
      if (name === 'City_V13NestSteel') material.color.lerp(new THREE.Color(.62,.52,.36),.45);
      if (name === 'City_V13LitGlass') material.emissiveIntensity *= .55;
      if (name === 'Water_Lake' || name === 'Water_Beihai' || name === 'Water_ValleyLagoon' || name === 'Water_CityPond' || name === 'Water_OlympicCanal' || name === 'Water_WorkersLake' || name === 'Water_BeihaiGarden') {
        // Fixed etched ripples give the lake a surface at close range. They
        // have no time uniform, so pause/reduced-motion and idle rendering
        // keep their existing behavior, and winter still controls the color.
        const reflectionStrength = { value: 1 - seasonAmount * .92 };
        const beihaiSite = world.places.find(place => place.id === 'beihai').position;
        const lakeCenter = { value: new THREE.Vector2(beihaiSite[0], -beihaiSite[1]) };
        const shoreLights = beihaiReflectionAnchors(world).map(anchor => new THREE.Vector4(...anchor));
        material.userData.reflectionStrength = reflectionStrength;
        material.onBeforeCompile = (shader) => {
          shader.uniforms.reflectionStrength = reflectionStrength;
          shader.uniforms.lakeCenter = lakeCenter;
          if (name === 'Water_Beihai' && shoreLights.length) shader.uniforms.beihaiShoreLights = { value: shoreLights };
          shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vLake;').replace('#include <project_vertex>', '#include <project_vertex>\nvLake = (modelMatrix * vec4(transformed, 1.0)).xz;');
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vLake;uniform float reflectionStrength;uniform vec2 lakeCenter;').replace('#include <color_fragment>', `#include <color_fragment>
            float ripple = sin(vLake.y * 18.0 + sin(vLake.x * 2.7) * 1.7);
            float swell = sin(vLake.y * 2.4 + vLake.x * .7);
            float glint = smoothstep(.88, .995, ripple) * (.45 + .55 * sin(vLake.x * 5.0) * sin(vLake.x * 5.0));
            diffuseColor.rgb *= .74 + .12 * swell + .25 * glint;
          `);
          if (name === 'Water_Beihai' && shoreLights.length) shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\nuniform vec4 beihaiShoreLights[${shoreLights.length}];`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            float reflectedLanterns = 0.;
            for (int i = 0; i < ${shoreLights.length}; i++) {
              vec4 shore = beihaiShoreLights[i];
              vec2 inward = normalize(lakeCenter - shore.xy);
              vec2 delta = vLake - shore.xy;
              float reach = dot(delta, inward);
              float across = dot(delta, vec2(-inward.y, inward.x));
              float spread = max(.065 + max(0., reach) * .075, fwidth(across) * .8);
              float streak = exp(-pow((across + sin(reach * 17.) * .025) / spread, 2.));
              streak *= smoothstep(-.06, .08, reach) * (1. - smoothstep(.18, shore.z, reach));
              reflectedLanterns += streak * shore.w;
            }
            float rippledLight = .3 + .7 * smoothstep(-.15, .65, sin(vLake.y * 23. + sin(vLake.x * 12.)));
            totalEmissiveRadiance += vec3(.55, .24, .055) * min(1., reflectedLanterns) * rippledLight * reflectionStrength;
          `);
        };
        material.customProgramCacheKey = () => `lake-reflections-v4-${name}-${shoreLights.length}`;
      }
      material.name = name;
      applyCitySurface(material, name);
      applyCityLighting(material, name, cityLighting);
      applyViewHierarchy(material, name, role, mapViewDetail);
      applyVisitFocus(material, visitFocus);
      if (!converted.has(source)) converted.set(source, new Map());
      converted.get(source).set(role, material);
      materials.push({ material, kind, color: material.color.clone(), winterColor: new THREE.Color(kind === 'water' ? '#94bec9' : '#7ba2af'), emissive: material.emissive.clone(), emissiveIntensity: material.emissiveIntensity });
      return material;
    });
    mesh.material = Array.isArray(mesh.material) ? result : result[0];
    if (sourceMaterials.every((material) => materialKind(material.name) === 'snow')) { snowMeshes.push(mesh); mesh.visible = false; }
    const names = sourceMaterials.map((material) => material.name).join(' ');
    if (!/Water|Snow|Foliage|StadiumLamp|Ground|Terrain_BlueSlate|Road|Grass|Chongli_ForestFloor|Chongli_ExposedRidge|Ridge|Glass|Window|Light|Lamp|Sign|Paper|Trim|Rail|Pipe|Mortar|Universal_Globe|Universal_LetterSilver/i.test(names) && mesh.geometry.attributes.position.count < 180000) outlines.push({mesh,role});
  });
  const landmarkLine = new THREE.LineBasicMaterial({ color: '#020b20', transparent: true, opacity: .16, depthWrite: false });
  const cityLine = new THREE.LineBasicMaterial({ color: '#102131', transparent: true, opacity: .035, depthWrite: false });
  contourMaterials = [{material:landmarkLine,far:.16,near:.32},{material:cityLine,far:.035,near:.18}];
  for (const {mesh,role} of outlines) {
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 38), role === 'landmark' ? landmarkLine : cityLine);
    edge.name = 'InkContour';
    mesh.add(edge);
  }
  // The imported PBR materials are replaced, so release their GPU programs.
  for (const source of converted.keys()) source.dispose();
}

function updateViewHierarchy() {
  mapViewDetail.value = viewDetail(camera, controls.target);
  for (const record of contourMaterials) record.material.opacity = record.far + (record.near - record.far) * mapViewDetail.value;
}

function disposeObject(root) {
  const geometries = new Set(), ownedMaterials = new Set(), textures = new Set();
  root?.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      ownedMaterials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  ownedMaterials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

function disposeScene() {
  clearHover();
  if (requestId) cancelAnimationFrame(requestId);
  requestId = 0;
  resizeObserver?.disconnect();
  controls?.dispose();
  nightEffect?.dispose(); nightEffect = null;
  cityLighting?.texture.dispose(); cityLighting = null;
  disposeObject(scene);
  renderer?.dispose();
  host.replaceChildren();
  renderer = null; scene = null; camera = null; controls = null; model = null;
  nightScenery = null;
  materials = []; snowMeshes = []; cones = []; snow = null; stadiumFill = null;
  contourMaterials = []; mapViewDetail.value = 0;
  visitFocus.value = 0;
  overviewPoints = []; viewportFitDistance = 0; viewportFitPose = null; overviewCache = null;
  cameraTween = null; seasonTween = null; lightTween = null;
  seasonAmount = 0; lightAmount = 0; lightLevels = lampPositions.map(() => 0); lastTime = 0; snowPhase = 0;
  modelMeshes = []; placeBounds = new Map(); raycaster = null;
  pointerStart = null; activePointers.clear();
  delete stage.dataset.rendered;
}

function indexPlaces() {
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (!object.isMesh) return;
    modelMeshes.push(object);
    const id = placeIdForObject(object, world);
    if (!id) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.every((material) => materialKind(material.name) === 'snow')) return;
    const bounds = new THREE.Box3().setFromObject(object);
    if (!placeBounds.has(id)) placeBounds.set(id, bounds);
    else placeBounds.get(id).union(bounds);
  });
  nightScenery.updateMatrixWorld(true);
  nightScenery.traverse((object) => { if (object.isMesh) modelMeshes.push(object); });
  stage.dataset.placeCount = String(placeBounds.size);
}

function onPointerDown(event) {
  clearHover();
  stage.dataset.dragging = 'true';
  activePointers.add(event.pointerId);
  if (activePointers.size === 1) {
    pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), button: event.button };
    pointerMoved = 0; gestureMultiTouch = false;
  } else gestureMultiTouch = true;
}

function onPointerMove(event) {
  if (pointerStart?.id === event.pointerId) pointerMoved = Math.max(pointerMoved, Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y));
  if (event.pointerType !== 'mouse' || activePointers.size || cameraTween || state.status !== 'ready') return;
  hoverPoint = { x: event.clientX, y: event.clientY };
  // Raycast at most once per 80ms, using the latest pointer, without a render loop.
  if (!hoverTimer) hoverTimer = window.setTimeout(showHover, 80);
}

function placeAtPoint(x, y) {
  const rect = renderer.domElement.getBoundingClientRect();
  camera.updateMatrixWorld();
  raycaster.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), camera);
  return placeFromHits(raycaster.intersectObjects(modelMeshes, false), world);
}

function clearHover() {
  window.clearTimeout(hoverTimer); hoverTimer = 0; hoverPoint = null;
  $('#place-hover').hidden = true;
  delete stage.dataset.hoverPlace;
}

function showHover() {
  hoverTimer = 0;
  if (!hoverPoint || activePointers.size || cameraTween || !raycaster) return;
  const hit = placeAtPoint(hoverPoint.x, hoverPoint.y);
  const id = !freeView && state.focus === 'beihai' && hit !== 'beihai' ? null : hit;
  const place = world.places.find((item) => item.id === id);
  const label = $('#place-hover');
  label.hidden = !place;
  if (!place) { delete stage.dataset.hoverPlace; return; }
  stage.dataset.hoverPlace = id;
  label.textContent = `${place.name}${state.focus === id ? ' · 当前地点' : ' · 点击走近'}`;
  const rect = stage.getBoundingClientRect();
  label.style.left = `${Math.max(8, Math.min(stage.clientWidth - label.offsetWidth - 8, hoverPoint.x - rect.left + 14))}px`;
  label.style.top = `${Math.max(8, Math.min(stage.clientHeight - label.offsetHeight - 8, hoverPoint.y - rect.top - label.offsetHeight - 12))}px`;
}

function resetPointer(event) {
  activePointers.delete(event.pointerId);
  pointerStart = null; gestureMultiTouch = true;
  stage.dataset.dragging = String(activePointers.size > 0);
}

function onPointerUp(event) {
  activePointers.delete(event.pointerId);
  stage.dataset.dragging = String(activePointers.size > 0);
  if (!pointerStart || pointerStart.id !== event.pointerId) return;
  const tap = isSceneTap(pointerStart, { x: event.clientX, y: event.clientY, time: performance.now() }, { moved: pointerMoved, multiTouch: gestureMultiTouch });
  pointerStart = null;
  if (!tap || state.status !== 'ready' || !raycaster) return;
  const id = placeAtPoint(event.clientX, event.clientY);
  // Tapping the current model must not discard the user's angle or resort.
  if (id && id !== state.focus && (freeView || state.focus !== 'beihai')) selectPlace(id);
}

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setClearColor('#071532');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  nightEffect = createNightPostEffect(THREE, renderer);
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '北京十二地点立体场景。拖动旋转，右键或平移模式拖动地图，点击地标聚焦，双指或滚轮缩放。键盘左右键旋转，上下键缩放，Home 回全景。也可使用地点导航。');
  canvas.addEventListener('keydown', handleCanvasKeys);
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    loadController?.abort();
    cancelLoadWatchdog?.();
    disposeScene();
    dispatch({ type: 'failed', loadId: state.loadId, reason: 'webgl' });
    announce('立体显示已中断，已切换到场景预览。可以重新载入。');
  });
  host.append(canvas);
  scene = new THREE.Scene();
  const worldSpan = Math.hypot(world.bounds.width, world.bounds.depth);
  scene.fog = new THREE.Fog('#091e48', worldSpan * 1.6, worldSpan * 4.3);
  nightScenery = createNightScenery(THREE, scene);
  const horizonMaterials = new Set();
  nightScenery.traverse((object) => { if (object.material?.name === 'Foliage_Horizon') horizonMaterials.add(object.material); });
  for (const material of horizonMaterials) materials.push({material,kind:'foliage',color:material.color.clone(),winterColor:new THREE.Color('#607d94')});
  camera = new THREE.PerspectiveCamera(35, 1, .1, worldSpan * 8);
  controls = new OrbitControls(camera, canvas);
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.enableDamping = false;
  controls.minPolarAngle = .35;
  controls.maxPolarAngle = 1.25;
  controls.minDistance = 5;
  const overviewPose = cameraPose('all');
  controls.maxDistance = overviewPose.position.distanceTo(overviewPose.target) * 1.3;
  controls.rotateSpeed = .6;
  controls.zoomSpeed = .8;
  controls.addEventListener('change', scheduleRender);
  controls.addEventListener('start', () => { cameraTween = null; visitFocus.value = !freeView && state.focus === 'beihai' ? 1 : 0; configureView(); clearHover(); });
  configureView();
  raycaster = new THREE.Raycaster();
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', resetPointer);
  canvas.addEventListener('pointerleave', clearHover);
  scene.add(new THREE.HemisphereLight('#789fde', '#111b32', .82));
  const key = new THREE.DirectionalLight('#ffdda0', 1.4);
  key.position.set(-36, 60, 44);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#5687ef', 1.35);
  fill.position.set(36, 32, -40);
  scene.add(fill);
  let previousWidth = 0, previousHeight = 0;
  resizeObserver = new ResizeObserver(() => {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    const previousOverview = viewportFitPose;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    nightEffect.setSize(width, height);
    const fit = cameraPose('all');
    const fitDistance = fit.position.distanceTo(fit.target);
    controls.maxDistance = fitDistance * 1.3;
    if (Math.abs(width - previousWidth) > 1 || (!freeView && ['all','beihai'].includes(state.focus) && Math.abs(height - previousHeight) > 1)) {
      locationDocked = false;
      // Preserve the map's pan and relative zoom. Guided overview also adopts
      // the framing angle for this aspect ratio; free view keeps its azimuth.
      if (viewportFitDistance && state.status === 'ready') {
        // Finish an interrupted guided flight at its destination when resizing;
        // otherwise the overview label could remain on a half-finished close-up.
        if (cameraTween?.intent === 'map-return') {
          const tweenFit=cameraTween.fitPose;
          const tweenDistance=tweenFit?Math.hypot(...tweenFit.position.map((value,i)=>value-tweenFit.target[i])):viewportFitDistance;
          const pose = restoreMapView({position:cameraTween.position.toArray(), target:cameraTween.target.toArray(), fitDistance:tweenDistance, fitPose:tweenFit, free:freeView}, fitDistance,overviewCache?.pose);
          animateCamera({position:new THREE.Vector3(...pose.position),target:new THREE.Vector3(...pose.target)},0);
        } else if (!freeView && (state.focus === 'beihai' || cameraTween)) focusScene(state.focus, true);
        else if (!freeView && state.focus === 'all') {
          const pose=restoreMapView({position:camera.position.toArray(),target:controls.target.toArray(),fitDistance:viewportFitDistance,fitPose:previousOverview,free:false},fitDistance,overviewCache?.pose);
          animateCamera({position:new THREE.Vector3(...pose.position),target:new THREE.Vector3(...pose.target)},0);
        }
        else {
          cameraTween = null;
          const offset = camera.position.clone().sub(controls.target).multiplyScalar(fitDistance / viewportFitDistance).clampLength(controls.minDistance, controls.maxDistance);
          camera.position.copy(controls.target).add(offset); controls.update();
        }
      }
      previousWidth = width;
    }
    viewportFitDistance = fitDistance; viewportFitPose = overviewCache?.pose; previousHeight = height;
    configureView();
    scheduleRender();
  });
  resizeObserver.observe(host);
}

async function readModel(signal, loadId) {
  const response = await fetch('./beijing-world.glb?v=panorama25', { signal, cache: 'no-cache' });
  if (!response.ok) throw new Error(`Scene response ${response.status}`);
  const total = Number(response.headers.get('Content-Length'));
  if (!response.body || !total) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    dispatch({ type: 'progress', loadId, progress: 5 + received / total * 85 });
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

async function loadScene() {
  const loadId = state.loadId;
  loadController?.abort();
  cancelLoadWatchdog?.();
  disposeScene();
  const controller = new AbortController();
  loadController = controller;
  let phase = 'model';
  const stopWatchdog = createLoadWatchdog({
    loadId, getState: () => state, controller,
    onTimeout: () => {
      disposeScene();
      dispatch({ type: 'failed', loadId, reason: phase });
      announce('场景载入超时，已显示预览。可以重新载入。');
    },
  });
  cancelLoadWatchdog = stopWatchdog;
  try {
    if (!world) {
      const response = await fetch('./places.json?v=panorama25', { signal: controller.signal, cache: 'no-cache' });
      if (!response.ok) throw new Error(`Places response ${response.status}`);
      const contract = validateWorld(await response.json());
      if (loadId !== state.loadId || state.status !== 'loading' || controller.signal.aborted) return;
      world = validateWorld(createDisplayWorld(contract));
      lampPositions = world.lampPositions;
      lightLevels = lampPositions.map(() => 0);
      buildNavigation();
      dispatch({ type: 'progress', loadId, progress: 3 });
    }
    if (!THREE) {
      [THREE, { OrbitControls }, { GLTFLoader }] = await Promise.all([
        import('./vendor/three.module.min.js'), import('./vendor/controls/OrbitControls.js'), import('./vendor/loaders/GLTFLoader.js'),
      ]);
    }
    if (loadId !== state.loadId || state.status !== 'loading') return;
    if (controller.signal.aborted) throw new DOMException('Scene loading interrupted', 'AbortError');
    phase = 'webgl';
    initRenderer();
    phase = 'model';
    const bytes = await readModel(controller.signal, loadId);
    if (loadId !== state.loadId || state.status !== 'loading') return;
    if (controller.signal.aborted) throw new DOMException('Scene loading interrupted', 'AbortError');
    const gltf = await new GLTFLoader().parseAsync(bytes, new URL('.', location.href).href);
    if (loadId !== state.loadId || state.status !== 'loading' || controller.signal.aborted) {
      disposeObject(gltf.scene);
      if (loadId !== state.loadId || state.status !== 'loading') return;
      throw new DOMException('Scene loading interrupted', 'AbortError');
    }
    model = gltf.scene;
    applyMapLayout(THREE, model, world.mapLayout);
    overviewPoints = collectOverviewPoints(THREE, model);
    const actualOverview = cameraPose('all');
    viewportFitDistance = actualOverview.position.distanceTo(actualOverview.target);
    viewportFitPose = overviewCache.pose;
    cityLighting = createCityLighting(THREE, world.atmosphere);
    styleModel(model);
    scene.add(model);
    indexPlaces();
    createAtmosphere();
    dispatch({ type: 'ready', loadId });
    focusScene(state.focus, true);
    changeSeason(true);
    changeLights(true);
    updateViewHierarchy();
    nightEffect.render(scene, camera);
    stage.dataset.rendered = 'true';
    announce('北京十二个地点已展开。可点击地标，或使用地点导航聚焦，也可以点亮工体、切换冬景。');
    scheduleRender();
  } catch (error) {
    if (loadId !== state.loadId || state.status === 'fallback') return;
    console.warn('Beijing world could not load:', error);
    disposeScene();
    dispatch({ type: 'failed', loadId, reason: phase });
    announce(phase === 'webgl' ? '此设备暂时无法显示立体场景，已切换到预览。' : '场景载入失败，已显示预览。可以重新载入。');
  } finally { stopWatchdog(); }
}

function moveCamera(action) {
  if (!camera || state.status !== 'ready') return;
  if (!freeView && (action === 'left' || action === 'right')) return;
  const target = cameraTween?.target.clone() || controls.target.clone();
  const offset = (cameraTween?.position.clone() || camera.position.clone()).sub(target);
  if (action === 'left' || action === 'right') offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), action === 'left' ? .2 : -.2);
  else offset.multiplyScalar(action === 'in' ? .86 : 1.16).clampLength(controls.minDistance, controls.maxDistance);
  animateCamera({ target, position: target.clone().add(offset) }, transitionDuration(state, 160));
  announce(({ left: '视角已向左旋转。', right: '视角已向右旋转。', in: '已放大场景。', out: '已缩小场景。' })[action]);
  scheduleRender();
}

function handleCanvasKeys(event) {
  const actions = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'in', ArrowDown: 'out', '+': 'in', '=': 'in', '-': 'out' };
  if (actions[event.key]) { event.preventDefault(); moveCamera(actions[event.key]); }
  if (event.key === 'Home') { event.preventDefault(); selectPlace('all'); }
}

function selectPlace(id) {
  if (state.status !== 'ready' || (id !== 'all' && !world.places.some((place) => place.id === id))) return;
  if (id === state.focus && id !== 'all') { announce(freeView ? '已在当前地点。可用重置视角重新对准。' : '已在当前地点。可选择取景或进入自由看。'); return; }
  const entryHadFocus = document.activeElement === $('#start-beihai') || document.activeElement === $('#visit-back');
  if (state.focus === 'all' && id !== 'all') {
    const fit = cameraPose('all');
    overviewMemory = {position:(cameraTween?.position || camera.position).toArray(), target:(cameraTween?.target || controls.target).toArray(), fitDistance:fit.position.distanceTo(fit.target), fitPose:{position:fit.position.toArray(),target:fit.target.toArray()}, free:freeView, dragMode};
  }
  if (id === 'all') overviewMemory = null;
  freeView = false;
  if (id === 'beihai') beihaiShot = 'island';
  dispatch({ type: 'focus', place: id });
  focusScene(state.focus);
  const place = world.places.find((item) => item.id === id);
  announce(id === 'beihai' ? '已进入北海导览。可选择湖岛全貌、白塔或东岸。' : place ? `已选择${place.name}。${place.card ? `地点卡预览：${place.card.name}，${place.card.type}。` : place.description}` : '已回到北京全景。');
  if (entryHadFocus) (id === 'beihai' ? $('#beihai-views button') : $('#start-beihai')).focus({ preventScroll: true });
  const selectedButton = [...$('#place-list').querySelectorAll('button')].find((button) => button.dataset.focus === id);
  if (selectedButton) $('#place-list').scrollTo({ left: selectedButton.offsetLeft - ($('#place-list').clientWidth - selectedButton.offsetWidth) / 2, behavior: 'instant' });
}

function returnToMap() {
  if (state.status !== 'ready') return;
  if (!overviewMemory) { selectPlace('all'); return; }
  freeView = overviewMemory.free;
  dragMode = overviewMemory.dragMode;
  dispatch({type:'focus',place:'all'});
  const fit = cameraPose('all'), saved = restoreMapView(overviewMemory,fit.position.distanceTo(fit.target),{position:fit.position.toArray(),target:fit.target.toArray()});
  animateCamera({position:new THREE.Vector3(...saved.position),target:new THREE.Vector3(...saved.target)},transitionDuration(state,480),'map-return');
  $('#start-beihai').focus({preventScroll:true});
  announce('已返回刚才的地图位置。点击全景可重新查看完整北京。');
}

$('.place-navigation').addEventListener('click', (event) => {
  const button = event.target.closest('[data-focus]');
  if (button) selectPlace(button.dataset.focus);
});
$('#place-select').addEventListener('change', (event) => selectPlace(event.target.value));
$('#resort-navigation').addEventListener('click', (event) => {
  const button = event.target.closest('[data-resort]');
  if (!button || state.status !== 'ready') return;
  dispatch({ type: 'resort', resort: button.dataset.resort || null });
  focusScene(state.focus);
  announce(state.resort ? `已走近${button.textContent}。` : '已展开崇礼群山。');
});
for (const button of document.querySelectorAll('[data-camera]')) button.addEventListener('click', () => moveCamera(button.dataset.camera));
for (const button of document.querySelectorAll('button[data-drag-mode]')) button.addEventListener('click', () => { setDragMode(button.dataset.dragMode); announce(dragMode === 'pan' ? '平移模式：拖动即可移动地图。' : '旋转模式：拖动即可环绕当前视点。'); });
$('#overview').addEventListener('click', () => selectPlace('all'));
$('#visit-back').addEventListener('click', returnToMap);
$('#start-beihai').addEventListener('click', () => selectPlace('beihai'));
$('#view-mode').addEventListener('click', () => {
  freeView = !freeView;
  cameraTween = null;
  if (freeView) dragMode = 'rotate';
  syncUI(); configureView();
  if (freeView) animateCamera({ position: camera.position.clone(), target: controls.target.clone() }, transitionDuration(state, 240));
  else focusScene(state.focus);
  announce(freeView ? '自由看：拖动旋转，可在下方调整视角。' : '已回到安排好的导览视角。');
});
$('#beihai-views').addEventListener('click', event => {
  const button = event.target.closest('button[data-shot]');
  if (!button || state.status !== 'ready') return;
  beihaiShot = button.dataset.shot; syncUI(); focusScene('beihai');
  announce(`北海，${button.textContent}。`);
});
$('#recenter').addEventListener('click', () => { focusScene(state.focus); announce('已重新对准当前地点。'); });
$('#winter').addEventListener('click', () => { dispatch({ type: 'winter' }); changeSeason(); announce(state.winter ? '冬日降临，湖面结冰，全图落雪。崇礼永久雪帽继续保留。' : '已回到原来的北京夜景，崇礼永久雪帽继续保留。'); });
$('#lights').addEventListener('click', () => { dispatch({ type: 'lights' }); changeLights(); announce(state.lights ? '工体灯光正在依次亮起。' : '工体灯光已熄灭。'); });
$('#pause').addEventListener('click', () => { dispatch({ type: 'pause' }); if (state.paused) finishTransitions(); lastTime = 0; scheduleRender(); announce(state.paused ? '动效已暂停，仍可调整视角和切换场景。' : '动效已继续。'); });
$('#reduce-motion').addEventListener('click', () => { dispatch({ type: 'reduced-motion', value: !state.reducedMotion }); if (state.reducedMotion) finishTransitions(); lastTime = 0; scheduleRender(); announce(state.reducedMotion ? '已减少动态：取景与季节立即切换，雪花保持静止。' : '已恢复场景过渡动效。'); });
$('#restore').addEventListener('click', () => { freeView = false; beihaiShot = 'island'; overviewMemory = null; dispatch({ type: 'restore' }); focusScene('all'); changeSeason(); changeLights(); announce('已还原北京全景、原始季节与灯光。'); });
$('#retry').addEventListener('click', () => {
  // Failed module imports remain rejected for this document, even after the
  // local server returns. A fresh document resets that browser module cache.
  if (!THREE) { location.reload(); return; }
  dispatch({ type: 'retry' }); announce('正在重新载入北京场景。'); loadScene();
});
media.addEventListener('change', (event) => { dispatch({ type: 'reduced-motion', value: event.matches }); if (state.reducedMotion && renderer) finishTransitions(); lastTime = 0; scheduleRender(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (requestId) cancelAnimationFrame(requestId); requestId = 0; if (locationCardAnimation?.playState === 'running') locationCardAnimation.pause(); }
  else { lastTime = 0; if (locationCardAnimation?.playState === 'paused') { if (state.paused || state.reducedMotion) locationCardAnimation.finish(); else locationCardAnimation.play(); } scheduleRender(); }
});
window.addEventListener('pagehide', (event) => { if (!event.persisted) { loadController?.abort(); cancelLoadWatchdog?.(); disposeScene(); } });
syncUI();
loadScene();
