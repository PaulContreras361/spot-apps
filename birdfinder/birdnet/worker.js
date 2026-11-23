/* Backyard Bird - "Who's Singing?" listener (runs off the main page so the screen stays smooth)
 * Bird-sound model: BirdNET by the K. Lisa Yang Center for Conservation Bioacoustics (Cornell Lab of Ornithology)
 * and Chemnitz University of Technology. Model license: CC BY-SA 4.0.
 * Browser code adapted from BirdNET Live (github.com/birdnet-team/real-time-pwa, MIT License,
 * Copyright (c) 2025 BirdNET-Team), which is based on github.com/georg95/birdnet-web.
 * Everything runs on the phone. No audio leaves the device.
 */
importScripts('tf.min.js');

const SAMPLE_RATE = 48000;
const WINDOW = 144000;            // the model listens in 3-second pieces
const HERE = u => new URL(u, self.location.href).href;
let birdModel = null, areaModel = null, labels = [];

class MelSpecLayerSimple extends tf.layers.Layer {
  constructor(config) {
    super(config);
    this.sampleRate = config.sampleRate;
    this.specShape = config.specShape;
    this.frameStep = config.frameStep;
    this.frameLength = config.frameLength;
    this.melFilterbank = tf.tensor2d(config.melFilterbank);
  }
  build() {
    this.magScale = this.addWeight('magnitude_scaling', [], 'float32', tf.initializers.constant({ value: 1.23 }));
    super.build();
  }
  computeOutputShape(s) { return [s[0], this.specShape[0], this.specShape[1], 1]; }
  call(inputs) {
    return tf.tidy(() => {
      const x = inputs[0];
      return tf.stack(x.split(x.shape[0]).map(input => {
        let spec = input.squeeze();
        spec = tf.sub(spec, tf.min(spec, -1, true));
        spec = tf.div(spec, tf.max(spec, -1, true).add(1e-6));
        spec = tf.sub(spec, 0.5).mul(2.0);
        spec = tf.engine().runKernel('STFT', { signal: spec, frameLength: this.frameLength, frameStep: this.frameStep });
        spec = tf.matMul(spec, this.melFilterbank).pow(2.0);
        spec = spec.pow(tf.div(1.0, tf.add(1.0, tf.exp(this.magScale.read()))));
        spec = tf.reverse(spec, -1);
        return tf.transpose(spec).expandDims(-1);
      }));
    });
  }
  static get className() { return 'MelSpecLayerSimple'; }
}

tf.registerKernel({
  kernelName: 'STFT', backendName: 'webgl',
  kernelFunc: ({ backend, inputs: { signal, frameLength, frameStep } }) => {
    const innerDim = frameLength / 2;
    const batch = (signal.size - frameLength + frameStep) / frameStep | 0;
    let cur = backend.runWebGLProgram({
      variableNames: ['x'], outputShape: [batch, frameLength],
      userCode: `void main(){ivec2 c=getOutputCoords();int p=c[1]%${innerDim};int k=0;
        for(int i=0;i<${Math.log2(innerDim)};++i){if((p & (1<<i))!=0){k|=(1<<(${Math.log2(innerDim) - 1}-i));}}
        int i=2*k;if(c[1]>=${innerDim}){i=2*(k%${innerDim})+1;}
        int q=c[0]*${frameLength}+i;float val=getX((q/${frameLength})*${frameStep}+ q % ${frameLength});
        float cosArg=${2.0 * Math.PI / frameLength}*float(q);float mul=0.5-0.5*cos(cosArg);setOutput(val*mul);}`
    }, [signal], 'float32');
    for (let len = 1; len < innerDim; len *= 2) {
      const prev = cur;
      cur = backend.runWebGLProgram({
        variableNames: ['x'], outputShape: [batch, innerDim * 2],
        userCode: `void main(){ivec2 c=getOutputCoords();int b=c[0];int i=c[1];int k=i%${innerDim};
          int isHigh=(k%${len * 2})/${len};int highSign=(1 - isHigh*2);int baseIndex=k - isHigh*${len};
          float t=${Math.PI / len}*float(k%${len});float a=cos(t);float bsin=sin(-t);
          float oddK_re=getX(b, baseIndex+${len});float oddK_im=getX(b, baseIndex+${len + innerDim});
          if(i<${innerDim}){float evenK_re=getX(b, baseIndex);setOutput(evenK_re + (oddK_re*a - oddK_im*bsin)*float(highSign));}
          else{float evenK_im=getX(b, baseIndex+${innerDim});setOutput(evenK_im + (oddK_re*bsin + oddK_im*a)*float(highSign));}}`
      }, [prev], 'float32');
      backend.disposeIntermediateTensorInfo(prev);
    }
    const real = backend.runWebGLProgram({
      variableNames: ['x'], outputShape: [batch, innerDim + 1],
      userCode: `void main(){ivec2 c=getOutputCoords();int b=c[0];int i=c[1];int zI=i%${innerDim};
        int conjI=(${innerDim}-i)%${innerDim};float Zk0=getX(b,zI);float Zk1=getX(b,zI+${innerDim});
        float Zk_conj0=getX(b,conjI);float Zk_conj1=-getX(b,conjI+${innerDim});
        float t=${-2.0 * Math.PI}*float(i)/float(${innerDim * 2});float diff0=Zk0 - Zk_conj0;float diff1=Zk1 - Zk_conj1;
        setOutput((Zk0+Zk_conj0 + cos(t)*diff1 + sin(t)*diff0)*0.5);}`
    }, [cur], 'float32');
    backend.disposeIntermediateTensorInfo(cur);
    return real;
  }
});

async function init() {
  try {
    const ok = await tf.setBackend('webgl');
    if (!ok || tf.getBackend() !== 'webgl') throw new Error('nowebgl');
    tf.serialization.registerClass(MelSpecLayerSimple);
    birdModel = await tf.loadLayersModel(HERE('model.json'), {
      onProgress: p => postMessage({ msg: 'progress', pct: Math.round(p * 85) })
    });
    postMessage({ msg: 'progress', pct: 88 });
    tf.tidy(() => { birdModel.predict(tf.zeros([1, WINDOW])); });
    postMessage({ msg: 'progress', pct: 94 });
    try { areaModel = await tf.loadGraphModel(HERE('area-model/model.json')); } catch (e) { areaModel = null; }
    labels = (await fetch(HERE('labels/en_us.txt')).then(r => r.text())).split('\n').map(l => {
      const [s, c] = l.trim().split('_'); return { s: s || l, c: c || s || l };
    });
    postMessage({ msg: 'ready' });
  } catch (e) {
    postMessage({ msg: 'error', why: String(e && e.message || e) });
  }
}
init();

function weekOfYear() {
  // BirdNET's area model uses a 48-week year (4 per month)
  const d = new Date();
  return Math.min(48, d.getMonth() * 4 + Math.min(4, Math.floor((d.getDate() - 1) / 7) + 1));
}

onmessage = async ({ data }) => {
  if (data.msg !== 'identify' || !birdModel) return;
  try {
    const pcm = data.pcm, hop = 72000; // 1.5 s overlap between pieces
    const n = Math.max(1, Math.ceil(Math.max(0, pcm.length - WINDOW) / hop) + 1);
    const framed = new Float32Array(n * WINDOW);
    for (let f = 0; f < n; f++) framed.set(pcm.subarray(f * hop, Math.min(f * hop + WINDOW, pcm.length)), f * WINDOW);
    const x = tf.tensor2d(framed, [n, WINDOW]);
    const y = birdModel.predict(x);
    const rows = await y.array(); x.dispose(); y.dispose();

    // combine the pieces: a bird that sings loudly in one piece still counts (smooth max)
    const K = rows[0].length, A = 5, pooled = new Float64Array(K), best = new Float64Array(K);
    for (const r of rows) for (let i = 0; i < K; i++) { pooled[i] += Math.exp(A * r[i]); if (r[i] > best[i]) best[i] = r[i]; }
    for (let i = 0; i < K; i++) pooled[i] = Math.log(pooled[i] / rows.length) / A;

    let geo = null;
    if (areaModel && isFinite(data.lat) && isFinite(data.lon)) {
      geo = tf.tidy(() => areaModel.predict(tf.tensor([[data.lat, data.lon, weekOfYear()]])).dataSync().slice());
    }
    const out = [];
    for (let i = 0; i < K; i++) {
      const conf = Math.max(pooled[i], best[i] * 0.9);
      if (conf < 0.08) continue;
      const g = geo ? geo[i] : 1;
      out.push({ s: labels[i].s, c: labels[i].c, conf, geo: g });
    }
    // birds that are not expected around here right now get pushed down, not hidden
    out.forEach(o => { o.score = o.conf * (o.geo >= 0.03 ? 1 : 0.35); });
    out.sort((a, b) => b.score - a.score);
    postMessage({ msg: 'result', list: out.slice(0, 6), pieces: n });
  } catch (e) {
    postMessage({ msg: 'error', why: String(e && e.message || e) });
  }
};
