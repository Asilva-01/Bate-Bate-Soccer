import { GAMEPAD, KEYBOARD } from './config';
import { clamp } from './math';

export type ControlFrame = {
  throttle: number;
  steer: number;
  boost: boolean;
  kickPresses: number;
  ballCamToggles: number;
  pausePresses: number;
};

export function createControlFrame(): ControlFrame {
  return { throttle: 0, steer: 0, boost: false, kickPresses: 0, ballCamToggles: 0, pausePresses: 0 };
}

const THROTTLE_KEYS = { forward: ['KeyW', 'ArrowUp'], reverse: ['KeyS', 'ArrowDown'] } as const;
const STEER_KEYS = { left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] } as const;
const MOVEMENT_KEYS = new Set<string>([...THROTTLE_KEYS.forward, ...THROTTLE_KEYS.reverse, ...STEER_KEYS.left, ...STEER_KEYS.right]);
const KICK_KEYS = new Set(['Space', 'KeyK']);
const BOOST_KEYS = new Set(['ShiftLeft', 'ShiftRight', 'KeyL']);

const anyPressed = (pressed: ReadonlySet<string>, codes: readonly string[]) => codes.some((code) => pressed.has(code));

export function rampAxis(current: number, target: number, ratePerSecond: number, dt: number): number {
  const step = ratePerSecond * dt;
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

export function keyboardTarget(pressed: ReadonlySet<string>): { throttle: number; steer: number; boost: boolean } {
  return {
    throttle: Number(anyPressed(pressed, THROTTLE_KEYS.forward)) - Number(anyPressed(pressed, THROTTLE_KEYS.reverse)),
    steer: Number(anyPressed(pressed, STEER_KEYS.right)) - Number(anyPressed(pressed, STEER_KEYS.left)),
    boost: anyPressed(pressed, [...BOOST_KEYS]),
  };
}

export function applyGamepadDeadzone(value: number, deadzone = GAMEPAD.deadzone): number {
  if (Math.abs(value) <= deadzone) return 0;
  return Math.sign(value) * (Math.abs(value) - deadzone) / (1 - deadzone);
}

export type GamepadSnapshot = {
  throttle: number;
  steer: number;
  boost: boolean;
  kick: boolean;
  ballCam: boolean;
  pause: boolean;
};

export function readGamepadMapping(pad: Pick<Gamepad, 'axes' | 'buttons'> | null, deadzone = GAMEPAD.deadzone): GamepadSnapshot {
  if (!pad) return { throttle: 0, steer: 0, boost: false, kick: false, ballCam: false, pause: false };
  const button = (index: number) => pad.buttons[index]?.value ?? 0;
  const pressed = (index: number) => pad.buttons[index]?.pressed ?? button(index) > 0.5;
  const throttle = clamp(button(7) - button(6), -1, 1);
  const steer = applyGamepadDeadzone(pad.axes[0] ?? 0, deadzone);
  return {
    throttle,
    steer,
    boost: pressed(1) || pressed(2),
    kick: pressed(0),
    ballCam: pressed(3),
    pause: pressed(9),
  };
}

function firstGamepad(): Gamepad | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  const pads = navigator.getGamepads();
  for (const pad of pads) if (pad) return pad;
  return null;
}

export function createKeyboardInput(isPlaying: () => boolean) {
  const pressed = new Set<string>();
  let throttle = 0;
  let steer = 0;
  let kickPresses = 0;
  let previousKick = false;
  const keydown = (event: KeyboardEvent) => {
    if (!isPlaying() || event.altKey || event.ctrlKey || event.metaKey) return;
    if (KICK_KEYS.has(event.code)) {
      if (event.repeat) return;
      event.preventDefault();
      kickPresses += 1;
      return;
    }
    if (BOOST_KEYS.has(event.code)) {
      event.preventDefault();
      pressed.add(event.code);
      return;
    }
    if (!MOVEMENT_KEYS.has(event.code)) return;
    event.preventDefault();
    pressed.add(event.code);
  };
  const keyup = (event: KeyboardEvent) => {
    if ((KICK_KEYS.has(event.code) || BOOST_KEYS.has(event.code)) && isPlaying()) event.preventDefault();
    pressed.delete(event.code);
  };
  const clear = () => {
    pressed.clear();
    throttle = 0;
    steer = 0;
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', clear);
  }
  return {
    /** Soma toque, teclado (com rampa) e gamepad. Com `dt` 0 apenas lê, sem avançar a rampa. */
    read(input: ControlFrame, dt = 0): ControlFrame {
      const target = keyboardTarget(pressed);
      const pad = readGamepadMapping(firstGamepad());
      throttle = rampAxis(throttle, target.throttle, KEYBOARD.throttleRampPerSecond, dt);
      steer = rampAxis(steer, target.steer, KEYBOARD.steerRampPerSecond, dt);
      if (pad.kick && !previousKick) kickPresses += 1;
      previousKick = pad.kick;
      return {
        throttle: clamp(input.throttle + throttle + pad.throttle, -1, 1),
        steer: clamp(input.steer + steer + pad.steer, -1, 1),
        boost: input.boost || target.boost || pad.boost,
        kickPresses: input.kickPresses + kickPresses,
        ballCamToggles: input.ballCamToggles,
        pausePresses: input.pausePresses,
      };
    },
    clear,
    dispose() {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', keydown);
        window.removeEventListener('keyup', keyup);
        window.removeEventListener('blur', clear);
      }
      clear();
    },
  };
}
