import React, { useEffect, useRef, useState } from 'react';
import CanvasGrid from './CanvasGrid';

export default function App() {
  const [isWasmReady, setIsWasmReady] = useState(false);
  const [fleetStats, setFleetStats] = useState([
    { id: 0, x: 0, y: 0, battery: 100, state: 0 },
    { id: 1, x: 0, y: 19, battery: 100, state: 0 },
    { id: 2, x: 19, y: 0, battery: 100, state: 0 },
  ]);
  const [logs, setLogs] = useState(["[System] Initialized C++ WebAssembly multi-agent runtime environment."]);
  
  const cpp = useRef({});
  const prevStateRef = useRef([0, 0, 0]);

  // ---------- Scenario A state ----------
  const [clickMode, setClickMode] = useState('dispatch'); // 'dispatch' | 'object'
  const [capacity, setCapacity] = useState(2);
  const [zone, setZone] = useState({ occupied: 0, full: false });
  const [kpi, setKpi] = useState({ replans: 0, detour: 0, trips: 0, distance: 0 });
  const [latencies, setLatencies] = useState([]); // ms, event -> alert painted
  const [muted, setMuted] = useState(false);
  const zoneFullRef = useRef(false);
  const audioRef = useRef(null);
  const buzzerTimerRef = useRef(null);
  const mutedRef = useRef(false);
  const scenarioTimersRef = useRef([]);

  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 6)]);
  };

  useEffect(() => {
    const checkWasm = setInterval(() => {
      if (window.Module && window.Module._init_fleet) {
        clearInterval(checkWasm);
        
        cpp.current = {
          initFleet: window.Module.cwrap('init_fleet', 'null', ['number']),
          updateSim: window.Module.cwrap('update_simulation', 'null', ['number']),
          assignTask: window.Module.cwrap('assign_task', 'null', ['number', 'number', 'number']),
          emergencyRecall: window.Module.cwrap('emergency_recall', 'null', ['number']),
          getRobotX: window.Module.cwrap('get_robot_x', 'number', ['number']),
          getRobotY: window.Module.cwrap('get_robot_y', 'number', ['number']),
          getBattery: window.Module.cwrap('get_robot_battery', 'number', ['number']),
          getState: window.Module.cwrap('get_robot_state', 'number', ['number']),
          setObstacle: window.Module.cwrap('set_obstacle', 'null', ['number', 'number', 'number']),
          getActivePathLength: window.Module.cwrap('get_active_path_length', 'number', ['number']),
          getActivePathX: window.Module.cwrap('get_active_path_x', 'number', ['number', 'number']),
          getActivePathY: window.Module.cwrap('get_active_path_y', 'number', ['number', 'number']),
          // Scenario A
          setCellOccupied: window.Module.cwrap('set_cell_occupied', 'null', ['number', 'number', 'number']),
          getCellOccupied: window.Module.cwrap('get_cell_occupied', 'number', ['number', 'number']),
          setZone: window.Module.cwrap('set_zone', 'null', ['number', 'number', 'number', 'number']),
          setZoneCapacity: window.Module.cwrap('set_zone_capacity', 'null', ['number']),
          getZoneCapacity: window.Module.cwrap('get_zone_capacity', 'number', []),
          getZoneOccupied: window.Module.cwrap('get_zone_occupied', 'number', []),
          getZoneFull: window.Module.cwrap('get_zone_full', 'number', []),
          getZoneBound: window.Module.cwrap('get_zone_bound', 'number', ['number']),
          clearOccupancy: window.Module.cwrap('clear_occupancy', 'null', []),
          resetKpi: window.Module.cwrap('reset_kpi', 'null', []),
          getRobotDistance: window.Module.cwrap('get_robot_distance', 'number', ['number']),
          getTotalReplans: window.Module.cwrap('get_total_replans', 'number', []),
          getTotalTrips: window.Module.cwrap('get_total_trips', 'number', []),
          getTotalDetour: window.Module.cwrap('get_total_detour', 'number', []),
        };
        cpp.current.setZoneCapacity(2);

        cpp.current.initFleet(3);
        
        for(let y = 5; y < 15; y++) {
          cpp.current.setObstacle(10, y, 1); 
        }

        setIsWasmReady(true);
        addLog("WASM binary bound successfully. Fleet spawned at distributed docks.");
      }
    }, 100);
    return () => clearInterval(checkWasm);
  }, []);

  // Poll telemetry & detect state/fail-safe transitions for activity log
  useEffect(() => {
    if (!isWasmReady) return;

    const telemetryInterval = setInterval(() => {
      const updated = [];
      for (let i = 0; i < 3; i++) {
        const state = cpp.current.getState(i);
        const battery = cpp.current.getBattery(i);
        const x = cpp.current.getRobotX(i);
        const y = cpp.current.getRobotY(i);

        // Detect state changes to log autonomous events
        if (prevStateRef.current[i] !== state) {
          if (state === 2) {
            addLog(`Robot R${i} docked and entered CHARGING state at (${x.toFixed(0)}, ${y.toFixed(0)})`);
          } else if (state === 3) {
            addLog(`SAFETY STOP: Robot R${i} halted, shared zone is full`);
          } else if (state === 1 && prevStateRef.current[i] === 3) {
            addLog(`Robot R${i} resumed, zone below capacity`);
          } else if (state === 1 && battery < 40) {
            addLog(`Robot R${i} triggered Dynamic Distance-to-Dock re-routing (Low Battery)`);
          }
          prevStateRef.current[i] = state;
        }

        updated.push({ id: i, x, y, battery, state });
      }
      setFleetStats(updated);
      let distance = 0;
      for (let i = 0; i < 3; i++) distance += cpp.current.getRobotDistance(i);
      setKpi({
        replans: cpp.current.getTotalReplans(),
        detour: cpp.current.getTotalDetour(),
        trips: cpp.current.getTotalTrips(),
        distance,
      });
    }, 250);

    return () => clearInterval(telemetryInterval);
  }, [isWasmReady]);

  const handleResetFleet = () => {
    if (!isWasmReady) return;
    scenarioTimersRef.current.forEach(clearTimeout);
    scenarioTimersRef.current = [];
    cpp.current.initFleet(3);
    cpp.current.clearOccupancy();
    cpp.current.resetKpi();
    setLatencies([]);
    applyZoneState(null);
    addLog("Manual Action: Fleet, zone objects and KPIs reset.");
  };

  // ---------- Buzzer (Web Audio, no assets needed) ----------
  const beep = () => {
    if (mutedRef.current) return;
    try {
      if (!audioRef.current) audioRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } catch (e) { /* audio unavailable */ }
  };

  const setBuzzer = (on) => {
    if (on && !buzzerTimerRef.current) {
      beep();
      buzzerTimerRef.current = setInterval(beep, 500);
    } else if (!on && buzzerTimerRef.current) {
      clearInterval(buzzerTimerRef.current);
      buzzerTimerRef.current = null;
    }
  };

  useEffect(() => () => setBuzzer(false), []);

  // Evaluate zone after every occupancy event; measure event -> alert painted latency.
  const applyZoneState = (eventT0) => {
    const occupied = cpp.current.getZoneOccupied();
    const full = cpp.current.getZoneFull() === 1;
    setZone({ occupied, full });
    if (full && !zoneFullRef.current) {
      setBuzzer(true);
      addLog(`ALERT: Shared zone FULL (${occupied}/${cpp.current.getZoneCapacity()}). Buzzer ON, AMRs stopping.`);
      if (eventT0 != null) {
        // two rAFs = the frame containing the alert has been painted
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const ms = performance.now() - eventT0;
          setLatencies(prev => [...prev.slice(-49), ms]);
        }));
      }
    } else if (!full && zoneFullRef.current) {
      setBuzzer(false);
      addLog(`Zone below capacity (${occupied}/${cpp.current.getZoneCapacity()}). Buzzer OFF.`);
    }
    zoneFullRef.current = full;
  };

  // Single entry point for occupancy events (manual click, scripted scenario, or edge node).
  const handleOccupancyEvent = (x, y, occupiedFlag, source = 'operator', t0 = performance.now()) => {
    if (!isWasmReady) return;
    const value = occupiedFlag === undefined ? (cpp.current.getCellOccupied(x, y) ? 0 : 1) : (occupiedFlag ? 1 : 0);
    cpp.current.setCellOccupied(x, y, value);
    addLog(`[${source}] Cell (${x}, ${y}) ${value ? 'OCCUPIED' : 'cleared'}`);
    applyZoneState(t0);
  };

  const handleCapacityChange = (value) => {
    const c = Math.max(1, Math.min(16, parseInt(value, 10) || 1));
    setCapacity(c);
    if (!isWasmReady) return;
    cpp.current.setZoneCapacity(c);
    addLog(`Operator set shared-zone capacity to ${c}`);
    applyZoneState(performance.now());
  };

  // Scripted Scenario A for a repeatable demo (same steps every time).
  const runScenarioA = () => {
    if (!isWasmReady) return;
    handleResetFleet();
    cpp.current.setZoneCapacity(capacity);
    const T = (ms, fn) => scenarioTimersRef.current.push(setTimeout(fn, ms));
    addLog(`Scenario A started (capacity ${capacity}).`);
    cpp.current.assignTask(2, 11, 3);
    T(4500, () => { cpp.current.assignTask(2, 11, 17); addLog('Dispatched Robot R2 through the shared aisle to (11, 17)'); });
    T(5200, () => handleOccupancyEvent(11, 10, 1, 'scenario'));
    T(6000, () => handleOccupancyEvent(12, 12, 1, 'scenario'));
    T(10000, () => handleOccupancyEvent(12, 12, 0, 'scenario'));
  };

  // Optional edge-node feed: open the page with ?ws=ws://localhost:8765
  // Messages: {"type":"cell","x":11,"y":10,"occupied":1}
  useEffect(() => {
    if (!isWasmReady) return;
    const url = new URLSearchParams(window.location.search).get('ws');
    window.amrOccupancy = (x, y, occ) => handleOccupancyEvent(x, y, occ, 'edge-api');
    if (!url) return;
    let ws;
    try {
      ws = new WebSocket(url);
      ws.onopen = () => addLog(`Edge node connected: ${url}`);
      ws.onmessage = (m) => {
        const t0 = performance.now();
        try {
          const msg = JSON.parse(m.data);
          if (msg.type === 'cell') handleOccupancyEvent(msg.x, msg.y, msg.occupied, 'edge-cam', t0);
        } catch (e) { addLog('Edge node: invalid message ignored'); }
      };
      ws.onclose = () => addLog('Edge node disconnected');
    } catch (e) { addLog(`Edge node connection failed: ${url}`); }
    return () => ws && ws.close();
  }, [isWasmReady]);

  const latencyStats = (() => {
    if (!latencies.length) return null;
    const sorted = [...latencies].sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    return { n: sorted.length, p50: q(0.5), p95: q(0.95), last: latencies[latencies.length - 1] };
  })();

  const handleEmergencyRecall = () => {
    if (!isWasmReady) return;
    for (let i = 0; i < 3; i++) {
      cpp.current.emergencyRecall(i);
    }
    addLog("Emergency Override: All units evaluating A* paths to nearest charging dock.");
  };

  const getStateLabel = (state) => {
    if (state === 3) return { text: 'HALTED', color: '#ef4444' };
    if (state === 2) return { text: 'CHARGING', color: '#eab308' };
    if (state === 1) return { text: 'MOVING', color: '#3b82f6' };
    return { text: 'IDLE', color: '#22c55e' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: 'system-ui, sans-serif', padding: '30px 20px', backgroundColor: '#f8fafc', minHeight: '100vh', color: '#334155' }}>
      
      {/* Header Section */}
      <div style={{ textAlign: 'center', maxWidth: '950px', marginBottom: '25px' }}>
        <h1 style={{ color: '#0f172a', margin: '0 0 8px 0' }}>AMR Fleet Real-Time Simulator</h1>
        <p style={{ fontSize: '1.05rem', color: '#64748b', margin: 0 }}>Enterprise Industrial Digital Twin powered by C++ WebAssembly & React</p>
      </div>

      {/* Main Content Layout */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '30px', justifyContent: 'center', width: '100%', maxWidth: '1350px' }}>
        
        {/* Left Column: Canvas, Toolbar & Telemetry */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '640px' }}>
          
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {!isWasmReady ? (
              <div style={{ padding: '150px 100px', textAlign: 'center', fontWeight: 'bold', color: '#64748b' }}>
                Initializing C++ WASM Engine...
              </div>
            ) : (
              <>
                <CanvasGrid cpp={cpp.current} clickMode={clickMode} onCellToggle={(gx, gy) => handleOccupancyEvent(gx, gy, undefined, 'operator')} onTaskAssigned={(id, gx, gy) => addLog(`Dispatched Robot R${id} to grid coordinate (${gx}, ${gy})`)} />
                <div style={{ marginTop: '15px', padding: '10px 15px', backgroundColor: '#f1f5f9', borderRadius: '8px', color: '#475569', fontSize: '0.85rem', width: '100%', textAlign: 'center', boxSizing: 'border-box' }}>
                  <strong>Interactive:</strong> {clickMode === 'object' ? <>Click a cell to place/remove a detected object (simulated edge camera).</> : <>Click open grid to dispatch nearest</>} {clickMode !== 'object' && <><span style={{ color: '#22c55e', fontWeight: 'bold' }}>IDLE</span> robot. Units navigate around <strong>Warehouse Walls</strong>.</>}
                </div>
              </>
            )}
          </div>

          {/* Scenario A: Shared Zone Safety (PS-5 / PS-4) */}
          <div style={{ backgroundColor: zone.full ? '#fef2f2' : '#fff', border: zone.full ? '2px solid #ef4444' : '2px solid transparent', padding: '15px 20px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1rem' }}>Scenario A: Shared Zone Safety</h3>
              <span style={{ fontWeight: 'bold', padding: '4px 10px', borderRadius: '6px', color: '#fff', backgroundColor: zone.full ? '#dc2626' : '#16a34a' }}>
                {zone.full ? '🔊 ZONE FULL - AMR STOP' : 'ZONE OK'} ({zone.occupied}/{capacity})
              </span>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem' }}>
              <label>Capacity:{' '}
                <input type="number" min="1" max="16" value={capacity} onChange={(e) => handleCapacityChange(e.target.value)} style={{ width: '50px', padding: '4px' }} />
              </label>
              <button onClick={() => setClickMode(clickMode === 'object' ? 'dispatch' : 'object')}
                style={{ backgroundColor: clickMode === 'object' ? '#b45309' : '#e2e8f0', color: clickMode === 'object' ? '#fff' : '#334155', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}>
                {clickMode === 'object' ? '📦 Mode: Place Object' : '🤖 Mode: Dispatch Robot'}
              </button>
              <button onClick={runScenarioA}
                style={{ backgroundColor: '#2563eb', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}>
                ▶ Run Scenario A
              </button>
              <button onClick={() => { const m = !muted; setMuted(m); mutedRef.current = m; }}
                style={{ backgroundColor: '#e2e8f0', color: '#334155', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}>
                {muted ? '🔇 Buzzer muted' : '🔊 Buzzer on'}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', fontSize: '0.8rem' }}>
              {[
                ['Alert latency p50', latencyStats ? `${latencyStats.p50.toFixed(1)} ms` : '-'],
                ['Alert latency p95', latencyStats ? `${latencyStats.p95.toFixed(1)} ms (n=${latencyStats.n})` : '-'],
                ['Re-routes / detour', `${kpi.replans} / +${kpi.detour.toFixed(0)} cells`],
                ['Trips / distance', `${kpi.trips} / ${kpi.distance.toFixed(1)} cells`],
              ].map(([k, v]) => (
                <div key={k} style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px' }}>
                  <div style={{ color: '#64748b' }}>{k}</div>
                  <div style={{ fontWeight: 'bold', color: '#0f172a' }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* FMS Controls */}
          <div style={{ backgroundColor: '#fff', padding: '15px 20px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', display: 'flex', gap: '15px', justifyContent: 'center', alignItems: 'center' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#475569' }}>FMS Controls:</span>
            <button 
              onClick={handleEmergencyRecall}
              style={{ backgroundColor: '#f59e0b', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' }}>
              ⚡ Emergency Recall (Nearest Dock)
            </button>
            <button 
              onClick={handleResetFleet}
              style={{ backgroundColor: '#64748b', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' }}>
              🔄 Reset Fleet
            </button>
          </div>

          {/* Live Fleet Telemetry Card Panel */}
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '12px', color: '#0f172a', fontSize: '1rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '6px' }}>
              Live Fleet Telemetry (C++ Memory State)
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {fleetStats.map(robot => {
                const badge = getStateLabel(robot.state);
                return (
                  <div key={robot.id} style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 'bold', fontSize: '0.9rem', color: '#1e293b' }}>
                      <span>Robot R{robot.id}</span>
                      <span style={{ fontSize: '0.7rem', padding: '2px 5px', borderRadius: '4px', backgroundColor: badge.color + '20', color: badge.color }}>
                        {badge.text}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      Pos: ({robot.x.toFixed(1)}, {robot.y.toFixed(1)})
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '2px', color: '#475569' }}>
                        <span>Battery</span>
                        <span>{robot.battery.toFixed(0)}%</span>
                      </div>
                      <div style={{ width: '100%', height: '6px', backgroundColor: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${robot.battery}%`, height: '100%', backgroundColor: robot.battery < 25 ? '#ef4444' : '#22c55e', transition: 'width 0.2s ease' }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Interactive Event Ticker */}
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '10px', color: '#0f172a', fontSize: '1rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '6px' }}>
              System Event Activity Log
            </h3>
            <div style={{ backgroundColor: '#0f172a', color: '#38bdf8', fontFamily: 'monospace', fontSize: '0.78rem', padding: '10px', borderRadius: '6px', height: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {logs.map((log, index) => (
                <div key={index}>{log}</div>
              ))}
            </div>
          </div>

        </div>

        {/* Right Column: Exhaustive Technical Documentation */}
        <div style={{ flex: '1', minWidth: '400px', maxWidth: '580px', backgroundColor: '#fff', padding: '30px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', display: 'flex', flexDirection: 'column', gap: '22px' }}>
          
          <div>
            <h3 style={{ marginTop: 0, color: '#0f172a', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px' }}>Project Background & Engineering Goals</h3>
            <p style={{ fontSize: '0.9rem', lineHeight: '1.6', color: '#475569', margin: '8px 0 0 0' }}>
              In modern automated smart factories and fulfillment centers, orchestrating multi-agent fleets of Autonomous Mobile Robots (AMRs) requires deterministic, low-latency collision avoidance and resource-aware scheduling. This project establishes an industrial digital twin to rigorously evaluate real-time kinematics, grid path planning, and autonomous power management under constrained operational parameters.
            </p>
          </div>

          <div>
            <h3 style={{ color: '#0f172a', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px', marginTop: 0 }}>System Architecture & Concurrent Processing</h3>
            <p style={{ fontSize: '0.9rem', lineHeight: '1.6', color: '#475569', margin: '8px 0 0 0' }}>
              To achieve near-native execution speeds without backend server latency, the core simulation engine is implemented in native <strong>C++</strong> and compiled to <strong>WebAssembly (WASM)</strong> via Emscripten. 
            </p>
            <p style={{ fontSize: '0.9rem', lineHeight: '1.6', color: '#475569', margin: '8px 0 0 0' }}>
              <strong>Concurrent Memory Architecture:</strong> The engine manages multiple independent state machines simultaneously inside raw C++ memory vectors. Each unit processes its own position, speed vectors, and battery drain equations in isolation during every simulation tick, while the <strong>React</strong> frontend interacts strictly through lightweight memory pointers rendered via a 60 FPS <code>requestAnimationFrame</code> loop.
            </p>
          </div>

          <div>
            <h3 style={{ color: '#0f172a', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px', marginTop: 0 }}>Multi-Robot Fleet & Distributed Charging Stations</h3>
            <p style={{ fontSize: '0.9rem', lineHeight: '1.6', color: '#475569', margin: '8px 0 0 0' }}>
              The warehouse floor models <strong>3 autonomous units</strong> deployed across multiple distributed charging docks marked with ⚡:
            </p>
            <ul style={{ fontSize: '0.88rem', lineHeight: '1.5', color: '#475569', margin: '6px 0 0 20px', padding: 0 }}>
              <li><strong>Decentralized Stations:</strong> Docks are strategically placed across the floor coordinates <code>(0,0)</code>, <code>(0,19)</code>, and <code>(19,0)</code> to prevent single points of failure.</li>
              <li><strong>Collision Boundaries:</strong> A central impassable <strong>Warehouse Wall / Rack Obstacle</strong> forces units to calculate valid alternate trajectories.</li>
            </ul>
          </div>

          <div>
            <h3 style={{ color: '#0f172a', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px', marginTop: 0 }}>Method: Dynamic Distance-to-Dock Evaluation</h3>
            <div style={{ fontSize: '0.88rem', lineHeight: '1.5', color: '#475569', display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              <div><strong style={{ color: '#22c55e' }}>1. IDLE (Green):</strong> Standby state awaiting task dispatches.</div>
              <div><strong style={{ color: '#3b82f6' }}>2. MOVING (Blue):</strong> Traverses the floor using A* grid pathfinding while depleting energy reserves.</div>
              <div><strong style={{ color: '#eab308' }}>3. Dynamic Distance-to-Dock Fail-Safe (Yellow):</strong> 
                Rather than using a rigid static battery percentage threshold, the robot continuously computes the exact A* path length to <em>every</em> available charging station. It evaluates traversal cost against remaining battery reserve plus a safety buffer. If energy becomes critical, current instructions are overridden to execute an autonomous emergency return to the <strong>nearest</strong> charging dock.
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}