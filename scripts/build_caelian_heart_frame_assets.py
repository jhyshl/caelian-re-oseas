from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "src" / "assets" / "themes" / "caelian-heart"


def first_and_last(mask: np.ndarray, axis: int) -> tuple[np.ndarray, np.ndarray]:
    has_value = mask.any(axis=axis)
    first = np.where(has_value, mask.argmax(axis=axis), -1)
    last = np.where(
        has_value,
        mask.shape[axis] - 1 - np.flip(mask, axis=axis).argmax(axis=axis),
        -1,
    )
    return first, last


def interpolate_inside(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    positions = np.flatnonzero(values >= 0)
    if positions.size < 2:
        raise ValueError("Could not trace the outer gold frame contour")
    coordinates = np.arange(values.size)
    traced = np.rint(np.interp(coordinates, positions, values[positions])).astype(
        np.int32,
    )
    valid = (coordinates >= int(positions[0])) & (coordinates <= int(positions[-1]))
    return traced, valid


def save_center_gem() -> None:
    source = Image.open(ASSET_DIR / "frame-center-gem-painted.png").convert("RGB")
    rgb = np.asarray(source)
    red = rgb[:, :, 0].astype(np.int16)
    green = rgb[:, :, 1].astype(np.int16)
    blue = rgb[:, :, 2].astype(np.int16)
    background_candidate = (
        (np.minimum(np.minimum(red, green), blue) >= 220)
        & ((np.maximum(np.maximum(red, green), blue) - np.minimum(np.minimum(red, green), blue)) <= 20)
    )

    height, width = background_candidate.shape
    background = np.zeros_like(background_candidate, dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        if background_candidate[0, x]:
            queue.append((0, x))
        if background_candidate[height - 1, x]:
            queue.append((height - 1, x))
    for y in range(height):
        if background_candidate[y, 0]:
            queue.append((y, 0))
        if background_candidate[y, width - 1]:
            queue.append((y, width - 1))

    while queue:
        y, x = queue.popleft()
        if background[y, x] or not background_candidate[y, x]:
            continue
        background[y, x] = True
        if y > 0:
            queue.append((y - 1, x))
        if y + 1 < height:
            queue.append((y + 1, x))
        if x > 0:
            queue.append((y, x - 1))
        if x + 1 < width:
            queue.append((y, x + 1))

    alpha_image = Image.fromarray(
        np.where(background, 0, 255).astype(np.uint8),
        "L",
    ).filter(ImageFilter.GaussianBlur(0.65))
    rgba = Image.fromarray(np.dstack((rgb, np.asarray(alpha_image))), "RGBA")
    bounds = rgba.getbbox()
    if not bounds:
        raise ValueError("Could not isolate the center gem")
    rgba = rgba.crop(bounds)
    target_width = 512
    target_height = round(rgba.height * target_width / rgba.width)
    rgba.resize((target_width, target_height), Image.Resampling.LANCZOS).save(
        ASSET_DIR / "frame-center-gem.png",
        optimize=True,
    )


def save_launcher_preview() -> None:
    frame = Image.open(ASSET_DIR / "launcher-frame.png").convert("RGBA")
    portrait = Image.open(ASSET_DIR / "icons" / "battle.png").convert("RGBA")
    portrait_width = 380
    portrait_height = round(portrait.height * portrait_width / portrait.width)
    portrait = portrait.resize(
        (portrait_width, portrait_height),
        Image.Resampling.LANCZOS,
    )
    position = (
        (frame.width - portrait.width) // 2,
        (frame.height - portrait.height) // 2,
    )
    composed = frame.copy()
    composed.alpha_composite(portrait, position)
    composed.save(ASSET_DIR / "launcher-preview.png", optimize=True)


def save_battle_cutout(character_sheet: Path) -> None:
    source = Image.open(character_sheet).convert("RGB")
    if source.size != (1216, 832):
        raise ValueError(
            f"Unexpected character sheet dimensions: {source.size}; expected (1216, 832)",
        )

    # Image #4 top-left sticker. Detect only neutral gray background that is
    # connected to the crop edge. Enclosed gray/beige hair pixels can therefore
    # never be removed as background.
    crop = source.crop((68, 32, 432, 408))
    rgb = np.asarray(crop)
    softened = np.asarray(crop.filter(ImageFilter.GaussianBlur(0.8))).astype(
        np.int16,
    )
    minimum = softened.min(axis=2)
    maximum = softened.max(axis=2)
    luminance = softened.mean(axis=2)
    background_candidate = (
        ((maximum - minimum) <= 18)
        & (luminance >= 204)
        & (luminance <= 242)
    )

    height, width = background_candidate.shape
    background = np.zeros_like(background_candidate, dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        queue.append((0, x))
        queue.append((height - 1, x))
    for y in range(height):
        queue.append((y, 0))
        queue.append((y, width - 1))

    while queue:
        y, x = queue.popleft()
        if background[y, x] or not background_candidate[y, x]:
            continue
        background[y, x] = True
        if y > 0:
            queue.append((y - 1, x))
        if y + 1 < height:
            queue.append((y + 1, x))
        if x > 0:
            queue.append((y, x - 1))
        if x + 1 < width:
            queue.append((y, x + 1))

    # Discard isolated non-background specks outside the sticker while filling
    # every enclosed pixel inside its continuous white outline.
    foreground_candidate = ~background
    seen = np.zeros_like(foreground_candidate, dtype=bool)
    largest: list[tuple[int, int]] = []
    for start_y, start_x in zip(*np.where(foreground_candidate)):
        if seen[start_y, start_x]:
            continue
        component: list[tuple[int, int]] = []
        stack = [(int(start_y), int(start_x))]
        seen[start_y, start_x] = True
        while stack:
            y, x = stack.pop()
            component.append((y, x))
            for next_y, next_x in (
                (y - 1, x),
                (y + 1, x),
                (y, x - 1),
                (y, x + 1),
            ):
                if (
                    0 <= next_y < height
                    and 0 <= next_x < width
                    and foreground_candidate[next_y, next_x]
                    and not seen[next_y, next_x]
                ):
                    seen[next_y, next_x] = True
                    stack.append((next_y, next_x))
        if len(component) > len(largest):
            largest = component

    foreground = np.zeros_like(foreground_candidate, dtype=bool)
    for y, x in largest:
        foreground[y, x] = True
    alpha = foreground.astype(np.uint8) * 255
    rgba = Image.fromarray(np.dstack((rgb, alpha)), "RGBA")
    bounds = rgba.getbbox()
    if not bounds:
        raise ValueError("Could not isolate Image #4 top-left character")
    rgba = rgba.crop(bounds)
    scale = min(464 / rgba.width, 464 / rgba.height)
    size = (round(rgba.width * scale), round(rgba.height * scale))
    rgba = rgba.convert("RGBa").resize(
        size,
        Image.Resampling.LANCZOS,
    ).convert("RGBA")
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    canvas.alpha_composite(
        rgba,
        ((canvas.width - rgba.width) // 2, (canvas.height - rgba.height) // 2),
    )
    canvas.save(ASSET_DIR / "icons" / "battle.png", optimize=True)


def main(character_sheet: Path | None = None) -> None:
    source = Image.open(ASSET_DIR / "menu-frame-9slice-painted.png").convert("RGB")
    source = source.resize((1024, 640), Image.Resampling.LANCZOS)
    rgb = np.asarray(source)
    height, width, _ = rgb.shape
    red = rgb[:, :, 0].astype(np.int16)
    green = rgb[:, :, 1].astype(np.int16)
    blue = rgb[:, :, 2].astype(np.int16)
    gold = (
        (red >= 90)
        & (green >= 62)
        & ((red - blue) >= 28)
        & ((green - blue) >= 12)
        & ((red + green) >= 185)
    )

    x_band = max(1, round(width * 0.16))
    y_band = max(1, round(height * 0.16))
    left, _ = first_and_last(gold[:, :x_band], axis=1)
    _, right_in_band = first_and_last(gold[:, width - x_band :], axis=1)
    top, _ = first_and_last(gold[:y_band, :], axis=0)
    _, bottom_in_band = first_and_last(gold[height - y_band :, :], axis=0)
    right = np.where(right_in_band >= 0, width - x_band + right_in_band, -1)
    bottom = np.where(bottom_in_band >= 0, height - y_band + bottom_in_band, -1)

    left, valid_rows_left = interpolate_inside(left)
    right, valid_rows_right = interpolate_inside(right)
    top, valid_columns_top = interpolate_inside(top)
    bottom, valid_columns_bottom = interpolate_inside(bottom)

    x = np.arange(width)[None, :]
    y = np.arange(height)[:, None]
    inside_rows = (
        valid_rows_left[:, None]
        & valid_rows_right[:, None]
        & (x >= left[:, None])
        & (x <= right[:, None])
    )
    inside_columns = (
        valid_columns_top[None, :]
        & valid_columns_bottom[None, :]
        & (y >= top[None, :])
        & (y <= bottom[None, :])
    )
    contour_alpha = np.where(inside_rows & inside_columns, 255, 0).astype(np.uint8)

    # The painted source has a near-white center joined to the empty strips
    # inside all four rails. Those pixels used to stay opaque in the nine-slice
    # atlas and became a large white gutter whenever the frame was rendered.
    # Remove every neutral light fill pixel while retaining every blue/gold rail
    # and corner pixel. This also clears the anti-aliased white rim that is not
    # necessarily connected to the exact center after resampling.
    minimum = rgb.min(axis=2).astype(np.int16)
    maximum = rgb.max(axis=2).astype(np.int16)
    luminance = rgb.mean(axis=2)
    neutral_fill = (
        (contour_alpha > 0)
        & ((maximum - minimum) <= 28)
        & (luminance >= 220)
    )

    transparent_fill = np.asarray(
        Image.fromarray(neutral_fill.astype(np.uint8) * 255, "L").filter(
            ImageFilter.GaussianBlur(0.65),
        ),
    )
    rail_alpha = np.minimum(contour_alpha, 255 - transparent_fill).astype(
        np.uint8,
    )
    safe_frame = Image.fromarray(np.dstack((rgb, rail_alpha)), "RGBA")

    # Journey's final frame implementation keeps the painted paper and the
    # nine-slice rails in one border-image layer. Build the Heart equivalent by
    # placing the original pattern at full opacity inside the traced contour,
    # then compositing only the blue/gold rails above it.
    pattern = ImageOps.fit(
        Image.open(ASSET_DIR / "pattern.png").convert("RGB"),
        (width, height),
        method=Image.Resampling.LANCZOS,
    )
    patterned_frame = Image.fromarray(
        np.dstack((np.asarray(pattern), contour_alpha)),
        "RGBA",
    )
    patterned_frame.alpha_composite(safe_frame)
    patterned_frame.save(ASSET_DIR / "menu-frame-9slice.png", optimize=True)
    # Retain the former atlas for cache and older-manifest compatibility. The
    # current compact entry cards use the untouched original menu-cell artwork.
    safe_frame.save(ASSET_DIR / "menu-cell-9slice.png", optimize=True)
    save_center_gem()
    if character_sheet is not None:
        save_battle_cutout(character_sheet)
    save_launcher_preview()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--character-sheet",
        type=Path,
        help="Original 1216x832 Image #4 sheet used for the exact top-left cutout",
    )
    arguments = parser.parse_args()
    main(arguments.character_sheet)
