/* Backyard Bird - Photo ID (runs on the phone, works without signal once saved)
 * Model: MobileNet V2 trained on iNaturalist bird photos, 965 species, from Google Coral
 * (github.com/google-coral/test_data, Apache License 2.0). Runtime: TensorFlow.js TFLite (Apache 2.0).
 */
window.PhotoID = (() => {
  let model = null, labels = null, loading = null;
  const addScript = src => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src));
    document.head.appendChild(s);
  });
  function load() {
    if (model) return Promise.resolve();
    if (loading) return loading;
    loading = (async () => {
      if (!window.tf) await addScript('birdnet/tf.min.js');
      if (!window.tflite) await addScript('photoid/tf-tflite.min.js');
      tflite.setWasmPath('photoid/wasm/');
      const [m, txt] = await Promise.all([
        tflite.loadTFLiteModel('photoid/birds.tflite'),
        fetch('photoid/labels.txt').then(r => r.text())
      ]);
      labels = txt.trim().split('\n').map(l => {
        const x = l.trim().match(/^(.*?) \((.*)\)$/);
        return x ? { s: x[1], c: x[2] } : { s: l.trim(), c: l.trim() };
      });
      model = m;
    })().catch(e => { loading = null; throw e; });
    return loading;
  }
  // score one square crop of the picture
  async function scoreCrop(img, sx, sy, sw, sh) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 224;
    const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(img, sx, sy, sw, sh, 0, 0, 224, 224);
    const x = tf.tidy(() => tf.browser.fromPixels(cv).expandDims(0).toInt());
    const y = model.predict(x);
    const d = await y.data(); x.dispose(); y.dispose();
    let mx = 0; for (let i = 0; i < d.length; i++) if (d[i] > mx) mx = d[i];
    const scale = mx > 1.5 ? 255 : 1;          // quantized model returns 0-255
    return Array.from(d, v => v / scale);
  }
  // look at the whole picture plus a closer middle crop, keep the best score for each bird
  async function identify(img) {
    await load();
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    const side = Math.min(W, H), crops = [
      [(W - side) / 2, (H - side) / 2, side, side],
      [(W - side * 0.62) / 2, (H - side * 0.62) / 2, side * 0.62, side * 0.62]
    ];
    if (W / H > 1.25 || H / W > 1.25) crops.push([0, 0, W, H]); // squashed full frame for wide shots
    const all = [];
    for (const c of crops) all.push(await scoreCrop(img, ...c));
    const n = all[0].length, best = new Float32Array(n);
    for (const a of all) for (let i = 0; i < n; i++) if (a[i] > best[i]) best[i] = a[i];
    const out = [];
    for (let i = 0; i < n && i < labels.length; i++) if (best[i] >= 0.05 && !/background/i.test(labels[i].s)) out.push({ s: labels[i].s, c: labels[i].c, conf: best[i] });
    out.sort((a, b) => b.conf - a.conf);
    return out.slice(0, 5);
  }
  return { load, identify, ready: () => !!model };
})();
