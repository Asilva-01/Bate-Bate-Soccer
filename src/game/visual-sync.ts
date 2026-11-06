import { interpolatePose, type Pose } from './render-interpolation';

/** Objeto visual com a superfície que o runtime precisa — Three.js satisfaz sem o runtime importar Three. */
export type VisualObject = {
  position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
  quaternion: { set(x: number, y: number, z: number, w: number): void };
  rotation: { y: number };
  visible: boolean;
};

export function syncVisuals(
  ball: VisualObject,
  cars: VisualObject[],
  previous: Pose[],
  current: Pose[],
  interpolated: Pose,
  alpha: number,
  carHeight: number,
) {
  interpolatePose(previous[0], current[0], alpha, interpolated);
  ball.position.set(interpolated[0], interpolated[1], interpolated[2]);
  ball.quaternion.set(interpolated[3], interpolated[4], interpolated[5], interpolated[6]);
  for (let index = 0; index < cars.length; index++) {
    interpolatePose(previous[index + 1], current[index + 1], alpha, interpolated);
    cars[index].position.set(interpolated[0], interpolated[1] - carHeight, interpolated[2]);
    cars[index].quaternion.set(interpolated[3], interpolated[4], interpolated[5], interpolated[6]);
  }
}
