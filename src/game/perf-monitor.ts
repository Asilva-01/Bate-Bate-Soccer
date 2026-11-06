export type PerfMonitor = {
  push: (milliseconds: number) => void;
  averageMs: () => number;
  averageFps: () => number;
  p95Ms: () => number;
  reset: () => void;
};

export function createPerfMonitor(windowSize: number): PerfMonitor {
  const samples: number[] = [];
  let next = 0;
  return {
    push(milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
      if (samples.length < windowSize) samples.push(milliseconds);
      else samples[next] = milliseconds;
      next = (next + 1) % windowSize;
    },
    averageMs() {
      if (!samples.length) return 0;
      return samples.reduce((sum, value) => sum + value, 0) / samples.length;
    },
    averageFps() {
      const average = this.averageMs();
      return average > 0 ? 1000 / average : 0;
    },
    p95Ms() {
      if (!samples.length) return 0;
      const sorted = [...samples].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
    },
    reset() {
      samples.length = 0;
      next = 0;
    },
  };
}
