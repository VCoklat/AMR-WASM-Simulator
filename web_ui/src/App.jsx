import React, { useEffect, useRef, useState } from 'react';

// Konstanta ukuran
const TILE_SIZE = 30;
const GRID_WIDTH = 20;
const GRID_HEIGHT = 20;
const NUM_ROBOTS = 3;

export default function App() {
  const canvasRef = useRef(null);
  const [isWasmReady, setIsWasmReady] = useState(false);
  
  // Referensi untuk menyimpan fungsi C++ yang sudah di-bind
  const cpp = useRef({});
  const animationRef = useRef(null);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    // Menunggu objek 'Module' dari engine.js selesai memuat engine.wasm
    const checkWasm = setInterval(() => {
      if (window.Module && window.Module._init_fleet) {
        clearInterval(checkWasm);
        
        // Membungkus (wrapping) fungsi C++ ke fungsi JavaScript menggunakan cwrap
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

        // Inisialisasi armada robot
        cpp.current.initFleet(NUM_ROBOTS);
        
        // Setup Rintangan (Contoh: Membuat tembok di tengah gudang)
        for(let y = 5; y < 15; y++) {
          cpp.current.setObstacle(10, y, 1); 
        }

        setIsWasmReady(true);
      }
    }, 100);

    return () => clearInterval(checkWasm);
  }, []);

  // Main Simulation & Render Loop
  useEffect(() => {
    if (!isWasmReady) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const renderLoop = (time) => {
      // Menghitung Delta Time (dt) dalam detik
      const dt = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      // 1. UPDATE SIMULASI C++ (Hanya hitung jika dt wajar, max 0.1s untuk hindari glitch)
      if (dt > 0 && dt < 0.1) {
        cpp.current.updateSim(dt);
      }

      // 2. CLEAR CANVAS
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 3. GAMBAR GRID & RINTANGAN
      for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
          // Asumsi sederhana: jika x==10 dan y antara 5-14 adalah rintangan (sesuai setup awal)
          if (x === 10 && y >= 5 && y < 15) {
            ctx.fillStyle = '#475569'; // Warna Rak/Tembok
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          } else {
            ctx.strokeStyle = '#e2e8f0'; // Garis Grid
            ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          }
        }
      }

      // 4. GAMBAR ROBOT (Baca posisi terbaru dari C++ memory)
      for (let i = 0; i < NUM_ROBOTS; i++) {
        const rx = cpp.current.getRobotX(i);
        const ry = cpp.current.getRobotY(i);
        const battery = Math.max(0, cpp.current.getBattery(i));
        const state = cpp.current.getState(i);

        // Tentukan warna berdasarkan State (0=IDLE, 1=MOVING, 2=CHARGING)
        ctx.fillStyle = state === 2 ? '#eab308' : (state === 1 ? '#3b82f6' : '#22c55e');

        // Gambar body robot (lingkaran)
        ctx.beginPath();
        ctx.arc(rx * TILE_SIZE + TILE_SIZE/2, ry * TILE_SIZE + TILE_SIZE/2, TILE_SIZE/2.5, 0, Math.PI * 2);
        ctx.fill();

        // Gambar status baterai di atas robot
        ctx.fillStyle = '#000';
        ctx.font = '10px Arial';
        ctx.fillText(`${battery.toFixed(0)}%`, rx * TILE_SIZE, ry * TILE_SIZE);
      }

      // Lanjutkan loop ke frame berikutnya (Target 60 FPS)
      animationRef.current = requestAnimationFrame(renderLoop);
    };

    // Mulai animasi
    animationRef.current = requestAnimationFrame(renderLoop);

    return () => cancelAnimationFrame(animationRef.current);
  }, [isWasmReady]);

  // Handle Klik dari User untuk memerintahkan robot
  const handleCanvasClick = (e) => {
    if (!isWasmReady) return;

    // Hitung koordinat klik relatif terhadap canvas
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Konversi piksel ke Grid Index (0-19)
    const gridX = Math.floor(clickX / TILE_SIZE);
    const gridY = Math.floor(clickY / TILE_SIZE);

    // Kirim perintah ke robot pertama (ID 0) sebagai percobaan
    // Dalam logika sesungguhnya, Anda bisa mencari robot terdekat yang sedang IDLE
    cpp.current.assignTask(0, gridX, gridY);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: 'sans-serif', marginTop: '20px' }}>
      <h2>AMR Fleet Real-Time Simulator</h2>
      <p style={{ maxWidth: '600px', textAlign: 'center', color: '#666' }}>
        Tugas simulasi robotika yang dioptimalkan dengan <strong>C++ WebAssembly</strong>. 
        Klik di mana saja pada grid untuk menggerakkan robot ID 0.
      </p>
      
      {!isWasmReady ? (
        <div style={{ marginTop: '50px' }}>Memuat Engine C++ (WASM)...</div>
      ) : (
        <canvas
          ref={canvasRef}
          width={GRID_WIDTH * TILE_SIZE}
          height={GRID_HEIGHT * TILE_SIZE}
          onClick={handleCanvasClick}
          style={{ border: '2px solid #333', cursor: 'crosshair', marginTop: '10px' }}
        />
      )}
    </div>
  );
}