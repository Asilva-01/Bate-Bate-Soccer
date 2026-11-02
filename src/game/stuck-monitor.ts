import { GAME_CONFIG } from './game-config';

export function createStuckMonitor() {
  let anchor: { x: number; z: number } | undefined;
  let elapsed = 0;
  return {
    reset() { anchor = undefined; elapsed = 0; },
    update(x: number, z: number, delta: number) {
      const nearBoundary = Math.abs(x) > GAME_CONFIG.arena.halfWidth - 6 || Math.abs(z) > GAME_CONFIG.arena.halfLength - 4;
      if (!nearBoundary) { anchor = undefined; elapsed = 0; return false; }
      if (!anchor || Math.hypot(x - anchor.x, z - anchor.z) > 3) {
        anchor = { x, z }; elapsed = 0;
      }
      elapsed += delta;
      if (elapsed < 4) return false;
      anchor = undefined; elapsed = 0;
      return true;
    },
  };
}
