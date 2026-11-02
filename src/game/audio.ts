export function createAudio() {
  let context: AudioContext | undefined;
  let timer: number | undefined;
  let beat = 0;
  let enabled = false;
  const notes = [220, 0, 330, 0, 277.18, 0, 330, 440, 196, 0, 293.66, 0, 246.94, 0, 293.66, 392];
  const tone = (frequency: number, duration: number, volume: number, type: OscillatorType = 'triangle') => {
    if (!context || context.state !== 'running' || !enabled) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + duration);
  };
  return {
    async toggle() {
      enabled = !enabled;
      if (enabled) {
        context ??= new AudioContext();
        await context.resume();
        timer = window.setInterval(() => {
          const note = notes[beat++ % notes.length];
          if (note) tone(note, 0.15, 0.035);
          if (beat % 4 === 1) tone(65, 0.12, 0.045, 'sine');
        }, 170);
      } else if (timer !== undefined) { window.clearInterval(timer); timer = undefined; }
      return enabled;
    },
    sound(kind: 'hit' | 'goal') {
      if (kind === 'hit') tone(110, 0.08, 0.035, 'square');
      else { tone(440, 0.24, 0.08); window.setTimeout(() => tone(660, 0.3, 0.06), 120); }
    },
    dispose() { if (timer !== undefined) window.clearInterval(timer); void context?.close(); },
  };
}
