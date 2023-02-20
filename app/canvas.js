import { getColors } from './colors.js';
import { createMatrix } from './matrix.js';

export const init = async (imageData) => {
  const $gridSize = document.querySelector('#grid-size');
  $gridSize.max = Math.max(imageData.width, imageData.height);

  const canvas = document.querySelector('#zoom-canvas');
  const context = canvas.getContext('2d');

  const [colors, colorMap] = getColors(imageData);
  renderColors(colorMap);

  const bitmap = await createImageBitmap(
    imageData,
    0,
    0,
    imageData.width,
    imageData.height,
  );

  const clamp = (dir, n) =>
    Math.max(-imageData[dir] * scale, Math.min(canvas[dir], n));

  const setSize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };

  setSize();

  let gridSize = $gridSize.valueAsNumber;

  let scale = 1;
  let x = canvas.width / 2 - (imageData.width * scale) / 2;
  let y = canvas.height / 2 - (imageData.height * scale) / 2;
  let moving = false;

  draw();

  window.addEventListener('resize', () => {
    setSize();
    draw();
  });

  canvas.addEventListener('contextmenu', (evt) => evt.preventDefault());

  canvas.addEventListener('wheel', (evt) => {
    evt.preventDefault();

    let { deltaY } = event;
    const { ctrlKey, deltaMode } = event;

    if (deltaMode === 1) {
      // 1 is "lines", 0 is "pixels"
      // Firefox uses "lines" for some types of mouse
      deltaY *= 15;
    }

    // ctrlKey is true when pinch-zooming on a trackpad.
    const divisor = ctrlKey ? 100 : 300;
    const scaleDiff = 1 - deltaY / divisor;

    const originX = evt.clientX - x;
    const originY = evt.clientY - y;

    const matrix = createMatrix()
      // Scale about the origin.
      .translate(originX, originY)
      // Apply current translate
      .translate(x, y)
      .scale(scaleDiff)
      .translate(-originX, -originY)
      // Apply current scale.
      .scale(scale);

    scale = matrix.a;
    x = matrix.e;
    y = matrix.f;

    draw();
  });

  canvas.addEventListener('pointerdown', () => {
    moving = true;
  });

  canvas.addEventListener('pointerup', () => {
    moving = false;
    draw();
  });

  canvas.addEventListener('pointermove', (evt) => {
    if (!moving) {
      return;
    }

    x = clamp('width', x + evt.movementX);
    y = clamp('height', y + evt.movementY);
    draw();
  });

  $gridSize.addEventListener('input', (evt) => {
    gridSize = evt.target.valueAsNumber;
    draw();
  });

  function draw() {
    context.clearRect(0, 0, canvas.width, canvas.height);

    const state = {
      height: imageData.height,
      scale,
      width: imageData.width,
      x,
      y,
    };

    drawImage(context, state, bitmap);

    if (!moving && scale >= 16) {
      drawLabels(context, state, colors);
    }

    if (scale > 5) {
      drawGrid(context, state, { color: 'white', gap: 1 });
    }

    drawGrid(context, state, { color: 'grey', gap: gridSize });
    drawBorder(context, state, { color: 'black' });
  }
};

function drawBorder(ctx, state, options) {
  const { height, scale, width, x, y } = state;
  const { color, lineWidth = 1 } = options;

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(x, y, width * scale, height * scale);
}

function drawGrid(ctx, state, options) {
  const { height, scale, width, x: left, y: top } = state;
  const { color, gap, lineWidth = 1 } = options;

  const bottom = height * scale + top;
  const right = width * scale + left;
  const factor = gap * scale;

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();

  for (let i = 0, count = Math.ceil(width / gap); i <= count; i++) {
    const x = i * factor + left;
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }

  for (let i = 0, count = Math.ceil(height / gap); i <= count; i++) {
    const y = i * factor + top;
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }

  ctx.stroke();
}

function drawImage(ctx, state, bitmap) {
  const { height, scale, width, x, y } = state;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, x, y, width * scale, height * scale);
}

function drawLabels(ctx, state, colors) {
  const { scale, width, x, y } = state;

  ctx.font = "12px 'Helvetica Neue', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const { brightness, id, index } of colors) {
    const col = index % width;
    const row = Math.floor(index / width);

    ctx.fillStyle = brightness > 125 ? 'black' : 'white';
    ctx.fillText(
      id,
      x + (col * scale + scale / 2),
      y + (row * scale + scale / 2),
    );
  }
}

function renderColors(colorMap) {
  const $colors = document.querySelector('#colors');
  const fragment = new DocumentFragment();

  for (const [color, { id }] of colorMap) {
    const $color = document.createElement('div');
    $color.classList.add('color');
    $color.innerHTML = `
      <span class="color-swatch" style="background-color: ${color};"></span>
      #${id} ${color}
    `;
    fragment.appendChild($color);
  }

  $colors.innerHTML = '';
  $colors.appendChild(fragment);
}
