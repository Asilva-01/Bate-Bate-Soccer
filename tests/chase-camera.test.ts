import { expect, test } from 'vitest';
import { CAMERA } from '../src/game/config.ts';
import {
  createChaseRig,
  offscreenIndicator,
  stepChaseCamera,
  verticalFovForAspect,
  wrapAngle,
  type CameraTarget,
} from '../src/game/chase-camera.ts';

const DEG = Math.PI / 180;
const ASPECT = 844 / 390;
const target = (overrides: Partial<CameraTarget> = {}): CameraTarget => ({
  carX: 0, carY: 0, carZ: 0, carHeading: 0, carSpeed: 0, boosting: false,
  ballX: 0, ballY: 0.96, ballZ: 120,
  ...overrides,
});
const forward = (heading: number) => ({ x: -Math.sin(heading), z: -Math.cos(heading) });

test('verticalFovForAspect: celular deitado, retrato e 16:9', () => {
  expect(verticalFovForAspect(2.164, 95, 50, 75)).toBeCloseTo(53.5, 0);
  expect(verticalFovForAspect(0.46, 95, 50, 75)).toBe(75);
  expect(verticalFovForAspect(16 / 9, 95, 50, 75)).toBeCloseTo(63, 0);
  expect(verticalFovForAspect(10, 95, 50, 75)).toBe(50);
});

test.each([
  ['perto', 0.3],
  ['alta', 2.1],
] as const)('preset %s: com o carro parado, a câmera assenta a distância e altura do preset', (preset, heading) => {
  const { distance, height } = CAMERA.presets[preset];
  const subject = target({ carX: 12, carZ: -7, carHeading: heading });
  let { rig } = createChaseRig(target({ carX: 12, carZ: -7, carHeading: heading + 1.2 }), ASPECT, preset);
  for (let i = 0; i < 120; i++) rig = stepChaseCamera(rig, subject, 1 / 60, ASPECT, preset).rig;
  const f = forward(heading);
  const behind = -((rig.x - 12) * f.x + (rig.z + 7) * f.z);
  const sideways = (rig.x - 12) * -f.z + (rig.z + 7) * f.x;
  expect(behind).toBeCloseTo(distance, 1);
  expect(Math.abs(sideways)).toBeLessThan(0.1);
  expect(rig.y).toBeCloseTo(height, 1);
});

test('preset perto tem ~10° de inclinação e o alta ~25°', () => {
  for (const [preset, expected] of [['perto', 10], ['alta', 25]] as const) {
    const { rig, lookAt } = createChaseRig(target(), ASPECT, preset);
    const horizontal = Math.hypot(lookAt.x - rig.x, lookAt.z - rig.z);
    expect(Math.atan2(rig.y - lookAt.y, horizontal) / DEG).toBeCloseTo(expected, 0);
  }
});

test('giro de 180° em 0,5 s: o atraso de yaw nunca passa de 35°', () => {
  let { rig } = createChaseRig(target(), ASPECT, 'perto');
  let worst = 0;
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    const heading = (Math.PI * i) / steps;
    rig = stepChaseCamera(rig, target({ carHeading: heading }), 1 / 60, ASPECT, 'perto').rig;
    worst = Math.max(worst, Math.abs(wrapAngle(heading - rig.yaw)));
  }
  expect(worst).toBeLessThanOrEqual(CAMERA.maxYawLagDeg * DEG + 1e-9);
  expect(worst).toBeGreaterThan(20 * DEG);
});

test('assistência de bola desvia o yaw em até 15° na direção da bola e some fora do cone', () => {
  const settle = (subject: CameraTarget) => {
    let { rig } = createChaseRig(subject, ASPECT, 'perto');
    for (let i = 0; i < 240; i++) rig = stepChaseCamera(rig, subject, 1 / 60, ASPECT, 'perto').rig;
    return rig;
  };
  const onLeft = settle(target({ ballX: -12, ballZ: -12 }));
  expect(onLeft.yaw).toBeGreaterThan(5 * DEG);
  expect(onLeft.yaw).toBeLessThanOrEqual(15 * DEG + 1e-9);
  expect(settle(target({ ballX: -12, ballZ: 12 })).yaw).toBeCloseTo(0, 6);
  expect(settle(target({ ballX: -12, ballZ: -60 })).yaw).toBeCloseTo(0, 6);
});

test('a câmera encaixa de uma vez quando o carro é teleportado', () => {
  const { rig } = createChaseRig(target(), ASPECT, 'perto');
  const next = stepChaseCamera(rig, target({ carX: 40 }), 1 / 60, ASPECT, 'perto').rig;
  expect(next.x).toBeCloseTo(40, 6);
});

test('FOV sobe no turbo e não sobe com movimento reduzido', () => {
  const run = (reducedMotion: boolean) => {
    let { rig } = createChaseRig(target(), ASPECT, 'perto') ;
    for (let i = 0; i < 120; i++) rig = stepChaseCamera(rig, target({ boosting: true }), 1 / 60, ASPECT, 'perto', { reducedMotion }).rig;
    return rig.fovDeg;
  };
  const base = verticalFovForAspect(ASPECT, CAMERA.hFovDeg, CAMERA.vFovMinDeg, CAMERA.vFovMaxDeg);
  expect(run(false)).toBeCloseTo(base + CAMERA.boostFovDeg, 1);
  expect(run(true)).toBeCloseTo(base, 6);
});

const insets = { left: 56, right: 56, top: 56, bottom: 56 };
const viewport = { width: 844, height: 390 };

test('offscreenIndicator: bola visível → null', () => {
  expect(offscreenIndicator({ x: 0.2, y: -0.1 }, false, insets, viewport)).toBeNull();
  expect(offscreenIndicator({ x: 0.9, y: 0.9 }, false, insets, viewport)).toBeNull();
});

test('offscreenIndicator: atrás → seta na borda inferior apontando para baixo', () => {
  const result = offscreenIndicator({ x: 0.05, y: 0.1 }, true, insets, viewport);
  expect(result).not.toBeNull();
  expect(result!.y).toBeGreaterThan(390 - 56 - 40);
  expect(result!.y).toBeLessThanOrEqual(390 - 56 + 1e-6);
  expect(result!.angleRad).toBeGreaterThan(60 * DEG);
  expect(result!.angleRad).toBeLessThan(120 * DEG);
});

test('offscreenIndicator: direita, esquerda e acima', () => {
  const right = offscreenIndicator({ x: 2, y: 0 }, false, insets, viewport)!;
  expect(right.angleRad).toBeCloseTo(0, 6);
  expect(right.x).toBeCloseTo(844 - 56, 6);
  expect(right.y).toBeCloseTo(195, 6);
  const left = offscreenIndicator({ x: -2, y: 0 }, false, insets, viewport)!;
  expect(Math.abs(left.angleRad)).toBeCloseTo(Math.PI, 6);
  expect(left.x).toBeCloseTo(56, 6);
  const above = offscreenIndicator({ x: 0, y: 3 }, false, insets, viewport)!;
  expect(above.angleRad).toBeCloseTo(-Math.PI / 2, 6);
  expect(above.y).toBeCloseTo(56, 6);
});

test('offscreenIndicator: sempre dentro da elipse recuada pelos insets', () => {
  for (let angle = 0; angle < 360; angle += 15) {
    const result = offscreenIndicator({ x: 3 * Math.cos(angle * DEG), y: 3 * Math.sin(angle * DEG) }, false, insets, viewport)!;
    const nx = (result.x - 422) / (422 - 56);
    const ny = (result.y - 195) / (195 - 56);
    expect(nx * nx + ny * ny).toBeCloseTo(1, 6);
  }
});
