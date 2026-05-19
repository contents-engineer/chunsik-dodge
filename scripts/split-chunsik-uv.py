"""
Split chunsik-uv.png into two layers so hue-rotate only affects skin:

- chunsik-uv-skin.png: yellow/brown fur (with detail regions filled by skin
  fallback color so the underlying layer stays opaque). This is the texture
  the hue/saturation/brightness filter is applied to.
- chunsik-uv-details.png: eyes, cheeks, nose, mouth. Transparent elsewhere.
  Drawn on top of the filtered skin layer without any filter.

Classification uses HSV thresholds. Detail mask is dilated by 1px to
absorb anti-aliased edges so no thin yellow halo bleeds through.
"""
from pathlib import Path

from PIL import Image, ImageFilter
import colorsys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "assets" / "chunsik-dodge" / "images" / "chunsik-uv.png"
OUT_SKIN = SRC.parent / "chunsik-uv-skin.png"
OUT_DETAILS = SRC.parent / "chunsik-uv-details.png"

SKIN_FALLBACK = (240, 210, 130)  # representative yellow used to fill detail
                                 # holes so the filtered base stays opaque


def is_skin(rgb):
    r, g, b = (c / 255.0 for c in rgb)
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    hue_deg = h * 360
    # Black eyes / mouth / teeth
    if v < 0.25:
        return False
    # Whitish / pinkish nose
    if s < 0.14:
        return False
    # Main yellow body fur
    if 36 <= hue_deg <= 52 and s >= 0.3 and v >= 0.7:
        return True
    # Darker brown body shading (lower value, same warm hue range as cheek)
    if 28 <= hue_deg <= 36 and v < 0.78 and s >= 0.3:
        return True
    # Cheek peach (hue 28-32, but bright v >= 0.85) — falls through as detail
    return False


def main():
    src = Image.open(SRC).convert("RGB")
    w, h = src.size
    src_px = src.load()

    skin = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    details_mask = Image.new("L", (w, h), 0)
    mask_px = details_mask.load()

    # First pass: build a hard skin/details mask
    for y in range(h):
        for x in range(w):
            if not is_skin(src_px[x, y]):
                mask_px[x, y] = 255

    # Dilate the details mask by 1px to absorb anti-aliased detail edges
    details_mask = details_mask.filter(ImageFilter.MaxFilter(3))

    # Second pass: fill skin layer (skin = original, details = fallback)
    # and details layer (details = original, skin = transparent)
    details = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    skin_px = skin.load()
    detail_out_px = details.load()
    final_mask_px = details_mask.load()

    skin_pixel_count = 0
    detail_pixel_count = 0
    for y in range(h):
        for x in range(w):
            rgb = src_px[x, y]
            if final_mask_px[x, y] >= 128:
                skin_px[x, y] = SKIN_FALLBACK + (255,)
                detail_out_px[x, y] = rgb + (255,)
                detail_pixel_count += 1
            else:
                skin_px[x, y] = rgb + (255,)
                skin_pixel_count += 1

    skin.save(OUT_SKIN, "PNG")
    details.save(OUT_DETAILS, "PNG")
    total = w * h
    print(
        f"src={SRC.name} {w}x{h}\n"
        f"skin pixels: {skin_pixel_count} ({skin_pixel_count/total*100:.1f}%)\n"
        f"detail pixels: {detail_pixel_count} ({detail_pixel_count/total*100:.1f}%)\n"
        f"out: {OUT_SKIN.name}, {OUT_DETAILS.name}"
    )


if __name__ == "__main__":
    main()
