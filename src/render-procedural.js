// Procedural fly renderer (PLAN.md §4.9). Draws a top-down fly with canvas primitives.
// Geometry is in body lengths (BL) with the thorax centre at the origin and the fly facing
// up (−y): head tip at y ≈ −0.42, abdomen tip at y ≈ +0.59. The head overlaps the thorax.

const TWO_PI = 2 * Math.PI;
const STANCE = 0.6;

const COLORS = {
  leg: 'rgba(52, 38, 24, 0.95)',
  thorax: '#7d5b34',
  head: '#6e4f2c',
  abdomen: '#a07a48',
  band: 'rgba(48, 32, 18, 0.55)',
  eye: '#c0281c',
  wing: 'rgba(225, 232, 240, 0.38)',
  wingEdge: 'rgba(90, 90, 100, 0.45)',
  outline: 'rgba(30, 20, 10, 0.6)',
};

// Legs on the left side (x < 0); the right side mirrors x. `hip` is on the thorax, `foot`
// is the neutral foot position, `bend` pushes the knee outward from the hip–foot midpoint.
const LEGS = [
  { hip: [-0.07, -0.07], foot: [-0.3, -0.3], bend: 0.06 },
  { hip: [-0.09, 0.0], foot: [-0.38, 0.02], bend: 0.05 },
  { hip: [-0.07, 0.08], foot: [-0.3, 0.38], bend: 0.06 },
];

function ellipse(ctx, x, y, rx, ry, rot, fill) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TWO_PI);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * Fore–aft foot offset (BL, +forward) and outward lift for a leg at cycle phase `p` in
 * [0, 1). Stance (first 60%) moves the foot backward linearly by one stride relative to the
 * body, so it stays planted while the body travels; swing brings it forward with a lift.
 */
export function footOffset(p, strideBL) {
  if (p < STANCE) return { fore: strideBL * (0.5 - p / STANCE), lift: 0 };
  const t = (p - STANCE) / (1 - STANCE);
  return { fore: strideBL * (t - 0.5), lift: Math.sin(Math.PI * t) };
}

// side = 1 draws the left leg as defined in LEGS, side = −1 its right-hand mirror.
function drawLeg(ctx, leg, side, phase, strideBL) {
  const { fore, lift } = footOffset(phase, strideBL);
  const hx = leg.hip[0] * side;
  const hy = leg.hip[1];
  const fx = (leg.foot[0] - 0.04 * lift) * side;
  const fy = leg.foot[1] - fore;
  const kx = (hx + fx) / 2 + leg.bend * side;
  const ky = (hy + fy) / 2;
  ctx.moveTo(hx, hy);
  ctx.lineTo(kx, ky);
  ctx.lineTo(fx, fy);
}

/**
 * Draws one fly. `fly` needs x, y, theta and phase; `size` is the body length in px.
 * Tripods {L1, R2, L3} and {R1, L2, R3} are half a cycle apart.
 */
export function drawProcedural(ctx, fly, size, strideBL) {
  ctx.save();
  ctx.translate(fly.x, fly.y);
  ctx.rotate(fly.theta + Math.PI / 2);
  ctx.scale(size, size);
  const px = 1 / size;

  // Legs, under the body. L1, L3 and R2 share a phase; the other tripod is offset by 0.5.
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const offset = i % 2 ? 0.5 : 0;
    drawLeg(ctx, LEGS[i], 1, (fly.phase + offset) % 1, strideBL);
    drawLeg(ctx, LEGS[i], -1, (fly.phase + 0.5 - offset) % 1, strideBL);
  }
  ctx.lineWidth = Math.max(1, size * 0.022) * px;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COLORS.leg;
  ctx.stroke();

  // Body: abdomen, thorax, head, with a thin outline for contrast on light and dark pages.
  ctx.lineWidth = Math.max(0.75, size * 0.012) * px;
  ctx.strokeStyle = COLORS.outline;
  ellipse(ctx, 0, 0.37, 0.15, 0.22, 0, COLORS.abdomen);
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  for (const y of [0.24, 0.33, 0.42, 0.51]) {
    ctx.moveTo(-0.2, y);
    ctx.quadraticCurveTo(0, y + 0.05, 0.2, y);
  }
  ctx.lineWidth = 0.035;
  ctx.strokeStyle = COLORS.band;
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = COLORS.outline;
  ellipse(ctx, 0, 0, 0.14, 0.2, 0, COLORS.thorax);
  ctx.stroke();
  ellipse(ctx, 0, -0.3, 0.12, 0.115, 0, COLORS.head);
  ctx.stroke();
  ellipse(ctx, -0.085, -0.31, 0.055, 0.07, 0.25, COLORS.eye);
  ellipse(ctx, 0.085, -0.31, 0.055, 0.07, -0.25, COLORS.eye);

  // Folded wings over the abdomen.
  for (const side of [-1, 1]) {
    ellipse(ctx, 0.065 * side, 0.38, 0.095, 0.29, -0.13 * side, COLORS.wing);
    ctx.strokeStyle = COLORS.wingEdge;
    ctx.stroke();
  }
  ctx.restore();
}
