// Static, distance-filtered surface detail. World-space patterns stay anchored
// while orbiting, and fade before they can shimmer in the overview.
export function applyCitySurface(material, name) {
  const kind = /^(City_ResidentialBrick|City_AgedBrick|Factory_Brick)$/.test(name) ? 'brick'
    : /^(City_WarmPlaster|City_CoolPlaster|City_Steel)$/.test(name) ? 'plaster'
    : /^(Road_Sidewalk|City_V13Paving|City_V13WarmStone|Ground_NeighborhoodStone|Ground_CourtyardPaving|Ground_CityParkPath|Ground_OlympicPaving|Ground_OlympicAxis|Ground_OlympicVenueStone|Ground_OlympicSteps|Ground_WorkersPaving|Ground_WorkersCourt|Ground_BeihaiPath|Ground_BeihaiCourt|Ground_FactoryCourt)$/.test(name) ? 'paving'
    : name === 'Road_Asphalt' ? 'asphalt' : null;
  if (!kind) return;
  const pattern = kind === 'brick' ? `
      vec2 cell=uv*vec2(3.8,8.4);cell.x+=mod(floor(cell.y),2.)*.5;
      vec2 footprint=fwidth(cell);float fade=1.-smoothstep(.18,.7,max(footprint.x,footprint.y));
      vec2 edge=abs(fract(cell)-.5);vec2 seam=smoothstep(vec2(.46)-footprint,vec2(.495),edge);
      float joint=max(seam.x,seam.y);float variation=cityHash(floor(cell))-.5;
      diffuseColor.rgb*=1.+fade*(variation*.09-joint*.17);`
    : kind === 'paving' ? `
      vec2 cell=vCityPosition.xz*2.6;cell.x+=mod(floor(cell.y),2.)*.5;
      vec2 footprint=fwidth(cell);float fade=1.-smoothstep(.18,.75,max(footprint.x,footprint.y));
      vec2 seam=smoothstep(vec2(.46)-footprint,vec2(.49),abs(fract(cell)-.5));
      diffuseColor.rgb*=1.-max(seam.x,seam.y)*.21*fade;`
    : kind === 'asphalt' ? `
      vec2 cell=vCityPosition.xz*19.;float fade=1.-smoothstep(.3,1.3,max(fwidth(cell.x),fwidth(cell.y)));
      diffuseColor.rgb*=.96+(cityHash(floor(cell))-.5)*.085*fade;`
    : `
      vec2 cell=uv*8.;float fade=1.-smoothstep(.25,.8,max(fwidth(cell.x),fwidth(cell.y)));
      diffuseColor.rgb*=1.+(cityHash(floor(cell))-.5)*.05*fade;`;
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCityPosition;varying vec3 vCityNormal;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCityPosition=(modelMatrix*vec4(transformed,1.)).xyz;vCityNormal=normalize(mat3(modelMatrix)*normal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCityPosition;varying vec3 vCityNormal;
        float cityHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 n=abs(normalize(vCityNormal));
        vec2 uv=n.y>.7?vCityPosition.xz:(n.x>n.z?vCityPosition.zy:vCityPosition.xy);
        ${pattern}`);
  };
  material.customProgramCacheKey = () => `city-surface-${kind}-v1`;
}
