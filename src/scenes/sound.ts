// Short synthesized blips for alerts (sound=1). No audio files: a couple of
// oscillator notes with a fast envelope through a gentle low-pass.

import type { AlertKind } from '../logic/rules.ts';

type Note = [frequencyHz: number, startMs: number, lengthMs: number, wave: OscillatorType];

const PATTERNS: Record<AlertKind, Note[]> = {
  wake: [
    [523.25, 0, 90, 'triangle'],
    [783.99, 95, 140, 'triangle'],
  ],
  sleep: [
    [659.25, 0, 110, 'triangle'],
    [392.0, 120, 220, 'triangle'],
  ],
  run_recap: [
    [783.99, 0, 80, 'triangle'],
    [659.25, 90, 80, 'triangle'],
    [987.77, 180, 220, 'triangle'],
  ],
  speed_record: [
    [523.25, 0, 70, 'square'],
    [659.25, 75, 70, 'square'],
    [783.99, 150, 70, 'square'],
    [1046.5, 225, 180, 'triangle'],
  ],
  distance_milestone: [
    [698.46, 0, 80, 'triangle'],
    [880.0, 90, 160, 'triangle'],
  ],
  daily_distance_milestone: [
    [659.25, 0, 70, 'triangle'],
    [880.0, 80, 140, 'triangle'],
  ],
  speed_milestone: [
    [987.77, 0, 60, 'square'],
    [987.77, 90, 60, 'square'],
  ],
  distance_streak: [
    [587.33, 0, 60, 'triangle'],
    [587.33, 80, 60, 'triangle'],
    [880.0, 160, 160, 'triangle'],
  ],
  blocks: [
    [1318.5, 0, 35, 'square'],
    [1318.5, 70, 35, 'square'],
  ],
};

export class Blips {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;

  private ready(): AudioContext | null {
    if (this.context === null) {
      try {
        this.context = new AudioContext();
        const filter = this.context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 3200;
        this.output = this.context.createGain();
        this.output.gain.value = 0.16;
        this.output.connect(filter);
        filter.connect(this.context.destination);
      } catch {
        return null;
      }
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
    return this.context;
  }

  play(kind: AlertKind): void {
    const ctx = this.ready();
    if (!ctx || !this.output) return;
    const t0 = ctx.currentTime + 0.02;
    for (const [freq, startMs, lengthMs, wave] of PATTERNS[kind]) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = wave;
      osc.frequency.value = freq;
      const start = t0 + startMs / 1000;
      const end = start + lengthMs / 1000;
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(wave === 'square' ? 0.45 : 0.9, start + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(env);
      env.connect(this.output);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  }
}
