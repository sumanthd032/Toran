/**
 * Touch feedback sound.
 *
 * Gammon and Burch found that museum kiosks need both visual and auditory
 * feedback on every press. A beep is wrong for this building, so this
 * synthesises a short dry click closer to a card being set down on paper:
 * a filtered noise transient over a low woody body, both decaying fast.
 *
 * Synthesised rather than shipped as a file so it costs no bytes, needs no
 * decode, and can be tuned by changing numbers.
 */

let ctx: AudioContext | null = null;
let enabled = true;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx === null) {
    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return null;
    ctx = new Ctor();
  }
  return ctx;
}

/** Browsers suspend audio until a gesture. Call from the first real touch. */
export function unlockAudio(): void {
  const c = context();
  if (c !== null && c.state === 'suspended') void c.resume();
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

type Weight = 'light' | 'firm';

/**
 * @param weight 'light' for selection and navigation, 'firm' for a commit
 *               such as saving to the dossier.
 */
export function playTouch(weight: Weight = 'light'): void {
  if (!enabled) return;
  const c = context();
  if (c === null || c.state === 'closed') return;
  if (c.state === 'suspended') void c.resume();

  const now = c.currentTime;
  const gain = weight === 'firm' ? 0.16 : 0.09;
  const bodyHz = weight === 'firm' ? 168 : 232;
  const tail = weight === 'firm' ? 0.085 : 0.055;

  const out = c.createGain();
  out.gain.value = 1;
  out.connect(c.destination);

  // Transient: a very short noise burst, band limited so it reads as paper
  // rather than static.
  const frames = Math.max(1, Math.floor(c.sampleRate * 0.02));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Decaying white noise.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 3;
  }
  const noise = c.createBufferSource();
  noise.buffer = buffer;

  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = weight === 'firm' ? 1400 : 2100;
  band.Q.value = 0.9;

  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(gain, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);

  noise.connect(band).connect(noiseGain).connect(out);

  // Body: a low sine that drops slightly, which is what makes it sound like
  // an object with mass rather than a UI sound.
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(bodyHz, now);
  osc.frequency.exponentialRampToValueAtTime(bodyHz * 0.72, now + tail);

  const oscGain = c.createGain();
  oscGain.gain.setValueAtTime(gain * 0.8, now);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + tail);

  osc.connect(oscGain).connect(out);

  noise.start(now);
  noise.stop(now + 0.04);
  osc.start(now);
  osc.stop(now + tail + 0.02);

  window.setTimeout(() => out.disconnect(), (tail + 0.1) * 1000);
}
