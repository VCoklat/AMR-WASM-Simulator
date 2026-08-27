import React, { useEffect, useRef, useState } from 'react';
import CanvasGrid from './CanvasGrid';

export default function App() {
  const [isWasmReady, setIsWasmReady] = useState(false);
  const cpp = useRef({});

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
        };

        cpp.current.initFleet(3);
        
        for(let y = 5; y < 15; y++) {
          cpp.current.setObstacle(10, y, 1); 
        }

        setIsWasmReady(true);
      }
    }, 100);
    return () => clearInterval(checkWasm);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: 'system-ui, sans-serif', padding: '30px 20px', backgroundColor: '#f8fafc', minHeight: '100vh', color: '#334155' }}>
      
      {/* Header Section */}
      <div style={{ textAlign: 'center', maxWidth: '900px', marginBottom: '30px' }}>
        <h1 style={{ color: '#0f172a', margin: '0 0 10px 0' }}>AMR Fleet Real-Time Simulator</h1>
        <p style={{ fontSize: '1.1rem', color: '#64748b', margin: 0 }}>High-Performance Industrial Digital Twin powered by C++ & WebAssembly</p>
      </div>

      {/* Main Content Layout */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '30px', justifyContent: 'center', width: '100%', maxWidth: '1250px' }}>
        
        {/* Simulation Canvas Container */}
        <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {!isWasmReady ? (
            <div style={{ padding: '150px 100px', textAlign: 'center', fontWeight: 'bold', color: '#64748b' }}>
              Initializing C++ WASM Engine...
            </div>
          ) : (
            <>
              <CanvasGrid cpp={cpp.current} />
              <div style={{ marginTop: '15px', padding: '12px 20px', backgroundColor: '#f1f5f9', borderRadius: '8px', color: '#475569', fontSize: '0.9rem', maxWidth: '600px', textAlign: 'center' }}>
                <strong>Interactive Controls:</strong> Click anywhere on the open grid to dispatch an <span style={{ color: '#22c55e', fontWeight: 'bold' }}>IDLE</span> robot. Watch them transition to <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>MOVING</span>, drain battery, and trigger auto-charging when critical.
              </div>
            </>
          )}
        </div>

        {/* Explanatory Technical Panel */}
        <div style={{ flex: '1', minWidth: '400px', maxWidth: '550px', backgroundColor: '#fff', padding: '30px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Project Background */}
          <div>
            <h3 style={{ marginTop: 0, color: '#0f172a', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px' }}>Project Background</h3>
            <p style={{ fontSize: '0.9rem', lineHeight: '1.6', color: '#475569', margin: '8px 0 0 0' }}>
              In modern automated smart factories and logistics hubs, coordinating fleets of Autonomous Mobile Robots (AMRs) requires precise, deterministic real-time processing. This project models a warehouse floor digital twin to evaluate kinematics, runtime task routing, and autonomous power management.
            </p>
          </div>

          {/* Architecture & Performance */}
          <div>
            <h3 style={{ color: '#0f172a', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px', marginTop: 0 }}>System Architecture & Performance</h3>
            <p style={{ fontSize: '0.9rem', lineHeight: '1.6', color: '#475569', margin: '8px 0 0 0' }}>
              The core simulation engine is written in native <strong>C++</strong> and compiled into <strong>WebAssembly (WASM)</strong> via Emscripten. It calculates physics, continuous-time motion dynamics, and state transitions independently in memory. The <strong>React</strong> frontend serves strictly as a high-performance presentation layer, querying memory via a <code>requestAnimationFrame</code> loop to maintain smooth 60 FPS rendering without Garbage Collection bottlenecks.
            </p>
          </div>

          {/* Detailed State Machine & Charging Mechanics */}
          <div>
            <h3 style={{ color: '#0f172a', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px', marginTop: 0 }}>State Machine & Autonomous Charging Mechanics</h3>
            <div style={{ fontSize: '0.88rem', lineHeight: '1.5', color: '#475569', display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
              <div>
                <strong style={{ color: '#22c55e' }}>1. IDLE State (Green):</strong> Robots remain stationary on standby at their current grid positions, continuously monitoring tasks and battery levels.
              </div>
              <div>
                <strong style={{ color: '#3b82f6' }}>2. MOVING State (Blue):</strong> Vector kinematics compute displacement using delta-time ($dt$) scaling to ensure frame-rate independent movement, steadily depleting battery reserves per second.
              </div>
              <div>
                <strong style={{ color: '#eab308' }}>3. Autonomous Fail-Safe & CHARGING State (Yellow):</strong> 
                <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
                  <li><strong>Critical Threshold Trigger:</strong> If battery drops below 20%, an automated fail-safe overrides current instructions, re-routing the robot back to the charging station at coordinate <code>(0,0)</code>.</li>
                  <li><strong>Stationary Regeneration:</strong> Upon arriving at the dock, motion is paused and energy is regenerated using continuous-time formulas until reaching 100%.</li>
                  <li><strong>State Recovery:</strong> Once fully charged, the robot automatically transitions back to <strong>IDLE</strong>, ready to accept new dispatch assignments.</li>
                </ul>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}