importScripts('./wasm/image_quant.js');

const { quantize } = wasm_bindgen;

onmessage = async function handleColorQuantization(event) {
  await wasm_bindgen('./wasm/image_quant_bg.wasm');
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
