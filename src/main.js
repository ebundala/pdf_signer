import './style.css'
import { openDocument, renderPage } from './lib/pdfview.js'
import { signPdf } from './lib/sign.js'
import { clamp, rotateVec, unrotateVec } from './lib/geometry.js'
import { DrawPad } from './lib/draw.js'

const state = {
  pdfBytes: null,
  pdfName: 'document.pdf',
  pages: [],
  zoom: 1,
  images: [],
  placements: [],
  selectedId: null,
  nextId: 1,
}

const app = document.querySelector('#app')
app.innerHTML = `
<div class="flex h-full flex-col">
  <header class="flex shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-900/95 px-4 py-2">
    <h1 class="text-sm font-semibold tracking-tight">PDF Signer</h1>
    <label class="btn-ghost cursor-pointer">
      Open PDF<input id="pdf-input" type="file" accept="application/pdf" class="hidden" />
    </label>
    <label class="btn-ghost cursor-pointer">
      Add signature image<input id="img-input" type="file" accept="image/png,image/jpeg" multiple class="hidden" />
    </label>
    <button id="draw-open" class="btn-ghost">Draw signature</button>
    <div class="ml-auto flex items-center gap-2">
      <button id="zoom-out" class="btn-ghost">-</button>
      <span id="zoom-label" class="w-12 text-center text-xs tabular-nums text-slate-400">100%</span>
      <button id="zoom-in" class="btn-ghost">+</button>
      <button id="export" class="btn-primary" disabled>Download signed PDF</button>
    </div>
  </header>

  <div class="flex min-h-0 flex-1">
    <main id="viewer" class="min-h-0 flex-1 overflow-auto bg-slate-950 p-6">
      <div id="empty" class="grid h-full place-items-center text-sm text-slate-500">
        Open a PDF to begin.
      </div>
      <div id="pages" class="mx-auto flex w-fit flex-col items-center gap-6"></div>
    </main>

    <aside class="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-slate-800 bg-slate-900 p-4">
      <section>
        <h2 class="label mb-2">Signature images</h2>
        <div id="lib" class="grid grid-cols-3 gap-2"></div>
        <p id="lib-hint" class="mt-2 text-xs text-slate-500">
          Add a PNG or JPEG, then click it to drop it on the current page.
        </p>
      </section>
      <section id="inspector" class="hidden space-y-3">
        <h2 class="label">Selected signature</h2>
        <div class="grid grid-cols-2 gap-2">
          <div><span class="label">X (pt)</span><input id="in-x" type="number" step="1" class="field" /></div>
          <div><span class="label">Y (pt)</span><input id="in-y" type="number" step="1" class="field" /></div>
          <div><span class="label">Width</span><input id="in-w" type="number" step="1" min="4" class="field" /></div>
          <div><span class="label">Height</span><input id="in-h" type="number" step="1" min="4" class="field" /></div>
        </div>
        <div>
          <span class="label">Rotation <span id="rot-val" class="text-slate-300">0°</span></span>
          <input id="in-r" type="range" min="-180" max="180" step="0.5" class="w-full accent-sky-500" />
        </div>
        <div>
          <span class="label">Opacity <span id="op-val" class="text-slate-300">100%</span></span>
          <input id="in-o" type="range" min="10" max="100" step="1" class="w-full accent-sky-500" />
        </div>
        <label class="flex items-center gap-2 text-xs text-slate-300">
          <input id="in-lock" type="checkbox" checked class="accent-sky-500" /> Lock aspect ratio
        </label>
        <div class="flex gap-2">
          <button id="btn-reset-rot" class="btn-ghost flex-1">Reset angle</button>
          <button id="btn-delete" class="btn-ghost flex-1 !text-rose-300">Delete</button>
        </div>
      </section>
      <p class="mt-auto text-[11px] leading-relaxed text-slate-500">
        Drag to move &middot; corner handles resize &middot; amber handle rotates.<br />
        Hold Shift while rotating to snap to 15&deg;. Arrow keys nudge, Delete removes.<br />
        Everything runs locally; no file leaves your browser.
      </p>
    </aside>
  </div>
</div>
<div id="toast" class="pointer-events-none fixed bottom-4 left-1/2 hidden -translate-x-1/2 rounded-md bg-slate-800 px-4 py-2 text-sm shadow-lg ring-1 ring-slate-700"></div>

<div id="draw-modal" class="fixed inset-0 z-50 hidden items-center justify-center bg-slate-950/70 p-4">
  <div class="w-full max-w-2xl rounded-lg bg-slate-900 p-4 shadow-2xl ring-1 ring-slate-700">
    <div class="mb-3 flex items-center gap-3">
      <h2 class="text-sm font-semibold">Draw signature</h2>
      <button id="draw-close" class="btn-ghost ml-auto">Cancel</button>
    </div>

    <canvas id="draw-canvas" class="h-64 w-full cursor-crosshair rounded-md bg-white"></canvas>

    <div class="mt-3 flex flex-wrap items-center gap-4">
      <div class="flex items-center gap-2">
        <span class="label !inline">Pen</span>
        <div id="swatches" class="flex gap-1.5"></div>
        <input id="draw-color" type="color" value="#0f172a"
               class="h-7 w-8 cursor-pointer rounded border border-slate-700 bg-slate-800 p-0.5" />
      </div>
      <div class="flex flex-1 items-center gap-2">
        <span class="label !inline">Stroke <span id="draw-width-val" class="text-slate-300">3</span></span>
        <input id="draw-width" type="range" min="1" max="16" step="0.5" value="3"
               class="w-full min-w-24 flex-1 accent-sky-500" />
      </div>
      <div class="ml-auto flex gap-2">
        <button id="draw-undo" class="btn-ghost">Undo</button>
        <button id="draw-clear" class="btn-ghost">Clear</button>
        <button id="draw-save" class="btn-primary">Add to library</button>
      </div>
    </div>
  </div>
</div>
`

const $ = (id) => document.getElementById(id)
const pagesEl = $('pages')
const libEl = $('lib')
const inspector = $('inspector')

function toast(msg, ms = 2200) {
  const el = $('toast')
  el.textContent = msg
  el.classList.remove('hidden')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => el.classList.add('hidden'), ms)
}

/* ---------- loading ---------- */

async function loadPdfFile(file) {
  try {
    state.pdfBytes = new Uint8Array(await file.arrayBuffer())
    state.pdfName = file.name
    state.placements = []
    state.selectedId = null
    const { pages } = await openDocument(state.pdfBytes)
    state.pages = pages
    $('empty').classList.add('hidden')
    $('export').disabled = false
    await buildPages()
    toast(`Loaded ${pages.length} page${pages.length > 1 ? 's' : ''}`)
  } catch (err) {
    console.error(err)
    toast(`Could not open PDF: ${err.message}`, 4000)
  }
}

$('pdf-input').addEventListener('change', (e) => {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (file) loadPdfFile(file)
})

$('img-input').addEventListener('change', async (e) => {
  const files = [...(e.target.files ?? [])]
  e.target.value = ''
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const url = URL.createObjectURL(new Blob([bytes], { type: file.type }))
    const dim = await naturalSize(url)
    state.images.push({ id: `img${state.nextId++}`, name: file.name, type: file.type, bytes, url, ...dim })
  }
  renderLibrary()
  if (files.length) toast('Image added - click it to place on a page')
})

function naturalSize(url) {
  return new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => res({ nw: im.naturalWidth, nh: im.naturalHeight })
    im.onerror = () => rej(new Error('Invalid image'))
    im.src = url
  })
}

function renderLibrary() {
  libEl.innerHTML = ''
  for (const img of state.images) {
    const b = document.createElement('button')
    b.className =
      'relative aspect-square rounded-md bg-slate-800 p-1 ring-1 ring-slate-700 hover:ring-sky-500'
    b.title = `Place ${img.name}`
    b.dataset.img = img.id
    const el = document.createElement('img')
    el.src = img.url
    el.className = 'h-full w-full object-contain'
    b.appendChild(el)
    b.addEventListener('click', () => placeImage(img))
    libEl.appendChild(b)
  }
  $('lib-hint').classList.toggle('hidden', state.images.length > 0)
}

/* ---------- freehand drawing ---------- */

const PEN_COLORS = ['#0f172a', '#1d4ed8', '#dc2626', '#047857']
const modal = $('draw-modal')
const pad = new DrawPad($('draw-canvas'))

for (const c of PEN_COLORS) {
  const b = document.createElement('button')
  b.className = 'h-6 w-6 rounded-full ring-1 ring-slate-600'
  b.style.background = c
  b.dataset.swatch = c
  b.addEventListener('click', () => setPenColor(c))
  $('swatches').appendChild(b)
}

function setPenColor(c) {
  pad.color = c
  $('draw-color').value = c
  for (const b of $('swatches').children) {
    b.style.outline = b.dataset.swatch === c ? '2px solid #38bdf8' : 'none'
    b.style.outlineOffset = '2px'
  }
}

function openDrawModal() {
  modal.classList.remove('hidden')
  modal.classList.add('flex')
  pad.resize()
}

function closeDrawModal() {
  modal.classList.add('hidden')
  modal.classList.remove('flex')
}

$('draw-open').addEventListener('click', openDrawModal)
$('draw-close').addEventListener('click', closeDrawModal)
modal.addEventListener('pointerdown', (e) => {
  if (e.target === modal) closeDrawModal()
})
$('draw-undo').addEventListener('click', () => pad.undo())
$('draw-clear').addEventListener('click', () => pad.clear())
$('draw-color').addEventListener('input', (e) => setPenColor(e.target.value))
$('draw-width').addEventListener('input', (e) => {
  pad.width = Number(e.target.value)
  $('draw-width-val').textContent = e.target.value
})
window.addEventListener('resize', () => {
  if (!modal.classList.contains('hidden')) pad.resize()
})

async function saveDrawing() {
  const png = await pad.toPng()
  if (!png) return toast('Draw something first')
  const url = URL.createObjectURL(new Blob([png.bytes], { type: 'image/png' }))
  const img = {
    id: `img${state.nextId++}`,
    name: 'drawn signature',
    type: 'image/png',
    bytes: png.bytes,
    url,
    nw: png.nw,
    nh: png.nh,
  }
  state.images.push(img)
  renderLibrary()
  pad.clear()
  closeDrawModal()
  if (state.pages.length) placeImage(img)
  else toast('Signature saved - open a PDF to place it')
}

$('draw-save').addEventListener('click', saveDrawing)
setPenColor(PEN_COLORS[0])

/* ---------- page rendering ---------- */

async function buildPages() {
  pagesEl.innerHTML = ''
  for (const p of state.pages) {
    const wrap = document.createElement('div')
    wrap.className = 'relative bg-white shadow-2xl ring-1 ring-slate-700'
    wrap.dataset.page = String(p.index)
    wrap.style.width = `${p.vw * state.zoom}px`
    wrap.style.height = `${p.vh * state.zoom}px`
    const canvas = document.createElement('canvas')
    canvas.className = 'block'
    const overlay = document.createElement('div')
    overlay.className = 'absolute inset-0'
    overlay.dataset.overlay = String(p.index)
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) select(null)
    })
    wrap.append(canvas, overlay)
    pagesEl.appendChild(wrap)
    await renderPage(p, canvas, state.zoom)
  }
  renderPlacements()
}

function setZoom(z) {
  state.zoom = clamp(z, 0.25, 4)
  $('zoom-label').textContent = `${Math.round(state.zoom * 100)}%`
  if (state.pages.length) buildPages()
}
$('zoom-in').addEventListener('click', () => setZoom(state.zoom + 0.25))
$('zoom-out').addEventListener('click', () => setZoom(state.zoom - 0.25))

/* ---------- placements ---------- */

function currentPageIndex() {
  const viewer = $('viewer')
  const mid = viewer.scrollTop + viewer.clientHeight / 2
  let best = 0
  for (const el of pagesEl.children) {
    if (el.offsetTop <= mid) best = Number(el.dataset.page)
  }
  return best
}

function placeImage(img) {
  if (!state.pages.length) return toast('Open a PDF first')
  const pageIndex = currentPageIndex()
  const page = state.pages[pageIndex]
  const w = Math.min(180, page.vw * 0.35)
  const h = (w * img.nh) / img.nw
  const p = {
    id: `pl${state.nextId++}`,
    imageId: img.id,
    pageIndex,
    cx: page.vw / 2,
    cy: page.vh / 2,
    w,
    h,
    rotation: 0,
    opacity: 1,
    lockAspect: true,
    aspect: img.nw / img.nh,
  }
  state.placements.push(p)
  renderPlacements()
  select(p.id)
}

function imageOf(p) {
  return state.images.find((i) => i.id === p.imageId)
}

function renderPlacements() {
  for (const ov of pagesEl.querySelectorAll('[data-overlay]')) ov.innerHTML = ''
  for (const p of state.placements) {
    const ov = pagesEl.querySelector(`[data-overlay="${p.pageIndex}"]`)
    if (!ov) continue
    const box = document.createElement('div')
    box.className = 'sig-box'
    box.dataset.id = p.id
    const im = document.createElement('img')
    im.src = imageOf(p)?.url ?? ''
    box.appendChild(im)
    ov.appendChild(box)
    attachInteractions(box, p)
  }
  syncAll()
}

function syncAll() {
  for (const p of state.placements) {
    const box = pagesEl.querySelector(`.sig-box[data-id="${p.id}"]`)
    if (box) syncBox(box, p)
  }
  syncInspector()
}

function syncBox(box, p) {
  const z = state.zoom
  box.style.width = `${p.w * z}px`
  box.style.height = `${p.h * z}px`
  box.style.left = `${(p.cx - p.w / 2) * z}px`
  box.style.top = `${(p.cy - p.h / 2) * z}px`
  box.style.transform = `rotate(${p.rotation}deg)`
  box.style.opacity = String(p.opacity)
  box.style.cursor = 'move'
  const on = p.id === state.selectedId
  box.style.outline = on ? '1.5px solid #0ea5e9' : 'none'
  box.querySelectorAll('[data-deco]').forEach((h) => h.remove())
  if (on) addHandles(box)
}

const CORNERS = [
  ['nw', 0, 0, 'nwse-resize'],
  ['ne', 1, 0, 'nesw-resize'],
  ['se', 1, 1, 'nwse-resize'],
  ['sw', 0, 1, 'nesw-resize'],
]

function addHandles(box) {
  for (const [name, fx, fy, cursor] of CORNERS) {
    const h = document.createElement('div')
    h.className = 'sig-handle'
    h.dataset.deco = '1'
    h.dataset.handle = name
    h.style.left = `calc(${fx * 100}% - 6px)`
    h.style.top = `calc(${fy * 100}% - 6px)`
    h.style.cursor = cursor
    box.appendChild(h)
  }
  const stem = document.createElement('div')
  stem.dataset.deco = '1'
  stem.style.cssText =
    'position:absolute;left:calc(50% - 1px);top:-20px;width:2px;height:20px;background:#f59e0b;pointer-events:none;'
  box.appendChild(stem)

  const rot = document.createElement('div')
  rot.className = 'sig-handle'
  rot.dataset.deco = '1'
  rot.dataset.handle = 'rotate'
  rot.style.left = 'calc(50% - 6px)'
  rot.style.top = '-26px'
  rot.style.background = '#f59e0b'
  rot.style.cursor = 'grab'
  box.appendChild(rot)
}

/* ---------- interactions ---------- */

function overlayPoint(e, pageIndex) {
  const ov = pagesEl.querySelector(`[data-overlay="${pageIndex}"]`)
  const r = ov.getBoundingClientRect()
  return { x: (e.clientX - r.left) / state.zoom, y: (e.clientY - r.top) / state.zoom }
}

function attachInteractions(box, p) {
  box.addEventListener('pointerdown', (e) => {
    const handle = e.target.dataset?.handle
    e.preventDefault()
    e.stopPropagation()
    select(p.id)
    box.setPointerCapture(e.pointerId)

    const start = overlayPoint(e, p.pageIndex)
    const snap = { ...p }

    const onMove = (ev) => {
      const cur = overlayPoint(ev, p.pageIndex)
      const dx = cur.x - start.x
      const dy = cur.y - start.y

      if (!handle) {
        p.cx = snap.cx + dx
        p.cy = snap.cy + dy
      } else if (handle === 'rotate') {
        let ang = (Math.atan2(cur.y - p.cy, cur.x - p.cx) * 180) / Math.PI + 90
        if (ev.shiftKey) ang = Math.round(ang / 15) * 15
        if (ang > 180) ang -= 360
        if (ang < -180) ang += 360
        p.rotation = ang
      } else {
        resize(p, snap, handle, dx, dy, ev.shiftKey)
      }
      syncBox(box, p)
      syncInspector()
    }

    const onUp = (ev) => {
      box.releasePointerCapture(ev.pointerId)
      box.removeEventListener('pointermove', onMove)
      box.removeEventListener('pointerup', onUp)
      box.removeEventListener('pointercancel', onUp)
    }

    box.addEventListener('pointermove', onMove)
    box.addEventListener('pointerup', onUp)
    box.addEventListener('pointercancel', onUp)
  })
}

// Resize about the opposite corner, working in the signature's own rotated frame
// so the fixed corner stays put at any angle.
function resize(p, snap, handle, dx, dy, shift) {
  const signX = handle === 'ne' || handle === 'se' ? 1 : -1
  const signY = handle === 'se' || handle === 'sw' ? 1 : -1

  const off = rotateVec((-signX * snap.w) / 2, (-signY * snap.h) / 2, snap.rotation)
  const fixed = { x: snap.cx + off.x, y: snap.cy + off.y }

  const local = unrotateVec(dx, dy, snap.rotation)
  let w = Math.max(6, snap.w + signX * local.x)
  let h = Math.max(6, snap.h + signY * local.y)

  const keepAspect = p.lockAspect !== shift
  if (keepAspect && p.aspect) {
    if (Math.abs(w / snap.w - 1) > Math.abs(h / snap.h - 1)) h = w / p.aspect
    else w = h * p.aspect
  }

  p.w = w
  p.h = h
  const back = rotateVec((signX * w) / 2, (signY * h) / 2, snap.rotation)
  p.cx = fixed.x + back.x
  p.cy = fixed.y + back.y
}

/* ---------- selection + inspector ---------- */

function select(id) {
  state.selectedId = id
  syncAll()
}

function selected() {
  return state.placements.find((p) => p.id === state.selectedId) ?? null
}

function syncInspector() {
  const p = selected()
  inspector.classList.toggle('hidden', !p)
  if (!p) return
  const page = state.pages[p.pageIndex]
  setIf($('in-x'), round(p.cx - p.w / 2))
  setIf($('in-y'), round(page.vh - (p.cy + p.h / 2)))
  setIf($('in-w'), round(p.w))
  setIf($('in-h'), round(p.h))
  setIf($('in-r'), round(p.rotation, 1))
  setIf($('in-o'), Math.round(p.opacity * 100))
  $('rot-val').textContent = `${round(p.rotation, 1)}°`
  $('op-val').textContent = `${Math.round(p.opacity * 100)}%`
  $('in-lock').checked = !!p.lockAspect
}

function setIf(el, v) {
  if (document.activeElement !== el) el.value = String(v)
}

function round(v, d = 0) {
  const m = 10 ** d
  return Math.round(v * m) / m
}

function editSelected(fn) {
  const p = selected()
  if (!p) return
  fn(p, state.pages[p.pageIndex])
  const box = pagesEl.querySelector(`.sig-box[data-id="${p.id}"]`)
  if (box) syncBox(box, p)
  syncInspector()
}

$('in-x').addEventListener('input', (e) =>
  editSelected((p) => (p.cx = Number(e.target.value) + p.w / 2)),
)
$('in-y').addEventListener('input', (e) =>
  editSelected((p, pg) => (p.cy = pg.vh - Number(e.target.value) - p.h / 2)),
)
$('in-w').addEventListener('input', (e) =>
  editSelected((p) => {
    const w = Math.max(6, Number(e.target.value))
    if (p.lockAspect && p.aspect) p.h = w / p.aspect
    p.w = w
  }),
)
$('in-h').addEventListener('input', (e) =>
  editSelected((p) => {
    const h = Math.max(6, Number(e.target.value))
    if (p.lockAspect && p.aspect) p.w = h * p.aspect
    p.h = h
  }),
)
$('in-r').addEventListener('input', (e) => editSelected((p) => (p.rotation = Number(e.target.value))))
$('in-o').addEventListener('input', (e) =>
  editSelected((p) => (p.opacity = Number(e.target.value) / 100)),
)
$('in-lock').addEventListener('change', (e) => editSelected((p) => (p.lockAspect = e.target.checked)))
$('btn-reset-rot').addEventListener('click', () => editSelected((p) => (p.rotation = 0)))
$('btn-delete').addEventListener('click', deleteSelected)

function deleteSelected() {
  const p = selected()
  if (!p) return
  state.placements = state.placements.filter((x) => x !== p)
  state.selectedId = null
  renderPlacements()
}

document.addEventListener('keydown', (e) => {
  if (!modal.classList.contains('hidden')) {
    if (e.key === 'Escape') closeDrawModal()
    return
  }
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return
  if (!selected()) return
  const step = e.shiftKey ? 10 : 1
  const moves = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }
  if (moves[e.key]) {
    e.preventDefault()
    editSelected((p) => {
      p.cx += moves[e.key][0]
      p.cy += moves[e.key][1]
    })
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault()
    deleteSelected()
  } else if (e.key === 'Escape') {
    select(null)
  }
})

/* ---------- export ---------- */

$('export').addEventListener('click', async () => {
  if (!state.pdfBytes) return
  const btn = $('export')
  btn.disabled = true
  btn.textContent = 'Signing...'
  try {
    const out = await signPdf(state.pdfBytes, state.images, state.placements)
    const url = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }))
    const a = document.createElement('a')
    a.href = url
    a.download = state.pdfName.replace(/\.pdf$/i, '') + '-signed.pdf'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    toast('Signed PDF downloaded')
  } catch (err) {
    console.error(err)
    toast(`Export failed: ${err.message}`, 4000)
  } finally {
    btn.disabled = false
    btn.textContent = 'Download signed PDF'
  }
})

/* ---------- drag & drop ---------- */

const viewer = $('viewer')
viewer.addEventListener('dragover', (e) => e.preventDefault())
viewer.addEventListener('drop', (e) => {
  e.preventDefault()
  const file = [...e.dataTransfer.files].find((f) => f.type === 'application/pdf')
  if (file) loadPdfFile(file)
})

setZoom(1)

// Exposed for automated end-to-end checks.
window.__pdfSigner = {
  state,
  loadPdfFile,
  signPdf,
  placeImage,
  select,
  renderPlacements,
  syncAll,
  openDocument,
  renderPage,
  pad,
  openDrawModal,
  saveDrawing,
}
