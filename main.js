import { init } from './canvas.js';

const canvas = document.querySelector('#image-canvas');
const context = canvas.getContext('2d');

const image = new Image();
image.src = './charizard.png';
image.onload = () => {
  const { height, width } = image;
  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  init(imageData);
};
