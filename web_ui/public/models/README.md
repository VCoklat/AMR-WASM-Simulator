Letakkan model embedding di sini dengan nama `embedder.onnx` (INT8, input NCHW float32 `[N,3,S,S]`,
keluaran embedding per gambar). Tanpa file ini, panel kamera memakai embedding fallback
(histogram warna + citra abu-abu kecil) dan diberi label "fallback" di UI.
