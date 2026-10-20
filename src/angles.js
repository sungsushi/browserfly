// Angle helpers. All results are in (−π, π].
const PI = Math.PI;
const TWO_PI = 2 * Math.PI;

/** Wraps an angle to (−π, π]; wrapToPi(−π) = π. */
export function wrapToPi(a) {
  let r = a % TWO_PI;
  if (r <= -PI) r += TWO_PI;
  else if (r > PI) r -= TWO_PI;
  return r;
}

/** Signed shortest rotation that takes b to a: wrapToPi(a − b). */
export function angleDiff(a, b) {
  return wrapToPi(a - b);
}

/** Interpolates from a towards b along the shortest path; t in [0, 1]. */
export function lerpAngle(a, b, t) {
  return wrapToPi(a + angleDiff(b, a) * t);
}
