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

onmessage = function handleCanvas(event) {
  if (event.data.canvas) {
    pxCanvas = new PxCanvas(event.data.canvas);
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

class PxCanvas {
  static MAX_SUPPORTED_COLORS = 32;

  #canvas;
  #context;
  /** @type {ImageData} */
  #initialImageData;
  /** @type {ImageData} */
  #image;
  /** @type {ImageBitmap} */
  #bitmap;
  /** @type {Array<Color} */
  #colors;
  /** @type {Map<string, number>} */
  #colorMap;
  /** @type {number} */
  #x;
  /** @type {number} */
  #y;
  /** @type {number} */
  #z;
  #gridSize = 0;
  #maxColors = PxCanvas.MAX_SUPPORTED_COLORS;
  #dithering = 1;
  #latestQuantizeTaskId = 0;
  #lastFinishedQuantizeTaskId = 0;

  /** @param {OffscreenCanvas} canvas */
  constructor(canvas) {
    this.#canvas = canvas;
    this.#context = canvas.getContext('2d');
  }

  /** @param {ImageData} image */
  async setImage(image) {
    this.#initialImageData = image;

    const { height, width } = this.#initialImageData;

    this.#z = 1;
    this.#x = this.#canvas.width / 2 - (width * this.#z) / 2;
    this.#y = this.#canvas.height / 2 - (height * this.#z) / 2;

    const maxGridSize = Math.max(width, height);
    postMessage({ type: 'maxGridSize', payload: maxGridSize });

    // reset settings before `initImage` is called
    this.#gridSize = 0;
    this.#maxColors = PxCanvas.MAX_SUPPORTED_COLORS;
    this.#dithering = 1;

    await this.#initImage();

    const maxColors = Math.min(
      this.#colorMap.size,
      PxCanvas.MAX_SUPPORTED_COLORS,
    );
    postMessage({ type: 'maxColors', payload: maxColors });
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

    this.#image = new ImageData(
      quantizedImageData,
      this.#initialImageData.width,
      this.#initialImageData.height,
      { colorSpace: this.#initialImageData.colorSpace },
    );

    [this.#colors, this.#colorMap] = getColorData(this.#image);
    this.#renderColors();

    this.#bitmap = await createImageBitmap(
      this.#image,
      0,
      0,
      this.#image.width,
      this.#image.height,
    );

    this.#draw();
  }

  /** @param {number} value */
  setGridSize(value) {
    this.#gridSize = value;
    this.#draw();
  }

  /** @param {number} value */
  setMaxColors(value) {
    this.#maxColors = value;
    this.#initImage();
  }

  /** @param {number} value */
  setDithering(value) {
    this.#dithering = value;
    this.#initImage();
  }

  /** @param {{ height: number; width: number }} data */
  resize({ height, width }) {
    this.#canvas.height = height;
    this.#canvas.width = width;
    this.#draw();
  }

  /** @param {{ movementX: number; movementY: number }} data */
  pan({ movementX, movementY }) {
    this.#x = this.#clampXY('width', this.#x + movementX);
    this.#y = this.#clampXY('height', this.#y + movementY);
    this.#draw();
  }

  /** @param {{ scaleDiff: number; x: number; y: number }} data */
  zoom({ scaleDiff, x, y }) {
    const originX = x - this.#x;
    const originY = y - this.#y;

    const matrix = new DOMMatrix()
      // Scale about the origin
      .translate(originX, originY)
      // Apply current translate
      .translate(this.#x, this.#y)
      .scale(scaleDiff)
      .translate(-originX, -originY)
      // Apply current scale
      .scale(this.#z);

    this.#x = matrix.e;
    this.#y = matrix.f;
    this.#z = Math.max(0.1, matrix.a);

    postMessage({ type: 'zoom', payload: this.#z });

    this.#draw();
  }

  #draw() {
    this.#context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);

    this.#drawImage();

    if (this.#z >= 16) {
      this.#drawLabels();
    }

    if (this.#z > 5) {
      this.#drawGrid({ color: 'white', gap: 1 });
    }

    this.#drawGrid({ color: 'grey', gap: this.#gridSize });
    this.#drawBorder({ color: 'black' });
  }

  #drawImage() {
    this.#context.imageSmoothingEnabled = false;
    this.#context.drawImage(
      this.#bitmap,
      this.#x,
      this.#y,
      this.#image.width * this.#z,
      this.#image.height * this.#z,
    );
  }

  *#labeledPixels() {
    const getPixelX = (n) => Math.floor(Math.max(0, (n / this.#z) * -1));

    const getPixelY = (dir, n) =>
      Math.ceil(Math.min((this.#canvas[dir] - n) / this.#z, this.#image[dir]));

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
      const index = this.#image.width * y + x;
      const color = this.#colors[index];
      if (!color) {
        console.warn(`color not found at index ${index} [${x}, ${y}]`);
        continue;
      }
      this.#context.fillStyle = color.brightness > 125 ? 'black' : 'white';
      this.#context.fillText(
        color.id,
        this.#x + (x * this.#z + this.#z / 2),
        this.#y + (y * this.#z + this.#z / 2),
      );
    }
  }

  #drawGrid({ color, gap, lineWidth = 1 }) {
    if (gap === 0) return;

    const bottom = this.#image.height * this.#z + this.#y;
    const right = this.#image.width * this.#z + this.#x;
    const factor = gap * this.#z;

    this.#context.strokeStyle = color;
    this.#context.lineWidth = lineWidth;
    this.#context.beginPath();

    for (
      let i = 0, count = Math.ceil(this.#image.width / gap);
      i < count;
      i++
    ) {
      const x = i * factor + this.#x;
      this.#context.moveTo(x, this.#y);
      this.#context.lineTo(x, bottom);
    }

    for (
      let i = 0, count = Math.ceil(this.#image.height / gap);
      i < count;
      i++
    ) {
      const y = i * factor + this.#y;
      this.#context.moveTo(this.#x, y);
      this.#context.lineTo(right, y);
    }

    this.#context.stroke();
  }

  #drawBorder({ color, lineWidth = 1 }) {
    this.#context.strokeStyle = color;
    this.#context.lineWidth = lineWidth;
    this.#context.strokeRect(
      this.#x,
      this.#y,
      this.#image.width * this.#z,
      this.#image.height * this.#z,
    );
  }

  #clampXY(dir, n) {
    const max = 0 - this.#image[dir] * this.#z;
    const min = this.#canvas[dir];
    return Math.max(max, Math.min(min, n));
  }

  #renderColors() {
    postMessage({
      type: 'colors',
      payload: this.#colorMap,
    });
  }
}

/**
 * @typedef {Object} Color
 * @property {string} color
 * @property {number} brightness
 * @property {number} id
 */

/**
 * @param {ImageData} imageData
 * @returns [Array<Color>, Map<string, number>]
 */
function getColorData(imageData) {
  const { data } = imageData;

  const colorMap = new Map();
  let colorCount = 0;

  const results = [];

  for (let i = 0; i < data.length; i += 4) {
    let [r, g, b, a] = data.slice(i, i + 4);
    if (a === 0) r = b = g = 0;

    const color = `rgba(${r}, ${g}, ${b}, ${a / 255})`;

    let id;
    if (!colorMap.has(color)) {
      id = ++colorCount;
      colorMap.set(color, id);
    } else {
      id = colorMap.get(color);
    }

    results.push({
      color,
      // https://www.w3.org/TR/AERT/#color-contrast
      brightness: Math.round((r * 299 + g * 587 + b * 114) / 1000),
      id,
    });
  }

  return [results, colorMap];
}
