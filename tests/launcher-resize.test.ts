import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  LAUNCHER_MENU_SCALE_STORAGE_KEY,
  launcherResizeAnchor,
  launcherResizeHandleAtPoint,
  launcherResizeHandlesForGrowth,
  launcherScaleFromPointer,
  MAX_LAUNCHER_MENU_SCALE,
  maxLauncherMenuScaleForViewport,
  MIN_LAUNCHER_MENU_SCALE,
  normalizeLauncherMenuScale,
} from '@/modules/shell/launcher-resize';

describe('launcher menu resizing', () => {
  it('applies one root transform so visuals and pointer hit boxes share a scale', async () => {
    const component = await readFile('src/modules/shell/App.vue', 'utf8');

    expect(component).toContain(
      'transform: scale(var(--launcher-menu-scale));',
    );
    expect(component).toContain("'--launcher-menu-scale': menuScale.value");
    expect(component).toContain('@pointerdown.capture="handleResizePointerDown"');
    expect(component).toContain("'pointermove',\n    handleResizePointerMove");
    expect(component).toContain('if (event.target !== wheel) return;');
    expect(component).toContain('pointerHitsVerticalScrollbar');
    expect(component).not.toContain('class="resize-handle"');
    expect(component).not.toContain('resize: both');
  });

  it('normalizes persisted scale values and falls back for malformed data', () => {
    expect(LAUNCHER_MENU_SCALE_STORAGE_KEY).toBe(
      'caelian_launcher_menu_scale_v1',
    );
    expect(normalizeLauncherMenuScale('1.2')).toBe(1.2);
    expect(normalizeLauncherMenuScale(0.1)).toBe(MIN_LAUNCHER_MENU_SCALE);
    expect(normalizeLauncherMenuScale(8)).toBe(MAX_LAUNCHER_MENU_SCALE);
    expect(normalizeLauncherMenuScale('')).toBe(1);
    expect(normalizeLauncherMenuScale('not-a-scale', 1.25)).toBe(1.25);
    expect(normalizeLauncherMenuScale(Number.POSITIVE_INFINITY, 3)).toBe(
      MAX_LAUNCHER_MENU_SCALE,
    );
  });

  it('exposes only the free edges and outer corner for each growth direction', () => {
    expect(
      launcherResizeHandlesForGrowth({
        horizontal: 'right',
        vertical: 'bottom',
      }),
    ).toEqual(['right', 'bottom', 'bottom-right']);
    expect(
      launcherResizeHandlesForGrowth({
        horizontal: 'left',
        vertical: 'top',
      }),
    ).toEqual(['left', 'top', 'top-left']);
    expect(
      launcherResizeHandlesForGrowth({
        horizontal: 'left',
        vertical: 'bottom',
      }),
    ).toEqual(['left', 'bottom', 'bottom-left']);
  });

  it('only starts resizing inside the free border hit area', () => {
    const rect = { left: 20, top: 30, width: 240, height: 180 };
    const growth = { horizontal: 'left', vertical: 'bottom' } as const;

    expect(
      launcherResizeHandleAtPoint(rect, { x: 25, y: 120 }, growth, 9),
    ).toBe('left');
    expect(
      launcherResizeHandleAtPoint(rect, { x: 140, y: 205 }, growth, 9),
    ).toBe('bottom');
    expect(
      launcherResizeHandleAtPoint(rect, { x: 24, y: 207 }, growth, 9),
    ).toBe('bottom-left');
    expect(
      launcherResizeHandleAtPoint(rect, { x: 140, y: 120 }, growth, 18),
    ).toBeNull();
    expect(
      launcherResizeHandleAtPoint(rect, { x: 255, y: 120 }, growth, 18),
    ).toBeNull();
    expect(
      launcherResizeHandleAtPoint(rect, { x: 19, y: 120 }, growth, 18),
    ).toBeNull();
  });

  it('anchors edges and corners at the opposite side of the rendered menu', () => {
    const rect = { left: 20, top: 30, width: 240, height: 180 };

    expect(launcherResizeAnchor(rect, 'right')).toEqual({ x: 20, y: 120 });
    expect(launcherResizeAnchor(rect, 'top')).toEqual({ x: 140, y: 210 });
    expect(launcherResizeAnchor(rect, 'bottom-left')).toEqual({
      x: 260,
      y: 30,
    });
    expect(launcherResizeAnchor(rect, 'top-right')).toEqual({
      x: 20,
      y: 210,
    });
  });

  it('derives a proportional scale from horizontal and vertical edge drags', () => {
    expect(
      launcherScaleFromPointer({
        handle: 'right',
        anchor: { x: 20, y: 120 },
        startPointer: { x: 220, y: 120 },
        currentPointer: { x: 270, y: 400 },
        startScale: 1,
      }),
    ).toBe(1.25);

    expect(
      launcherScaleFromPointer({
        handle: 'top',
        anchor: { x: 140, y: 210 },
        startPointer: { x: 140, y: 30 },
        currentPointer: { x: -200, y: -60 },
        startScale: 0.8,
      }),
    ).toBeCloseTo(1.2);
  });

  it('projects corner movement onto the diagonal and clamps scale limits', () => {
    const common = {
      handle: 'bottom-right' as const,
      anchor: { x: 0, y: 0 },
      startPointer: { x: 240, y: 180 },
      startScale: 1,
    };

    expect(
      launcherScaleFromPointer({
        ...common,
        currentPointer: { x: 300, y: 225 },
      }),
    ).toBe(1.25);
    expect(
      launcherScaleFromPointer({
        ...common,
        currentPointer: { x: 800, y: 600 },
      }),
    ).toBe(MAX_LAUNCHER_MENU_SCALE);
    expect(
      launcherScaleFromPointer({
        ...common,
        currentPointer: { x: 20, y: 15 },
      }),
    ).toBe(MIN_LAUNCHER_MENU_SCALE);
  });

  it('keeps the starting scale when pointer geometry is unusable', () => {
    expect(
      launcherScaleFromPointer({
        handle: 'right',
        anchor: { x: 10, y: 10 },
        startPointer: { x: 10, y: 10 },
        currentPointer: { x: 30, y: 10 },
        startScale: 1.1,
      }),
    ).toBe(1.1);
    expect(
      launcherScaleFromPointer({
        handle: 'bottom',
        anchor: { x: 10, y: 10 },
        startPointer: { x: 10, y: 100 },
        currentPointer: { x: 10, y: Number.NaN },
        startScale: 0.9,
      }),
    ).toBe(0.9);
  });

  it('limits right/down growth using the visual viewport offsets', () => {
    expect(
      maxLauncherMenuScaleForViewport(
        { left: 40, top: 30, width: 200, height: 120 },
        1,
        { width: 300, height: 270, offsetLeft: 10, offsetTop: 20 },
        { horizontal: 'right', vertical: 'bottom' },
      ),
    ).toBeCloseTo(1.35);
  });

  it('limits left/up growth from the opposite anchored corner', () => {
    expect(
      maxLauncherMenuScaleForViewport(
        { left: 130, top: 110, width: 160, height: 120 },
        0.8,
        { width: 300, height: 240, offsetLeft: 10, offsetTop: 20 },
        { horizontal: 'left', vertical: 'top' },
      ),
    ).toBeCloseTo(1.4);
  });

  it('returns bounded defaults for missing geometry and cramped viewports', () => {
    expect(
      maxLauncherMenuScaleForViewport(
        { left: 0, top: 0, width: 0, height: 0 },
        1,
        { width: 390, height: 720, offsetLeft: 0, offsetTop: 0 },
        { horizontal: 'right', vertical: 'bottom' },
      ),
    ).toBe(MAX_LAUNCHER_MENU_SCALE);
    expect(
      maxLauncherMenuScaleForViewport(
        { left: 0, top: 0, width: 300, height: 300 },
        1,
        { width: 100, height: 100, offsetLeft: 0, offsetTop: 0 },
        { horizontal: 'right', vertical: 'bottom' },
      ),
    ).toBe(MIN_LAUNCHER_MENU_SCALE);
  });
});
