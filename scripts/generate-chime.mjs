import { mkdirSync, writeFileSync } from 'node:fs';

// Original G4–C5 cue. Rounded attacks and decaying sine harmonics avoid a sharp bell strike.
// The final 300 ms of silence gives listeners a moment before speech starts.
const sampleRate = 24000;
const duration = 1.9;
const samples = new Float64Array(Math.round(sampleRate * duration));
const notes = [
  { start: 0, frequency: 392, length: 1.05 },
  { start: 0.55, frequency: 523.251, length: 1.05 },
];
for (const { start, frequency, length } of notes) {
  for (let i = 0; i < Math.round(length * sampleRate); i++) {
    const t = i / sampleRate;
    const attack = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(t / 0.09, 1));
    const release = 0.5 - 0.5 * Math.cos(Math.PI * Math.min((length - t) / 0.3, 1));
    const envelope = attack * release * Math.exp(-3.2 * t);
    const phase = 2 * Math.PI * frequency * t;
    samples[Math.round(start * sampleRate) + i] +=
      envelope * (Math.sin(phase) + 0.12 * Math.sin(2 * phase) + 0.025 * Math.sin(3 * phase));
  }
}
const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
const wav = Buffer.alloc(44 + samples.length * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); // PCM
wav.writeUInt16LE(1, 22); // Mono
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(samples.length * 2, 40);
samples.forEach((sample, i) => wav.writeInt16LE(Math.round((sample / peak) * 0.32 * 32767), 44 + i * 2));
const target = new URL('../apps/tablet/assets/soft-chime.wav', import.meta.url);
mkdirSync(new URL('.', target), { recursive: true });
writeFileSync(target, wav);
