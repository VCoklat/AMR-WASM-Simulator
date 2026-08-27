#!/bin/bash
# File: core_engine/build.sh

echo "Mulai kompilasi C++ ke WebAssembly..."

emcc core_engine/simulation.cpp \
  -O3 \
  -s WASM=1 \
  -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap"]' \
  -o web_ui/public/engine.js

echo "Kompilasi selesai! File engine.js dan engine.wasm berhasil dibuat di folder public."