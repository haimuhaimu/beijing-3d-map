// Place each reflection just inside the lake, on the radial line from its
// physical shore lamp. The shader then points the glimmer toward open water.
export function beihaiReflectionAnchors(world) {
  const center = world?.places?.find(place => place.id === 'beihai')?.position;
  const radii = world?.beihaiShore?.lakeRadii;
  if (!center?.slice(0, 2).every(Number.isFinite) || center.length < 2 ||
      !Array.isArray(radii) || radii.length !== 2 || !radii.every(r => Number.isFinite(r) && r > 0)) return [];
  const result = [];
  for (const light of world.beihaiShore.reflectionLights || []) {
    const p = light.position;
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || !Number.isFinite(light.strength) || light.strength <= 0) continue;
    const dx = p[0] - center[0], dz = p[1] + center[1];
    const radius = Math.hypot(dx / radii[0], dz / radii[1]);
    if (radius < .5) continue;
    result.push([center[0] + dx * .985 / radius, -center[1] + dz * .985 / radius, 1.35, Math.min(1, light.strength)]);
    if (result.length === 24) break;
  }
  return result;
}
