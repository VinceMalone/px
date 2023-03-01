import { Controller } from './controller.js';
import { throttle } from './utils.js';

export class PxCanvas {
  #canvas;
  #controller;

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
    this.#canvas.width = this.#canvas.clientWidth;
    this.#canvas.height = this.#canvas.clientHeight;

    this.#controller = new Controller(this.#canvas);

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
    this.#controller.setImage(imageData);
  }

  #onResize = () => {
    this.#controller.resize({
      height: this.#canvas.clientHeight,
      width: this.#canvas.clientWidth,
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
      this.#controller.pan({ movementX, movementY });
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

      this.#controller.zoom({
        scaleDiff,
        x: event.clientX,
        y: event.clientY,
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
        this.#controller.pan({ movementX, movementY });
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
          this.#controller.zoom({ scaleDiff, x, y });
        }
        this.#pointerDiff = currentDiff;
        break;
      }
    }
  };

  #onGridSizeChange = (event) => {
    if (!event.target.validity.valid) return;
    const gridSize = event.target.valueAsNumber;
    this.#controller.setGridSize(gridSize);
  };

  #onMaxColorsChange = throttle((event) => {
    if (!event.target.validity.valid) return;
    const maxColors = event.target.valueAsNumber;
    this.#controller.setMaxColors(maxColors);
  }, 250);

  #onDitheringChange = throttle((event) => {
    if (!event.target.validity.valid) return;
    const dithering = event.target.valueAsNumber;
    this.#controller.setDithering(dithering);
  }, 250);

  #onColors = (event) => {
    this.#renderColors(event.detail);
  };

  #onMaxColors = (event) => {
    this.#$maxColors.max = event.detail;
    this.#$maxColors.value = event.detail;
  };

  #onMaxGridSize = (event) => {
    this.#$gridSize.max = event.detail;
  };

  #onZoom = (event) => {
    this.#renderZoom(event.detail);
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
    this.#controller.addEventListener('colors', this.#onColors);
    this.#controller.addEventListener('maxColors', this.#onMaxColors);
    this.#controller.addEventListener('maxGridSize', this.#onMaxGridSize);
    this.#controller.addEventListener('zoom', this.#onZoom);
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
    this.#controller.removeEventListener('colors', this.#onColors);
    this.#controller.removeEventListener('maxColors', this.#onMaxColors);
    this.#controller.removeEventListener('maxGridSize', this.#onMaxGridSize);
    this.#controller.removeEventListener('zoom', this.#onZoom);
    this.#controller.destroy();
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
