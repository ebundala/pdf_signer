import { PDFDocument, rgb, degrees } from 'pdf-lib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let TABLE = null
const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
mkdirSync(out, { recursive: true })

// Multi-page PDF: page 0 portrait, page 1 rotated 90, page 2 landscape rotated 270.
const doc = await PDFDocument.create()
const specs = [
  { size: [612, 792], rot: 0, label: 'Page 1 - portrait, rotate 0' },
  { size: [612, 792], rot: 90, label: 'Page 2 - portrait, rotate 90' },
  { size: [842, 595], rot: 270, label: 'Page 3 - landscape, rotate 270' },
]
for (const s of specs) {
  const page = doc.addPage(s.size)
  page.setRotation(degrees(s.rot))
  page.drawRectangle({ x: 20, y: 20, width: s.size[0] - 40, height: s.size[1] - 40, borderWidth: 2, borderColor: rgb(0.7, 0.7, 0.7) })
  page.drawText(s.label, { x: 40, y: s.size[1] - 60, size: 16 })
  page.drawText('Sign here: ______________', { x: 40, y: 80, size: 12 })
}
writeFileSync(join(out, 'sample.pdf'), await doc.save())

// A 200x80 PNG with an obvious asymmetric mark, hand-rolled (no canvas in node).
const png = makePng(200, 80, (x, y) => {
  const border = x < 3 || y < 3 || x > 196 || y > 76
  const diag = Math.abs(y - x * 0.4) < 6
  const corner = x < 40 && y < 20
  if (corner) return [255, 0, 0, 255]
  if (border) return [0, 0, 255, 255]
  if (diag) return [0, 0, 0, 255]
  return [0, 0, 0, 0]
})
writeFileSync(join(out, 'signature.png'), png)
console.log('fixtures written to', out)

function makePng(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  let o = 0
  for (let y = 0; y < h; y++) {
    raw[o++] = 0
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = px(x, y)
      raw[o++] = r
      raw[o++] = g
      raw[o++] = b
      raw[o++] = a
    }
  }
  const idat = deflateSync(raw)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      TABLE[n] = c
    }
  }
  let c = -1
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return c ^ -1
}
