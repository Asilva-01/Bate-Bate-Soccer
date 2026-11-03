export type DriveInput = { forward: boolean; reverse: boolean; left: boolean; right: boolean };

const KEY_ACTIONS: Record<string, keyof DriveInput> = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'reverse', ArrowDown: 'reverse',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};

export function createKeyboardInput(isPlaying: () => boolean) {
  const pressed = new Set<string>();
  const keydown = (event: KeyboardEvent) => {
    if (!isPlaying() || !KEY_ACTIONS[event.code] || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    pressed.add(event.code);
  };
  const keyup = (event: KeyboardEvent) => pressed.delete(event.code);
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
