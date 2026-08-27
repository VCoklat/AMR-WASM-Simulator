#!/bin/bash

echo "Mulai kompilasi C++ ke WebAssembly..."

# MENGGUNAKAN em++ KARENA KITA MENGKOMPILASI KODE C++
em++ core_engine/simulation.cpp core_engine/pathfinding.cpp \
  -O3 \
  -s WASM=1 \
  -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap"]' \
  -o web_ui/public/engine.js

echo "Kompilasi selesai! File engine.js dan engine.wasm berhasil diperbarui."