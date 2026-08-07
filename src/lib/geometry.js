export const DEG = Math.PI / 180

// Rotate a vector by `deg` clockwise in a y-down coordinate system.
export function rotateVec(x, y, deg) {
  const a = deg * DEG
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: x * c - y * s, y: x * s + y * c }
}

export function unrotateVec(x, y, deg) {
  return rotateVec(x, y, -deg)
}

export function norm(deg) {
  return ((Math.round(deg) % 360) + 360) % 360
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}
