// ShaderCard2 — VOID's own WebGL implementation of the "ShaderCard2" API used by the supplied
// PricingDemo (the Lightswind Pro original is a paid component not available in this project).
// Props: color, speed, noiseScale, waveAmount, branchIntensity, blur, opacity, enableTilt, glow,
// className. A procedural shader (domain-warped fbm + ridged "branches") animates behind the
// card content; it pauses off-screen / in background tabs and renders one still frame when the
// user prefers reduced motion. Without WebGL the card falls back to a static CSS gradient.

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FRAG = `precision mediump float;
uniform vec2 uRes;uniform float uTime;uniform vec3 uColor;uniform float uNoise,uWave,uBranch,uSoft,uOpacity;uniform vec2 uPointer;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.03;a*=.5;}return v;}
float ridged(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){float n=1.-abs(noise(p)*2.-1.);v+=a*n*n;p*=2.1;a*=.5;}return v;}
void main(){
  vec2 p=(gl_FragCoord.xy-.5*uRes)/min(uRes.x,uRes.y);
  float t=uTime;
  p+=uWave*vec2(sin(p.y*4.+t*1.3),cos(p.x*4.-t*1.1));
  p+=(uPointer-.5)*.15;
  vec2 q=p*uNoise;
  vec2 w=vec2(fbm(q+vec2(0.,t*.15)),fbm(q+vec2(5.2,-t*.12)));
  float base=fbm(q+1.6*w);
  float br=ridged(q*1.3+2.*w+vec2(t*.05,-t*.03));
  float branches=pow(br,mix(6.,2.5,uSoft))*uBranch;
  float body=smoothstep(.2,.9,base);
  vec3 col=uColor*(.35*body+.9*branches)+vec3(1.)*branches*branches*.25;
  float vign=smoothstep(1.25,.15,length(p));
  float a=clamp((.25*body+branches)*uOpacity*vign,0.,1.);
  gl_FragColor=vec4(col*vign*a,a);
}`;

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex) || [null, '5227ff'];
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export function shaderCard2({
  color = '#5227FF', speed = 0.5, noiseScale = 1.5, waveAmount = 0.15, branchIntensity = 2.0,
  blur = 5.0, opacity = 0.8, enableTilt = true, glow = true, className = '',
} = {}, ...children) {
  const card = document.createElement('div');
  card.className = `shader-card ${glow ? 'shader-card-glow' : ''} ${className}`.trim();
  card.style.setProperty('--sc-color', color);
  const canvas = document.createElement('canvas');
  canvas.className = 'shader-card-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.filter = blur > 0 ? `blur(${(blur * 0.4).toFixed(1)}px)` : '';
  const content = document.createElement('div');
  content.className = 'shader-card-content';
  content.append(...children.flat().filter(Boolean));
  card.append(canvas, content);

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true });
  if (!gl) { card.classList.add('shader-card-fallback'); return card; }

  const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const prog = vs && fs && gl.createProgram();
  if (!prog) { card.classList.add('shader-card-fallback'); return card; }
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { card.classList.add('shader-card-fallback'); return card; }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n) => gl.getUniformLocation(prog, n);
  const U = { res: u('uRes'), time: u('uTime'), color: u('uColor'), noise: u('uNoise'), wave: u('uWave'), branch: u('uBranch'), soft: u('uSoft'), opacity: u('uOpacity'), pointer: u('uPointer') };
  gl.uniform3fv(U.color, hexToRgb(color));
  gl.uniform1f(U.noise, noiseScale);
  gl.uniform1f(U.wave, waveAmount);
  gl.uniform1f(U.branch, branchIntensity);
  gl.uniform1f(U.soft, Math.min(1, Math.max(0, blur / 10)));
  gl.uniform1f(U.opacity, opacity);
  gl.uniform2f(U.pointer, 0.5, 0.5);

  let pointer = [0.5, 0.5];
  const resize = () => {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(card.clientWidth * dpr)), hgt = Math.max(1, Math.round(card.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; gl.viewport(0, 0, w, hgt); }
    gl.uniform2f(U.res, w, hgt);
  };
  const draw = (ms) => {
    resize();
    gl.uniform1f(U.time, (ms / 1000) * speed);
    gl.uniform2f(U.pointer, pointer[0], pointer[1]);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  let raf = 0, visible = true;
  const loop = (ms) => {
    raf = 0;
    if (!card.isConnected) return stop(); // route changed: release the GPU context
    draw(ms);
    if (!reduceMotion && visible && document.visibilityState === 'visible') raf = requestAnimationFrame(loop);
  };
  const start = () => { if (!raf) raf = requestAnimationFrame(loop); };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; io?.disconnect(); ro?.disconnect(); document.removeEventListener('visibilitychange', onVis); gl.getExtension('WEBGL_lose_context')?.loseContext(); };
  const onVis = () => { if (document.visibilityState === 'visible') start(); };
  document.addEventListener('visibilitychange', onVis);
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }) : null;
  io?.observe(card);
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { if (reduceMotion) draw(0); }) : null;
  ro?.observe(card);
  requestAnimationFrame(start);

  // Pointer tilt (fine pointers only, never with reduced motion).
  if (enableTilt && !reduceMotion && window.matchMedia?.('(pointer: fine)').matches) {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      pointer = [x, 1 - y];
      card.style.transform = `perspective(900px) rotateX(${((0.5 - y) * 8).toFixed(2)}deg) rotateY(${((x - 0.5) * 10).toFixed(2)}deg)`;
    });
    card.addEventListener('pointerleave', () => { pointer = [0.5, 0.5]; card.style.transform = ''; });
  }
  return card;
}
