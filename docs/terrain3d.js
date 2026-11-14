// Written with assistance from Claude Code (Anthropic).
// Lunar Horizon — 3-D view of the LOLA terrain around a polar site: sunlight and shadows from the Sun's
// direction at the chosen time, arrows to the Sun and Earth. Uses three.js (MIT), loaded from jsDelivr
// only when this view starts. Units: km; x = east, y = up, z = south.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const D2R = Math.PI / 180;
// Direction on the sky (azimuth from north clockwise, elevation) as a three.js unit vector.
const skyDir = (az, el) => new THREE.Vector3(Math.cos(el * D2R) * Math.sin(az * D2R), Math.sin(el * D2R), -Math.cos(el * D2R) * Math.cos(az * D2R));

// onLost(): called if the browser drops the WebGL context (it can on phones).
export function createTerrainView(canvas, onLost) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0B1222');
  const camera = new THREE.PerspectiveCamera(45, 2, 0.05, 500);
  const controls = new OrbitControls(camera, canvas);
  controls.maxPolarAngle = Math.PI * 0.495;           // stay above the ground plane
  controls.minDistance = 2; controls.maxDistance = 90;

  // Faint fill light so terrain in shadow is not pure black (stands in for earthshine; not to scale).
  scene.add(new THREE.HemisphereLight('#9FB6D9', '#3A4252', 0.55));
  const sun = new THREE.DirectionalLight('#FFF1D6', 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 200 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const ground = new THREE.MeshStandardMaterial({ color: '#BFC3CA', roughness: 0.97, metalness: 0 });
  let mesh = null;

  // The site: a small white pin and a ring.
  const pin = new THREE.Group();
  pin.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 12).translate(0, 0.45, 0), new THREE.MeshBasicMaterial({ color: '#FFFFFF' })));
  pin.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12).translate(0, 0.95, 0), new THREE.MeshBasicMaterial({ color: '#FFFFFF' })));
  scene.add(pin);

  // Arrows from the site and markers at their tips: the Sun (glowing ball), Earth (lit by the Sun, so it shows its phase).
  const ARROW = 9;
  const sunArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), ARROW, 0xFFC24B, 0.8, 0.45);
  const earthArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), ARROW, 0x6CB6FF, 0.8, 0.45);
  const sunBall = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 16), new THREE.MeshBasicMaterial({ color: '#FFF3D1' }));
  const earthBall = new THREE.Mesh(new THREE.SphereGeometry(0.75, 32, 24), new THREE.MeshStandardMaterial({ color: '#8CC8FF', roughness: 0.6, emissive: '#0B1630' }));
  scene.add(sunArrow, earthArrow, sunBall, earthBall);
  const dim = (arrow, up) => { for (const m of [arrow.line.material, arrow.cone.material]) { m.transparent = true; m.opacity = up ? 1 : 0.35; } };

  let renders = 0;
  function render() { renderer.render(scene, camera); renders++; }
  controls.addEventListener('change', render);
  // Redraw every frame while the view is on screen: some browsers (Safari on iPhone) can drop a frame that
  // was drawn only once, which leaves the canvas empty. Off screen, nothing is drawn.
  new IntersectionObserver((es) => renderer.setAnimationLoop(es.some((e) => e.isIntersecting) ? render : null)).observe(canvas);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); renderer.setAnimationLoop(null); if (onLost) onLost(); });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    render();
  }
  new ResizeObserver(resize).observe(canvas);

  // P = docs/data/terrain/<id>.json: n × n heights (m) above the site's horizontal plane, rows north to south.
  function setTerrain(P, earthAz) {
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
    const n = P.n, half = (n - 1) / 2, k = P.step_m / 1000, pos = new Float32Array(n * n * 3), idx = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const i = r * n + c;
      pos[i * 3] = (c - half) * k; pos[i * 3 + 1] = P.z_m[i] / 1000; pos[i * 3 + 2] = (r - half) * k;
    }
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
      const a = r * n + c, b = a + 1, d = a + n, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    mesh = new THREE.Mesh(g, ground);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    // Start behind the site, looking towards Earth (as in the sky view above).
    const toEarth = skyDir(earthAz, 0);
    camera.position.copy(toEarth.clone().multiplyScalar(-15)).add(new THREE.Vector3(0, 11, 0));
    controls.target.set(0, 0.5, 0);
    controls.update();
    resize();
  }

  function setSky(sAz, sEl, eAz, eEl, sunUp, earthUp) {
    const ds = skyDir(sAz, sEl), de = skyDir(eAz, eEl), o = new THREE.Vector3(0, 1, 0);
    sun.position.copy(ds).multiplyScalar(80); sun.target.position.set(0, 0, 0);
    sunArrow.setDirection(ds); earthArrow.setDirection(de);
    sunBall.position.copy(o).addScaledVector(ds, ARROW + 0.6);
    earthBall.position.copy(o).addScaledVector(de, ARROW + 0.9);
    dim(sunArrow, sunUp); dim(earthArrow, earthUp);
    render();
  }

  // For ?debug3d: what the browser gave us.
  function info() {
    const gl = renderer.getContext();
    return 'WebGL' + (renderer.capabilities.isWebGL2 ? '2' : '1') + ' · canvas ' + canvas.clientWidth + '×' + canvas.clientHeight +
      ' css, buffer ' + gl.drawingBufferWidth + '×' + gl.drawingBufferHeight + ' · terrain ' + (mesh ? 'loaded' : 'none') +
      ' · frames ' + renders + ' · lost ' + gl.isContextLost();
  }

  return { setTerrain, setSky, resize, info };
}
