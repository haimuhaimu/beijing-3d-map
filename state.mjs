export function createFieldState({ reducedMotion = false } = {}) {
  return { focus: 'all', resort: null, winter: false, lights: false, paused: false, reducedMotion, status: 'loading', progress: 0, loadId: 1, reason: null };
}

export function reduceFieldState(state, action, world) {
  if (['ready', 'failed', 'progress'].includes(action.type) && action.loadId !== state.loadId) return state;
  if (['ready', 'progress'].includes(action.type) && state.status !== 'loading') return state;
  switch (action.type) {
    case 'focus': return action.place === 'all' || world?.places.some((place) => place.id === action.place) ? { ...state, focus: action.place, resort: null } : state;
    case 'resort': {
      const place = world?.places.find((item) => item.id === state.focus);
      return place?.resorts && (action.resort === null || place.resorts.some((item) => item.id === action.resort)) ? { ...state, resort: action.resort } : state;
    }
    case 'winter': return { ...state, winter: !state.winter };
    case 'lights': return { ...state, lights: !state.lights };
    case 'pause': return { ...state, paused: !state.paused };
    case 'reduced-motion': return { ...state, reducedMotion: Boolean(action.value) };
    case 'restore': return { ...state, focus: 'all', resort: null, winter: false, lights: false };
    case 'retry': return { ...state, status: 'loading', progress: 0, reason: null, loadId: state.loadId + 1 };
    case 'progress': return { ...state, progress: Math.min(99, Math.max(state.progress, Number(action.progress) || 0)) };
    case 'ready': return { ...state, status: 'ready', progress: 100, reason: null };
    case 'failed': return { ...state, status: 'fallback', reason: action.reason || 'model' };
    default: return state;
  }
}

export function transitionDuration(state, milliseconds) {
  return state.paused || state.reducedMotion ? 0 : milliseconds;
}

export function lampLevel(elapsed, index, count) {
  if (count < 1) return 0;
  const phase = Math.max(0, Math.min(1, (elapsed - index * 170) / 280));
  return phase * phase * (3 - 2 * phase);
}

export function createLoadWatchdog({ loadId, getState, controller, onTimeout, timeoutMs = 45000 }) {
  const timer = setTimeout(() => {
    const current = getState();
    if (current.loadId !== loadId || current.status !== 'loading') return;
    // Imports and GLTF parsing do not consume the fetch signal; update the UI
    // directly instead of relying on a pending operation to reject.
    controller.abort();
    onTimeout();
  }, timeoutMs);
  return () => clearTimeout(timer);
}

export function validateWorld(world) {
  const vector = (value, label, length = 3) => {
    if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) throw new Error(`Invalid ${label} vector`);
  };
  if (!world || !Array.isArray(world.places) || world.places.length !== 12) throw new Error('World requires 12 places');
  if (new Set(world.places.map((place) => place.id)).size !== 12) throw new Error('Place ids must be unique');
  for (const name of ['width', 'depth', 'height']) if (!Number.isFinite(world.bounds?.[name]) || world.bounds[name] <= 0) throw new Error(`Invalid bounds ${name}`);
  if (world.bounds.center) vector(world.bounds.center, 'bounds center');
  vector(world.overview?.target, 'overview target'); vector(world.overview?.offset, 'overview offset');
  if (world.overview.frame?.center) vector(world.overview.frame.center, 'framing center');
  if (world.overview.frame) for (const name of ['width', 'depth', 'height']) if (!Number.isFinite(world.overview.frame[name]) || world.overview.frame[name] <= 0) throw new Error(`Invalid framing ${name}`);
  vector(world.stadiumCenter, 'stadiumCenter');
  if (!Array.isArray(world.lampPositions) || !world.lampPositions.length) throw new Error('Missing lamp positions');
  world.lampPositions.forEach((position) => vector(position, 'lamp'));
  for (const place of world.places) {
    for (const name of ['id', 'number', 'name', 'subtitle', 'group', 'description', 'art']) if (typeof place[name] !== 'string' || !place[name].trim()) throw new Error(`Missing place ${name}`);
    if (!/^[a-z0-9-]+$/.test(place.id) || place.id === 'all') throw new Error('Invalid place id');
    for (const name of ['target', 'anchor', 'offset']) vector(place[name], `${place.id} ${name}`);
    vector(place.position, `${place.id} position`, 2);
    if (Math.hypot(...place.offset) < 1) throw new Error('Invalid camera offset');
    if (place.frame) {
      for (const name of ['width', 'depth', 'height']) if (!Number.isFinite(place.frame[name]) || place.frame[name] <= 0) throw new Error(`Invalid ${place.id} framing ${name}`);
      if (place.frame.center) vector(place.frame.center, `${place.id} framing center`);
    }
    if (place.card) for (const name of ['name', 'type', 'kind', 'line']) if (typeof place.card[name] !== 'string' || !place.card[name].trim()) throw new Error(`Missing card ${name}`);
    if (place.resorts) {
      if (!Array.isArray(place.resorts) || new Set(place.resorts.map((item) => item.id)).size !== place.resorts.length) throw new Error('Invalid resort ids');
      for (const resort of place.resorts) {
        for (const name of ['id', 'name', 'subtitle', 'description']) if (typeof resort[name] !== 'string' || !resort[name].trim()) throw new Error(`Missing resort ${name}`);
        if (!/^[a-z0-9-]+$/.test(resort.id)) throw new Error('Invalid resort id');
        for (const name of ['target', 'anchor', 'offset']) vector(resort[name], `${resort.id} ${name}`);
        if (Math.hypot(...resort.offset) < 1) throw new Error('Invalid resort offset');
        for (const name of ['width', 'depth', 'height']) if (!Number.isFinite(resort.frame?.[name]) || resort.frame[name] <= 0) throw new Error(`Invalid resort frame ${name}`);
        vector(resort.frame.center, 'resort framing center');
      }
    }
  }
  return world;
}

export function cameraPoseFor(world, id, aspect, resortId = null) {
  const place = id === 'all' ? world.overview : world.places.find((place) => place.id === id);
  const preset = resortId ? place?.resorts?.find((resort) => resort.id === resortId) : place;
  if (!preset) return null;
  const safeAspect = Math.max(.35, Number.isFinite(aspect) ? aspect : 1);
  if (id !== 'all' && !preset.frame) {
    const scale = Math.max(1, Math.min(2.3, 1.12 / safeAspect));
    return { target: preset.target.slice(), position: preset.target.map((value, index) => value + preset.offset[index] * scale) };
  }
  let distance = Math.hypot(...preset.offset);
  const direction = preset.offset.map((value) => value / distance);
  if (id === 'all' || preset.frame) {
    const horizontal = Math.hypot(direction[0], direction[2]);
    const right = [direction[2] / horizontal, 0, -direction[0] / horizontal];
    const up = [direction[1] * right[2], direction[2] * right[0] - direction[0] * right[2], -direction[1] * right[0]];
    const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
    const tanV = Math.tan(35 * Math.PI / 360), tanH = tanV * safeAspect;
    const frame = preset.frame || world.bounds;
    for (const x of [-frame.width / 2, frame.width / 2]) {
      for (const y of [-1.5, frame.height]) for (const z of [-frame.depth / 2, frame.depth / 2]) {
        const center = frame.center || [0, 0, 0];
        const relative = [x, y, z].map((value, index) => value + center[index] - preset.target[index]);
        distance = Math.max(distance, dot(relative, direction) + Math.max(Math.abs(dot(relative, right)) / tanH, Math.abs(dot(relative, up)) / tanV) / .94);
      }
    }
  }
  return { target: preset.target.slice(), position: preset.target.map((value, index) => value + direction[index] * distance) };
}

export function locationCardForState(state, world) {
  if (state.status !== 'ready') return null;
  const place = world?.places.find((item) => item.id === state.focus);
  if (!place) return null;
  const resort = place.resorts?.find((item) => item.id === state.resort);
  if (resort) return { place: place.id, key: `${place.id}:${resort.id}`, number: place.number, anchor: resort.anchor, name: resort.name, type: resort.subtitle, line: resort.description, kind: 'place', label: '雪场近景' };
  return { place: place.id, number: place.number, anchor: place.anchor, name: place.card?.name || place.name, type: place.card?.type || place.subtitle, line: place.card?.line || place.description, kind: place.card?.kind || 'place', label: place.card ? '地点卡预览' : '地点信息' };
}

export function placeCardLayout(anchor, viewport, card, protectedRect) {
  const margin = 12, gap = 14;
  const rect = protectedRect || { left: anchor.x - 36, right: anchor.x + 36, top: anchor.y - 36, bottom: anchor.y + 36 };
  const minY = Math.min(76, viewport.height * .2), maxY = viewport.height - card.height - 56;
  const maxX = viewport.width - card.width - margin;
  const clampedY = Math.max(minY, Math.min(maxY, anchor.y - card.height / 2));
  const clampedX = Math.max(margin, Math.min(maxX, anchor.x - card.width / 2));
  const candidates = [
    { x: rect.right + gap, y: clampedY }, { x: rect.left - card.width - gap, y: clampedY },
    { x: clampedX, y: rect.top - card.height - gap }, { x: clampedX, y: rect.bottom + gap },
    { x: margin, y: minY }, { x: maxX, y: minY }, { x: margin, y: maxY }, { x: maxX, y: maxY },
  ];
  const safe = candidates.filter(({ x, y }) => x >= margin && x <= maxX && y >= minY && y <= maxY && (x + card.width + gap <= rect.left || x - gap >= rect.right || y + card.height + gap <= rect.top || y - gap >= rect.bottom));
  safe.sort((a, b) => Math.hypot(a.x + card.width / 2 - anchor.x, a.y + card.height / 2 - anchor.y) - Math.hypot(b.x + card.width / 2 - anchor.x, b.y + card.height / 2 - anchor.y));
  return safe.length ? { ...safe[0], docked: false } : { x: margin, y: minY, docked: true };
}

export function isSceneTap(start, end, { moved = 0, multiTouch = false } = {}) {
  return Boolean(start && end && start.button === 0 && !multiTouch && moved <= 7 && Math.hypot(end.x - start.x, end.y - start.y) <= 7 && end.time - start.time >= 0 && end.time - start.time <= 550);
}

export function materialKind(name = '') {
  return /^Snow(?:[_.]|$)/i.test(name) ? 'snow' : /Water/i.test(name) ? 'water' : /Foliage/i.test(name) ? 'foliage' : /StadiumLamp/i.test(name) ? 'lamp' : /^Road_(LampWash|ContactShadow)$/.test(name) ? 'ground-effect' : 'base';
}

export function placeIdForObject(object, world) {
  for (let current = object; current; current = current.parent) {
    if (world.places.some((place) => place.id === current.userData?.place)) return current.userData.place;
  }
  return null;
}

export function placeFromHits(hits, world) {
  // Raycaster supplies nearest-first hits. The first visible surface blocks
  // everything behind it, even if that surface has no selectable place.
  for (const { object, face } of hits) {
    if (!object.isMesh) continue;
    let skipped = false;
    for (let current = object; current; current = current.parent) {
      if (current.visible === false || /^Season_Snow(?:[_.]|$)/i.test(current.name || '')) { skipped = true; break; }
    }
    if (skipped) continue;
    const material = Array.isArray(object.material) ? object.material[face?.materialIndex ?? 0] : object.material;
    // Seasonal snow is a decorative overlay, including when winter makes it
    // visible. Alpine_Ice is permanent landmark geometry and is not skipped.
    if (material?.visible === false || (material?.transparent && material.opacity === 0) || ['snow', 'ground-effect'].includes(materialKind(material?.name))) continue;
    return placeIdForObject(object, world);
  }
  return null;
}
