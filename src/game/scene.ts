import * as THREE from 'three';
import { createArena } from './arena';
import { createBall, createCar } from './objects';
import { createPhysics, type ControlFrame, type MatchState, type KickEvent } from './physics';
import type { Difficulty } from './match-rules';
import { CAMERA, DEBUG, FIELD, RENDER } from './config';
import { isInKickZone } from './kick';
import { createChaseRig, offscreenIndicator, stepChaseCamera, type CameraPreset, type CameraStep, type CameraTarget, type IndicatorPosition, type ScreenInsets } from './chase-camera';
import { yawFromQuaternion } from './render-interpolation';
import { createPerfMonitor } from './perf-monitor';

export type BallIndicator = IndicatorPosition & { distance: number };
export type GameControls = {
  cameraPreset: CameraPreset;
  running: boolean;
  restart: () => void;
  resetTiming: () => void;
  sound: (kind: 'hit' | 'goal' | 'kick') => void;
  indicator: (state: BallIndicator | null) => void;
};

function readSafeInsets(probe: HTMLElement): ScreenInsets {
  const style = getComputedStyle(probe);
  return { top: parseFloat(style.paddingTop) || 0, right: parseFloat(style.paddingRight) || 0, bottom: parseFloat(style.paddingBottom) || 0, left: parseFloat(style.paddingLeft) || 0 };
}

export async function createScene(container: HTMLElement, input: ControlFrame, controls: GameControls, onState: (state: MatchState) => void, difficulty: Difficulty, round: number) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x101b2b);
  const camera = new THREE.PerspectiveCamera(60, 1, CAMERA.near, CAMERA.far);
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pixelRatio = Math.min(window.devicePixelRatio, coarsePointer ? RENDER.pixelRatioCoarse : RENDER.pixelRatioFine);
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(pixelRatio); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; container.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xa8dfff, 0x1d1420, 2)); const main = new THREE.DirectionalLight(0xffffff, 2.3); main.position.set(4, 18, 8); scene.add(main);
  const blue = new THREE.PointLight(0x00bfff, 100, 24); blue.position.set(-12, 5, -5); scene.add(blue); const red = new THREE.PointLight(0xff2856, 100, 24); red.position.set(12, 5, 5); scene.add(red);
  const arena = createArena(); arena.scale.set(FIELD.scaleX, 1, FIELD.scaleZ); scene.add(arena); const ball = createBall(); scene.add(ball);
  const cars = [[0xf43c4b, '01', -18, 0, -Math.PI / 2], [0x148fff, '02', 18, 0, Math.PI / 2], [0xff8b5b, '03', -18, 9, -Math.PI / 2], [0x45b6e5, '04', 18, -9, Math.PI / 2], [0x1978c7, '05', 18, 9, Math.PI / 2], [0x7abde5, '06', 24, 0, Math.PI / 2]] as const;
  const carModels = cars.map(([color, number, x, z, rotation]) => { const car = createCar(color, number); car.position.set(x, 0, z); car.rotation.y = rotation; scene.add(car); return car; });
  let previousRed = 0;
  let previousBlue = 0;
  let goalCelebrationAge = 1;
  const celebrationMaterial = new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const goalCelebration = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 8, 48), celebrationMaterial);
  goalCelebration.rotation.y = Math.PI / 2;
  goalCelebration.visible = false;
  scene.add(goalCelebration);
  const physics = await createPhysics(ball, carModels, input, (state) => {
    if (state.red > previousRed || state.blue > previousBlue) {
      controls.sound('goal');
      const scoringSide = state.red > previousRed ? 1 : -1;
      goalCelebration.position.set(scoringSide * (FIELD.goalLineX + FIELD.celebrationXOffset), FIELD.goalHeight / 2, 0);
      goalCelebrationAge = 0;
      goalCelebration.visible = true;
    }
    previousRed = state.red;
    previousBlue = state.blue;
    onState(state);
  }, difficulty, round, () => controls.running);
  let previous = performance.now();
  let skipNextDelta = false;
  const resetTiming = () => {
    previous = performance.now();
    skipNextDelta = true;
    physics.resetAccumulator();
  };
  controls.resetTiming = resetTiming;
  const restart = () => { previousRed = 0; previousBlue = 0; goalCelebrationAge = 1; goalCelebration.visible = false; physics.restart(); };
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
  const kickRings = Array.from({ length: 4 }, () => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.65, 0.82, 32), new THREE.MeshBasicMaterial({ color: 0xff8b5b, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    scene.add(ring);
    return { ring, age: 1, power: 1 };
  });
  let nextKickRing = 0;
  const kick = (event: KickEvent) => {
    controls.sound('kick');
    if (event.isPlayer && typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(12);
    const impact = kickRings[nextKickRing++ % kickRings.length];
    impact.ring.position.set(event.position.x, 0.14, event.position.z);
    impact.age = 0;
    impact.power = event.power;
    impact.ring.visible = true;
    impact.ring.scale.setScalar(0.85);
  };
  const safeAreaProbe = document.createElement('div');
  safeAreaProbe.style.cssText = 'position:absolute;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  container.appendChild(safeAreaProbe);
  let safeInsets = readSafeInsets(safeAreaProbe);
  const resize = () => { const { clientWidth, clientHeight } = container; if (!clientWidth || !clientHeight) return; camera.aspect = clientWidth / clientHeight; renderer.setSize(clientWidth, clientHeight); safeInsets = readSafeInsets(safeAreaProbe); };
  const observer = new ResizeObserver(resize); observer.observe(container); resize(); let frame = 0;
  const playerCar = carModels[0];
  const cameraSubject: CameraTarget = { carX: 0, carY: 0, carZ: 0, carHeading: 0, carSpeed: 0, boosting: false, ballX: 0, ballY: 0, ballZ: 0 };
  const updateSubject = () => {
    cameraSubject.carX = playerCar.position.x; cameraSubject.carY = playerCar.position.y; cameraSubject.carZ = playerCar.position.z;
    cameraSubject.carHeading = yawFromQuaternion(playerCar.quaternion.y, playerCar.quaternion.w);
    cameraSubject.carSpeed = physics.playerSpeed();
    cameraSubject.ballX = ball.position.x; cameraSubject.ballY = ball.position.y; cameraSubject.ballZ = ball.position.z;
  };
  updateSubject();
  let cameraStep: CameraStep = createChaseRig(cameraSubject, camera.aspect, controls.cameraPreset);
  const projected = new THREE.Vector3();
  const insetPx = CAMERA.indicatorInsetPx;
  const debugEnabled = new URLSearchParams(window.location.search).get('debug') === '1';
  const frameMonitor = createPerfMonitor(DEBUG.frameWindow);
  const physicsMonitor = createPerfMonitor(DEBUG.frameWindow);
  const debugPanel = debugEnabled ? document.createElement('pre') : undefined;
  if (debugPanel) { debugPanel.className = 'debug-panel'; container.appendChild(debugPanel); }
  let lastDebugUpdate = 0;
  let lastFrameTime = performance.now();
  const updateDebugPanel = (now: number) => {
    if (!debugPanel || now - lastDebugUpdate < DEBUG.refreshMs) return;
    lastDebugUpdate = now;
    const { stats } = physics;
    debugPanel.textContent = [
      `FPS ${frameMonitor.averageFps().toFixed(1)} (média de ${DEBUG.frameWindow} quadros) · p95 ${frameMonitor.p95Ms().toFixed(1)} ms`,
      `draw calls ${renderer.info.render.calls} · triângulos ${renderer.info.render.triangles} · pixelRatio ${renderer.getPixelRatio().toFixed(2)}`,
      `physics.update ${physicsMonitor.averageMs().toFixed(2)} ms`,
      `rede de segurança ${stats.safetyNetActivations} · bola presa ${stats.stuckResets}`,
      `toques na bola ${stats.playerBallTouches} · chutes ao gol ${stats.playerShotsOnGoal}`,
    ].join('\n');
  };
  const animate = (now: number) => {
    const delta = skipNextDelta ? 0 : Math.min((now - previous) / 1000, 0.1);
    skipNextDelta = false;
    previous = now;
    const frameTime = performance.now();
    if (frameTime - lastFrameTime < 1000) frameMonitor.push(frameTime - lastFrameTime);
    lastFrameTime = frameTime;
    if (controls.running) {
      physics.update(delta, hit, kick);
      physicsMonitor.push(performance.now() - frameTime);
    }
    if (goalCelebrationAge < 1) {
      goalCelebrationAge = Math.min(1, goalCelebrationAge + delta * 1.4);
      const progress = goalCelebrationAge;
      goalCelebration.scale.set(0.5 + progress * 1.4, 0.35 + progress, 1);
      celebrationMaterial.opacity = (1 - progress) * 0.9;
      if (goalCelebrationAge >= 1) goalCelebration.visible = false;
    }
    updateSubject();
    cameraStep = stepChaseCamera(cameraStep.rig, cameraSubject, delta, camera.aspect, controls.cameraPreset, { reducedMotion: reducedMotion.matches });
    const { rig, lookAt } = cameraStep;
    camera.position.set(rig.x, rig.y, rig.z);
    camera.fov = rig.fovDeg;
    camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    if (controls.running) {
      projected.copy(ball.position).applyMatrix4(camera.matrixWorldInverse);
      const behind = projected.z > 0;
      projected.applyMatrix4(camera.projectionMatrix);
      const marker = offscreenIndicator(projected, behind, { left: safeInsets.left + insetPx, right: safeInsets.right + insetPx, top: safeInsets.top + insetPx, bottom: safeInsets.bottom + insetPx }, { width: container.clientWidth, height: container.clientHeight });
      controls.indicator(marker && { ...marker, distance: Math.hypot(ball.position.x - playerCar.position.x, ball.position.z - playerCar.position.z) });
    } else controls.indicator(null);
    ballHalo.position.x = ball.position.x;
    ballHalo.position.z = ball.position.z;
    const readyToKick = isInKickZone(playerCar.position.x, playerCar.position.z, cameraSubject.carHeading, ball.position.x, ball.position.y, ball.position.z);
    ballHalo.material.color.setHex(readyToKick ? 0xffd15c : 0x69e8ff);
    ballHalo.scale.setScalar(1 + (readyToKick ? 0.14 : 0.08) * Math.sin(now * 0.006));
    for (const impact of kickRings) {
      if (!impact.ring.visible) continue;
      impact.age += delta * 2.2;
      if (impact.age >= 1) { impact.ring.visible = false; continue; }
      impact.ring.material.opacity = (1 - impact.age) * 0.85;
      impact.ring.scale.setScalar(0.85 + impact.age * 2.4 * (impact.power / 14));
    }
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
    updateDebugPanel(now);
    frame = requestAnimationFrame(animate);
  }; frame = requestAnimationFrame(animate);
  const dispose = () => { physics.dispose(); if (controls.resetTiming === resetTiming) controls.resetTiming = () => {}; cancelAnimationFrame(frame); observer.disconnect(); controls.indicator(null); safeAreaProbe.remove(); debugPanel?.remove(); scene.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(mat => { if (mat instanceof THREE.MeshBasicMaterial && mat.map) mat.map.dispose(); mat.dispose(); }); } }); renderer.dispose(); renderer.domElement.remove(); };
  return { restart, dispose };
}
