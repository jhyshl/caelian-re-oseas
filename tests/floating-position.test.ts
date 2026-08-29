import { describe, expect, it } from 'vitest';
import {
  clampLauncherPosition,
  JOURNEY_DOCK_PEEK,
  launcherFootprintForViewport,
  resolveLauncherDrop,
  retractLauncherPosition,
  type ViewportRect,
} from '@/modules/shell/floating-position';

const viewport: ViewportRect = {
  width: 390,
  height: 720,
  offsetLeft: 0,
  offsetTop: 0,
};

describe('floating launcher placement', () => {
  it('keeps a freely placed launcher away from the docking zones', () => {
    expect(resolveLauncherDrop({ x: 140, y: 280 }, viewport, 54)).toEqual({
      position: { x: 140, y: 280 },
      dockSide: null,
    });
  });

  it('docks and retracts at both side edges', () => {
    const left = resolveLauncherDrop({ x: 2, y: 100 }, viewport, 54);
    const right = resolveLauncherDrop({ x: 350, y: 620 }, viewport, 54);

    expect(left).toEqual({
      position: { x: 6, y: 100 },
      dockSide: 'left',
    });
    expect(retractLauncherPosition(left.position, viewport, 54, 'left')).toEqual(
      { x: -36, y: 100 },
    );
    expect(right).toEqual({
      position: { x: 330, y: 620 },
      dockSide: 'right',
    });
    expect(
      retractLauncherPosition(right.position, viewport, 54, 'right'),
    ).toEqual({ x: 372, y: 620 });
  });

  it('clamps restored positions into the current visual viewport', () => {
    expect(
      clampLauncherPosition(
        { x: Number.NaN, y: 900 },
        { ...viewport, offsetLeft: 12, offsetTop: 8 },
        54,
      ),
    ).toEqual({ x: 18, y: 668 });
  });

  it('uses the full Journey ticket footprint and keeps a usable docked edge', () => {
    const ticket = launcherFootprintForViewport(viewport.width, true);
    expect(ticket).toEqual({ width: 84, height: 96 });

    const docked = resolveLauncherDrop({ x: 390, y: 700 }, viewport, ticket);
    expect(docked).toEqual({
      position: { x: 300, y: 618 },
      dockSide: 'right',
    });
    expect(
      retractLauncherPosition(
        docked.position,
        viewport,
        ticket,
        'right',
        JOURNEY_DOCK_PEEK,
      ),
    ).toEqual({ x: 348, y: 618 });
  });
});
