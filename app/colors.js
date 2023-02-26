const pixelToRgba = (r, g, b, a) => `rgba(${r}, ${g}, ${b}, ${a / 255})`;

export const getColors = (imageData) => {
  const { data } = imageData;

  const colorMap = new Map();
  let colorCount = 0;

  const results = [];

  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = data.slice(i, i + 4);
    const color = pixelToRgba(r, g, b, a);

    let id;
    if (!colorMap.has(color)) {
      id = ++colorCount;
      colorMap.set(color, {
        id,
        // luma: 0.3 * r + 0.59 * g + 0.11 * b,
        rgba: [r, g, b, a],
      });
    } else {
      id = colorMap.get(color).id;
    }

    results.push({
      color,
      // https://www.w3.org/TR/AERT/#color-contrast
      brightness: Math.round((r * 299 + g * 587 + b * 114) / 1000),
      id,
    });
  }

  return [results, colorMap];
};
