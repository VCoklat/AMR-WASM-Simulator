import React, { useEffect, useRef } from 'react';

export default function CanvasGrid({ cpp, gridWidth = 20, gridHeight = 20, tileSize = 30, numRobots = 3 }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const renderLoop = (time) => {
      const dt = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      if (dt > 0 && dt < 0.1) {
        cpp.updateSim(dt);
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. Render Warehouse Floor & Impassable Walls
      for (let x = 0; x < gridWidth; x++) {
        for (let y = 0; y < gridHeight; y++) {
          if (x === 10 && y >= 5 && y < 15) {
            ctx.fillStyle = '#475569';
            ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
            
            ctx.strokeStyle = '#334155';
            ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
          } else {
            ctx.strokeStyle = '#e2e8f0';
            ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
          }
        }
      }

      // 2. Render Active Routing Lines for all robots
      const routeColors = ['#3b82f6', '#ec4899', '#8b5cf6'];
      for (let i = 0; i < numRobots; i++) {
        const pathLen = cpp.getActivePathLength ? cpp.getActivePathLength(i) : 0;
        if (pathLen > 1) {
          ctx.beginPath();
          ctx.strokeStyle = routeColors[i % routeColors.length];
          ctx.lineWidth = 3;
          const startX = cpp.getRobotX(i) * tileSize + tileSize / 2;
          const startY = cpp.getRobotY(i) * tileSize + tileSize / 2;
          ctx.moveTo(startX, startY);

          for (let p = 0; p < pathLen; p++) {
            const px = cpp.getActivePathX(i, p) * tileSize + tileSize / 2;
            const py = cpp.getActivePathY(i, p) * tileSize + tileSize / 2;
            ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }

      // 3. Render Fleet Robots with IDs and Telemetry
      for (let i = 0; i < numRobots; i++) {
        const rx = cpp.getRobotX(i);
        const ry = cpp.getRobotY(i);
        const battery = Math.max(0, cpp.getBattery(i));
        const state = cpp.getState(i);

        ctx.fillStyle = state === 2 ? '#eab308' : (state === 1 ? '#3b82f6' : '#22c55e');

        ctx.beginPath();
        ctx.arc(rx * tileSize + tileSize / 2, ry * tileSize + tileSize / 2, tileSize / 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Label Robot ID and Battery
        ctx.fillStyle = '#000';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(`R${i} ${battery.toFixed(0)}%`, rx * tileSize - 2, ry * tileSize - 4);
      }

      animationRef.current = requestAnimationFrame(renderLoop);
    };

    animationRef.current = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animationRef.current);
  }, [cpp, gridWidth, gridHeight, tileSize, numRobots]);

  const handleCanvasClick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const gridX = Math.floor(clickX / tileSize);
    const gridY = Math.floor(clickY / tileSize);

    // Concurrent dispatch: Find the nearest IDLE robot to handle the click
    let bestRobotId = -1;
    let minDistance = Infinity;

    for (let i = 0; i < numRobots; i++) {
      const state = cpp.getState(i);
      if (state === 0) { // IDLE
        const rx = cpp.getRobotX(i);
        const ry = cpp.getRobotY(i);
        const dist = Math.hypot(rx - gridX, ry - gridY);
        if (dist < minDistance) {
          minDistance = dist;
          bestRobotId = i;
        }
      }
    }

    if (bestRobotId !== -1) {
      cpp.assignTask(bestRobotId, gridX, gridY);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <canvas
        ref={canvasRef}
        width={gridWidth * tileSize}
        height={gridHeight * tileSize}
        onClick={handleCanvasClick}
        style={{
          border: '2px solid #333',
          cursor: 'crosshair',
          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
        }}
      />
      <div style={{ display: 'flex', gap: '15px', marginTop: '10px', fontSize: '0.85rem', color: '#64748b' }}>
        <span>🟩 <strong>IDLE</strong></span>
        <span>🟦 <strong>MOVING</strong></span>
        <span>🟨 <strong>CHARGING</strong></span>
        <span>⬛ <strong>Warehouse Wall</strong></span>
      </div>
    </div>
  );
}