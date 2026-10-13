// One static world-space light/contact map, shared by the city's surfaces.
// No dynamic lights, extra render loop or external texture download.
export function createCityLighting(T, data) {
  if (!data) return null;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
  const ctx=canvas.getContext('2d');
  const [xmin,zmin,xmax,zmax]=data.bounds, width=xmax-xmin, depth=zmax-zmin;
  ctx.fillStyle='#000';ctx.fillRect(0,0,1024,1024);ctx.globalCompositeOperation='lighter';
  // A soft district mask fades the edge of modeled floor skirts into the night.
  for(const polygon of data.districts||[]) {
    const center=polygon.reduce((sum,p)=>[sum[0]+p[0]/polygon.length,sum[1]+p[1]/polygon.length],[0,0]);
    ctx.save();ctx.fillStyle='rgb(0,255,0)';ctx.shadowColor='rgb(0,255,0)';ctx.shadowBlur=15;
    ctx.beginPath();polygon.forEach((point,i)=>{
      const x=(center[0]+(point[0]-center[0])*.90-xmin)/width*1024;
      const y=(center[1]+(point[1]-center[1])*.94-zmin)/depth*1024;
      if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);
    });ctx.closePath();ctx.fill();ctx.restore();
  }
  function ellipse(position,radius,strength,channel,angle=0) {
    ctx.save();ctx.translate((position[0]-xmin)/width*1024,(position[1]-zmin)/depth*1024);
    ctx.scale(1024/width,1024/depth);ctx.rotate(-angle);ctx.scale(radius[0],radius[1]);
    const gradient=ctx.createRadialGradient(0,0,0,0,0,1);
    const color=channel==='light'?'255,0,0':'0,0,255';
    gradient.addColorStop(0,`rgba(${color},${strength})`);
    gradient.addColorStop(.38,`rgba(${color},${strength*.65})`);
    gradient.addColorStop(1,`rgba(${color},0)`);
    ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(0,0,1,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  for(const light of data.lights)ellipse(light.position,light.radius,light.strength,'light',light.angle||0);
  for(const contact of data.contacts)ellipse(contact.position,contact.radius,contact.strength,'contact',contact.angle||0);
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.NoColorSpace;
  texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;
  return {texture,bounds:new T.Vector4(xmin,zmin,width,depth),season:{value:0}};
}

export function applyCityLighting(material,name,lighting) {
  if(!lighting || !/^(Ground_|Road_(Asphalt|Sidewalk|StoneCurb)|City_(ResidentialBrick|AgedBrick|WarmPlaster|CoolPlaster|Steel|Blue|V13Paving|V13WarmStone|V13Glass|V13GlassSide)|Stone_Mortar|Factory_Brick)/.test(name))return;
  const floorSkirt=name==='Ground_NeighborhoodStone';
  if(floorSkirt){material.transparent=true;material.depthWrite=false;material.alphaTest=.015;}
  const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey.bind(material);
  const key=previousKey();
  material.onBeforeCompile=shader=>{
    previous(shader);
    shader.uniforms.cityLightMap={value:lighting.texture};
    shader.uniforms.cityLightBounds={value:lighting.bounds};
    shader.uniforms.cityLightWinter=lighting.season;
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 vCityLightPosition;varying vec3 vCityLightNormal;')
      .replace('#include <project_vertex>','#include <project_vertex>\nvCityLightPosition=(modelMatrix*vec4(transformed,1.)).xyz;vCityLightNormal=normalize(mat3(modelMatrix)*normal);');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>',`#include <common>
        varying vec3 vCityLightPosition;varying vec3 vCityLightNormal;
        uniform sampler2D cityLightMap;uniform vec4 cityLightBounds;uniform float cityLightWinter;
        vec2 cityLightUV(){vec2 p=(vCityLightPosition.xz-cityLightBounds.xy)/cityLightBounds.zw;return vec2(p.x,1.-p.y);}
        vec3 cityLightSample(){vec2 uv=cityLightUV();float inside=step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);return texture2D(cityLightMap,clamp(uv,0.,1.)).rgb*inside;}
        float cityLightHeight(){return exp(-max(0.,vCityLightPosition.y-.2)*.63);}`)
      .replace('#include <color_fragment>',`#include <color_fragment>
        vec3 cityIllumination=cityLightSample();
        float cityGround=step(.72,abs(normalize(vCityLightNormal).y))*(1.-smoothstep(.24,.65,vCityLightPosition.y));
        diffuseColor.rgb*=1.-cityIllumination.b*.49*cityGround;
        ${floorSkirt ? 'diffuseColor.a*=smoothstep(.025,.6,cityIllumination.g);' : ''}
        diffuseColor.rgb+=vec3(.105,.062,.019)*cityIllumination.r*cityLightHeight();`)
      .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
        totalEmissiveRadiance+=vec3(.21,.105,.030)*cityLightSample().r*cityLightHeight()*(1.-cityLightWinter*.16);`);
  };
  material.customProgramCacheKey=()=>key+'-city-ground-light-v16-'+floorSkirt;
}
