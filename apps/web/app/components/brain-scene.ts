import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

type Options = { listening: boolean; reduceMotion: boolean; theme: 'light' | 'dark' };
export type BrainScene = { update(options: Options): void; dispose(): void };

/** Locally bundled anatomical cortex; thought text never enters the scene. */
export function createBrainScene(host: HTMLElement, initial: Options, onReady: () => void): BrainScene | null {
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }); }
  catch { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
  camera.position.z = 1000;
  const brain = new THREE.Group();
  scene.add(brain);
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const keepGeometry = <T extends THREE.BufferGeometry>(geometry: T) => { geometries.push(geometry); return geometry; };
  const keepMaterial = <T extends THREE.Material>(material: T) => { materials.push(material); return material; };
  scene.add(new THREE.HemisphereLight('#fff4ee', '#59434e', 1.25));
  const keyLight = new THREE.DirectionalLight('#fff6ef', 2.8);
  keyLight.position.set(-200, 300, 450);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight('#ffd5c5', 1.6);
  rimLight.position.set(200, 100, -100);
  scene.add(rimLight);

  const lineMaterial = keepMaterial(new THREE.LineBasicMaterial({ color: '#729a85', transparent: true, opacity: 0.48 }));
  const signalMaterial = keepMaterial(new THREE.MeshBasicMaterial({ color: '#558768' }));
  const dotGeometry = keepGeometry(new THREE.SphereGeometry(2.4, 8, 8));
  const connections = Array.from({ length: 4 }, () => {
    const geometry = keepGeometry(new THREE.BufferGeometry());
    const line = new THREE.Line(geometry, lineMaterial);
    const signal = new THREE.Mesh(dotGeometry, signalMaterial);
    scene.add(line, signal);
    return { line, signal, curve: new THREE.CubicBezierCurve3() };
  });
  let options = initial;
  let scale = 100;
  let frame = 0;
  let time = 0;
  let previousTime = 0;
  let disposed = false;
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => options.reduceMotion || motionPreference.matches;

  function draw() {
    brain.rotation.set(0.24 + Math.sin(time * 0.22) * 0.035, -0.85 + Math.sin(time * 0.28) * 0.18, -0.06);
    brain.scale.setScalar(scale * (1 + Math.sin(time * (options.listening ? 2.7 : 0.8)) * (options.listening ? 0.025 : 0.008)));
    connections.forEach(({ signal, curve }, index) => {
      signal.position.copy(curve.getPoint((time * (options.listening ? 0.25 : 0.09) + index * 0.25) % 1));
    });
    renderer.render(scene, camera);
  }
  function animate(now: number) {
    frame = 0;
    if (disposed || document.hidden || reduced()) return;
    if (previousTime) time += Math.min((now - previousTime) / 1000, 0.05);
    previousTime = now;
    draw();
    frame = requestAnimationFrame(animate);
  }
  function syncAnimation() {
    cancelAnimationFrame(frame); frame = 0; previousTime = 0;
    if (reduced()) time = 0;
    draw();
    if (!document.hidden && !reduced()) frame = requestAnimationFrame(animate);
  }
  function resize() {
    const width = host.clientWidth; const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.left = -width / 2; camera.right = width / 2;
    camera.top = height / 2; camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
    scale = Math.min(width * 0.34, height * 0.42, 185);
    connections.forEach((connection, index) => {
      const x = index % 2 ? 1 : -1; const y = index < 2 ? 1 : -1;
      connection.curve = new THREE.CubicBezierCurve3(
        new THREE.Vector3(x * scale * 0.85, y * scale * 0.42, -80),
        new THREE.Vector3(x * width * 0.29, y * scale * 0.7, -60),
        new THREE.Vector3(x * width * 0.28, y * (height / 2 - 8), 0),
        new THREE.Vector3(x * (width / 2 - 8), y * (height / 2 - 8), 0),
      );
      connection.line.geometry.setFromPoints(connection.curve.getPoints(60));
    });
    draw();
  }
  function update(next: Options) {
    options = next;
    const dark = options.theme === 'dark';
    lineMaterial.color.set(dark ? '#a1c9ae' : '#729a85');
    signalMaterial.color.set(dark ? '#dbf1bd' : '#558768');
    syncAnimation();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  document.addEventListener('visibilitychange', syncAnimation);
  motionPreference.addEventListener('change', syncAnimation);
  const contextLost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frame); };
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  renderer.domElement.addEventListener('webglcontextrestored', syncAnimation);
  resize(); update(initial);
  const request = new AbortController();
  void fetch('/assets/anatomical-brain.glb', { signal: request.signal })
    .then((response) => {
      if (!response.ok) throw new Error('Brain model unavailable');
      return response.arrayBuffer();
    })
    .then((buffer) => new GLTFLoader().parseAsync(buffer, ''))
    .then(({ scene: model }) => {
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const modelMaterials = Array.isArray(object.material) ? object.material : [object.material];
        if (disposed) {
          object.geometry.dispose();
          modelMaterials.forEach((material) => material.dispose());
        } else {
          keepGeometry(object.geometry);
          modelMaterials.forEach(keepMaterial);
        }
      });
      if (disposed) return;
      brain.add(model);
      draw();
      onReady();
    }).catch(() => { /* Keep the static fallback if loading or WebGL fails. */ });
  return { update, dispose() {
    disposed = true;
    request.abort();
    cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener('visibilitychange', syncAnimation);
    motionPreference.removeEventListener('change', syncAnimation);
    renderer.domElement.removeEventListener('webglcontextlost', contextLost);
    renderer.domElement.removeEventListener('webglcontextrestored', syncAnimation);
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    renderer.dispose();
    renderer.domElement.remove();
  } };
}
