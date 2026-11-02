export function createAudio() {
  let context: AudioContext | undefined;
  let timer: number | undefined;
  let enabled = false;
  let generation = 0;
  let step = 0;
  let lastHit = 0;
  let noise: AudioBuffer | undefined;
  const riff = [110, 110, 0, 164.81, 110, 196, 0, 164.81, 130.81, 130.81, 0, 196, 146.83, 0, 164.81, 196];

  const tone = (frequency: number, duration: number, volume: number, type: OscillatorType, endFrequency = frequency) => {
    if (!context || !enabled || context.state !== 'running') return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    filter.type = 'lowpass'; filter.frequency.value = type === 'sawtooth' ? 1400 : 8000;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(filter); filter.connect(gain); gain.connect(context.destination);
    oscillator.start(now); oscillator.stop(now + duration + 0.01);
  };

  const percussion = (duration: number, volume: number, highpass: number) => {
    if (!context || !enabled || !noise || context.state !== 'running') return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noise; filter.type = 'highpass'; filter.frequency.value = highpass;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter); filter.connect(gain); gain.connect(context.destination);
    source.start(now); source.stop(now + duration);
  };

  const playBeat = () => {
    const current = step++ % riff.length;
    const note = riff[current];
    if (note) {
      tone(note, 0.18, 0.025, 'sawtooth');
      tone(note * 1.5, 0.16, 0.014, 'sawtooth');
      if (current % 2 === 0) tone(note / 2, 0.18, 0.04, 'triangle');
    }
    if (current % 4 === 0) tone(130, 0.14, 0.085, 'sine', 45);
    if (current % 8 === 4) percussion(0.14, 0.045, 900);
    percussion(0.035, 0.012, 6500);
  };

  return {
    async toggle() {
      enabled = !enabled;
      const currentGeneration = ++generation;
      if (!enabled) {
        if (timer !== undefined) window.clearInterval(timer);
        timer = undefined;
        return false;
      }
      try {
        context ??= new AudioContext();
        await context.resume();
        if (!enabled || currentGeneration !== generation) return enabled;
        if (!noise) {
          noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.2), context.sampleRate);
          const samples = noise.getChannelData(0);
          for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
        }
        playBeat();
        timer = window.setInterval(playBeat, 133);
        return true;
      } catch (error) {
        if (currentGeneration === generation) enabled = false;
        throw error;
      }
    },
    sound(kind: 'hit' | 'goal') {
      if (kind === 'hit') {
        if (!context || context.currentTime - lastHit < 0.1) return;
        lastHit = context.currentTime;
        tone(160, 0.09, 0.045, 'triangle', 65);
      } else {
        tone(440, 0.28, 0.055, 'triangle', 660);
        tone(660, 0.35, 0.035, 'triangle', 880);
      }
    },
    dispose() {
      enabled = false; generation++;
      if (timer !== undefined) window.clearInterval(timer);
      void context?.close();
    },
  };
}
