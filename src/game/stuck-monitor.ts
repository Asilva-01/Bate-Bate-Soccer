import { STUCK } from './config';
import { createArenaDimensions, type ArenaDimensions } from './arena-dimensions';

export type PinchCar = { x: number; z: number; team: 'red' | 'blue' };

export function createStuckMonitor(dims: ArenaDimensions = createArenaDimensions()) {
  let anchor: { x: number; z: number } | undefined;
  let elapsed = 0;
  let pinchElapsed = 0;
  return {
    reset() {
      anchor = undefined;
      elapsed = 0;
      pinchElapsed = 0;
    },
    update(x: number, z: number, delta: number) {
      const nearBoundary = Math.abs(x) > dims.goalLineX - STUCK.edgeMarginX
        || Math.abs(z) > dims.sideWallZ - STUCK.edgeMarginZ;
      if (!nearBoundary) {
        anchor = undefined;
        elapsed = 0;
        return false;
      }
      if (!anchor || Math.hypot(x - anchor.x, z - anchor.z) > STUCK.movementResetDistance) {
        anchor = { x, z };
        elapsed = 0;
      }
      elapsed += delta;
      if (elapsed < STUCK.timeoutSeconds) return false;
      anchor = undefined;
      elapsed = 0;
      return true;
    },
    updatePinch(ball: { x: number; z: number; speed: number }, cars: readonly PinchCar[], delta: number) {
      const slow = ball.speed < STUCK.pinchSpeed;
      const redNear = cars.some((car) => car.team === 'red' && Math.hypot(car.x - ball.x, car.z - ball.z) < STUCK.pinchDistance);
      const blueNear = cars.some((car) => car.team === 'blue' && Math.hypot(car.x - ball.x, car.z - ball.z) < STUCK.pinchDistance);
      if (!(slow && redNear && blueNear)) {
        pinchElapsed = 0;
        return false;
      }
      pinchElapsed += delta;
      if (pinchElapsed < STUCK.pinchSeconds) return false;
      pinchElapsed = 0;
      return true;
    },
  };
}
