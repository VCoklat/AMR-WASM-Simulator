import React, { useEffect, useRef, useState } from 'react';

// Kamera edge di peramban: webcam -> crop sel lorong -> embedding (Web Worker, ONNX Runtime Web)
// -> cocokkan prototipe few-shot -> debounce -> kejadian sel ke engine WASM.
// Seluruhnya luring; tidak ada server.

const FW = 320; // resolusi kerja frame (hemat CPU di laptop kelas bawah)
const FH = 240;
const STORE_KEY = 'amr-vision-v1';

// Grid sel kamera (kolom x baris) dipetakan ke sel engine di zona bersama (x 11-12, y 6-13).
const COLS = 2;
const ROWS = 4;
const toEngine = (c, r) => ({ x: 11 + c, y: 7 + r * 2 });

// Contoh gambar (dibuat oleh scripts/generate_samples.py) dan preset kalibrasi lorongnya.
const SAMPLES = [
  ['01_kosong.png', 'Lorong kosong'],
  ['02_palet.png', 'Palet di lorong'],
  ['03_palet_forklift_penuh.png', 'Palet + forklift (zona penuh)'],
  ['04_kardus.png', 'Kardus'],
  ['05_karung_1.png', 'Karung (sampel 1)'],
  ['05_karung_2.png', 'Karung (sampel 2)'],
  ['05_karung_3.png', 'Karung (sampel 3)'],
  ['05_karung_4.png', 'Karung (sampel 4)'],
  ['05_karung_5.png', 'Karung (sampel 5)'],
  ['06_karung_sel_lain.png', 'Karung di sel lain'],
  ['07_lensa_tertutup.png', 'Lensa tertutup'],
];
const SAMPLE_QUAD = [[100, 20], [220, 20], [220, 220], [100, 220]];

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
}
function saveStore(obj) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(obj)); } catch (e) { /* abaikan */ }
}
const toArr = (f) => Array.from(f);

function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function meanVec(list) {
  const out = new Float32Array(list[0].length);
  list.forEach((v) => { for (let i = 0; i < v.length; i++) out[i] += v[i]; });
  let n = 0;
  for (let i = 0; i < out.length; i++) n += out[i] * out[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

// Titik pada quad (TL, TR, BR, BL) untuk koordinat normal (u, v).
function quadPoint(q, u, v) {
  const [tl, tr, br, bl] = q;
  const top = [tl[0] + (tr[0] - tl[0]) * u, tl[1] + (tr[1] - tl[1]) * u];
  const bot = [bl[0] + (br[0] - bl[0]) * u, bl[1] + (br[1] - bl[1]) * u];
  return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
}

// Crop sel (c, r) dari ImageData frame menjadi n x n RGBA (sampling nearest, koreksi perspektif kasar).
function cropCell(img, q, c, r, n) {
  const out = new Uint8ClampedArray(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = (c + (i + 0.5) / n) / COLS;
      const v = (r + (j + 0.5) / n) / ROWS;
      const [px, py] = quadPoint(q, u, v);
      const x = Math.min(FW - 1, Math.max(0, Math.round(px)));
      const y = Math.min(FH - 1, Math.max(0, Math.round(py)));
      const si = (y * FW + x) * 4;
      const di = (j * n + i) * 4;
      out[di] = img.data[si];
      out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2];
      out[di + 3] = 255;
    }
  }
  return out;
}

// Statistik frame untuk mendeteksi gangguan sensor (lensa tertutup / gelap / datar).
function frameStats(img) {
  let s = 0, s2 = 0, n = 0;
  for (let i = 0; i < img.data.length; i += 16) {
    const l = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
    s += l; s2 += l * l; n++;
  }
  const mean = s / n;
  return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
}

export default function VisionPanel({ onCell, onLog }) {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const workRef = useRef(null);
  const workerRef = useRef(null);
  const pendingRef = useRef(new Map());
  const idRef = useRef(0);
  const busyRef = useRef(false);

  const stored = useRef(loadStore()).current;
  const quadRef = useRef(stored.quad || null);
  const clicksRef = useRef([]);
  const emptyRef = useRef((stored.empty || []).map((e) => (e ? Float32Array.from(e) : null)));
  const protoRef = useRef(Object.fromEntries(Object.entries(stored.protos || {}).map(([k, v]) => [k, Float32Array.from(v)])));
  const cellsRef = useRef(Array.from({ length: COLS * ROWS }, () => ({ occ: 0, label: '-', score: 0, cand: null, streak: 0 })));
  const faultRef = useRef(false);
  const latRef = useRef([]);

  const [running, setRunning] = useState(false);
  const [source, setSource] = useState('none'); // 'webcam' | 'image'
  const [imgSrc, setImgSrc] = useState(null);
  const sourceRef = useRef('none');
  const imgRef = useRef(null);
  const [info, setInfo] = useState({ mode: 'memuat…', size: 96 });
  const [calibrating, setCalibrating] = useState(false);
  const [selected, setSelected] = useState(0);
  const [label, setLabel] = useState('karung');
  const [tau, setTau] = useState(stored.tau || 0.9);
  const [debounceN, setDebounceN] = useState(3);
  const [status, setStatus] = useState('Kamera belum aktif');
  const [stats, setStats] = useState({ p50: 0, p95: 0, n: 0 });
  const [, force] = useState(0);
  const tauRef = useRef(tau);
  const debRef = useRef(debounceN);
  useEffect(() => { tauRef.current = tau; }, [tau]);
  useEffect(() => { debRef.current = debounceN; }, [debounceN]);

  const persist = () => saveStore({
    quad: quadRef.current,
    empty: emptyRef.current.map((e) => (e ? toArr(e) : null)),
    protos: Object.fromEntries(Object.entries(protoRef.current).map(([k, v]) => [k, toArr(v)])),
    tau: tauRef.current,
  });

  // Worker embedding
  useEffect(() => {
    const w = new Worker(new URL('./embedWorker.js', import.meta.url), { type: 'module' });
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'ready') {
        setInfo({ mode: m.mode, size: m.size });
        onLog && onLog(`Vision worker siap (${m.mode === 'onnx' ? 'model ONNX INT8' : 'embedding fallback, model belum ada'}).`);
      } else if (m.id !== undefined && pendingRef.current.has(m.id)) {
        pendingRef.current.get(m.id)(m);
        pendingRef.current.delete(m.id);
      }
    };
    w.postMessage({ type: 'init', modelUrl: '/models/embedder.onnx' });
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  const embed = (crops) => new Promise((resolve) => {
    const id = ++idRef.current;
    pendingRef.current.set(id, resolve);
    workerRef.current.postMessage({ type: 'embed', id, crops, size: info.size });
  });

  const grab = () => {
    const ctx = workRef.current.getContext('2d', { willReadFrequently: true });
    if (sourceRef.current === 'image') {
      const im = imgRef.current;
      if (!im || !im.complete || !im.naturalWidth) return null;
      ctx.drawImage(im, 0, 0, FW, FH);
    } else {
      const v = videoRef.current;
      if (!v || v.readyState < 2) return null;
      ctx.drawImage(v, 0, 0, FW, FH);
    }
    return ctx.getImageData(0, 0, FW, FH);
  };

  const allCrops = (img) => {
    const crops = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) crops.push(cropCell(img, quadRef.current, c, r, info.size));
    return crops;
  };

  // Klasifikasi satu sel: kosong (prototipe per sel) vs kelas terdaftar; di bawah tau = tidak dikenal.
  const classify = (emb, idx) => {
    let best = 'tidak dikenal';
    let bestScore = -1;
    const empty = emptyRef.current[idx];
    if (empty) { bestScore = cosine(emb, empty); best = 'kosong'; }
    for (const [k, p] of Object.entries(protoRef.current)) {
      const s = cosine(emb, p);
      if (s > bestScore) { bestScore = s; best = k; }
    }
    if (bestScore < tauRef.current) best = 'tidak dikenal';
    return { label: best, score: bestScore };
  };

  const tick = async () => {
    if (busyRef.current || !quadRef.current) return;
    busyRef.current = true;
    try {
      const t0 = performance.now();
      const img = grab();
      if (!img) return;
      const st = frameStats(img);
      const fault = st.mean < 25 || st.std < 6;
      if (fault !== faultRef.current) {
        faultRef.current = fault;
        onLog && onLog(fault ? 'GANGGUAN SENSOR: kamera tertutup/gelap. Kejadian okupansi dibekukan.' : 'Sensor kamera normal kembali.');
      }
      if (fault) { setStatus('Gangguan sensor: kamera tertutup atau gelap'); return; }
      if (!emptyRef.current.some(Boolean)) { setStatus('Klik "Kalibrasi kosong" saat lorong kosong'); return; }

      const res = await embed(allCrops(img));
      if (!res.embs) return;
      latRef.current = [...latRef.current.slice(-199), res.ms / res.embs.length];
      res.embs.forEach((emb, idx) => {
        const cell = cellsRef.current[idx];
        const { label: lab, score } = classify(emb, idx);
        const occ = lab === 'kosong' ? 0 : 1;
        cell.label = lab;
        cell.score = score;
        if (occ === cell.occ) { cell.cand = null; cell.streak = 0; return; }
        if (cell.cand === occ) cell.streak += 1; else { cell.cand = occ; cell.streak = 1; }
        if (cell.streak >= debRef.current) {
          cell.occ = occ; cell.cand = null; cell.streak = 0;
          const c = idx % COLS, r = Math.floor(idx / COLS);
          const { x, y } = toEngine(c, r);
          onCell(x, y, occ, `edge-cam:${lab}`, t0);
        }
      });
      setStatus('Memantau lorong');
      setStats({ p50: pct(latRef.current, 0.5), p95: pct(latRef.current, 0.95), n: latRef.current.length });
    } finally {
      busyRef.current = false;
      draw();
    }
  };

  // Loop 5 Hz; cukup untuk okupansi dan ringan untuk CPU generasi lama.
  useEffect(() => {
    if (!running) return;
    const h = setInterval(tick, 200);
    return () => clearInterval(h);
  }, [running, info.size]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      sourceRef.current = 'webcam';
      setSource('webcam');
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setRunning(true);
      setStatus(quadRef.current ? 'Memantau lorong' : 'Klik "Kalibrasi lorong" lalu klik 4 sudut lorong');
    } catch (e) {
      setStatus('Kamera tidak bisa dibuka: ' + e.message);
    }
  };

  const draw = () => {
    const cv = overlayRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, FW, FH);
    const q = quadRef.current;
    clicksRef.current.forEach(([x, y]) => { ctx.fillStyle = '#f59e0b'; ctx.fillRect(x - 3, y - 3, 6, 6); });
    if (!q) return;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const cell = cellsRef.current[idx];
        const pts = [quadPoint(q, c / COLS, r / ROWS), quadPoint(q, (c + 1) / COLS, r / ROWS), quadPoint(q, (c + 1) / COLS, (r + 1) / ROWS), quadPoint(q, c / COLS, (r + 1) / ROWS)];
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = cell.occ ? 'rgba(239,68,68,0.30)' : 'rgba(34,197,94,0.12)';
        ctx.fill();
        ctx.lineWidth = idx === selected ? 3 : 1;
        ctx.strokeStyle = idx === selected ? '#2563eb' : '#ffffff';
        ctx.stroke();
        const [cx, cy] = quadPoint(q, (c + 0.5) / COLS, (r + 0.5) / ROWS);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${cell.label} ${cell.score > 0 ? cell.score.toFixed(2) : ''}`, cx, cy);
      }
    }
  };

  const onOverlayClick = (e) => {
    const rect = overlayRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * FW;
    const y = ((e.clientY - rect.top) / rect.height) * FH;
    if (calibrating) {
      clicksRef.current.push([x, y]);
      if (clicksRef.current.length === 4) {
        quadRef.current = clicksRef.current;
        clicksRef.current = [];
        emptyRef.current = [];
        setCalibrating(false);
        persist();
        onLog && onLog('Lorong dikalibrasi (4 sudut). Lanjutkan dengan "Kalibrasi kosong".');
      }
      draw();
      return;
    }
    if (!quadRef.current) return;
    // pilih sel terdekat dari pusatnya
    let best = 0, bd = Infinity;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const [cx, cy] = quadPoint(quadRef.current, (c + 0.5) / COLS, (r + 0.5) / ROWS);
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) { bd = d; best = r * COLS + c; }
    }
    setSelected(best);
    setTimeout(draw, 0);
  };

  // Sumber gambar statis: unggahan pengguna atau contoh bawaan (tanpa webcam).
  const useImage = (url, name) => {
    const im = new Image();
    im.onload = () => {
      imgRef.current = im;
      sourceRef.current = 'image';
      setSource('image');
      setImgSrc(url);
      const v = videoRef.current;
      if (v && v.srcObject) { v.srcObject.getTracks().forEach((t) => t.stop()); v.srcObject = null; }
      setRunning(true);
      setStatus(quadRef.current ? 'Memantau gambar' : 'Klik "Kalibrasi lorong" (atau "Preset contoh") lalu "Kalibrasi kosong"');
      onLog && onLog(`Sumber gambar: ${name}`);
    };
    im.src = url;
  };

  const onUpload = (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) useImage(URL.createObjectURL(f), f.name);
    e.target.value = '';
  };

  const usePresetQuad = () => {
    quadRef.current = SAMPLE_QUAD.map((p) => [...p]);
    emptyRef.current = [];
    persist();
    onLog && onLog('Preset lorong contoh dipakai. Tampilkan gambar kosong lalu "Kalibrasi kosong".');
    draw();
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const calibrateEmpty = async () => {
    if (!quadRef.current) return;
    const shots = [];
    for (let k = 0; k < 3; k++) {
      const img = grab();
      if (img) shots.push((await embed(allCrops(img))).embs);
      await sleep(200);
    }
    if (!shots.length) return;
    emptyRef.current = shots[0].map((_, idx) => meanVec(shots.map((s) => s[idx])));
    cellsRef.current.forEach((c) => { c.occ = 0; c.cand = null; c.streak = 0; });
    persist();
    onLog && onLog('Prototipe "kosong" direkam untuk semua sel.');
    force((n) => n + 1);
  };

  // Daftarkan kelas baru dari 5 foto sel terpilih (few-shot, tanpa pelatihan ulang).
  const register = async () => {
    if (!quadRef.current || !label.trim()) return;
    const c = selected % COLS, r = Math.floor(selected / COLS);
    const embs = [];
    for (let k = 0; k < 5; k++) {
      setStatus(`Mendaftarkan "${label}": foto ${k + 1}/5 (geser/putar benda sedikit)`);
      const img = grab();
      if (img) embs.push((await embed([cropCell(img, quadRef.current, c, r, info.size)])).embs[0]);
      await sleep(350);
    }
    protoRef.current[label.trim()] = meanVec(embs);
    persist();
    onLog && onLog(`Kelas baru "${label.trim()}" terdaftar dari ${embs.length} foto (tanpa pelatihan ulang).`);
    setStatus('Memantau lorong');
    force((n) => n + 1);
  };

  const removeClass = (k) => {
    delete protoRef.current[k];
    persist();
    force((n) => n + 1);
  };

  // Benchmark: 100 kali embedding semua sel dari frame saat ini.
  const benchmark = async () => {
    const img = grab();
    if (!img || !quadRef.current) return;
    const crops = allCrops(img);
    const per = [];
    await embed(crops); // warm-up
    for (let k = 0; k < 100; k++) {
      const res = await embed(crops);
      per.push(res.ms / crops.length);
    }
    const msg = `Benchmark ${info.mode} (${info.size}px, ${crops.length} sel x 100): per crop p50 ${pct(per, 0.5).toFixed(2)} ms, p95 ${pct(per, 0.95).toFixed(2)} ms; ${navigator.hardwareConcurrency || '?'} thread logis; ${navigator.userAgent.match(/(Chrome|Firefox|Edg)\/[\d.]+/)?.[0] || ''}`;
    onLog && onLog(msg);
    // salinan ke console untuk dimasukkan ke laporan teknis
    console.log('[benchmark]', msg, per);
  };

  const btn = (bg, fg = '#fff') => ({ backgroundColor: bg, color: fg, border: 'none', padding: '7px 11px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' });

  return (
    <div style={{ backgroundColor: '#fff', padding: '15px 20px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1rem' }}>Kamera Edge (peramban, luring)</h3>
        <span style={{ fontSize: '0.75rem', padding: '3px 8px', borderRadius: '6px', backgroundColor: info.mode === 'onnx' ? '#dcfce7' : '#fef3c7', color: '#334155' }}>
          {info.mode === 'onnx' ? `ONNX Runtime Web · ${info.size}px` : info.mode === 'fallback' ? 'Embedding fallback (model belum dipasang)' : info.mode}
        </span>
      </div>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', backgroundColor: '#0f172a', borderRadius: '8px', overflow: 'hidden' }}>
        <video ref={videoRef} muted playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', display: source === 'image' ? 'none' : 'block' }} />
        {source === 'image' && imgSrc && <img src={imgSrc} alt="sumber" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill' }} />}
        <canvas ref={overlayRef} width={FW} height={FH} onClick={onOverlayClick} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: calibrating ? 'crosshair' : 'pointer' }} />
        <canvas ref={workRef} width={FW} height={FH} style={{ display: 'none' }} />
      </div>
      <div style={{ fontSize: '0.8rem', color: faultRef.current ? '#dc2626' : '#475569', fontWeight: faultRef.current ? 700 : 400 }}>Status: {status}</div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {source !== 'webcam' && <button style={btn('#2563eb')} onClick={start}>▶ Nyalakan kamera</button>}
        <label style={{ ...btn('#0369a1'), display: 'inline-block' }}>
          🖼 Unggah gambar
          <input type="file" accept="image/*" onChange={onUpload} style={{ display: 'none' }} />
        </label>
        <select defaultValue="" onChange={(e) => { if (e.target.value) useImage(`/samples/${e.target.value}`, e.target.value); }} style={{ padding: '6px', fontSize: '0.8rem' }}>
          <option value="" disabled>Contoh gambar…</option>
          {SAMPLES.map(([f, t]) => <option key={f} value={f}>{t}</option>)}
        </select>
        <button style={btn('#475569')} onClick={usePresetQuad}>Preset contoh</button>
        <button style={btn(calibrating ? '#b45309' : '#64748b')} onClick={() => { clicksRef.current = []; setCalibrating(true); setStatus('Klik 4 sudut lorong: kiri-atas, kanan-atas, kanan-bawah, kiri-bawah'); }}>📐 Kalibrasi lorong</button>
        <button style={btn('#16a34a')} onClick={calibrateEmpty}>Kalibrasi kosong</button>
        <button style={btn('#7c3aed')} onClick={benchmark}>⏱ Benchmark</button>
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8rem' }}>
        <span>Sel terpilih: <b>{selected + 1}</b></span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: '90px', padding: '4px' }} />
        <button style={btn('#0f766e')} onClick={register}>➕ Daftarkan (5 foto)</button>
        <label>τ {tau.toFixed(2)} <input type="range" min="0.5" max="0.99" step="0.01" value={tau} onChange={(e) => setTau(parseFloat(e.target.value))} /></label>
        <label>Debounce <input type="number" min="1" max="10" value={debounceN} onChange={(e) => setDebounceN(Math.max(1, parseInt(e.target.value, 10) || 1))} style={{ width: '40px' }} /></label>
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', fontSize: '0.75rem' }}>
        {Object.keys(protoRef.current).length === 0 && <span style={{ color: '#64748b' }}>Belum ada kelas terdaftar.</span>}
        {Object.keys(protoRef.current).map((k) => (
          <span key={k} style={{ backgroundColor: '#e0e7ff', padding: '2px 8px', borderRadius: '10px' }}>
            {k} <a style={{ cursor: 'pointer', color: '#dc2626' }} onClick={() => removeClass(k)}>×</a>
          </span>
        ))}
      </div>
      <div style={{ fontSize: '0.8rem', color: '#334155' }}>
        Latensi embedding per crop: p50 <b>{stats.p50.toFixed(1)} ms</b> · p95 <b>{stats.p95.toFixed(1)} ms</b> (n={stats.n})
      </div>
    </div>
  );
}
