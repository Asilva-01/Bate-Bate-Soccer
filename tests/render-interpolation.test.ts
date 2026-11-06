import { expect, test } from 'vitest';
import { createPose, interpolatePose, yawFromQuaternion } from '../src/game/render-interpolation.ts';

const poseAt = (x: number, yaw: number) => {
  const pose = createPose();
  pose.set([x, 1, -2, 0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);
  return pose;
};

test('interpolatePose: alpha 0 devolve a pose anterior e 1 a atual', () => {
  const previous = poseAt(0, 0);
  const current = poseAt(10, 1);
  expect([...interpolatePose(previous, current, 0)]).toEqual([...previous]);
  const end = interpolatePose(previous, current, 1);
  current.forEach((value, index) => expect(end[index]).toBeCloseTo(value, 6));
});

test('interpolatePose: 0,5 é o ponto médio e o quaternion sai normalizado', () => {
  const middle = interpolatePose(poseAt(0, 0), poseAt(10, 1), 0.5);
  expect(middle[0]).toBeCloseTo(5, 6);
  expect(middle[1]).toBeCloseTo(1, 6);
  expect(Math.hypot(middle[3], middle[4], middle[5], middle[6])).toBeCloseTo(1, 6);
  expect(yawFromQuaternion(middle[4], middle[6])).toBeCloseTo(0.5, 5);
});

test('interpolatePose: pega o caminho curto entre quaternions opostos', () => {
  const previous = poseAt(0, 3);
  const current = poseAt(0, -3);
  const middle = interpolatePose(previous, current, 0.5);
  expect(Math.abs(Math.cos(yawFromQuaternion(middle[4], middle[6])))).toBeCloseTo(1, 4);
  expect(Math.hypot(middle[3], middle[4], middle[5], middle[6])).toBeCloseTo(1, 6);
});

test('yawFromQuaternion funciona acima de 90°, onde Euler XYZ falharia', () => {
  const yaw = 2.6;
  expect(yawFromQuaternion(Math.sin(yaw / 2), Math.cos(yaw / 2))).toBeCloseTo(yaw, 6);
});
