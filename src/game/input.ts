export type DriveInput = {
  forward: boolean;
  reverse: boolean;
  left: boolean;
  right: boolean;
  kick: boolean;
  kickPresses: number;
};

const KEY_ACTIONS: Record<string, keyof Pick<DriveInput, 'forward' | 'reverse' | 'left' | 'right'>> = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'reverse', ArrowDown: 'reverse',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};

const KICK_KEYS = new Set(['Space', 'KeyK']);

export function createKeyboardInput(isPlaying: () => boolean) {
  const pressed = new Set<string>();
  let kickPresses = 0;
  const keydown = (event: KeyboardEvent) => {
    if (!isPlaying() || event.altKey || event.ctrlKey || event.metaKey) return;
    if (KICK_KEYS.has(event.code)) {
      if (event.repeat) return;
      event.preventDefault();
      kickPresses += 1;
      return;
    }
    if (!KEY_ACTIONS[event.code]) return;
    event.preventDefault();
    pressed.add(event.code);
  };
  const keyup = (event: KeyboardEvent) => {
    if (KICK_KEYS.has(event.code) && isPlaying()) event.preventDefault();
    pressed.delete(event.code);
  };
  const clear = () => pressed.clear();
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', clear);
  return {
    read(input: DriveInput): DriveInput {
      return {
        forward: input.forward || pressed.has('KeyW') || pressed.has('ArrowUp'),
        reverse: input.reverse || pressed.has('KeyS') || pressed.has('ArrowDown'),
        left: input.left || pressed.has('KeyA') || pressed.has('ArrowLeft'),
        right: input.right || pressed.has('KeyD') || pressed.has('ArrowRight'),
        kick: input.kick,
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
