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

      // 1. Render Warehouse Floor & Obstacles (Walls)
      for (let x = 0; x < gridWidth; x++) {
        for (let y = 0; y < gridHeight; y++) {
          if (x === 10 && y >= 5 && y < 15) {
            ctx.fillStyle = '#475569'; // Warehouse Wall / Rack Obstacle
            ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
            
            // Draw a subtle X to denote blocked wall tile
            ctx.strokeStyle = '#334155';
            ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
          } else {
            ctx.strokeStyle = '#e2e8f0';
            ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
          }
        }
      }

      // 2. Render Robot Routing Lines (Path Preview)
      for (let i = 0; i < numRobots; i++) {
        const pathLen = cpp.getActivePathLength ? cpp.getActivePathLength(i) : 0;
        if (pathLen > 1) {
          ctx.beginPath();
          ctx.strokeStyle = '#3b82f6'; // Blue route line
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

      // 3. Render Robots
      for (let i = 0; i < numRobots; i++) {
        const rx = cpp.getRobotX(i);
        const ry = cpp.getRobotY(i);
        const battery = Math.max(0, cpp.getBattery(i));
        const state = cpp.getState(i);

        ctx.fillStyle = state === 2 ? '#eab308' : (state === 1 ? '#3b82f6' : '#22c55e');

        ctx.beginPath();
        ctx.arc(rx * tileSize + tileSize / 2, ry * tileSize + tileSize / 2, tileSize / 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#000';
        ctx.font = '10px Arial';
        ctx.fillText(`${battery.toFixed(0)}%`, rx * tileSize, ry * tileSize);
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

    // Dispatch Robot 0 to clicked coordinate
    cpp.assignTask(0, gridX, gridY);
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
      {/* Legend / Descriptions */}
      <div style={{ display: 'flex', gap: '15px', marginTop: '10px', fontSize: '0.85rem', color: '#64748b' }}>
        <span>🟩 <strong>IDLE</strong></span>
        <span>🟦 <strong>MOVING (with Route Line)</strong></span>
        <span>🟨 <strong>CHARGING</strong></span>
        <span>⬛ <strong>Warehouse Wall / Obstacle (Impassable)</strong></span>
      </div>
    </div>
  );
}