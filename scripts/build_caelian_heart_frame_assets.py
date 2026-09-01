from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


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

    # Image #4 top-left sticker. Only the neutral background connected to this
    # crop's outer edge is removed; enclosed hair, clothing and white outline
    # pixels are retained exactly as foreground.
    crop = source.crop((55, 35, 430, 405))
    rgb = np.asarray(crop)
    red = rgb[:, :, 0].astype(np.int16)
    green = rgb[:, :, 1].astype(np.int16)
    blue = rgb[:, :, 2].astype(np.int16)
    minimum = np.minimum(np.minimum(red, green), blue)
    maximum = np.maximum(np.maximum(red, green), blue)
    background_candidate = (
        (minimum >= 195)
        & (maximum <= 248)
        & ((maximum - minimum) <= 12)
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

    alpha = Image.fromarray(
        np.where(background, 0, 255).astype(np.uint8),
        "L",
    ).filter(ImageFilter.GaussianBlur(0.55))
    rgba = Image.fromarray(np.dstack((rgb, np.asarray(alpha))), "RGBA")
    bounds = rgba.getbbox()
    if not bounds:
        raise ValueError("Could not isolate Image #4 top-left character")
    rgba = rgba.crop(bounds)
    scale = min(466 / rgba.width, 466 / rgba.height)
    size = (round(rgba.width * scale), round(rgba.height * scale))
    rgba = rgba.resize(size, Image.Resampling.LANCZOS)
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
    alpha = np.where(inside_rows & inside_columns, 255, 0).astype(np.uint8)
    safe_frame = Image.fromarray(np.dstack((rgb, alpha)), "RGBA")
    safe_frame.save(ASSET_DIR / "menu-frame-9slice.png", optimize=True)
    # The compact entry cards deliberately reuse the ornament-safe frame atlas.
    # Its four corners remain fixed while only straight edge/center tiles scale.
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
