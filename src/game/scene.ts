import * as THREE from 'three';
import { createArena } from './arena';
import { createBall, createCar } from './objects';
import { createPhysics, type DriveInput, type MatchState } from './physics';
import type { Difficulty } from './match-rules';

export type GameControls = { camera: 'arena' | 'follow' | 'top'; running: boolean; restart: () => void; sound: (kind: 'hit' | 'goal') => void };

export async function createScene(container: HTMLElement, input: DriveInput, controls: GameControls, onState: (state: MatchState) => void, difficulty: Difficulty, round: number) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x101b2b);
  const camera = new THREE.OrthographicCamera(-20, 20, 12, -12, 0.1, 210); camera.position.set(0, 45, 22); camera.lookAt(0, 0, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; container.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xa8dfff, 0x1d1420, 2)); const main = new THREE.DirectionalLight(0xffffff, 2.3); main.position.set(4, 18, 8); scene.add(main);
  const blue = new THREE.PointLight(0x00bfff, 100, 24); blue.position.set(-12, 5, -5); scene.add(blue); const red = new THREE.PointLight(0xff2856, 100, 24); red.position.set(12, 5, 5); scene.add(red);
  const arena = createArena(); arena.scale.set(2.8, 1, 2.45); scene.add(arena); const ball = createBall(); scene.add(ball);
  const cars = [[0xf43c4b, '01', -18, 0, -Math.PI / 2], [0x148fff, '02', 18, 0, Math.PI / 2], [0xff8b5b, '03', -18, 9, -Math.PI / 2], [0x45b6e5, '04', 18, -9, Math.PI / 2], [0x1978c7, '05', 18, 9, Math.PI / 2], [0x7abde5, '06', 24, 0, Math.PI / 2]] as const;
  const carModels = cars.map(([color, number, x, z, rotation]) => { const car = createCar(color, number); car.position.set(x, 0, z); car.rotation.y = rotation; scene.add(car); return car; });
  let previousScore = 0;
  const physics = await createPhysics(ball, carModels, input, (state) => {
    if (state.red + state.blue > previousScore) controls.sound('goal');
    previousScore = state.red + state.blue; onState(state);
  }, difficulty, round, () => controls.running);
  const restart = () => { previousScore = 0; physics.restart(); };
  // Reuse a small pool of rings to keep collision feedback inexpensive on mobile.
  const impacts = Array.from({ length: 6 }, () => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.9, 32), new THREE.MeshBasicMaterial({ color: 0xffd15c, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    scene.add(ring);
    return { ring, age: 1, strength: 1 };
  });
  let nextImpact = 0;
  let flash = 0;
  const hit = (position: THREE.Vector3, strength: number) => {
    controls.sound('hit');
    const impact = impacts[nextImpact++ % impacts.length];
    impact.ring.position.set(position.x, 0.12, position.z);
    impact.age = 0;
    impact.strength = Math.min(1.5, 0.7 + strength / 10);
    impact.ring.visible = true;
    flash = Math.min(1, strength / 8);
  };
  const ballHalo = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.13, 40), new THREE.MeshBasicMaterial({ color: 0x69e8ff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
  ballHalo.rotation.x = -Math.PI / 2;
  ballHalo.position.y = 0.1;
  scene.add(ballHalo);
  const cameraTarget = new THREE.Vector3();
  const resize = () => { const { clientWidth, clientHeight } = container; if (!clientWidth || !clientHeight) return; const aspect = clientWidth / clientHeight; const halfHeight = Math.max(29, 48 / aspect); camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect; camera.top = halfHeight; camera.bottom = -halfHeight; camera.updateProjectionMatrix(); renderer.setSize(clientWidth, clientHeight); };
  const observer = new ResizeObserver(resize); observer.observe(container); resize(); let frame = 0;
  let previous = performance.now();
  const animate = (now: number) => {
    const delta = Math.min((now - previous) / 1000, 0.1);
    previous = now;
    if (controls.running) physics.update(delta, hit);
    // Keep a wide framing while gently following the play rather than the car.
    const blend = 1 - Math.exp(-2 * delta);
    cameraTarget.x += (THREE.MathUtils.clamp(ball.position.x * 0.08, -0.8, 0.8) - cameraTarget.x) * blend;
    cameraTarget.z += (THREE.MathUtils.clamp(ball.position.z * 0.06, -0.4, 0.4) - cameraTarget.z) * blend;
    if (controls.camera === 'follow') {
      const car = carModels[0];
      cameraTarget.lerp(car.position, blend);
      camera.position.set(cameraTarget.x, 28, cameraTarget.z + 22);
    } else if (controls.camera === 'top') {
      cameraTarget.set(0, 0, 0); camera.position.set(0, 95, 0.01);
    } else { camera.position.set(cameraTarget.x, 95, 52 + cameraTarget.z); }
    camera.lookAt(cameraTarget);
    ballHalo.position.x = ball.position.x;
    ballHalo.position.z = ball.position.z;
    ballHalo.scale.setScalar(1 + 0.08 * Math.sin(now * 0.006));
    for (const impact of impacts) {
      if (!impact.ring.visible) continue;
      impact.age += delta * 2;
      if (impact.age >= 1) { impact.ring.visible = false; continue; }
      impact.ring.scale.setScalar(1 + impact.age * 2.5 * impact.strength);
      impact.ring.material.opacity = (1 - impact.age) * 0.9;
    }
    flash = Math.max(0, flash - delta * 2.5);
    main.intensity = 2.3 + flash * 0.5;
    blue.intensity = 100 + 12 * Math.sin(now * 0.0017);
    red.intensity = 100 + 12 * Math.sin(now * 0.0017 + Math.PI);
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  }; frame = requestAnimationFrame(animate);
  const dispose = () => { physics.dispose(); cancelAnimationFrame(frame); observer.disconnect(); scene.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(mat => { if (mat instanceof THREE.MeshBasicMaterial && mat.map) mat.map.dispose(); mat.dispose(); }); } }); renderer.dispose(); renderer.domElement.remove(); };
  return { restart, dispose };
}
