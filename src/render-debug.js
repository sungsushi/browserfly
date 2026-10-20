// Debug overlay: heading vectors, reorientation targets, state labels, cursor and arrival radii.

const TWO_PI = 2 * Math.PI;

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.stroke();
}

/** Draws the debug overlay for all flies. `cursor` is in container coordinates or null. */
export function drawDebug(ctx, flies, params, cursor) {
  const size = params.size;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'top';

  if (cursor) {
    ctx.strokeStyle = 'rgba(220, 40, 120, 0.9)';
    ctx.beginPath();
    ctx.moveTo(cursor.x - 8, cursor.y);
    ctx.lineTo(cursor.x + 8, cursor.y);
    ctx.moveTo(cursor.x, cursor.y - 8);
    ctx.lineTo(cursor.x, cursor.y + 8);
    ctx.stroke();
    if (params.arrivalRadius > 0) {
      const r = params.arrivalRadius * size;
      circle(ctx, cursor.x, cursor.y, r);
      ctx.setLineDash([4, 4]);
      circle(ctx, cursor.x, cursor.y, 2 * r);
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = 'rgba(220, 40, 120, 0.25)';
    circle(ctx, cursor.x, cursor.y, params.attractionRange);
  }

  for (const f of flies) {
    const len = size;
    ctx.strokeStyle = 'rgba(0, 140, 255, 0.95)';
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(f.x + Math.cos(f.theta) * len, f.y + Math.sin(f.theta) * len);
    ctx.stroke();
    if (f.mode === 'reorient') {
      ctx.strokeStyle = 'rgba(255, 150, 0, 0.95)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(f.x + Math.cos(f.targetTheta) * len, f.y + Math.sin(f.targetTheta) * len);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    let label = f.mode;
    if (f.mode === 'stop') label += ` ${Math.max(0, f.stopTimer).toFixed(1)}s`;
    if (f.lingerTimer > 0) label += ` linger ${f.lingerTimer.toFixed(1)}`;
    if (!f.arrivalArmed) label += ' (disarmed)';
    const tx = f.x + size * 0.6;
    const ty = f.y - size * 0.6;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(tx - 2, ty - 1, ctx.measureText(label).width + 4, 14);
    ctx.fillStyle = '#111';
    ctx.fillText(label, tx, ty);
  }
  ctx.restore();
}
