from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "src" / "assets" / "themes" / "journey"
ICON_DIR = ASSET_DIR / "icons-rgba"


def save_frame_alpha(source_name: str, output_name: str) -> None:
    source = Image.open(ASSET_DIR / source_name).convert("RGB")
    rgb = np.asarray(source)
    height, width, _ = rgb.shape
    red = rgb[:, :, 0].astype(np.int16)
    green = rgb[:, :, 1].astype(np.int16)
    blue = rgb[:, :, 2].astype(np.int16)

    # The painted source includes navy/black pixels outside the ticket. A colour
    # key therefore leaves a dark apron around the frame. Trace the *outer* gold
    # contour instead and make everything beyond that contour hard-transparent.
    gold = (
        (red >= 48)
        & (green >= 40)
        & ((red - blue) >= 20)
        & ((green - blue) >= 10)
        & ((red + green) >= 105)
    )

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
            raise ValueError(f"Could not trace outer gold contour in {source_name}")
        start = int(positions[0])
        end = int(positions[-1])
        coordinates = np.arange(values.size)
        traced = np.rint(
            np.interp(coordinates, positions, values[positions]),
        ).astype(np.int32)
        valid = (coordinates >= start) & (coordinates <= end)
        return traced, valid

    # The outer contour never enters the inner 80% of these assets. Limiting the
    # scan to the outer tenth prevents decorative dots and compass art from being
    # mistaken for the silhouette when a painted line has a worn gap.
    x_band = max(1, round(width * 0.1))
    y_band = max(1, round(height * 0.1))
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

    rgba = np.dstack((rgb, alpha))
    Image.fromarray(rgba, "RGBA").save(ASSET_DIR / output_name, optimize=True)


def remove_icon_background(crop: Image.Image) -> Image.Image:
    rgb = np.asarray(crop.convert("RGB"))
    red = rgb[:, :, 0].astype(np.int16)
    green = rgb[:, :, 1].astype(np.int16)
    blue = rgb[:, :, 2].astype(np.int16)

    background = (
        (red <= 72)
        & (green <= 84)
        & (blue <= 112)
        & ((blue - red) >= 13)
        & ((blue - green) >= 5)
    )
    alpha = np.where(background, 0, 255).astype(np.uint8)

    # Remove isolated texture flecks while keeping every substantial painted part.
    opaque = alpha > 0
    visited = np.zeros_like(opaque, dtype=bool)
    keep = np.zeros_like(opaque, dtype=bool)
    height, width = opaque.shape
    for start_y, start_x in zip(*np.nonzero(opaque & ~visited), strict=False):
        if visited[start_y, start_x]:
            continue
        queue: deque[tuple[int, int]] = deque([(start_y, start_x)])
        visited[start_y, start_x] = True
        component: list[tuple[int, int]] = []
        while queue:
            current_y, current_x = queue.popleft()
            component.append((current_y, current_x))
            for next_y, next_x in (
                (current_y - 1, current_x),
                (current_y + 1, current_x),
                (current_y, current_x - 1),
                (current_y, current_x + 1),
            ):
                if (
                    0 <= next_y < height
                    and 0 <= next_x < width
                    and opaque[next_y, next_x]
                    and not visited[next_y, next_x]
                ):
                    visited[next_y, next_x] = True
                    queue.append((next_y, next_x))
        if len(component) >= 96:
            ys, xs = zip(*component, strict=False)
            keep[np.asarray(ys), np.asarray(xs)] = True

    alpha[~keep] = 0
    rgba = np.dstack((rgb, alpha))
    cutout = Image.fromarray(rgba, "RGBA")
    bounds = cutout.getbbox()
    if not bounds:
        return Image.new("RGBA", (512, 512), (0, 0, 0, 0))

    subject = cutout.crop(bounds)
    target = 390
    scale = min(target / subject.width, target / subject.height)
    size = (
        max(1, round(subject.width * scale)),
        max(1, round(subject.height * scale)),
    )
    subject = subject.resize(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    canvas.alpha_composite(
        subject,
        ((512 - subject.width) // 2, (512 - subject.height) // 2),
    )
    return canvas


def split_icon_sheet(source_name: str, names: list[str]) -> None:
    source = Image.open(ASSET_DIR / source_name).convert("RGB")
    if source.size != (1536, 1024):
        raise ValueError(f"Unexpected sprite sheet size: {source_name} {source.size}")
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for index, name in enumerate(names):
        column = index % 3
        row = index // 3
        crop = source.crop((column * 512, row * 512, (column + 1) * 512, (row + 1) * 512))
        remove_icon_background(crop).save(ICON_DIR / f"{name}.png", optimize=True)


def main() -> None:
    save_frame_alpha("menu-frame-painted.png", "menu-frame-alpha.png")
    save_frame_alpha("section-frame-painted.png", "section-frame-alpha.png")
    save_frame_alpha("menu-cell-painted.png", "menu-cell-alpha.png")
    split_icon_sheet(
        "menu-icons-page-1.png",
        ["character", "affinity", "deck", "card-square", "inventory", "crafting"],
    )
    split_icon_sheet(
        "menu-icons-page-2.png",
        ["guild", "mailbox", "market", "map", "worldbook", "battle"],
    )
    split_icon_sheet(
        "menu-icons-page-3.png",
        ["achievements", "settings", "feedback", "surveys", "release-notes"],
    )


if __name__ == "__main__":
    main()
