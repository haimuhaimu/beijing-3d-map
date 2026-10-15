// Quiet, deterministic scenery. It only renders when the viewer already needs
// a frame; no extra animation loop or external textures are required.
export function createNightScenery(T, scene) {
  const root = new T.Group(); root.name = 'NightHorizon'; scene.add(root);
  let seed = 8249;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const sky = new T.Mesh(new T.SphereGeometry(370, 40, 24), new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vSky; void main(){vSky=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 vSky;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){vec3 d=normalize(vSky);float h=smoothstep(-.2,.7,d.y);
        vec3 c=mix(vec3(.008,.032,.12),vec3(.002,.005,.033),h);
        vec2 p=vec2(atan(d.z,d.x)*3.,d.y*14.);p.x+=p.y*.55;
        float cloud=noise(p*vec2(3.,1.))*noise(p*vec2(13.,3.));
        c+=vec3(.025,.055,.13)*smoothstep(.25,.6,cloud)*smoothstep(-.55,.05,d.y);
        gl_FragColor=vec4(c,1.);}`,
  }));
  // The wider geographic overview can move outside the original sky sphere.
  // Keep the sky centered on the camera and its far edge out of the frame.
  sky.frustumCulled=false;
  sky.onBeforeRender=(_renderer,_scene,camera)=>{sky.position.copy(camera.position);sky.updateMatrixWorld();};
  root.add(sky);
  const ramp = new T.DataTexture(new Uint8Array([26,72,151,245]),4,1,T.RedFormat);
  ramp.minFilter=ramp.magFilter=T.NearestFilter;ramp.needsUpdate=true;
  const ground = new T.Mesh(new T.PlaneGeometry(2000, 2000), new T.MeshToonMaterial({ color: new T.Color(.012,.034,.071),gradientMap:ramp }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.10; root.add(ground);
  const forestMaterial=new T.MeshToonMaterial({color:new T.Color(.027,.145,.105),gradientMap:ramp});
  forestMaterial.name='Foliage_Horizon';
  const planting=[];
  // A narrow, broken treeline frames the western hills. The old 220-unit
  // forest carpet outweighed Beijing and made the overview appear off-center.
  for(let x=-49;x<61;x+=1.5) for(let z=-43;z<49;z+=1.5){
    if(((x+43)/16)**2+((z+50)/15)**2 < 1.12)continue;
    if(x>-41 && z<47)continue;
    const westEdge=-43.5-1.4*Math.sin(z*.19);
    const west=Math.exp(-(((x-westEdge)/2.8)**2))*Math.exp(-(((z+23)/17)**4))*.42;
    const front=Math.exp(-(((z-48)/1.8)**2))*Math.exp(-(((x+5)/36)**4))*.10;
    if(random()>Math.max(west,front))continue;
    planting.push([x+(random()-.5),z+(random()-.5),.48+random()*.7,.48+random()*.48]);
  }
  // Separate random streams keep the city skyline stable as the fringe changes.
  seed=9173;
  const transform=new T.Object3D();
  const branchGeometry=(radius,height)=>{
    const vertices=[],indices=[],count=12;
    for(let i=0;i<count;i++){
      const a=i*Math.PI*2/count,r=radius*(i%2?.58:1);
      vertices.push(Math.cos(a)*r,-height/2+(i%2)*height*.1,Math.sin(a)*r);
    }
    vertices.push(0,height/2,0);
    for(let i=0;i<count;i++)indices.push(i,count,(i+1)%count);
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return g;
  };
  for(let level=0;level<3;level++){
    const forest=new T.InstancedMesh(branchGeometry(.49-level*.09,.95),forestMaterial,planting.length);
    forest.name='HorizonPines';
    planting.forEach(([x,z,s,tint],i)=>{transform.position.set(x,(.65+level*.4)*s,z);transform.scale.setScalar(s);transform.updateMatrix();forest.setMatrixAt(i,transform.matrix);forest.setColorAt(i,new T.Color(tint,tint,tint*1.07));});
    root.add(forest);
  }
  const cityMaterial=new T.MeshToonMaterial({color:new T.Color(.03,.07,.15),gradientMap:ramp});
  const lightMaterial=new T.MeshBasicMaterial({color:new T.Color(.65,.39,.14)});
  const cube=new T.BoxGeometry(1,1,1), windows=[];
  for(let i=0;i<126;i++){
    const layer=Math.floor(i/42),x=-15+(i%42)*1.7+(random()-.5)*.9;
    const z=-42-layer*5-random()*2.2,h=1.3+random()*(3.8+layer*1.6),w=.85+random()*.65;
    const building=new T.Mesh(cube,cityMaterial);building.position.set(x,h/2,z);building.scale.set(w,h,.85);root.add(building);
    for(let y=.5;y<h-.15;y+=.52) for(const dx of [-.22,.22]) if(random()>.53) windows.push([x+dx,y,z+.43]);
  }
  const cityWindows=new T.InstancedMesh(cube,lightMaterial,windows.length);
  windows.forEach(([x,y,z],i)=>{transform.position.set(x,y,z);transform.scale.set(.12,.19,.025);transform.updateMatrix();cityWindows.setMatrixAt(i,transform.matrix);});root.add(cityWindows);
  // Far silhouettes form depth behind the forest, without joining the list of
  // selectable destinations or expanding the map's focus bounds.
  for (let layer = 0; layer < 3; layer++) {
    const positions = [], indices = [];
    for (let i = 0; i <= 42; i++) {
      const x = -145 + i * 7;
      const y = 1 + random() * (layer === 2 ? 5 : 3) + Math.sin(i * .75);
      positions.push(x, -.12, -74 - layer * 10, x, y, -74 - layer * 10);
      if (i) { const n = i * 2; indices.push(n-2,n-1,n,n-1,n+1,n); }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions,3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const ridge = new T.Mesh(geometry, new T.MeshBasicMaterial({ color: ['#07172d','#0a2040','#0d294d'][layer], side: T.DoubleSide }));
    root.add(ridge);
  }
  const stars = [];
  for (let i = 0; i < 240; i++) {
    const a = random() * Math.PI * 2, elevation = .18 + random() * 1.2;
    stars.push(310*Math.cos(a)*Math.cos(elevation),310*Math.sin(elevation),310*Math.sin(a)*Math.cos(elevation));
  }
  const starGeometry = new T.BufferGeometry(); starGeometry.setAttribute('position',new T.Float32BufferAttribute(stars,3));
  root.add(new T.Points(starGeometry,new T.PointsMaterial({color:'#b9d4ff',size: .36,transparent:true,opacity:.66,depthWrite:false,fog:false})));
  const moon = new T.Mesh(new T.SphereGeometry(3.3, 48, 32),new T.ShaderMaterial({
    vertexShader:'varying vec3 vMoon;void main(){vMoon=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`varying vec3 vMoon;
      void main(){vec3 n=normalize(vMoon);float maria=sin(n.x*9.+sin(n.y*7.))*cos(n.y*11.+n.z*5.);
      float fine=sin(n.x*37.+n.y*17.)*cos(n.z*29.-n.y*41.);
      float tone=.76+.14*smoothstep(-.35,.6,maria)+.06*fine;
      gl_FragColor=vec4(vec3(1.25,1.04,.58)*tone,1.);}`,
  }));
  moon.position.set(33,10,-48); root.add(moon);
  // Warm corona, painted procedurally so the entire viewer remains offline.
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64,64,3,64,64,64);
  gradient.addColorStop(0,'rgba(255,213,122,.42)'); gradient.addColorStop(.25,'rgba(255,198,103,.13)'); gradient.addColorStop(1,'rgba(255,198,103,0)');
  context.fillStyle=gradient;context.fillRect(0,0,128,128);
  const halo = new T.Sprite(new T.SpriteMaterial({map:new T.CanvasTexture(canvas),transparent:true,depthWrite:false,blending:T.AdditiveBlending,fog:false}));
  halo.position.copy(moon.position);halo.scale.set(23,23,1);root.add(halo);
  return root;
}

// A small bloom chain at quarter resolution keeps window light warm while the
// forest remains dark. No animation or readbacks are introduced.
export function createNightPostEffect(T, renderer) {
  const type=renderer.extensions.has('EXT_color_buffer_float')?T.HalfFloatType:T.UnsignedByteType;
  const target = (depthBuffer=false) => new T.WebGLRenderTarget(1,1,{type,depthBuffer});
  const sceneTarget=target(true), a=target(), b=target();
  // Renderer antialiasing only covers its default framebuffer. The postprocess
  // scene target needs its own multisampling to stop thin roofs/roads sparkling.
  sceneTarget.samples = Math.min(4, renderer.capabilities.maxSamples || 0);
  const postScene=new T.Scene(), postCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  const vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const make=(uniforms,fragmentShader)=>new T.ShaderMaterial({uniforms,vertexShader,fragmentShader,depthTest:false,depthWrite:false});
  const bright=make({source:{value:sceneTarget.texture}},`varying vec2 vUv;uniform sampler2D source;
    void main(){vec3 c=texture2D(source,vUv).rgb;float l=max(c.r,max(c.g,c.b));gl_FragColor=vec4(c*smoothstep(.85,2.3,l),1.);}`);
  const blur=make({source:{value:a.texture},stepSize:{value:new T.Vector2()}},`varying vec2 vUv;uniform sampler2D source;uniform vec2 stepSize;
    void main(){vec3 c=texture2D(source,vUv).rgb*.227027;c+=texture2D(source,vUv+stepSize*1.384615).rgb*.316216;c+=texture2D(source,vUv-stepSize*1.384615).rgb*.316216;c+=texture2D(source,vUv+stepSize*3.230769).rgb*.070270;c+=texture2D(source,vUv-stepSize*3.230769).rgb*.070270;gl_FragColor=vec4(c,1.);}`);
  const combine=make({source:{value:sceneTarget.texture},glow:{value:a.texture}},`varying vec2 vUv;uniform sampler2D source;uniform sampler2D glow;
    void main(){vec3 c=texture2D(source,vUv).rgb+texture2D(glow,vUv).rgb*.38;
      gl_FragColor=vec4(c,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`);
  const quad=new T.Mesh(new T.PlaneGeometry(2,2),bright);postScene.add(quad);
  let width=1,height=1;
  const pass=(material,destination)=>{quad.material=material;renderer.setRenderTarget(destination);renderer.render(postScene,postCamera);};
  return {
    setSize(w,h){const dpr=renderer.getPixelRatio();sceneTarget.setSize(Math.round(w*dpr),Math.round(h*dpr));width=Math.max(1,Math.round(w*dpr/4));height=Math.max(1,Math.round(h*dpr/4));a.setSize(width,height);b.setSize(width,height);},
    render(scene,camera){renderer.setRenderTarget(sceneTarget);renderer.render(scene,camera);pass(bright,a);
      blur.uniforms.source.value=a.texture;blur.uniforms.stepSize.value.set(1/width,0);pass(blur,b);
      blur.uniforms.source.value=b.texture;blur.uniforms.stepSize.value.set(0,1/height);pass(blur,a);pass(combine,null);},
    dispose(){sceneTarget.dispose();a.dispose();b.dispose();bright.dispose();blur.dispose();combine.dispose();quad.geometry.dispose();},
  };
}
