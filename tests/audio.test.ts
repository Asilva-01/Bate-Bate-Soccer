import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AUDIO_FILES, audioUrl, createAudio } from '../src/game/audio.ts';

type Param = {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
};

type FakeSource = {
  buffer: AudioBuffer | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

type FakeGain = { gain: Param; connect: ReturnType<typeof vi.fn> };

const visibility = new Set<EventListener>();
const sources: FakeSource[] = [];
const oscillators: Array<{ start: ReturnType<typeof vi.fn> }> = [];
let fetchMock: ReturnType<typeof vi.fn>;
let decodeMock: ReturnType<typeof vi.fn>;
let context: {
  state: AudioContextState;
  currentTime: number;
  sampleRate: number;
  destination: object;
  resume: ReturnType<typeof vi.fn>;
  suspend: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  createGain: () => FakeGain;
  createOscillator: () => { type: string; frequency: Param; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  createBiquadFilter: () => { type: string; frequency: { value: number }; connect: ReturnType<typeof vi.fn> };
  createBufferSource: () => FakeSource;
  createBuffer: (channels: number, length: number, sampleRate: number) => AudioBuffer;
  decodeAudioData: ReturnType<typeof vi.fn>;
};

function param(value = 1): Param {
  const next: Param = {
    value,
    setValueAtTime: vi.fn((v: number) => { next.value = v; }),
    linearRampToValueAtTime: vi.fn((v: number) => { next.value = v; }),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
  return next;
}

function fakeBuffer(duration = 8): AudioBuffer {
  return {
    duration,
    sampleRate: 44100,
    length: 44100,
    numberOfChannels: 2,
    getChannelData: () => new Float32Array(8),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

function fetchedUrls() {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

beforeEach(() => {
  sources.length = 0;
  oscillators.length = 0;
  visibility.clear();
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('fail-me')) return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) };
  });
  decodeMock = vi.fn(async () => fakeBuffer());
  context = {
    state: 'running',
    currentTime: 1,
    sampleRate: 44100,
    destination: {},
    resume: vi.fn(async () => { context.state = 'running'; }),
    suspend: vi.fn(async () => { context.state = 'suspended'; }),
    close: vi.fn(async () => { context.state = 'closed'; }),
    createGain: () => ({ gain: param(1), connect: vi.fn() }),
    createOscillator: () => {
      const oscillator = { type: 'sine', frequency: param(440), connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      oscillators.push(oscillator);
      return oscillator;
    },
    createBiquadFilter: () => ({ type: 'lowpass', frequency: { value: 800 }, connect: vi.fn() }),
    createBufferSource: () => {
      const source: FakeSource = { buffer: null, loop: false, loopStart: 0, loopEnd: 0, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      sources.push(source);
      return source;
    },
    createBuffer: (_channels, length) => {
      const data = new Float32Array(length);
      return {
        duration: length / 44100,
        sampleRate: 44100,
        length,
        numberOfChannels: 1,
        getChannelData: () => data,
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
      } as unknown as AudioBuffer;
    },
    decodeAudioData: decodeMock,
  };
  Object.assign(globalThis, {
    window: globalThis,
    fetch: fetchMock,
    AudioContext: vi.fn(function AudioContext() { return context; }),
    document: {
      hidden: false,
      addEventListener: (type: string, handler: EventListener) => { if (type === 'visibilitychange') visibility.add(handler); },
      removeEventListener: (type: string, handler: EventListener) => { if (type === 'visibilitychange') visibility.delete(handler); },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('não baixa nada antes de ligar o som', () => {
  const audio = createAudio();
  expect(fetchMock).not.toHaveBeenCalled();
  audio.sound('kick');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(oscillators).toHaveLength(0);
  audio.dispose();
});

test('liga → baixa e toca a faixa do menu', async () => {
  const audio = createAudio();
  await expect(audio.toggle()).resolves.toBe(true);
  expect(fetchedUrls()).toContain(audioUrl(AUDIO_FILES.menu));
  expect(decodeMock).toHaveBeenCalled();
  const music = sources.find((source) => source.loop);
  expect(music).toBeDefined();
  expect(music?.start).toHaveBeenCalled();
  expect(music?.loop).toBe(true);
  audio.dispose();
});

test("setScene('match') faz crossfade", async () => {
  const audio = createAudio();
  await audio.toggle();
  const menuSource = sources.find((source) => source.loop);
  expect(menuSource?.start).toHaveBeenCalled();
  await audio.setScene('match');
  expect(fetchedUrls()).toContain(audioUrl(AUDIO_FILES.match[0]));
  const looping = sources.filter((source) => source.loop);
  expect(looping.length).toBeGreaterThanOrEqual(2);
  const matchSource = looping[looping.length - 1];
  expect(matchSource.start).toHaveBeenCalled();
  expect(menuSource?.stop).toHaveBeenCalled();
  audio.dispose();
});

test('desligar para tudo', async () => {
  const audio = createAudio();
  await audio.toggle();
  const music = sources.find((source) => source.loop);
  const startedBefore = oscillators.length;
  await expect(audio.toggle()).resolves.toBe(false);
  expect(music?.stop).toHaveBeenCalled();
  audio.sound('kick');
  audio.sound('goal');
  expect(oscillators.length).toBe(startedBefore);
  audio.dispose();
});

test('aba oculta pausa a música e voltar retoma', async () => {
  const audio = createAudio();
  await audio.toggle();
  (globalThis.document as { hidden: boolean }).hidden = true;
  visibility.forEach((handler) => handler(new Event('visibilitychange')));
  expect(context.suspend).toHaveBeenCalled();
  (globalThis.document as { hidden: boolean }).hidden = false;
  visibility.forEach((handler) => handler(new Event('visibilitychange')));
  expect(context.resume).toHaveBeenCalled();
  audio.dispose();
});

test('falha de fetch não lança erro e os efeitos continuam', async () => {
  fetchMock.mockImplementation(async () => { throw new Error('rede'); });
  const audio = createAudio();
  await expect(audio.toggle()).resolves.toBe(true);
  expect(() => audio.sound('kick')).not.toThrow();
  expect(oscillators.length).toBeGreaterThan(0);
  audio.dispose();
});
