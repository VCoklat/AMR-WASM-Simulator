import React, { useEffect, useRef } from 'react';

export default function CanvasGrid({ cpp, gridWidth = 20, gridHeight = 20, tileSize = 30, numRobots = 3 }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const renderLoop = (time) => {
      // 1. Hitung Delta Time (dt)
      const dt = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      // 2. Update Simulasi di C++ (Mencegah lonjakan saat tab berpindah)
      if (dt > 0 && dt < 0.1) {
        cpp.updateSim(dt);
      }

      // 3. Bersihkan frame sebelumnya
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 4. Render Lingkungan Gudang (Grid & Rintangan)
      for (let x = 0; x < gridWidth; x++) {
        for (let y = 0; y < gridHeight; y++) {
          // Rintangan hardcoded agar sinkron dengan inisialisasi di App.jsx
          if (x === 10 && y >= 5 && y < 15) {
            ctx.fillStyle = '#475569'; // Warna rak
            ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
          } else {
            ctx.strokeStyle = '#e2e8f0'; // Warna garis lantai
            ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
          }
        }
      }

      // 5. Render Armada Robot
      for (let i = 0; i < numRobots; i++) {
        // Ambil data real-time langsung dari memori C++
        const rx = cpp.getRobotX(i);
        const ry = cpp.getRobotY(i);
        const battery = Math.max(0, cpp.getBattery(i));
        const state = cpp.getState(i);

        // Warna: Kuning (CHARGING), Biru (MOVING), Hijau (IDLE)
        ctx.fillStyle = state === 2 ? '#eab308' : (state === 1 ? '#3b82f6' : '#22c55e');

        // Gambar body robot
        ctx.beginPath();
        ctx.arc(rx * tileSize + tileSize / 2, ry * tileSize + tileSize / 2, tileSize / 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Indikator Baterai
        ctx.fillStyle = '#000';
        ctx.font = '10px Arial';
        ctx.fillText(`${battery.toFixed(0)}%`, rx * tileSize, ry * tileSize);
      }

      // Panggil frame berikutnya
      animationRef.current = requestAnimationFrame(renderLoop);
    };

    // Mulai Game Loop
    animationRef.current = requestAnimationFrame(renderLoop);

    // Cleanup saat komponen dilepas (unmount)
    return () => cancelAnimationFrame(animationRef.current);
  }, [cpp, gridWidth, gridHeight, tileSize, numRobots]);

  // Penanganan Interaksi Klik
  const handleCanvasClick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const gridX = Math.floor(clickX / tileSize);
    const gridY = Math.floor(clickY / tileSize);

    // Mengirim perintah ke C++
    cpp.assignTask(0, gridX, gridY);
  };

  return (
    <canvas
      ref={canvasRef}
      width={gridWidth * tileSize}
      height={gridHeight * tileSize}
      onClick={handleCanvasClick}
      style={{
        border: '2px solid #333',
        cursor: 'crosshair',
        marginTop: '20px',
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
      }}
    />
  );
}