import '/web_modules/file-drop-element.js';

import { PxCanvas } from './canvas.js';

const canvas = document.querySelector('#image-canvas');
const context = canvas.getContext('2d', { willReadFrequently: true });

const pxCanvas = new PxCanvas(document.querySelector('#zoom-canvas'));

const dropTarget = document.querySelector('#file-drop-target');
dropTarget.addEventListener('filedrop', (evt) => {
  const [file] = evt.files;
  go(URL.createObjectURL(file));
});

go('./images/charizard.png');

function go(src) {
  const image = new Image();
  image.src = src;
  image.onload = () => {
    const { height, width } = image;
    canvas.width = width;
    canvas.height = height;
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    pxCanvas.setImage(imageData);
  };
}
