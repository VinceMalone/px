use rgb::AsPixels;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn quantize(
    image: Box<[u8]>,
    image_width: usize,
    image_height: usize,
    num_colors: u32,
    dithering: f32,
) -> Box<[u8]> {
    let mut liq = imagequant::new();
    let mut img = liq
        .new_image(image.as_pixels(), image_width, image_height, 0.0)
        .unwrap();
    liq.set_max_colors(num_colors).unwrap();
    let mut res = match liq.quantize(&mut img) {
        Ok(res) => res,
        Err(err) => panic!("Quantization failed, because: {err:?}"),
    };
    res.set_dithering_level(dithering).unwrap();
    let (palette, pixels) = res.remapped(&mut img).unwrap();
    let mut results = Vec::new();
    for px in pixels {
        let rgba = palette[px as usize];
        results.push(rgba.r);
        results.push(rgba.g);
        results.push(rgba.b);
        results.push(rgba.a);
    }
    results.to_owned().into_boxed_slice()
}
