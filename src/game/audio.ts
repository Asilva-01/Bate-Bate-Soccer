export type AudioScene = 'menu' | 'match';

export const AUDIO_FILES = {
  menu: 'menu.mp3',
  match: ['match-rock.mp3', 'match-arcade.mp3'],
  crowd: 'crowd.mp3',
} as const;

const MUSIC_LEVEL = 0.35;
const CROSSFADE_SECONDS = 0.6;
const DUCK_SECONDS = 1.5;
const DUCK_LEVEL = 0.18;
const CROWD_LEVEL = 0.5;

export function audioUrl(file: string) {
  const base = import.meta.env.BASE_URL || './';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}audio/${file}`;
}

type TrackSlot = { source: AudioBufferSourceNode; gain: GainNode; file: string };

function decodeAudio(context: AudioContext, data: ArrayBuffer) {
  return new Promise<AudioBuffer>((resolve, reject) => {
    let settled = false;
    const ok = (buffer: AudioBuffer) => { if (!settled) { settled = true; resolve(buffer); } };
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
    try {
      const result = context.decodeAudioData(data, ok, fail);
      if (result && typeof result.then === 'function') result.then(ok, fail);
    } catch (error) {
      fail(error);
    }
  });
}

export function createAudio() {
  let context: AudioContext | undefined;
  let masterGain: GainNode | undefined;
  let sfxGain: GainNode | undefined;
  let musicBus: GainNode | undefined;
  let duckGain: GainNode | undefined;
  let enabled = false;
  let generation = 0;
  let playGeneration = 0;
  let lastHit = 0;
  let noise: AudioBuffer | undefined;
  let scene: AudioScene = 'menu';
  let matchCursor = 0;
  let activeMatchFile: string = AUDIO_FILES.match[0];
  let current: TrackSlot | undefined;
  const buffers = new Map<string, Promise<AudioBuffer | undefined>>();

  const connect = (from: AudioNode, to: AudioNode) => { from.connect(to); };

  const ensureGraph = () => {
    if (!context || masterGain) return;
    masterGain = context.createGain();
    sfxGain = context.createGain();
    musicBus = context.createGain();
    duckGain = context.createGain();
    musicBus.gain.value = MUSIC_LEVEL;
    connect(sfxGain, masterGain);
    connect(musicBus, duckGain);
    connect(duckGain, masterGain);
    connect(masterGain, context.destination);
  };

  const output = () => sfxGain ?? context?.destination;

  const tone = (frequency: number, duration: number, volume: number, type: OscillatorType, endFrequency = frequency) => {
    if (!context || !enabled || context.state !== 'running' || !output()) return;
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
    oscillator.connect(filter); filter.connect(gain); gain.connect(output()!);
    oscillator.start(now); oscillator.stop(now + duration + 0.01);
  };

  const percussion = (duration: number, volume: number, highpass: number) => {
    if (!context || !enabled || !noise || context.state !== 'running' || !output()) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noise; filter.type = 'highpass'; filter.frequency.value = highpass;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter); filter.connect(gain); gain.connect(output()!);
    source.start(now); source.stop(now + duration);
  };

  const loadBuffer = (file: string) => {
    const url = audioUrl(file);
    let pending = buffers.get(url);
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok || !context) {
          buffers.delete(url);
          return undefined;
        }
        const data = await response.arrayBuffer();
        return await decodeAudio(context, data.slice(0));
      } catch {
        buffers.delete(url);
        return undefined;
      }
    })();
    buffers.set(url, pending);
    return pending;
  };

  const stopSlot = (slot: TrackSlot | undefined, fadeSeconds: number) => {
    if (!slot || !context) return;
    const now = context.currentTime;
    try {
      slot.gain.gain.cancelScheduledValues(now);
      slot.gain.gain.setValueAtTime(Math.max(slot.gain.gain.value, 0.0001), now);
      slot.gain.gain.linearRampToValueAtTime(0.0001, now + fadeSeconds);
      slot.source.stop(now + fadeSeconds);
    } catch {
      try { slot.source.stop(); } catch { /* already stopped */ }
    }
  };

  const startTrack = (file: string, buffer: AudioBuffer, fade: boolean) => {
    if (!context || !musicBus) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;
    source.connect(gain);
    gain.connect(musicBus);
    if (fade) {
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(1, now + CROSSFADE_SECONDS);
    } else {
      gain.gain.setValueAtTime(1, now);
    }
    source.start(now);
    stopSlot(current, fade ? CROSSFADE_SECONDS : 0.04);
    current = { source, gain, file };
  };

  const fileFor = (next: AudioScene, advanceMatch: boolean) => {
    if (next !== 'match') return AUDIO_FILES.menu;
    if (advanceMatch) {
      activeMatchFile = AUDIO_FILES.match[matchCursor % AUDIO_FILES.match.length];
      matchCursor += 1;
    }
    return activeMatchFile;
  };

  const playCurrent = async (fade: boolean, advanceMatch: boolean) => {
    if (!enabled || !context) return;
    const token = ++playGeneration;
    const file = fileFor(scene, advanceMatch && scene === 'match');
    if (current?.file === file && context.state !== 'closed') return;
    const buffer = await loadBuffer(file);
    if (token !== playGeneration || !enabled || !buffer) return;
    startTrack(file, buffer, fade && !!current);
  };

  const preloadRest = () => {
    void loadBuffer(AUDIO_FILES.menu);
    for (const file of AUDIO_FILES.match) void loadBuffer(file);
    void loadBuffer(AUDIO_FILES.crowd);
  };

  const duckMusic = () => {
    if (!context || !duckGain || !enabled) return;
    const now = context.currentTime;
    const param = duckGain.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(Math.max(param.value, 0.0001), now);
    param.linearRampToValueAtTime(DUCK_LEVEL, now + 0.06);
    param.setValueAtTime(DUCK_LEVEL, now + 1.2);
    param.linearRampToValueAtTime(1, now + DUCK_SECONDS);
  };

  const playCrowd = async () => {
    if (!context || !enabled || !sfxGain || context.state !== 'running') return;
    const buffer = await loadBuffer(AUDIO_FILES.crowd);
    if (!buffer || !enabled || !context || context.state !== 'running' || !sfxGain) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = false;
    const duration = Math.max(buffer.duration, 0.2);
    gain.gain.setValueAtTime(CROWD_LEVEL, now);
    gain.gain.setValueAtTime(CROWD_LEVEL, now + Math.max(duration - 0.12, 0.05));
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(gain); gain.connect(sfxGain);
    source.start(now); source.stop(now + buffer.duration + 0.02);
  };

  const stopAllMusic = () => {
    playGeneration += 1;
    stopSlot(current, 0.05);
    current = undefined;
  };

  const onVisibility = () => {
    if (!context || !enabled) return;
    if (document.hidden) void context.suspend();
    else void context.resume();
  };

  document.addEventListener('visibilitychange', onVisibility);

  return {
    async toggle() {
      enabled = !enabled;
      const currentGeneration = ++generation;
      if (!enabled) {
        stopAllMusic();
        if (masterGain && context) masterGain.gain.setValueAtTime(0, context.currentTime);
        return false;
      }
      try {
        context ??= new AudioContext();
        ensureGraph();
        if (masterGain) masterGain.gain.setValueAtTime(1, context.currentTime);
        await context.resume();
        if (!enabled || currentGeneration !== generation) return enabled;
        if (!noise) {
          noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.2), context.sampleRate);
          const samples = noise.getChannelData(0);
          for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
        }
        await playCurrent(false, scene === 'match' && !current);
        if (!enabled || currentGeneration !== generation) return enabled;
        preloadRest();
        return true;
      } catch (error) {
        if (currentGeneration === generation) enabled = false;
        throw error;
      }
    },
    async setScene(next: AudioScene) {
      const advanceMatch = next === 'match' && scene !== 'match';
      scene = next;
      if (!enabled) return;
      await playCurrent(true, advanceMatch);
    },
    sound(kind: 'hit' | 'goal' | 'kick' | 'dash') {
      if (kind === 'hit') {
        if (!context || context.currentTime - lastHit < 0.1) return;
        lastHit = context.currentTime;
        tone(160, 0.09, 0.045, 'triangle', 65);
      } else if (kind === 'dash') {
        tone(180, 0.05, 0.028, 'sine', 90);
        percussion(0.04, 0.02, 900);
      } else if (kind === 'kick') {
        tone(220, 0.07, 0.05, 'triangle', 120);
        percussion(0.05, 0.035, 1200);
      } else {
        tone(440, 0.28, 0.055, 'triangle', 660);
        tone(660, 0.35, 0.035, 'triangle', 880);
        duckMusic();
        void playCrowd();
      }
    },
    dispose() {
      enabled = false;
      generation++;
      playGeneration++;
      document.removeEventListener('visibilitychange', onVisibility);
      stopAllMusic();
      void context?.close();
    },
  };
}
