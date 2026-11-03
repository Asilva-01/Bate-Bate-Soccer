import { FIELD, STUCK } from './config';

export function createStuckMonitor() {
  let anchor: { x: number; z: number } | undefined;
  let elapsed = 0;
  return {
    reset() { anchor = undefined; elapsed = 0; },
    update(x: number, z: number, delta: number) {
      const nearBoundary = Math.abs(x) > FIELD.halfWidth - STUCK.edgeMarginX || Math.abs(z) > FIELD.halfLength - STUCK.edgeMarginZ;
      if (!nearBoundary) { anchor = undefined; elapsed = 0; return false; }
      if (!anchor || Math.hypot(x - anchor.x, z - anchor.z) > STUCK.movementResetDistance) {
        anchor = { x, z }; elapsed = 0;
      }
      elapsed += delta;
      if (elapsed < STUCK.timeoutSeconds) return false;
      anchor = undefined; elapsed = 0;
      return true;
    },
  };
}
