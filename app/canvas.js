import { throttle } from './utils.js';

export class PxCanvas {
  #canvas;
  #offscreenCanvas;
  #offscreenWorker;

  #$colors;
  #$zoom;
  #$gridSize;
  #$maxColors;
  #$dithering;

  #moving = false;
  #pointers = new Map();
  #pointerDiff = -1;
  #lastScreenX = 0;
  #lastScreenY = 0;

  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.#canvas = canvas;
    this.#canvas.width = this.#canvas.clientWidth; // window.innerWidth;
    this.#canvas.height = this.#canvas.clientHeight; // window.innerHeight;

    this.#offscreenCanvas = canvas.transferControlToOffscreen();
    this.#offscreenWorker = new Worker('./offscreen.js');
    this.#offscreenWorker.postMessage(
      {
        canvas: this.#offscreenCanvas,
      },
      [this.#offscreenCanvas],
    );

    this.#$colors = document.querySelector('#colors');
    this.#$zoom = document.querySelector('#zoom');
    this.#$gridSize = document.querySelector('#grid-size');
    this.#$maxColors = document.querySelector('#max-colors');
    this.#$dithering = document.querySelector('#dithering');

    this.#addEventListeners();
  }

  destroy() {
    this.#removeEventListeners();
  }

  /**
   * @param {ImageData} imageData
   */
  setImage(imageData) {
    this.#offscreenWorker.postMessage({
      type: 'image',
      payload: imageData,
    });
  }

  #onResize = () => {
    this.#offscreenWorker.postMessage({
      type: 'resize',
      payload: {
        height: this.#canvas.clientHeight,
        width: this.#canvas.clientWidth,
      },
    });
  };

  #onContextMenu = (event) => {
    event.preventDefault();
  };

  #onMouseWheel = (event) => {
    event.preventDefault();

    if (event.metaKey) {
      // holding the meta key should translate the image
      // also holding shift should scroll the image in a dominant x/y axis
      const { deltaX, deltaY } = event;
      const [movementX, movementY] = event.shiftKey
        ? Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? [deltaX, 0]
          : [0, deltaY]
        : [deltaX, deltaY];
      this.#offscreenWorker.postMessage({
        type: 'pan',
        payload: { movementX, movementY },
      });
    } else {
      let deltaZ =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;

      if (event.deltaMode === 1) {
        // 1 is "lines", 0 is "pixels"
        // Firefox uses "lines" for some types of mouse
        deltaZ *= 15;
      }

      // ctrlKey is true when pinch-zooming on a trackpad
      const divisor = event.ctrlKey ? 100 : 300;
      const scaleDiff = 1 - deltaZ / divisor;

      this.#offscreenWorker.postMessage({
        type: 'zoom',
        payload: { scaleDiff, x: event.clientX, y: event.clientY },
      });
    }
  };

  #onPointerDown = (event) => {
    this.#lastScreenX = event.screenX;
    this.#lastScreenY = event.screenY;
    this.#pointers.set(event.pointerId, event);
    this.#canvas.setPointerCapture(event.pointerId);
    this.#moving = true;
  };

  #onPointerUp = (event) => {
    this.#pointers.delete(event.pointerId);
    this.#canvas.releasePointerCapture(event.pointerId);
    this.#moving = false; // this.#pointers.size > 0;
    if (this.#pointers.size < 2) {
      this.#pointerDiff = -1;
    }
  };

  #onPointerMove = (event) => {
    this.#pointers.set(event.pointerId, event);

    switch (this.#pointers.size) {
      // drag/pan (mouse/touch)
      case 1: {
        if (!this.#moving) {
          return;
        }
        // movementX/movementY may not be available on iOS
        const movementX = event.movementX ?? event.screenX - this.#lastScreenX;
        const movementY = event.movementY ?? event.screenY - this.#lastScreenY;
        this.#offscreenWorker.postMessage({
          type: 'pan',
          payload: { movementX, movementY },
        });
        this.#lastScreenX = event.screenX;
        this.#lastScreenY = event.screenY;
        break;
      }
      // pinch-zoom
      case 2: {
        const [p1, p2] = this.#pointers.values();
        const xDiff = Math.abs(p1.clientX - p2.clientX);
        const yDiff = Math.abs(p1.clientY - p2.clientY);
        const currentDiff = Math.max(xDiff, yDiff);
        if (this.#pointerDiff > 0) {
          const deltaZ = this.#pointerDiff - currentDiff;
          const scaleDiff = 1 - deltaZ / 300;
          const x = (p1.clientX + p2.clientX) / 2;
          const y = (p1.clientY + p2.clientY) / 2;
          this.#offscreenWorker.postMessage({
            type: 'zoom',
            payload: { scaleDiff, x, y },
          });
        }
        this.#pointerDiff = currentDiff;
        break;
      }
    }
  };

  #onGridSizeChange = (event) => {
    if (!event.target.validity.valid) return;
    const gridSize = event.target.valueAsNumber;
    this.#offscreenWorker.postMessage({
      type: 'gridSize',
      payload: gridSize,
    });
  };

  #onMaxColorsChange = throttle((event) => {
    if (!event.target.validity.valid) return;
    const maxColors = event.target.valueAsNumber;
    this.#offscreenWorker.postMessage({
      type: 'maxColors',
      payload: maxColors,
    });
  }, 250);

  #onDitheringChange = throttle((event) => {
    if (!event.target.validity.valid) return;
    const dithering = event.target.valueAsNumber;
    this.#offscreenWorker.postMessage({
      type: 'dithering',
      payload: dithering,
    });
  }, 250);

  #onOffscreenMessage = (event) => {
    switch (event.data.type) {
      case 'colors':
        this.#renderColors(event.data.payload);
        break;
      case 'zoom':
        this.#renderZoom(event.data.payload);
        break;
      case 'maxGridSize':
        this.#$gridSize.max = event.data.payload;
        break;
      case 'maxColors':
        this.#$maxColors.max = event.data.payload;
        this.#$maxColors.value = event.data.payload;
        break;
    }
  };

  #addEventListeners() {
    window.addEventListener('resize', this.#onResize);
    this.#canvas.addEventListener('contextmenu', this.#onContextMenu);
    this.#canvas.addEventListener('wheel', this.#onMouseWheel);
    this.#canvas.addEventListener('pointerdown', this.#onPointerDown);
    this.#canvas.addEventListener('pointerup', this.#onPointerUp);
    this.#canvas.addEventListener('pointercancel', this.#onPointerUp);
    this.#canvas.addEventListener('pointerout', this.#onPointerUp);
    this.#canvas.addEventListener('pointerleave', this.#onPointerUp);
    this.#canvas.addEventListener('pointermove', this.#onPointerMove);
    this.#$gridSize.addEventListener('input', this.#onGridSizeChange);
    this.#$maxColors.addEventListener('input', this.#onMaxColorsChange);
    this.#$dithering.addEventListener('input', this.#onDitheringChange);
    this.#offscreenWorker.addEventListener('message', this.#onOffscreenMessage);
  }

  #removeEventListeners() {
    window.removeEventListener('resize', this.#onResize);
    this.#canvas.removeEventListener('contextmenu', this.#onContextMenu);
    this.#canvas.removeEventListener('wheel', this.#onMouseWheel);
    this.#canvas.removeEventListener('pointerdown', this.#onPointerDown);
    this.#canvas.removeEventListener('pointerup', this.#onPointerUp);
    this.#canvas.removeEventListener('pointercancel', this.#onPointerUp);
    this.#canvas.removeEventListener('pointerout', this.#onPointerUp);
    this.#canvas.removeEventListener('pointerleave', this.#onPointerUp);
    this.#canvas.removeEventListener('pointermove', this.#onPointerMove);
    this.#$gridSize.removeEventListener('input', this.#onGridSizeChange);
    this.#$maxColors.removeEventListener('input', this.#onMaxColorsChange);
    this.#$dithering.removeEventListener('input', this.#onDitheringChange);
    this.#offscreenWorker.terminate();
  }

  /** @param {Map<string, number>} colorMap */
  #renderColors(colorMap) {
    const fragment = new DocumentFragment();

    for (const [color, id] of colorMap) {
      const $color = document.createElement('div');
      $color.classList.add('color');
      $color.innerHTML = `
        <span class="color-swatch" style="background-color: ${color};"></span>
        #${id} ${color}
      `;
      fragment.appendChild($color);
    }

    this.#$colors.innerHTML = '';
    this.#$colors.appendChild(fragment);
  }

  /** @param {number} value */
  #renderZoom(value) {
    this.#$zoom.value = Math.round(value * 100);
  }

  // #renderBG(x, y, z) {
  //   const doc = document.documentElement;
  //   doc.style.setProperty('--zoom', `${z * 2}px`);
  //   doc.style.setProperty('--x', `${x}px`);
  //   doc.style.setProperty('--y', `${y}px`);
  // }
}
