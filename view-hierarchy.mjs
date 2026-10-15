// The overview reads as landmarks within a city. Fine street contrast returns
// continuously when zooming in; this never removes geometry or changes picking.
export function visualRole(mesh) {
  for(let object=mesh;object;object=object.parent) if(object.userData.place) return 'landmark';
  if (/^City_(CBD|CentralAxis)_/.test(mesh.name)) return 'landmark';
  if (/^City_(Streets|StreetLife|StreetDetails|NorthRailway|V15Lanes|V16EntryLight)__/.test(mesh.name)) return 'street';
  if (/^City_/.test(mesh.name)) return 'neighborhood';
  return 'landscape';
}

export function viewDetail(camera, target) {
  // Use the shorter visible world span so portrait views do not lose their
  // close-up detail simply because the framing camera has to move farther back.
  const span = 2 * camera.position.distanceTo(target) * Math.tan(camera.fov * Math.PI / 360) * Math.min(1, camera.aspect);
  const t = Math.max(0, Math.min(1, (span - 21) / 48));
  return 1 - t * t * (3 - 2 * t);
}

export function applyViewHierarchy(material, name, role, detail) {
  if (role === 'landmark' || role === 'landscape') return;
  const window = /Window|LitGlass|ShopSign/.test(name);
  const light = /LampWash|Headlights|TailLights/.test(name);
  const foliage = /Foliage|Tree_Bark/.test(name);
  const asphalt = name === 'Road_Asphalt';
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  // Nearby streets still support the destination; only residential facades
  // need the larger color compression that unifies the patchwork of blocks.
  const far = window ? .26 : light ? .32 : foliage ? .82 : asphalt ? .92 : role === 'street' ? .61 : .69;
  const near = window ? .82 : light ? .80 : 1;
  const unify = !window && !light && !foliage && !asphalt && role === 'neighborhood' ? .40 : 0;
  material.onBeforeCompile = shader => {
    previous(shader);
    shader.uniforms.mapViewDetail = detail;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float mapViewDetail;')
      .replace('#include <opaque_fragment>', `
        float mapLuma = dot(outgoingLight, vec3(.2126, .7152, .0722));
        vec3 mapQuiet = mix(outgoingLight, mapLuma * vec3(.82, .94, 1.07), ${unify.toFixed(2)});
        outgoingLight = mix(mapQuiet * ${far.toFixed(2)}, outgoingLight * ${near.toFixed(2)}, mapViewDetail);
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `${key}-hierarchy21-${role}-${window}-${light}-${foliage}-${asphalt}`;
}
