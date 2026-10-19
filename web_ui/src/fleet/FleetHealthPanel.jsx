import React, { useEffect, useRef, useState } from 'react';

// PS-1: satu dasbor untuk 3 jenis device (AMR, kamera edge, sensor gudang) + deteksi device "sakit"
// sebelum offline. Telemetri sensor & kesehatan perangkat disimulasikan di peramban; baterai AMR
// diambil langsung dari engine WASM, status kamera dari panel Kamera Edge.
// Prediksi: regresi garis lurus pada jendela data terakhir -> perkiraan waktu sampai ambang (ETA).

const SIM_FACTOR = 60;        // 1 detik nyata = 1 menit simulasi
const TICK_MS = 1000;
const WINDOW = 12;            // jumlah sampel untuk regresi tren
const WARN_MIN = 30;          // tandai "berisiko" bila ETA < 30 menit simulasi

const SIGNALS = {
  battery: { label: 'Baterai', unit: '%', limit: 5, dir: -1 },
  rssi: { label: 'Sinyal', unit: 'dBm', limit: -90, dir: -1 },
  mem: { label: 'Memori', unit: '%', limit: 98, dir: 1 },
  temp: { label: 'Suhu', unit: '°C', limit: 85, dir: 1 },
};

const FAULTS = [
  ['mem_leak', 'Memory leak'],
  ['battery_drop', 'Baterai cepat habis'],
  ['signal', 'Sinyal memburuk'],
  ['overheat', 'Panas berlebih'],
  ['stuck', 'Sensor macet (data janggal)'],
];

function makeDevices(numRobots) {
  const devs = [];
  for (let i = 0; i < numRobots; i++) devs.push({ id: `R${i}`, type: 'AMR', icon: '🤖', robot: i });
  devs.push({ id: 'CAM-01', type: 'Kamera edge', icon: '📷' });
  devs.push({ id: 'CAM-02', type: 'Kamera edge', icon: '📷' });
  ['ENV-01', 'ENV-02', 'ENV-03'].forEach((id) => devs.push({ id, type: 'Sensor gudang', icon: '🌡️' }));
  return devs.map((d, k) => ({
    ...d,
    sig: {
      battery: d.type === 'AMR' ? 100 : 90 - k * 3,
      rssi: -55 - k * 2,
      mem: 35 + k * 3,
      temp: d.type === 'Sensor gudang' ? 28 + k * 0.3 : 45 + k,
      env: 29 + k * 0.2, // suhu ruang gudang yang diukur sensor
    },
    hist: [],
    fault: null,
    status: 'OK',
    reasons: [],
    eta: null,
    flaggedAt: null,
    offlineAt: null,
    leadTime: null,
  }));
}

// Kemiringan regresi linear per menit simulasi.
function slope(ys) {
  const n = ys.length;
  if (n < 4) return 0;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxy += i * ys[i]; sxx += i * i; }
  const d = n * sxx - sx * sx;
  return d ? (n * sxy - sx * sy) / d : 0;
}

export default function FleetHealthPanel({ cpp, numRobots = 3, cameraStatusRef, onLog }) {
  const devRef = useRef(makeDevices(numRobots));
  const simMinRef = useRef(0);
  const [, force] = useState(0);
  const [target, setTarget] = useState('CAM-02');
  const [faultKind, setFaultKind] = useState('mem_leak');
  const [summary, setSummary] = useState({ flagged: 0, offline: 0, leads: [] });

  const tick = () => {
    simMinRef.current += (TICK_MS / 1000) * SIM_FACTOR / 60;
    const tMin = simMinRef.current;
    const leads = [];
    devRef.current.forEach((d) => {
      if (d.status === 'OFFLINE') return;
      const s = d.sig;
      const noise = () => (Math.random() - 0.5);
      // dinamika normal
      // nilai normal kembali ke titik kerjanya; sinyal yang sedang diganggu tidak dipulihkan
      s.rssi += noise() * 1.5 + (d.fault === 'signal' ? 0 : (-58 - s.rssi) * 0.1);
      s.mem += noise() * 0.6 + (d.fault === 'mem_leak' ? 0 : (40 - s.mem) * 0.05);
      s.temp += noise() * 0.4 + (d.fault === 'overheat' ? 0 : ((d.type === 'Sensor gudang' ? 29 : 48) - s.temp) * 0.05);
      if (d.type === 'AMR' && cpp && cpp.getBattery) s.battery = cpp.getBattery(d.robot);
      else s.battery -= 0.02;
      if (d.fault !== 'stuck') s.env += noise() * 0.3;
      // gangguan yang disuntikkan
      if (d.fault === 'mem_leak') s.mem += 1.5;
      if (d.fault === 'battery_drop') s.battery -= 2.5;
      if (d.fault === 'signal') s.rssi -= 1.6;
      if (d.fault === 'overheat') s.temp += 1.8;
      // kamera nyata: gangguan sensor dari panel Kamera Edge
      if (d.id === 'CAM-01' && cameraStatusRef?.current?.fault) d.camFault = true; else if (d.id === 'CAM-01') d.camFault = false;

      d.hist.push({ battery: s.battery, rssi: s.rssi, mem: s.mem, temp: s.temp, env: s.env });
      if (d.hist.length > 60) d.hist.shift();

      // perangkat benar-benar offline bila melewati ambang
      const dead = (d.type !== 'AMR' && s.battery <= SIGNALS.battery.limit) || s.rssi <= SIGNALS.rssi.limit || s.mem >= SIGNALS.mem.limit || s.temp >= SIGNALS.temp.limit;
      if (dead) {
        d.status = 'OFFLINE';
        d.offlineAt = tMin;
        if (d.flaggedAt !== null) d.leadTime = d.offlineAt - d.flaggedAt;
        onLog && onLog(`${d.id} OFFLINE pada menit ${tMin.toFixed(0)}${d.leadTime !== null ? ` — sudah ditandai ${d.leadTime.toFixed(0)} menit sebelumnya` : ' — tidak sempat ditandai'}.`);
        return;
      }

      // prediksi tren -> ETA ke ambang
      const win = d.hist.slice(-WINDOW);
      let best = null;
      const reasons = [];
      Object.entries(SIGNALS).forEach(([k, def]) => {
        if (k === 'battery' && d.type === 'AMR') return; // AMR mengisi daya sendiri di dock
        const sl = slope(win.map((h) => h[k]));
        const toward = def.dir > 0 ? sl > 0.05 : sl < -0.05;
        if (!toward) return;
        const eta = (def.limit - s[k]) / sl; // menit simulasi
        if (eta > 0 && eta < 600) {
          reasons.push({ k, eta, txt: `${def.label} ${sl > 0 ? '+' : ''}${sl.toFixed(1)} ${def.unit}/menit` });
          if (!best || eta < best) best = eta;
        }
      });
      // data janggal: nilai sensor tidak berubah sama sekali (macet)
      const envWin = win.map((h) => h.env);
      const flat = d.type === 'Sensor gudang' && envWin.length >= WINDOW && Math.max(...envWin) - Math.min(...envWin) < 1e-6;
      reasons.sort((a, b) => a.eta - b.eta);
      d.reasons = reasons.slice(0, 3).map((r) => r.txt);
      if (flat) d.reasons.unshift('Data janggal: nilai sensor macet');
      if (d.camFault) d.reasons.unshift('Gangguan sensor kamera (tertutup/gelap)');
      d.eta = best;
      const risky = (best !== null && best < WARN_MIN) || flat || d.camFault;
      const newStatus = risky ? 'BERISIKO' : 'OK';
      if (newStatus === 'BERISIKO' && d.status !== 'BERISIKO') {
        d.flaggedAt = tMin;
        onLog && onLog(`PERINGATAN ${d.id}: ${d.reasons[0] || 'tren memburuk'}${best !== null ? `, perkiraan offline ±${best.toFixed(0)} menit` : ''}.`);
      }
      d.status = newStatus;
    });
    devRef.current.forEach((d) => { if (d.leadTime !== null) leads.push(d.leadTime); });
    setSummary({
      flagged: devRef.current.filter((d) => d.status === 'BERISIKO').length,
      offline: devRef.current.filter((d) => d.status === 'OFFLINE').length,
      leads,
    });
    force((n) => n + 1);
  };

  useEffect(() => {
    const h = setInterval(tick, TICK_MS);
    return () => clearInterval(h);
  }, []);

  const inject = () => {
    const d = devRef.current.find((x) => x.id === target);
    if (!d || d.status === 'OFFLINE') return;
    d.fault = faultKind;
    onLog && onLog(`Gangguan "${FAULTS.find((f) => f[0] === faultKind)[1]}" disuntikkan ke ${d.id}.`);
  };

  const reset = () => {
    devRef.current = makeDevices(numRobots);
    simMinRef.current = 0;
    setSummary({ flagged: 0, offline: 0, leads: [] });
    onLog && onLog('Armada perangkat di-reset.');
  };

  const color = (st) => (st === 'OFFLINE' ? '#6b7280' : st === 'BERISIKO' ? '#dc2626' : '#16a34a');
  const types = [...new Set(devRef.current.map((d) => d.type))];
  const medianLead = summary.leads.length ? [...summary.leads].sort((a, b) => a - b)[Math.floor(summary.leads.length / 2)] : null;

  return (
    <div style={{ backgroundColor: '#fff', padding: '15px 20px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
        <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1rem' }}>Kesehatan Armada Perangkat (PS-1)</h3>
        <span style={{ fontSize: '0.75rem', color: '#475569' }}>
          {types.length} jenis device · menit simulasi {simMinRef.current.toFixed(0)} (×{SIM_FACTOR}) · data sensor & kesehatan disimulasikan
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', fontSize: '0.8rem' }}>
        {[['Device berisiko', summary.flagged], ['Device offline', summary.offline], ['Median lead time', medianLead !== null ? `${medianLead.toFixed(0)} menit` : '-'], ['Ditandai sebelum offline', `${summary.leads.length}/${summary.offline}`]].map(([k, v]) => (
          <div key={k} style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px' }}>
            <div style={{ color: '#64748b' }}>{k}</div>
            <div style={{ fontWeight: 'bold', color: '#0f172a' }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748b' }}>
              <th>Device</th><th>Jenis</th><th>Status</th><th>Baterai</th><th>Sinyal</th><th>Memori</th><th>Suhu</th><th>Perkiraan offline</th><th>Alasan</th>
            </tr>
          </thead>
          <tbody>
            {devRef.current.map((d) => (
              <tr key={d.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                <td>{d.icon} {d.id}</td>
                <td>{d.type}</td>
                <td><span style={{ color: '#fff', backgroundColor: color(d.status), padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>{d.status}</span></td>
                <td>{d.sig.battery.toFixed(0)}%</td>
                <td>{d.sig.rssi.toFixed(0)} dBm</td>
                <td>{d.sig.mem.toFixed(0)}%</td>
                <td>{d.sig.temp.toFixed(0)}°C</td>
                <td>{d.status === 'OFFLINE' ? '—' : d.eta !== null ? `±${d.eta.toFixed(0)} menit` : '-'}</td>
                <td style={{ color: '#475569' }}>{d.reasons.join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8rem' }}>
        <span>Suntik gangguan:</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>{devRef.current.map((d) => <option key={d.id}>{d.id}</option>)}</select>
        <select value={faultKind} onChange={(e) => setFaultKind(e.target.value)}>{FAULTS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
        <button onClick={inject} style={{ backgroundColor: '#dc2626', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>⚡ Suntik</button>
        <button onClick={reset} style={{ backgroundColor: '#e2e8f0', border: 'none', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer' }}>Reset armada</button>
      </div>
    </div>
  );
}
