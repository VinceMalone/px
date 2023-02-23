import init, { quantize } from './wasm/image_quant.js';

let wasmModule;

onmessage = async function handleColorQuantization(event) {
  if (!wasmModule) wasmModule = init();
  await wasmModule;

  const { data, width, height, maxColors, dithering } = event.data;
  const quantizedImageData = quantize(
    data,
    width,
    height,
    maxColors,
    dithering,
  );
  postMessage(new Uint8ClampedArray(quantizedImageData));
};
