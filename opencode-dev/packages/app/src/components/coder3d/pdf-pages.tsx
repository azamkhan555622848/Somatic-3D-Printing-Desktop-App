// 3D-Coder vendor code (verbatim port of Paperino's pdf-pages.tsx).
import { createEffect, onCleanup } from "solid-js"
import * as pdfjs from "pdfjs-dist"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export function PdfPages(props: { data: Uint8Array | undefined; onPageCount?: (n: number) => void }) {
  let pages!: HTMLDivElement
  let renderToken = 0

  const render = async (data: Uint8Array) => {
    const token = ++renderToken
    // pdf.js transfers the buffer to its worker — hand it a copy
    const doc = await pdfjs.getDocument({ data: data.slice() }).promise
    if (token !== renderToken) return
    const scroll = pages.scrollTop
    // clientWidth already excludes the vertical scrollbar; subtract the p-3 padding
    const available = Math.max(200, pages.clientWidth - 24)
    const canvases: HTMLCanvasElement[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const unscaled = page.getViewport({ scale: 1 })
      const scale = (available / unscaled.width) * window.devicePixelRatio
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement("canvas")
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width / window.devicePixelRatio}px`
      canvas.style.height = `${viewport.height / window.devicePixelRatio}px`
      canvas.className = "block mx-auto mb-2 shadow"
      await page.render({ canvas, viewport }).promise
      canvases.push(canvas)
    }
    if (token !== renderToken) return
    pages.replaceChildren(...canvases)
    pages.scrollTop = scroll
    props.onPageCount?.(doc.numPages)
  }

  createEffect(() => {
    const data = props.data
    if (!data) {
      renderToken++
      pages.replaceChildren()
      props.onPageCount?.(0)
      return
    }
    void render(data)
  })

  onCleanup(() => {
    renderToken++
  })

  return <div ref={pages} class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3" />
}
