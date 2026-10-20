// Sprite renderer (M5): draws a fly from the sprite sheet. The sheet faces up (−y), so the
// rotation is θ + π/2; the anchor (thorax centre) sits on the fly's position.

/** Draws one fly. `sheet` is { img, meta } from loadSheet; `size` is the body length in px. */
export function drawSprite(ctx, sheet, fly, size) {
  const { img, meta } = sheet;
  const clip = meta.clips[fly.clip] || meta.clips.walk;
  const fw = meta.frameWidth;
  const fh = meta.frameHeight;
  const frame = fly.frame % clip.frames;
  const k = size / meta.bodyLengthPx;
  ctx.save();
  ctx.translate(fly.x, fly.y);
  ctx.rotate(fly.theta + Math.PI / 2);
  ctx.scale(k, k);
  ctx.drawImage(img, frame * fw, clip.row * fh, fw, fh, -meta.anchor[0], -meta.anchor[1], fw, fh);
  ctx.restore();
}
