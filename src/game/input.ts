import { KEYBOARD } from './config';

export type ControlFrame = {
  throttle: number;
  steer: number;
  kickPresses: number;
};

export function createControlFrame(): ControlFrame {
  return { throttle: 0, steer: 0, kickPresses: 0 };
}

const THROTTLE_KEYS = { forward: ['KeyW', 'ArrowUp'], reverse: ['KeyS', 'ArrowDown'] } as const;
const STEER_KEYS = { left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] } as const;
const MOVEMENT_KEYS = new Set<string>([...THROTTLE_KEYS.forward, ...THROTTLE_KEYS.reverse, ...STEER_KEYS.left, ...STEER_KEYS.right]);
const KICK_KEYS = new Set(['Space', 'KeyK']);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const anyPressed = (pressed: ReadonlySet<string>, codes: readonly string[]) => codes.some((code) => pressed.has(code));

export function rampAxis(current: number, target: number, ratePerSecond: number, dt: number): number {
  const step = ratePerSecond * dt;
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

export function keyboardTarget(pressed: ReadonlySet<string>): { throttle: number; steer: number } {
  return {
    throttle: Number(anyPressed(pressed, THROTTLE_KEYS.forward)) - Number(anyPressed(pressed, THROTTLE_KEYS.reverse)),
    steer: Number(anyPressed(pressed, STEER_KEYS.right)) - Number(anyPressed(pressed, STEER_KEYS.left)),
  };
}

export function createKeyboardInput(isPlaying: () => boolean) {
  const pressed = new Set<string>();
  let throttle = 0;
  let steer = 0;
  let kickPresses = 0;
  const keydown = (event: KeyboardEvent) => {
    if (!isPlaying() || event.altKey || event.ctrlKey || event.metaKey) return;
    if (KICK_KEYS.has(event.code)) {
      if (event.repeat) return;
      event.preventDefault();
      kickPresses += 1;
      return;
    }
    if (!MOVEMENT_KEYS.has(event.code)) return;
    event.preventDefault();
    pressed.add(event.code);
  };
  const keyup = (event: KeyboardEvent) => {
    if (KICK_KEYS.has(event.code) && isPlaying()) event.preventDefault();
    pressed.delete(event.code);
  };
  const clear = () => {
    pressed.clear();
    throttle = 0;
    steer = 0;
  };
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', clear);
  return {
    /** Soma teclado (com rampa) e toque. Com `dt` 0 apenas lê, sem avançar a rampa. */
    read(input: ControlFrame, dt = 0): ControlFrame {
      const target = keyboardTarget(pressed);
      throttle = rampAxis(throttle, target.throttle, KEYBOARD.throttleRampPerSecond, dt);
      steer = rampAxis(steer, target.steer, KEYBOARD.steerRampPerSecond, dt);
      return {
        throttle: clamp(input.throttle + throttle, -1, 1),
        steer: clamp(input.steer + steer, -1, 1),
        kickPresses: input.kickPresses + kickPresses,
      };
    },
    clear,
    dispose() {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', clear);
      clear();
    },
  };
}
