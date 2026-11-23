/* Backyard Bird - bird-song cleanup (runs off the main page)
 * Removes steady background noise (wind, traffic hum, insects, hiss) and low rumble,
 * keeping the bird. Method: spectral gating.
 *   1. Cut the sound into short overlapping slices (about 1/20 of a second each).
 *   2. For every pitch band, measure the quiet "floor" level: that is the background noise.
 *   3. Keep only what rises clearly above that floor (the bird), turn the rest way down.
 *   4. Cut everything below the bird's lowest note (rumble, wind, traffic).
 */
const N = 2048, HOP = 512, BINS = N / 2 + 1;

// ---- FFT (in place, radix-2) ----
const rev = new Uint32Array(N), cosT = new Float64Array(N / 2), sinT = new Float64Array(N / 2);
(function () {
  const bits = Math.log2(N);
  for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  for (let i = 0; i < N / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / N); sinT[i] = Math.sin(2 * Math.PI * i / N); }
})();
function fft(re, im, inverse) {
  for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let s = 0; s < N; s += size) {
      for (let k = 0; k < half; k++) {
        const c = cosT[k * step], sn = inverse ? sinT[k * step] : -sinT[k * step];
        const a = s + k, b = a + half;
        const tr = re[b] * c - im[b] * sn, ti = re[b] * sn + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

function clean(x, sr, lowCut, opt) {
  opt = opt || {};
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const frames = Math.max(1, Math.ceil((x.length - N) / HOP) + 1);
  const padLen = (frames - 1) * HOP + N;
  const re = new Float64Array(N), im = new Float64Array(N);
  const SR = new Float32Array(frames * BINS), SI = new Float32Array(frames * BINS), MAG = new Float32Array(frames * BINS);

  // 1. slices -> pitch bands
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    for (let i = 0; i < N; i++) { const v = o + i < x.length ? x[o + i] : 0; re[i] = v * win[i]; im[i] = 0; }
    fft(re, im, false);
    for (let k = 0; k < BINS; k++) {
      const p = f * BINS + k; SR[p] = re[k]; SI[p] = im[k]; MAG[p] = Math.hypot(re[k], im[k]);
    }
  }

  // 2. background floor for each band = a quiet-moment level (25th percentile over time)
  const floor = new Float32Array(BINS), col = new Float32Array(frames);
  for (let k = 0; k < BINS; k++) {
    for (let f = 0; f < frames; f++) col[f] = MAG[f * BINS + k];
    const sorted = Float32Array.from(col).sort();
    floor[k] = sorted[Math.floor(frames * (opt.pct || 0.25))] + 1e-9;
  }
  // smooth the floor across neighbouring bands
  const fl = new Float32Array(BINS);
  for (let k = 0; k < BINS; k++) { let s = 0, n = 0; for (let j = k - 3; j <= k + 3; j++) if (j >= 0 && j < BINS) { s += floor[j]; n++; } fl[k] = s / n; }

  // 3 + 4. gain for every slice/band
  const binHz = sr / N, cutBin = Math.floor(lowCut / binHz), topBin = Math.min(BINS - 1, Math.floor(14000 / binHz));
  const FLOOR_GAIN = opt.fg || 0.02;   // background is turned down to 2% (about -34 dB), not to zero, so it doesn't sound robotic
  const G = new Float32Array(frames * BINS);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < BINS; k++) {
      const p = f * BINS + k;
      const ratio = MAG[p] / ((opt.th || 3.0) * fl[k]);            // must be clearly louder than the background
      let g = opt.noGate ? 1 : (ratio <= 1 ? 0 : 1 - 1 / (ratio * ratio));
      if (k < cutBin) g *= Math.pow(k / Math.max(1, cutBin), 4); // steep low cut
      if (k > topBin) g *= 0.3;
      G[p] = Math.max(FLOOR_GAIN, g);
    }
  }
  // smooth gains over neighbouring bands and keep each note's tail (fast open, slower close)
  const G2 = new Float32Array(frames * BINS);
  for (let f = 0; f < frames; f++) for (let k = 0; k < BINS; k++) {
    let s = 0, n = 0; for (let j = k - 2; j <= k + 2; j++) if (j >= 0 && j < BINS) { s += G[f * BINS + j]; n++; }
    G2[f * BINS + k] = s / n;
  }
  for (let k = 0; k < BINS; k++) for (let f = 1; f < frames; f++) {
    const p = f * BINS + k, prev = G2[p - BINS] * (opt.rel || 0.85);
    if (prev > G2[p]) G2[p] = prev;
  }

  // back to sound
  const out = new Float32Array(padLen);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < BINS; k++) { const p = f * BINS + k; re[k] = SR[p] * G2[p]; im[k] = SI[p] * G2[p]; }
    for (let k = 1; k < N / 2; k++) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    fft(re, im, true);
    const o = f * HOP;
    for (let i = 0; i < N; i++) out[o + i] += (re[i] / N) * win[i];
  }
  const norm = 1.5; // Hann x Hann at 75% overlap adds up to 1.5
  const y = out.subarray(0, x.length);
  let peak = 0;
  for (let i = 0; i < y.length; i++) { y[i] /= norm; const a = Math.abs(y[i]); if (a > peak) peak = a; }
  if (peak > 0 && !opt.raw) { const s = 0.9 / peak; for (let i = 0; i < y.length; i++) y[i] *= s; }
  // short fade in/out so there is no click
  const fade = Math.min(y.length >> 1, Math.floor(sr * 0.02));
  for (let i = 0; i < fade; i++) { const g = i / fade; y[i] *= g; y[y.length - 1 - i] *= g; }
  return new Float32Array(y);
}

if (typeof self !== 'undefined' && typeof importScripts === 'function') {
  onmessage = ({ data }) => {
    try {
      const y = clean(data.pcm, data.sr, data.lowCut || 1000);
      postMessage({ ok: true, pcm: y }, [y.buffer]);
    } catch (e) { postMessage({ ok: false, why: String(e) }); }
  };
}
if (typeof module !== 'undefined') module.exports = { clean };
