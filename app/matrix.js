let cachedSvg;

const getSVG = () => {
  if (!cachedSvg) {
    cachedSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  }
  return cachedSvg;
};

export const createMatrix = () => getSVG().createSVGMatrix();
