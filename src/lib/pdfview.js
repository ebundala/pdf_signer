import * as pdfjsLib from 'pdfjs-dist/build/pdf'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export async function openDocument(bytes) {
  // pdf.js transfers/detaches the buffer it is given, so hand it a copy and
  // keep the pristine original for pdf-lib at export time.
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    pages.push({ index: i - 1, page, vw: vp.width, vh: vp.height })
  }
  return { doc, pages }
}

export async function renderPage(pageInfo, canvas, zoom) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const vp = pageInfo.page.getViewport({ scale: zoom * dpr })
  canvas.width = Math.floor(vp.width)
  canvas.height = Math.floor(vp.height)
  canvas.style.width = `${pageInfo.vw * zoom}px`
  canvas.style.height = `${pageInfo.vh * zoom}px`
  const task = pageInfo.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp })
  await task.promise
}
