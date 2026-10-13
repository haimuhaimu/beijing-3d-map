import { cameraPoseFor } from './state.mjs';

// Curated views reuse the original scene and coordinates. The frame describes
// the subject, not every neighboring building that happens to be visible.
export const BEIHAI_VIEWS = [
  { id: 'island', name: '湖岛全貌', detail: '沿着永安桥，望向琼华岛和白塔。', target: [3, 1.8, 7], offset: [8, 15, 22], frame: { center: [3, 0, 7], width: 16, depth: 17, height: 6.7 } },
  { id: 'pagoda', name: '白塔', detail: '红墙、绿瓦、层层树梢，向上是白塔。', target: [2, 3.4, 4.8], offset: [-5, 7, 12], frame: { center: [2, 0, 4.8], width: 6, depth: 7, height: 6.7 } },
  { id: 'shore', name: '东岸', detail: '走近岸边的短廊、柳树与临水步道。', target: [9, 1, 2.7], offset: [-7, 10, 13], frame: { center: [9, 0, 2.7], width: 7, depth: 10, height: 2.4 } },
];

export function viewPolicy(focus, free) {
  return { rotate: free, pan: free || focus !== 'beihai', cursorZoom: free || focus !== 'beihai' };
}

export function guidedCameraPose(world, id, aspect, shot = 'island', resort = null) {
  if (id !== 'beihai') return cameraPoseFor(world, id, aspect, resort);
  const view = BEIHAI_VIEWS.find(view => view.id === shot) || BEIHAI_VIEWS[0];
  return cameraPoseFor({ ...world, places: [{ ...view, id: 'beihai' }] }, 'beihai', aspect);
}

// Quiet the surroundings in Beihai's guided views while retaining the actual
// streets and skyline. Shared landmark materials use world-space distance so
// the selected landmark itself never inherits a dimmed neighboring material.
export function applyVisitFocus(material, amount) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = shader => {
    previous(shader);
    shader.uniforms.visitFocus = amount;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vVisitWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvVisitWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float visitFocus; varying vec3 vVisitWorld;')
      .replace('#include <opaque_fragment>', `
        float visitDistance = distance(vVisitWorld.xz, vec2(3.8, 6.));
        float visitVeil = smoothstep(8.7, 15., visitDistance) * visitFocus;
        outgoingLight = mix(outgoingLight, vec3(.007, .016, .028), visitVeil * .94);
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `${key}-visit23`;
}
