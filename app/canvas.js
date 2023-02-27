import { getColors } from './colors.js';
import { createMatrix } from './matrix.js';
import { throttle } from './utils.js';

export class PxCanvas {
  static MAX_SUPPORTED_COLORS = 32;

  #canvas;
  #context;
  #$colors;
  #$dithering;
  #$gridSize;
  #$maxColors;
  #$zoom;
  #scale;
  #x;
  #y;
  #initialImageData;
  #imageData;
  #dithering;
  #maxColors;
  #gridSize;
  #colors;
  #colorMap;
  #bitmap;
  #moving = false;
  #pointers = new Map();
  #pointerDiff = -1;
  #lastScreenX = 0;
  #lastScreenY = 0;
  #latestQuantizeTaskId = 0;
  #lastFinishedQuantizeTaskId = 0;

  constructor({ canvas }) {
    this.#canvas = canvas;
    this.#context = canvas.getContext('2d');

    this.#$colors = document.querySelector('#colors');
    this.#$zoom = document.querySelector('#zoom');
    this.#$gridSize = document.querySelector('#grid-size');
    this.#$maxColors = document.querySelector('#max-colors');
    this.#$dithering = document.querySelector('#dithering');

    this.#setSettingValues();
    this.#addEventListeners();
    this.#setCanvasSize();
  }

  destroy() {
    this.#removeEventListeners();
  }

  async setImage(imageData) {
    this.#initialImageData = imageData;

    const { height, width } = this.#initialImageData;

    this.#scale = 1;
    this.#x = this.#canvas.width / 2 - (width * this.#scale) / 2;
    this.#y = this.#canvas.height / 2 - (height * this.#scale) / 2;

    const maxGridSize = Math.max(width, height);
    this.#$gridSize.max = maxGridSize;

    // reset this before `initImage` is called
    this.#maxColors = PxCanvas.MAX_SUPPORTED_COLORS;

    await this.#initImage();

    const maxColors = Math.min(
      this.#colorMap.size,
      PxCanvas.MAX_SUPPORTED_COLORS,
    );
    this.#$maxColors.max = maxColors;
    this.#$maxColors.value = maxColors;

    this.#setSettingValues();
  }

  async #initImage() {
    const quantizeWorker = new Worker('./quantize.js', { type: 'module' });
    const taskId = ++this.#latestQuantizeTaskId;

    quantizeWorker.postMessage({
      data: this.#initialImageData.data,
      width: this.#initialImageData.width,
      height: this.#initialImageData.height,
      maxColors: this.#maxColors,
      dithering: this.#dithering,
    });

    const quantizedImageData = await new Promise((resolve) => {
      quantizeWorker.onmessage = (message) => {
        resolve(message.data);
      };
    });

    quantizeWorker.terminate();

    if (taskId < this.#lastFinishedQuantizeTaskId) {
      return;
    }

    this.#lastFinishedQuantizeTaskId = taskId;

    this.#imageData = new ImageData(
      quantizedImageData,
      this.#initialImageData.width,
      this.#initialImageData.height,
      { colorSpace: this.#initialImageData.colorSpace },
    );

    [this.#colors, this.#colorMap] = getColors(this.#imageData);
    this.#renderColors();

    this.#bitmap = await createImageBitmap(
      this.#imageData,
      0,
      0,
      this.#imageData.width,
      this.#imageData.height,
    );

    this.#draw();
  }

  #setSettingValues() {
    this.#gridSize = this.#$gridSize.valueAsNumber;
    this.#maxColors = this.#$maxColors.valueAsNumber;
    this.#dithering = this.#$dithering.valueAsNumber;
  }

  #setCanvasSize() {
    this.#canvas.width = window.innerWidth;
    this.#canvas.height = window.innerHeight;
  }

  #onResize = () => {
    this.#setCanvasSize();
    this.#draw();
  };

  #onContextMenu = (event) => {
    event.preventDefault();
  };

  #clampXY(dir, n) {
    return Math.max(
      0 - this.#imageData[dir] * this.#scale,
      Math.min(this.#canvas[dir], n),
    );
  }

  #zoom({ scaleDiff, x, y }) {
    const originX = x - this.#x;
    const originY = y - this.#y;

    const matrix = createMatrix()
      // Scale about the origin
      .translate(originX, originY)
      // Apply current translate
      .translate(this.#x, this.#y)
      .scale(scaleDiff)
      .translate(-originX, -originY)
      // Apply current scale
      .scale(this.#scale);

    this.#scale = matrix.a;
    this.#x = matrix.e;
    this.#y = matrix.f;

    this.#scale = Math.max(0.1, this.#scale);

    this.#draw();
  }

  #onMouseWheel = (event) => {
    event.preventDefault();

    if (event.metaKey) {
      // holding the meta key should translate the image
      // also holding shift should scroll the image in a dominant x/y axis
      const axes = event.shiftKey
        ? Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? ['x']
          : ['y']
        : ['x', 'y'];
      if (axes.includes('x')) {
        this.#x = this.#clampXY('width', this.#x + event.deltaX);
      }
      if (axes.includes('y')) {
        this.#y = this.#clampXY('height', this.#y + event.deltaY);
      }
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

      this.#zoom({ scaleDiff, x: event.clientX, y: event.clientY });
    }

    this.#draw();
  };

  #onPointerDown = (event) => {
    this.#lastScreenX = event.screenX;
    this.#lastScreenY = event.screenY;
    this.#moving = true;
    this.#pointers.set(event.pointerId, event);
  };

  #onPointerUp = (event) => {
    this.#pointers.delete(event.pointerId);
    this.#moving = false; // this.#pointers.size > 0;
    if (this.#pointers.size < 2) {
      this.#pointerDiff = -1;
    }
    this.#draw();
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
        this.#lastScreenX = event.screenX;
        this.#lastScreenY = event.screenY;
        this.#x = this.#clampXY('width', this.#x + movementX);
        this.#y = this.#clampXY('height', this.#y + movementY);
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
          this.#zoom({ scaleDiff, x, y });
        }
        this.#pointerDiff = currentDiff;
        break;
      }
    }

    this.#draw();
  };

  #onGridSizeChange = (event) => {
    if (!event.target.validity.valid) return;
    this.#gridSize = event.target.valueAsNumber;
    this.#draw();
  };

  #onMaxColorsChange = throttle((event) => {
    if (!event.target.validity.valid) return;
    this.#maxColors = event.target.valueAsNumber;
    this.#initImage();
  }, 250);

  #onDitheringChange = throttle((event) => {
    if (!event.target.validity.valid) return;
    this.#dithering = event.target.valueAsNumber;
    this.#initImage();
  }, 250);

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
  }

  #draw() {
    this.#context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);

    // document.documentElement.style.setProperty('--zoom', `${this.#scale * 2}px`);
    // document.documentElement.style.setProperty('--x', `${this.#x}px`);
    // document.documentElement.style.setProperty('--y', `${this.#y}px`);

    this.#drawStats();
    this.#drawImage();

    if (!this.#moving && this.#scale >= 16) {
      this.#drawLabels();
    }

    if (this.#scale > 5) {
      this.#drawGrid({ color: 'white', gap: 1 });
    }

    this.#drawGrid({ color: 'grey', gap: this.#gridSize });
    this.#drawBorder({ color: 'black' });
  }

  #drawStats() {
    this.#$zoom.value = Math.round(this.#scale * 100);
  }

  #drawImage() {
    this.#context.imageSmoothingEnabled = false;
    this.#context.drawImage(
      this.#bitmap,
      this.#x,
      this.#y,
      this.#imageData.width * this.#scale,
      this.#imageData.height * this.#scale,
    );
  }

  #drawBorder({ color, lineWidth = 1 }) {
    this.#context.strokeStyle = color;
    this.#context.lineWidth = lineWidth;
    this.#context.strokeRect(
      this.#x,
      this.#y,
      this.#imageData.width * this.#scale,
      this.#imageData.height * this.#scale,
    );
  }

  #drawGrid({ color, gap, lineWidth = 1 }) {
    if (gap === 0) return;

    const bottom = this.#imageData.height * this.#scale + this.#y;
    const right = this.#imageData.width * this.#scale + this.#x;
    const factor = gap * this.#scale;

    this.#context.strokeStyle = color;
    this.#context.lineWidth = lineWidth;
    this.#context.beginPath();

    for (
      let i = 0, count = Math.ceil(this.#imageData.width / gap);
      i < count;
      i++
    ) {
      const x = i * factor + this.#x;
      this.#context.moveTo(x, this.#y);
      this.#context.lineTo(x, bottom);
    }

    for (
      let i = 0, count = Math.ceil(this.#imageData.height / gap);
      i < count;
      i++
    ) {
      const y = i * factor + this.#y;
      this.#context.moveTo(this.#x, y);
      this.#context.lineTo(right, y);
    }

    this.#context.stroke();
  }

  *#labeledPixels() {
    const getPixelX = (n) => Math.floor(Math.max(0, (n / this.#scale) * -1));

    const getPixelY = (dir, n) =>
      Math.ceil(
        Math.min((this.#canvas[dir] - n) / this.#scale, this.#imageData[dir]),
      );

    // calculate the rectangle for visible pixels on the canvas
    const top = getPixelX(this.#y);
    const bottom = getPixelY('height', this.#y);
    const right = getPixelY('width', this.#x);
    const left = getPixelX(this.#x);

    for (let x = left; x < right; x++) {
      for (let y = top; y < bottom; y++) {
        yield { x, y };
      }
    }
  }

  #drawLabels() {
    this.#context.font = "12px 'Helvetica Neue', sans-serif";
    this.#context.textAlign = 'center';
    this.#context.textBaseline = 'middle';

    // drawing labels on every pixel can be expensive, only do it for the
    // pixels that are rendered in the canvas.
    for (const { x, y } of this.#labeledPixels()) {
      const index = this.#imageData.width * y + x;
      const color = this.#colors[index];
      if (!color) {
        console.warn(`color not found at index ${index} [${x}, ${y}]`);
        continue;
      }
      this.#context.fillStyle = color.brightness > 125 ? 'black' : 'white';
      this.#context.fillText(
        color.id,
        this.#x + (x * this.#scale + this.#scale / 2),
        this.#y + (y * this.#scale + this.#scale / 2),
      );
    }
  }

  #renderColors() {
    const fragment = new DocumentFragment();

    for (const [color, { id }] of this.#colorMap) {
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
}
