// Salin file runtime WASM ONNX Runtime Web ke public/ort agar demo berjalan luring (tanpa CDN).
import { cpSync, mkdirSync, readdirSync } from 'fs';
const src = 'node_modules/onnxruntime-web/dist';
const dst = 'public/ort';
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) {
  if (/^ort-wasm-simd-threaded\.(wasm|mjs)$/.test(f)) cpSync(`${src}/${f}`, `${dst}/${f}`);
}
console.log('ONNX Runtime Web WASM disalin ke public/ort');
