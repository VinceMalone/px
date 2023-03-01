class OffscreenController extends EventTarget {
  #worker;

  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    super();

    const offscreenCanvas = canvas.transferControlToOffscreen();
    this.#worker = new Worker('./offscreen.js');
    this.#worker.postMessage(
      {
        canvas: offscreenCanvas,
      },
      [offscreenCanvas],
    );
    this.#worker.addEventListener('message', this.#onOffscreenMessage);
  }

  #onOffscreenMessage = (event) => {
    this.dispatchEvent(
      new CustomEvent(event.data.type, {
        detail: event.data.payload,
      }),
    );
  };

  destroy() {
    this.#worker.terminate();
  }

  /** @param {ImageData} imageData */
  setImage(imageData) {
    this.#worker.postMessage({ type: 'image', payload: imageData });
  }

  /** @param {number} value */
  setGridSize(value) {
    this.#worker.postMessage({ type: 'gridSize', payload: value });
  }

  /** @param {number} value */
  setMaxColors(value) {
    this.#worker.postMessage({ type: 'maxColors', payload: value });
  }

  /** @param {number} value */
  setDithering(value) {
    this.#worker.postMessage({ type: 'dithering', payload: value });
  }

  /** @param {{ height: number; width: number }} dimensions */
  resize(dimensions) {
    this.#worker.postMessage({ type: 'resize', payload: dimensions });
  }

  /** @param {{ movementX: number; movementY: number }} movement */
  pan(movement) {
    this.#worker.postMessage({ type: 'pan', payload: movement });
  }

  /** @param {{ scaleDiff: number; x: number; y: number }} details */
  zoom(details) {
    this.#worker.postMessage({ type: 'zoom', payload: details });
  }
}

class OnscreenController extends EventTarget {
  #controller;

  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    super();

    import('./offscreen-canvas.js').then(() => {
      this.#controller = new self.OffscreenPxCanvas(canvas);

      this.#controller.addEventListener('colors', this.#onEvent);
      this.#controller.addEventListener('maxColors', this.#onEvent);
      this.#controller.addEventListener('maxGridSize', this.#onEvent);
      this.#controller.addEventListener('zoom', this.#onEvent);

      for (const [method, args] of this.#queue) {
        this.#controller[method](...args);
      }
    });
  }

  #queue = [];

  #queueTask(method, args) {
    if (this.#controller) {
      this.#controller[method](...args);
    } else {
      this.#queue.push([method, args]);
    }
  }

  #onEvent = (event) => {
    this.dispatchEvent(
      new CustomEvent(event.type, {
        detail: event.detail,
      }),
    );
  };

  destroy() {
    this.#controller.removeEventListener('colors', this.#onEvent);
    this.#controller.removeEventListener('maxColors', this.#onEvent);
    this.#controller.removeEventListener('maxGridSize', this.#onEvent);
    this.#controller.removeEventListener('zoom', this.#onEvent);
  }

  /** @param {ImageData} imageData */
  setImage(imageData) {
    this.#queueTask('setImage', [imageData]);
  }

  /** @param {number} value */
  setGridSize(value) {
    this.#queueTask('setGridSize', [value]);
  }

  /** @param {number} value */
  setMaxColors(value) {
    this.#queueTask('setMaxColors', [value]);
  }

  /** @param {number} value */
  setDithering(value) {
    this.#queueTask('setDithering', [value]);
  }

  /** @param {{ height: number; width: number }} dimensions */
  resize(dimensions) {
    this.#queueTask('resize', [dimensions]);
  }

  /** @param {{ movementX: number; movementY: number }} movement */
  pan(movement) {
    this.#queueTask('pan', [movement]);
  }

  /** @param {{ scaleDiff: number; x: number; y: number }} details */
  zoom(details) {
    this.#queueTask('zoom', [details]);
  }
}

export const Controller =
  'OffscreenCanvas' in window ? OffscreenController : OnscreenController;
