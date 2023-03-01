importScripts('./offscreen-canvas.js');

let pxCanvas;

const eventTypeToFn = {
  image: (...args) => pxCanvas.setImage(...args),
  gridSize: (...args) => pxCanvas.setGridSize(...args),
  maxColors: (...args) => pxCanvas.setMaxColors(...args),
  dithering: (...args) => pxCanvas.setDithering(...args),
  pan: (...args) => pxCanvas.pan(...args),
  zoom: (...args) => pxCanvas.zoom(...args),
  resize: (...args) => pxCanvas.resize(...args),
};

function onEvent(event) {
  postMessage({ type: event.type, payload: event.detail });
}

onmessage = function handleCanvas(event) {
  if (event.data.canvas) {
    pxCanvas = new self.OffscreenPxCanvas(event.data.canvas);
    pxCanvas.addEventListener('colors', onEvent);
    pxCanvas.addEventListener('maxColors', onEvent);
    pxCanvas.addEventListener('maxGridSize', onEvent);
    pxCanvas.addEventListener('zoom', onEvent);
  } else if (!pxCanvas) {
    console.error('set a canvas first');
  } else {
    const action = eventTypeToFn[event.data.type];
    if (action == null) {
      console.error(`event type not found, got "${event.data.type}"`);
      return;
    }
    action(event.data.payload);
  }
};
