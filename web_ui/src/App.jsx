import React, { useEffect, useRef, useState } from 'react';
import CanvasGrid from './CanvasGrid';

export default function App() {
  const [isWasmReady, setIsWasmReady] = useState(false);
  const [fleetStats, setFleetStats] = useState([
    { id: 0, x: 0, y: 0, battery: 100, state: 0 },
    { id: 1, x: 0, y: 1, battery: 100, state: 0 },
    { id: 2, x: 0, y: 2, battery: 100, state: 0 },
  ]);
  const [logs, setLogs] = useState(["[00:00] System initialized. Fleet docked and ready."]);
  
  const cpp = useRef({});

  // Helper to append events to the live log
  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 5)]); // Keep last 6 logs
  };

  useEffect(() => {
    const checkWasm = setInterval(() => {
      if (window.Module && window.Module._init_fleet) {
        clearInterval(checkWasm);
        
        cpp.current = {
          initFleet: window.Module.cwrap('init_fleet', 'null', ['number']),
          updateSim: window.Module.cwrap('update_simulation', 'null', ['number']),
          assignTask: window.Module.cwrap('assign_task', 'null', ['number', 'number', 'number']),
          getRobotX: window.Module.cwrap('get_robot_x', 'number', ['number']),
          getRobotY: window.Module.cwrap('get_robot_y', 'number', ['number']),
          getBattery: window.Module.cwrap('get_robot_battery', 'number', ['number']),
          getState: window.Module.cwrap('get_robot_state', 'number', ['number']),
          setObstacle: window.Module.cwrap('set_obstacle', 'null', ['number', 'number', 'number']),
          getActivePathLength: window.Module.cwrap('get_active_path_length', 'number', ['number']),
          getActivePathX: window.Module.cwrap('get_active_path_x', 'number', ['number', 'number']),
          getActivePathY: window.Module.cwrap('get_active_path_y', 'number', ['number', 'number']),
        };

        cpp.current.initFleet(3);
        
        for(let y = 5; y < 15; y++) {
          cpp.current.setObstacle(10, y, 1); 
        }

        setIsWasmReady(true);
        addLog("C++ WASM Engine loaded successfully.");
      }
    }, 100);
    return () => clearInterval(checkWasm);
  }, []);

  // Poll telemetry data from C++ memory for React UI state cards
  useEffect(() => {
    if (!isWasmReady) return;

    const telemetryInterval = setInterval(() => {
      const updated = [];
      for (let i = 0; i < 3; i++) {
        updated.push({
          id: i,
          x: cpp.current.getRobotX(i),
          y: cpp.current.getRobotY(i),
          battery: cpp.current.getBattery(i),
          state: cpp.current.getState(i),
        });
      }
      setFleetStats(updated);
    }, 200);

    return () => clearInterval(telemetryInterval);
  }, [isWasmReady]);

  // Toolbar Actions
  const handleResetFleet = () => {
    if (!isWasmReady) return;
    cpp.current.initFleet(3);
    addLog("Manual Action: Fleet re-initialized and reset to docks.");
  };

  const handleEmergencyRecall = () => {
    if (!isWasmReady) return;
    // Force assign all robots back to dock (0,0)
    for (let i = 0; i < 3; i++) {
      cpp.current.assignTask(i, 0, 0);
    }
    addLog("Emergency Override: All units recalled to charging stations.");
  };

  const getStateLabel = (state) => {
    if (state === 2) return { text: 'CHARGING', color: '#eab308' };
    if (state === 1) return { text: 'MOVING', color: '#3b82f6' };
    return { text: 'IDLE', color: '#22c55e' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: 'system-ui, sans-serif', padding: '30px 20px', backgroundColor: '#f8fafc', minHeight: '100vh', color: '#334155' }}>
      
      {/* Header Section */}
      <div style={{ textAlign: 'center', maxWidth: '900px', marginBottom: '25px' }}>
        <h1 style={{ color: '#0f172a', margin: '0 0 8px 0' }}>AMR Fleet Real-Time Simulator</h1>
        <p style={{ fontSize: '1.05rem', color: '#64748b', margin: 0 }}>Enterprise Digital Twin powered by C++ WebAssembly & React</p>
      </div>

      {/* Main Content Layout */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '30px', justifyContent: 'center', width: '100%', maxWidth: '1300px' }}>
        
        {/* Left Column: Canvas & Control Toolbar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {!isWasmReady ? (
              <div style={{ padding: '150px 100px', textAlign: 'center', fontWeight: 'bold', color: '#64748b' }}>
                Initializing C++ WASM Engine...
              </div>
            ) : (
              <>
                <CanvasGrid cpp={cpp.current} onTaskAssigned={(id, gx, gy) => addLog(`Robot R${id} dispatched to grid (${gx}, ${gy})`)} />
                <div style={{ marginTop: '15px', padding: '10px 15px', backgroundColor: '#f1f5f9', borderRadius: '8px', color: '#475569', fontSize: '0.85rem', maxWidth: '600px', textAlign: 'center' }}>
                  <strong>Interactive:</strong> Click grid to auto-dispatch nearest <span style={{ color: '#22c55e', fontWeight: 'bold' }}>IDLE</span> robot. Units route around <strong>Warehouse Walls</strong>.
                </div>
              </>
            )}
          </div>

          {/* 1. Simulation Control Toolbar */}
          <div style={{ backgroundColor: '#fff', padding: '15px 20px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', display: 'flex', gap: '15px', justifyContent: 'center', alignItems: 'center' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#475569' }}>FMS Controls:</span>
            <button 
              onClick={handleEmergencyRecall}
              style={{ backgroundColor: '#f59e0b', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' }}>
              ⚡ Emergency Recall
            </button>
            <button 
              onClick={handleResetFleet}
              style={{ backgroundColor: '#64748b', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' }}>
              🔄 Reset Fleet
            </button>
          </div>

        </div>

        {/* Right Column: Telemetry Cards, Event Ticker & Architecture Docs */}
        <div style={{ flex: '1', minWidth: '400px', maxWidth: '550px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* 2. Live Fleet Telemetry Card Panel */}
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '12px', color: '#0f172a', fontSize: '1rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '6px' }}>
              Live Fleet Telemetry (C++ Memory State)
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {fleetStats.map(robot => {
                const badge = getStateLabel(robot.state);
                return (
                  <div key={robot.id} style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', fontWeight: 'bold', fontSize: '0.9rem', color: '#1e293b' }}>
                      <span>Robot R{robot.id}</span>
                      <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', backgroundColor: badge.color + '20', color: badge.color }}>
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

          {/* 3. Interactive Event Ticker / Activity Log */}
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '10px', color: '#0f172a', fontSize: '1rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '6px' }}>
              System Event Activity Log
            </h3>
            <div style={{ backgroundColor: '#0f172a', color: '#38bdf8', fontFamily: 'monospace', fontSize: '0.78rem', padding: '10px', borderRadius: '6px', height: '90px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {logs.map((log, index) => (
                <div key={index}>{log}</div>
              ))}
            </div>
          </div>

          {/* Technical Architecture Overview */}
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '6px' }}>Engineering Highlights</h3>
            <p style={{ fontSize: '0.85rem', lineHeight: '1.5', color: '#475569', margin: 0 }}>
              <strong>Concurrent Processing:</strong> All 3 units run independent state machines simultaneously inside C++ memory. When battery depletes, the <strong>Dynamic Distance-to-Dock Evaluation</strong> calculates the optimal A* path back to the nearest charging station ⚡.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}