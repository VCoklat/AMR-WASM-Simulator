#!/bin/bash

echo "Mulai kompilasi C++ ke WebAssembly..."

# Perhatikan bahwa sekarang ada dua file .cpp yang dimasukkan
emcc core_engine/simulation.cpp core_engine/pathfinding.cpp \
  -O3 \
  -s WASM=1 \
  -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap"]' \
  -o web_ui/public/engine.js

echo "Kompilasi selesai! File engine.js dan engine.wasm berhasil diperbarui."