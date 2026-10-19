// Web Worker: menghitung embedding crop sel dengan ONNX Runtime Web (WASM, luring).
// Model opsional di /models/embedder.onnx (input NCHW float32, keluaran embedding).
// Bila model tidak ada, dipakai embedding sederhana (histogram warna + citra abu-abu kecil)
// supaya demo tetap berjalan; mode ini diberi label "fallback" di UI.
import * as ort from 'onnxruntime-web/wasm';

ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1; // tanpa SharedArrayBuffer/COOP-COEP; ramah laptop kelas bawah

let session = null;
let inputName = null;
let size = 96;
let mode = 'fallback';

async function init(modelUrl) {
  try {
    const res = await fetch(modelUrl);
    if (!res.ok) throw new Error('model tidak ditemukan');
    const buf = await res.arrayBuffer();
    session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
    inputName = session.inputNames[0];
    const dims = session.inputMetadata?.[0]?.shape;
    if (dims && typeof dims[2] === 'number') size = dims[2];
    mode = 'onnx';
  } catch (e) {
    session = null;
    mode = 'fallback';
  }
  return { mode, size };
}

function l2(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= s;
  return v;
}

// rgba: Uint8ClampedArray ukuran size*size*4
function fallbackEmbed(rgba, n) {
  const bins = 8;
  const hist = new Float32Array(bins * 3);
  const g = 16;
  const small = new Float32Array(g * g);
  const step = n / g;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      hist[(rgba[i] * bins) >> 8]++;
      hist[bins + ((rgba[i + 1] * bins) >> 8)]++;
      hist[2 * bins + ((rgba[i + 2] * bins) >> 8)]++;
      const gi = Math.floor(y / step) * g + Math.floor(x / step);
      small[gi] += (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 765;
    }
  }
  // pusatkan citra kecil agar perubahan pola lebih terasa dibanding kecerahan global
  let mean = 0;
  for (const v of small) mean += v;
  mean /= small.length;
  for (let i = 0; i < small.length; i++) small[i] -= mean;
  const out = new Float32Array(hist.length + small.length);
  l2(hist);
  l2(small);
  out.set(hist, 0);
  out.set(small, hist.length);
  return l2(out);
}

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

async function onnxEmbed(crops, n) {
  const batch = crops.length;
  const data = new Float32Array(batch * 3 * n * n);
  crops.forEach((rgba, b) => {
    const base = b * 3 * n * n;
    for (let p = 0; p < n * n; p++) {
      for (let c = 0; c < 3; c++) {
        data[base + c * n * n + p] = (rgba[p * 4 + c] / 255 - MEAN[c]) / STD[c];
      }
    }
  });
  const out = await session.run({ [inputName]: new ort.Tensor('float32', data, [batch, 3, n, n]) });
  const t = out[session.outputNames[0]];
  const dim = t.data.length / batch;
  return crops.map((_, b) => l2(Float32Array.from(t.data.subarray(b * dim, (b + 1) * dim))));
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    const info = await init(msg.modelUrl);
    self.postMessage({ type: 'ready', ...info });
    return;
  }
  if (msg.type === 'embed') {
    const t0 = performance.now();
    let embs;
    if (session) {
      try {
        embs = await onnxEmbed(msg.crops, msg.size);
      } catch (e) {
        self.postMessage({ type: 'error', id: msg.id, error: String(e) });
        return;
      }
    } else {
      embs = msg.crops.map((c) => fallbackEmbed(c, msg.size));
    }
    const ms = performance.now() - t0;
    self.postMessage({ type: 'embeds', id: msg.id, embs, ms, mode });
  }
};
