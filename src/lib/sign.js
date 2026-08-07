import { PDFDocument, degrees } from 'pdf-lib'
import { norm, DEG } from './geometry.js'

// Linear part of the view->user mapping, applied to a direction vector.
// View space is y-down; user space is y-up, so every case is a reflection.
function mapDir(dx, dy, rotation) {
  switch (norm(rotation)) {
    case 90:
      return { x: dy, y: dx }
    case 180:
      return { x: -dx, y: dy }
    case 270:
      return { x: -dy, y: -dx }
    default:
      return { x: dx, y: -dy }
  }
}

// Map a point from view space (origin top-left of the visible page box, y down,
// units = points) to user space (PDF coordinates, y up), given the page's
// crop box and /Rotate.
function mapPoint(vx, vy, box, rotation) {
  const { width: w, height: h } = box
  let x
  let y
  switch (norm(rotation)) {
    case 90:
      x = vy
      y = vx
      break
    case 180:
      x = w - vx
      y = vy
      break
    case 270:
      x = w - vy
      y = h - vx
      break
    default:
      x = vx
      y = h - vy
  }
  return { x: x + box.x, y: y + box.y }
}

async function embed(pdfDoc, image) {
  const bytes = image.bytes
  if (image.type === 'image/png') return pdfDoc.embedPng(bytes)
  if (image.type === 'image/jpeg') return pdfDoc.embedJpg(bytes)
  throw new Error(`Unsupported image type: ${image.type}`)
}

/**
 * Burn signature placements into a PDF.
 *
 * @param {Uint8Array} pdfBytes original document
 * @param {Array} images  [{ id, bytes: Uint8Array, type }]
 * @param {Array} placements [{ imageId, pageIndex, cx, cy, w, h, rotation, opacity }]
 *        cx/cy/w/h are in PDF points in *view space*: origin at the top-left of
 *        the page as displayed, y increasing downward, page /Rotate applied.
 *        cx/cy is the centre of the signature; rotation is degrees clockwise.
 * @returns {Promise<Uint8Array>}
 */
export async function signPdf(pdfBytes, images, placements) {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
  const pages = pdfDoc.getPages()

  const embedded = new Map()
  for (const img of images) {
    if (placements.some((p) => p.imageId === img.id)) {
      embedded.set(img.id, await embed(pdfDoc, img))
    }
  }

  for (const p of placements) {
    const page = pages[p.pageIndex]
    const png = embedded.get(p.imageId)
    if (!page || !png) continue

    const box = page.getCropBox()
    const rotation = page.getRotation().angle

    const a = p.rotation * DEG
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    // Image axes in view space: u runs left->right, v runs top->bottom.
    const ux = cos
    const uy = sin
    const vx = -sin
    const vy = cos
    const hw = p.w / 2
    const hh = p.h / 2

    // The image's own bottom-left corner, in view space.
    const cornerV = {
      x: p.cx - hw * ux + hh * vx,
      y: p.cy - hw * uy + hh * vy,
    }
    const anchor = mapPoint(cornerV.x, cornerV.y, box, rotation)
    const dir = mapDir(ux, uy, rotation)
    const angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI

    page.drawImage(png, {
      x: anchor.x,
      y: anchor.y,
      width: p.w,
      height: p.h,
      rotate: degrees(angle),
      opacity: p.opacity ?? 1,
    })
  }

  return pdfDoc.save()
}
