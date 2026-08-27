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
          getActivePathLength: window.Module.cwrap('get_active_path_length', 'number', ['number']),
          getActivePathX: window.Module.cwrap('get_active_path_x', 'number', ['number', 'number']),
          getActivePathY: window.Module.cwrap('get_active_path_y', 'number', ['number', 'number']),
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
                <strong>Interactive Controls:</strong> Click anywhere on the open grid to dispatch Robot 0. Blue routing lines guide units around impassable <strong>Warehouse Walls</strong>.
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
              Smart warehouses require deterministic real-time collision avoidance and smart battery management. This digital twin simulates a multi-agent floor featuring impassable physical storage rack barriers.
            </p>
          </div>

          {/* Fleet Architecture */}
          <div>
            <h3 style={{ color: '#0f172a', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px', marginTop: 0 }}>Multi-Robot Fleet Architecture</h3>
            <p style={{ fontSize: '0.9rem', lineHeight: '1.6', color: '#475569', margin: '8px 0 0 0' }}>
              The engine coordinates <strong>3 autonomous units</strong> sharing identical infrastructure:
            </p>
            <ul style={{ fontSize: '0.88rem', lineHeight: '1.5', color: '#475569', margin: '6px 0 0 20px', padding: 0 }}>
              <li><strong>Concurrent Processing:</strong> Manages independent state machines simultaneously inside C++ memory.</li>
              <li><strong>Shared Docking:</strong> All units contend for the central charging infrastructure at coordinate <code>(0,0)</code>.</li>
            </ul>
          </div>

          {/* State Machine & Dynamic Distance-to-Dock Evaluation */}
          <div>
            <h3 style={{ color: '#0f172a', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px', marginTop: 0 }}>State Machine & Dynamic Energy Evaluation</h3>
            <div style={{ fontSize: '0.88rem', lineHeight: '1.5', color: '#475569', display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              <div><strong style={{ color: '#22c55e' }}>1. IDLE (Green):</strong> Standby state awaiting tasks.</div>
              <div><strong style={{ color: '#3b82f6' }}>2. MOVING (Blue):</strong> Navigates via A* pathfinding around <strong>Warehouse Walls</strong> while drawing energy.</div>
              <div><strong style={{ color: '#eab308' }}>3. Dynamic Distance-to-Dock Fail-Safe (Yellow):</strong> 
                Instead of a fixed percentage trigger, the system continuously computes the exact A* path length back to <code>(0,0)</code>. If remaining battery drops below the <strong>calculated traversal energy cost plus safety buffer</strong>, current tasks are overridden to guarantee safe dock return before power exhaustion.
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}