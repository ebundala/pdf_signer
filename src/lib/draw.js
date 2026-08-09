// Freehand drawing surface. Strokes are kept as point lists in CSS pixels so
// undo stays lossless and the export can be rasterised at `scale` for a crisp
// PNG regardless of how small the pad is on screen.
export class DrawPad {
  constructor(canvas, { scale = 3 } = {}) {
    this.canvas = canvas
    this.scale = scale
    this.strokes = []
    this.color = '#0f172a'
    this.width = 3
    this.current = null

    canvas.style.touchAction = 'none'
    canvas.addEventListener('pointerdown', (e) => this._down(e))
    canvas.addEventListener('pointermove', (e) => this._move(e))
    canvas.addEventListener('pointerup', (e) => this._up(e))
    canvas.addEventListener('pointercancel', (e) => this._up(e))
  }

  resize() {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (!w || !h) return
    this.canvas.width = Math.round(w * this.scale)
    this.canvas.height = Math.round(h * this.scale)
    this.redraw()
  }

  clear() {
    this.strokes = []
    this.current = null
    this.redraw()
  }

  undo() {
    this.strokes.pop()
    this.redraw()
  }

  isEmpty() {
    return this.strokes.length === 0
  }

  _pt(e) {
    const r = this.canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  _down(e) {
    e.preventDefault()
    this.canvas.setPointerCapture(e.pointerId)
    this.current = { color: this.color, width: this.width, points: [this._pt(e)] }
    this.strokes.push(this.current)
    this.redraw()
  }

  _move(e) {
    if (!this.current) return
    const p = this._pt(e)
    const last = this.current.points[this.current.points.length - 1]
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.7) return
    this.current.points.push(p)
    this.redraw()
  }

  _up(e) {
    if (!this.current) return
    this.canvas.releasePointerCapture(e.pointerId)
    this.current = null
  }

  redraw() {
    const ctx = this.canvas.getContext('2d')
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.scale(this.scale, this.scale)
    for (const s of this.strokes) this._stroke(ctx, s)
  }

  // Midpoint-quadratic smoothing: the raw pointer samples become control
  // points, so the curve stays clean at any sampling rate.
  _stroke(ctx, s) {
    const p = s.points
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.lineWidth = s.width

    if (p.length === 1) {
      ctx.beginPath()
      ctx.arc(p[0].x, p[0].y, s.width / 2, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    ctx.beginPath()
    ctx.moveTo(p[0].x, p[0].y)
    for (let i = 1; i < p.length - 1; i++) {
      ctx.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2)
    }
    ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y)
    ctx.stroke()
  }

  // Crop to the inked area so the placement's aspect ratio reflects the
  // drawing rather than the pad it was drawn on.
  async toPng(padding = 6) {
    if (this.isEmpty()) return null
    const src = this.canvas
    const W = src.width
    const H = src.height
    const data = src.getContext('2d').getImageData(0, 0, W, H).data

    let x0 = W
    let y0 = H
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (data[(y * W + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
    if (x1 < 0) return null

    const pad = Math.round(padding * this.scale)
    x0 = Math.max(0, x0 - pad)
    y0 = Math.max(0, y0 - pad)
    x1 = Math.min(W - 1, x1 + pad)
    y1 = Math.min(H - 1, y1 + pad)
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1

    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    out.getContext('2d').drawImage(src, x0, y0, w, h, 0, 0, w, h)

    const blob = await new Promise((r) => out.toBlob(r, 'image/png'))
    return { bytes: new Uint8Array(await blob.arrayBuffer()), nw: w, nh: h }
  }
}
