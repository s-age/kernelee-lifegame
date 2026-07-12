// presentation/GridCanvas.tsx — the single board <canvas>.
//
// Ring rule: presentation depends only on contract + react-kernelee.
// This component sticks to being a transducer:
// - subscribe → draw: it only draws the new useBuffer(GridState) snapshot (the
//   reference changes copy-on-write) to the ctx in a useEffect (mutate-driven,
//   no rAF needed).
// - sensor → dispatch: it only reduces the pointer position to normalized
//   coordinates (u, v) via rect measurement and sends strokeStart/Move/End.
//   Interpreting them as cell coordinates (hitCell), drag detection, and
//   same-cell-repeat suppression are all owned by circuit/compute — the view
//   does not interpret.

import { useCallback, useEffect, useRef, type PointerEvent, type ReactElement } from 'react';
import { useBuffer, useDispatch } from '@s-age/react-kernelee';
import { SimActions, type NormalizedPoint } from '../contract/ports';
import { GridState } from '../contract/states';

/** Logical pixel size of one cell (devicePixelRatio is absorbed by the canvas backing store). */
const CELL_SIZE = 12;

const COLOR_DEAD = '#12161c';
const COLOR_ALIVE = '#7ce8c4';
const COLOR_GRID_LINE = '#1e2530';

/**
 * Reduce the pointer position to normalized coordinates (u, v) ∈ [0,1). Rect
 * measurement is DOM work, so it stays in the view (the unavoidable part of
 * being a sensor) — no interpretation beyond this point is sent.
 */
function normalizedFromEvent(event: PointerEvent<HTMLCanvasElement>): NormalizedPoint | null {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    u: (event.clientX - rect.left) / rect.width,
    v: (event.clientY - rect.top) / rect.height,
  };
}

export function GridCanvas(): ReactElement {
  const grid = useBuffer(GridState);
  const dispatch = useDispatch();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const cssWidth = grid.width * CELL_SIZE;
  const cssHeight = grid.height * CELL_SIZE;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // devicePixelRatio support: the backing store is dpr times larger while the
    // CSS size stays in logical px (prevents blurring).
    const dpr = window.devicePixelRatio || 1;
    const backingWidth = Math.round(cssWidth * dpr);
    const backingHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = COLOR_DEAD;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    ctx.fillStyle = COLOR_ALIVE;
    for (let y = 0; y < grid.height; y++) {
      const row = y * grid.width;
      for (let x = 0; x < grid.width; x++) {
        if (grid.cells[row + x] === 1) {
          ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      }
    }

    ctx.strokeStyle = COLOR_GRID_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= grid.width; x++) {
      ctx.moveTo(x * CELL_SIZE + 0.5, 0);
      ctx.lineTo(x * CELL_SIZE + 0.5, cssHeight);
    }
    for (let y = 0; y <= grid.height; y++) {
      ctx.moveTo(0, y * CELL_SIZE + 0.5);
      ctx.lineTo(cssWidth, y * CELL_SIZE + 0.5);
    }
    ctx.stroke();
  }, [grid, cssWidth, cssHeight]);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>): void => {
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = normalizedFromEvent(event);
      if (point) dispatch(SimActions.strokeStart(point));
    },
    [dispatch],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>): void => {
      // The view does not decide whether a drag is in progress — circuit's
      // stroke state drops moves outside a stroke. The sensor sends everything.
      const point = normalizedFromEvent(event);
      if (point) dispatch(SimActions.strokeMove(point));
    },
    [dispatch],
  );

  const handlePointerEnd = useCallback(
    (event: PointerEvent<HTMLCanvasElement>): void => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dispatch(SimActions.strokeEnd());
    },
    [dispatch],
  );

  return (
    <canvas
      ref={canvasRef}
      className="grid-canvas"
      style={{ width: cssWidth, height: cssHeight }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
    />
  );
}
