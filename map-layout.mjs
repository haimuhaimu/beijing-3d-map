// Map composition is independent of the full-size editable resort model.
// One uniform transform keeps geometry, focus cameras and card anchors aligned.
export function mapPoint(point, region) {
  return point.map((value, axis) => region.center[axis] + (value - region.origin[axis]) * region.scale);
}

export function createDisplayWorld(source) {
  const world = structuredClone(source);
  if (!world.mapLayout) return world;
  const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  for (const [id, region] of Object.entries(world.mapLayout.regions)) {
    const place = world.places.find(place => place.id === id);
    if (!place || !vector(region.origin) || !vector(region.center) || !Number.isFinite(region.scale) || region.scale <= 0) {
      throw new Error(`Invalid map layout for ${id}`);
    }
    for (const preset of [place, ...(place.resorts || [])]) {
      preset.target = mapPoint(preset.target, region);
      preset.anchor = mapPoint(preset.anchor, region);
      preset.offset = preset.offset.map(value => value * region.scale);
      if (preset.frame) {
        preset.frame.center = mapPoint(preset.frame.center, region);
        for (const key of ['width', 'depth', 'height']) preset.frame[key] *= region.scale;
      }
    }
  }
  if (world.mapLayout.bounds) world.bounds = structuredClone(world.mapLayout.bounds);
  return world;
}

export function applyMapLayout(T, model, layout) {
  if (!layout) return;
  for (const [id, region] of Object.entries(layout.regions)) {
    const groupName = `MapRegion_${id}`;
    if (model.getObjectByName(groupName)) continue;
    const roots = [];
    model.traverse(object => {
      if (object.userData.place !== id) return;
      for (let parent = object.parent; parent && parent !== model; parent = parent.parent) {
        if (parent.userData.place === id) return;
      }
      roots.push(object);
    });
    const group = new T.Group(); group.name = groupName; group.userData.place = id;
    model.add(group); model.updateMatrixWorld(true);
    roots.forEach(object => group.attach(object));
    group.scale.setScalar(region.scale);
    group.position.fromArray(region.center.map((value, axis) => value - region.origin[axis] * region.scale));
    model.updateMatrixWorld(true);
  }
}
