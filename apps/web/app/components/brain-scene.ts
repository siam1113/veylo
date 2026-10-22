import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

type Options = { listening: boolean; reduceMotion: boolean; theme: 'light' | 'dark' };
export type BrainScene = { update(options: Options): void; dispose(): void };

/** Soft radial-gradient dot used as every signal sprite's glow, generated once (no asset to ship). */
function createGlowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** Fades a traveling pulse in near its start and out near its end, so it reads as a signal
 * firing and arriving rather than a dot looping in place. */
function pulseEnvelope(t: number): number {
  const fadeIn = Math.min(1, t / 0.1);
  const fadeOut = Math.min(1, (1 - t) / 0.16);
  return Math.max(0, Math.min(fadeIn, fadeOut));
}

/** An even spiral of points on a unit sphere — the "neuron" junctions the signal network connects. */
function fibonacciSpherePoint(i: number, n: number, radius: number): THREE.Vector3 {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const y = n <= 1 ? 0 : 1 - (i / (n - 1)) * 2;
  const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = goldenAngle * i;
  return new THREE.Vector3(Math.cos(theta) * radiusAtY, y, Math.sin(theta) * radiusAtY).multiplyScalar(radius);
}

/** A cubic arc between two surface points that bulges outward, so axons hug the cortex instead
 * of cutting straight through it. */
function buildArcCurve(a: THREE.Vector3, b: THREE.Vector3, bulge: number): THREE.CubicBezierCurve3 {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const outward = mid.lengthSq() > 0.0001 ? mid.clone().normalize() : new THREE.Vector3(0, 1, 0);
  const control = mid.clone().addScaledVector(outward, bulge);
  return new THREE.CubicBezierCurve3(a, a.clone().lerp(control, 0.5), b.clone().lerp(control, 0.5), b);
}

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
  const textures: THREE.Texture[] = [];
  const keepGeometry = <T extends THREE.BufferGeometry>(geometry: T) => { geometries.push(geometry); return geometry; };
  const keepMaterial = <T extends THREE.Material>(material: T) => { materials.push(material); return material; };
  scene.add(new THREE.HemisphereLight('#fff4ee', '#59434e', 1.25));
  const keyLight = new THREE.DirectionalLight('#fff6ef', 2.8);
  keyLight.position.set(-200, 300, 450);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight('#ffd5c5', 1.6);
  rimLight.position.set(200, 100, -100);
  scene.add(rimLight);

  // A small neural network wraps the brain itself — junction nodes on its surface, linked by
  // real 3D tube "axons" — instead of lines radiating out to the screen's four corners. Everything
  // here is parented to `brain`, so it rotates and breathes together with the model, not floating
  // independently over it. Coordinates are in the brain's own local space (its loaded geometry is
  // roughly unit-radius; `brain.scale` below blows the whole group up to on-screen size).
  const nodeCount = 6;
  const nodePositions = Array.from({ length: nodeCount }, (_, i) => fibonacciSpherePoint(i, nodeCount, 1.18));
  const nodeGeometry = keepGeometry(new THREE.SphereGeometry(0.045, 12, 12));
  const nodeMaterials: THREE.MeshBasicMaterial[] = [];
  nodePositions.forEach((position) => {
    const material = keepMaterial(new THREE.MeshBasicMaterial({ color: '#0a78f5', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    nodeMaterials.push(material);
    const mesh = new THREE.Mesh(nodeGeometry, material);
    mesh.position.copy(position);
    brain.add(mesh);
  });

  const axonMaterial = keepMaterial(new THREE.MeshBasicMaterial({ color: '#72859a', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  const glowTexture = (() => { const texture = createGlowTexture(); textures.push(texture); return texture; })();
  // Each axon carries two independently-phased pulse "trains" — a bright lead sprite plus two
  // fading echoes — so signals read as discrete impulses firing between neurons rather than one
  // dot orbiting forever.
  const pulseOffsets = [0, -0.05, -0.1];
  const pulseBaseScales = [1, 0.68, 0.42];
  const pulseBaseOpacities = [1, 0.55, 0.26];
  const trainPhases = [0, 0.5];
  const signalSprites: THREE.SpriteMaterial[] = [];
  const connections = Array.from({ length: nodeCount }, (_, i) => {
    const a = nodePositions[i]!;
    const b = nodePositions[(i + 1) % nodeCount]!;
    const curve = buildArcCurve(a, b, 0.42);
    const axonGeometry = keepGeometry(new THREE.TubeGeometry(curve, 48, 0.014, 6, false));
    const axon = new THREE.Mesh(axonGeometry, axonMaterial);
    brain.add(axon);
    const trains = trainPhases.map((phase) => ({
      phase,
      pulses: pulseOffsets.map((_, pi) => {
        const material = keepMaterial(new THREE.SpriteMaterial({ map: glowTexture, color: '#0a78f5', transparent: true, opacity: pulseBaseOpacities[pi], depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
        signalSprites.push(material);
        const sprite = new THREE.Sprite(material);
        brain.add(sprite);
        return { sprite, material, isLead: pi === 0 };
      }),
    }));
    return { trains, curve };
  });

  let options = initial;
  let wasListening = false;
  let scale = 100;
  let frame = 0;
  let time = 0;
  let previousTime = 0;
  let energy = 0;
  let micLevel = 0;
  let micTreble = 0;
  let disposed = false;
  const whiteColor = new THREE.Color('#ffffff');
  const baseSignalColor = new THREE.Color('#0a78f5');
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => options.reduceMotion || motionPreference.matches;

  // Voice-reactive pumping: SpeechRecognition never exposes raw audio, so a second mic tap
  // feeds a WebAudio analyser purely for amplitude/brightness — never recorded, never sent anywhere.
  // Processing (echo cancellation / noise suppression / AGC) is disabled on this tap so the
  // browser doesn't duck or flatten it just because SpeechRecognition already holds the mic.
  let audioContext: AudioContext | null = null;
  let analyserNode: AnalyserNode | null = null;
  let micStream: MediaStream | null = null;
  let micSource: MediaStreamAudioSourceNode | null = null;
  let timeData: Uint8Array<ArrayBuffer> | null = null;
  let freqData: Uint8Array<ArrayBuffer> | null = null;

  async function startMic() {
    if (micStream || disposed) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (disposed || !options.listening) { stream.getTracks().forEach((track) => track.stop()); return; }
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) { stream.getTracks().forEach((track) => track.stop()); return; }
      audioContext ??= new Context();
      if (audioContext.state === 'suspended') await audioContext.resume();
      if (!analyserNode) { analyserNode = audioContext.createAnalyser(); analyserNode.fftSize = 256; analyserNode.smoothingTimeConstant = 0.6; }
      micStream = stream;
      micSource = audioContext.createMediaStreamSource(stream);
      micSource.connect(analyserNode);
      timeData = new Uint8Array(new ArrayBuffer(analyserNode.fftSize));
      freqData = new Uint8Array(new ArrayBuffer(analyserNode.frequencyBinCount));
    } catch { /* Volume-reactive pumping is a bonus; the base animation still works without it. */ }
  }
  function stopMic() {
    micSource?.disconnect();
    micSource = null;
    micStream?.getTracks().forEach((track) => track.stop());
    micStream = null;
    timeData = null; freqData = null;
  }
  function sampleMic() {
    if (!analyserNode || !timeData || !freqData) return { level: 0, treble: 0 };
    try {
      analyserNode.getByteTimeDomainData(timeData);
      let sumSquares = 0;
      for (let i = 0; i < timeData.length; i++) { const v = (timeData[i]! - 128) / 128; sumSquares += v * v; }
      const level = Math.min(1, Math.sqrt(sumSquares / timeData.length) * 4.5);
      analyserNode.getByteFrequencyData(freqData);
      const start = Math.floor(freqData.length * 0.5);
      let trebleSum = 0;
      for (let i = start; i < freqData.length; i++) trebleSum += freqData[i]!;
      const treble = Math.min(1, (trebleSum / ((freqData.length - start) * 255)) * 2.2);
      return { level, treble };
    } catch { return { level: 0, treble: 0 }; }
  }

  function draw() {
    const drift = time * 0.015;
    const swayAmpY = 0.18 + energy * 0.08; const swayFreqY = 0.28 + energy * 0.06; const swayAmpX = 0.035 + energy * 0.015;
    brain.rotation.set(0.24 + Math.sin(time * 0.22) * swayAmpX, -0.85 + Math.sin(time * swayFreqY) * swayAmpY + drift, -0.06);
    const voicePump = energy * micLevel;
    const breathe = Math.sin(time * (0.8 + energy * 1.1)) * (0.008 + energy * 0.009) + voicePump * 0.11;
    brain.scale.setScalar(scale * (1 + breathe));
    axonMaterial.opacity = 0.5 + micLevel * 0.3;
    // Idle pulses still drift slowly; a strong, mic-independent jump while listening guarantees
    // visible speed-up even if the volume tap is unavailable, plus extra proportional kick from
    // actual loudness on top.
    const speed = 0.35 + energy * 0.85 + micLevel * 0.7;
    connections.forEach(({ trains, curve }, index) => {
      trains.forEach(({ phase, pulses }) => {
        const base = (time * speed + index * 0.18 + phase) % 1;
        pulses.forEach(({ sprite, material, isLead }, i) => {
          const t = ((base + pulseOffsets[i]!) % 1 + 1) % 1;
          sprite.position.copy(curve.getPoint(t));
          const envelope = pulseEnvelope(t);
          const twinkle = 1 + Math.sin(time * 7 + index * 1.4 + i) * (0.12 + micTreble * 0.2);
          const size = 0.1 * pulseBaseScales[i]! * twinkle * (1 + micLevel * 0.35);
          sprite.scale.set(size, size, 1);
          material.opacity = pulseBaseOpacities[i]! * envelope * (0.65 + micLevel * 0.45) * (0.5 + energy * 0.5);
          if (isLead) material.color.copy(baseSignalColor).lerp(whiteColor, 0.2 + micLevel * 0.6);
        });
      });
    });
    renderer.render(scene, camera);
  }
  function animate(now: number) {
    frame = 0;
    if (disposed || document.hidden || reduced()) return;
    if (previousTime) {
      const dt = Math.max(0, Math.min((now - previousTime) / 1000, 0.05));
      time += dt;
      energy += ((options.listening ? 1 : 0) - energy) * Math.min(dt * 3, 1);
      const sample = sampleMic();
      micLevel += (sample.level - micLevel) * Math.min(dt * 6, 1);
      micTreble += (sample.treble - micTreble) * Math.min(dt * 6, 1);
    }
    previousTime = now;
    draw();
    frame = requestAnimationFrame(animate);
  }
  function syncAnimation() {
    cancelAnimationFrame(frame); frame = 0; previousTime = 0;
    if (reduced()) { time = 0; energy = options.listening ? 1 : 0; micLevel = 0; micTreble = 0; }
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
    scale = Math.min(width * 0.27, height * 0.34, 150);
    draw();
  }
  function update(next: Options) {
    options = next;
    const dark = options.theme === 'dark';
    axonMaterial.color.set(dark ? '#a1b4c9' : '#72859a');
    const signalColor = dark ? '#9dc9fb' : '#0a78f5';
    baseSignalColor.set(signalColor);
    signalSprites.forEach((material) => material.color.set(signalColor));
    nodeMaterials.forEach((material) => material.color.set(signalColor));
    if (options.listening && !wasListening) void startMic();
    else if (!options.listening && wasListening) stopMic();
    wasListening = options.listening;
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
    stopMic();
    void audioContext?.close().catch(() => {});
    request.abort();
    cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener('visibilitychange', syncAnimation);
    motionPreference.removeEventListener('change', syncAnimation);
    renderer.domElement.removeEventListener('webglcontextlost', contextLost);
    renderer.domElement.removeEventListener('webglcontextrestored', syncAnimation);
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
    renderer.dispose();
    renderer.domElement.remove();
  } };
}
