// Camera nose position → a coarse 3×2 screen zone, with hysteresis. One lens can't resolve depth,
// so zones are the honest resolution. Touch always beats the camera.
export const COLS = 3, ROWS = 2
export interface Zone { col: number; row: number }
export interface NoseCalibration { xLeft: number; xCenter: number; xRight: number; yMid: number }

// Front-camera image is mirrored relative to the screen: dog moving to screen-left appears at image-right.
export const DEFAULT_CAL: NoseCalibration = { xLeft: 0.78, xCenter: 0.5, xRight: 0.22, yMid: 0.5 }

/** Map a camera-space nose (0..1) to a screen-space position (0..1) by piecewise-linear interpolation. */
export function noseToScreen(nx: number, ny: number, cal: NoseCalibration = DEFAULT_CAL): { x: number; y: number } {
  const seg = (v: number, a: number, b: number) => (Math.abs(b - a) < 1e-6 ? 0.5 : (v - a) / (b - a))
  const leftSide = Math.sign(cal.xLeft - cal.xCenter) === Math.sign(nx - cal.xCenter)
  const x = leftSide ? 0.5 - 0.5 * seg(nx, cal.xCenter, cal.xLeft) : 0.5 + 0.5 * seg(nx, cal.xCenter, cal.xRight)
  const y = 0.5 + (ny - cal.yMid)
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }
}

/**
 * Where the dog is pointing: where its nose is in front of the screen, pushed further by which way the head is
 * turned. Keypoint left/right are the dog's own, and a dog facing the screen shares the screen's left/right, so a
 * head turned toward its right eye (positive yaw) points further right. Coarse by nature: one lens, no depth.
 */
// Halved after the first field test: yaw was the noisiest input and carried no usable aim signal yet.
export const YAW_GAIN = 0.25
export function pointAt(nx: number, ny: number, yaw: number, neutralYaw: number, cal: NoseCalibration = DEFAULT_CAL): { x: number; y: number } {
  const base = noseToScreen(nx, ny, cal)
  const turn = Math.max(-0.6, Math.min(0.6, yaw - neutralYaw))
  return { x: Math.max(0, Math.min(1, base.x + YAW_GAIN * turn)), y: base.y }
}

export class ZoneTracker {
  private cur: Zone | null = null
  private since = 0
  constructor(private hysteresis = 0.08) {}
  update(sx: number, sy: number, now: number): Zone {
    const raw = { col: Math.min(COLS - 1, Math.floor(sx * COLS)), row: Math.min(ROWS - 1, Math.floor(sy * ROWS)) }
    if (!this.cur) { this.cur = raw; this.since = now; return raw }
    if (raw.col !== this.cur.col || raw.row !== this.cur.row) {
      // only switch once the point is clearly inside the new zone
      const cx = (this.cur.col + 0.5) / COLS, cy = (this.cur.row + 0.5) / ROWS
      const past = Math.abs(sx - cx) > 0.5 / COLS + this.hysteresis || Math.abs(sy - cy) > 0.5 / ROWS + this.hysteresis
      if (past) { this.cur = raw; this.since = now }
    }
    return this.cur
  }
  clear() { this.cur = null }
  get zone() { return this.cur }
  dwellMs(now: number) { return this.cur ? now - this.since : 0 }
}

export const zoneOf = (x: number, y: number): Zone => ({ col: Math.min(COLS - 1, Math.floor(x * COLS)), row: Math.min(ROWS - 1, Math.floor(y * ROWS)) })
export const sameZone = (a: Zone | null, b: Zone | null) => !!a && !!b && a.col === b.col && a.row === b.row
