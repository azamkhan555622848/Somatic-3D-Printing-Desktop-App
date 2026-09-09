// 3D-Coder vendor code (ported from Paperino's file-preview.tsx, + mesh branch).
import { Match, Show, Switch, createEffect, createResource, createSignal, onCleanup } from "solid-js"
import { MeshViewer } from "./mesh-viewer"
import { PdfPages } from "./pdf-pages"
import { TEXT_DISPLAY_CAP, classifyPreviewKind, extensionOf, imageMime } from "./preview-kind"

export type FilePreviewState = {
  path: string
  bytes?: Uint8Array
  error?: "invalid-path" | "not-found" | "too-large" | "read-failed"
}

function Notice(props: { children: string }) {
  return (
    <div class="flex-1 min-h-0 flex items-center justify-center px-8">
      <div class="text-12-regular text-text-weak text-center max-w-64">{props.children}</div>
    </div>
  )
}

const ERROR_TEXT: Record<NonNullable<FilePreviewState["error"]>, string> = {
  "invalid-path": "This path is outside the project folder.",
  "not-found": "This file no longer exists.",
  "too-large": "This file is larger than 50 MB and cannot be previewed.",
  "read-failed": "The file could not be read.",
}

const VIEWER_EXT = new Set(["stl", "glb"])

export function FilePreview(props: { state: FilePreviewState; onMeshLoadError?: (path: string) => void }) {
  const kind = () => {
    const bytes = props.state.bytes
    if (!bytes) return undefined
    return classifyPreviewKind(props.state.path, bytes)
  }
  const ext = () => extensionOf(props.state.path)

  // Image object URL: created per (path, bytes), revoked on switch/unmount.
  const [imgUrl, setImgUrl] = createSignal<string>()
  createEffect(() => {
    const bytes = props.state.bytes
    if (kind() !== "image" || !bytes) {
      setImgUrl(undefined)
      return
    }
    // IPC hands back a Buffer view over a shared pool — copy before wrapping
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: imageMime(extensionOf(props.state.path)) }))
    setImgUrl(url)
    onCleanup(() => URL.revokeObjectURL(url))
  })

  const [docxHtml] = createResource(
    () => (kind() === "docx" ? { path: props.state.path, bytes: props.state.bytes! } : undefined),
    async (input) => {
      // mammoth is CommonJS (`export =`); under the bundler's interop the callable
      // may sit on the namespace or on `.default`, so reach for both.
      const mod: any = await import("mammoth")
      const convertToHtml = mod.convertToHtml ?? mod.default?.convertToHtml
      const copy = input.bytes.slice()
      const result = await convertToHtml({ arrayBuffer: copy.buffer })
      return result.value as string
    },
  )

  const text = () => {
    const bytes = props.state.bytes
    if (!bytes) return ""
    return new TextDecoder().decode(bytes)
  }

  return (
    <Switch fallback={<Notice>Reading file…</Notice>}>
      <Match when={props.state.error}>{(error) => <Notice>{ERROR_TEXT[error()]}</Notice>}</Match>
      <Match when={kind() === "pdf"}>
        <PdfPages data={props.state.bytes} />
      </Match>
      <Match when={kind() === "image"}>
        <div class="flex-1 min-h-0 overflow-auto p-3">
          <Show when={imgUrl()}>
            {(url) => <img src={url()} alt={props.state.path} class="max-w-full mx-auto shadow" />}
          </Show>
        </div>
      </Match>
      <Match when={kind() === "docx"}>
        <div class="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          <Switch>
            <Match when={docxHtml.error}>
              <Notice>Could not convert this Word document.</Notice>
            </Match>
            <Match when={docxHtml()}>
              {(html) => (
                <div
                  class="text-14-regular leading-relaxed [&_h1]:text-20-medium [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-16-medium [&_h2]:mt-3 [&_h2]:mb-1 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_table]:border-collapse [&_td]:border [&_td]:border-border-weak-base [&_td]:px-2 [&_td]:py-1 [&_img]:max-w-full"
                  innerHTML={html()}
                />
              )}
            </Match>
            <Match when={docxHtml.loading}>
              <Notice>Converting Word document…</Notice>
            </Match>
          </Switch>
        </div>
      </Match>
      <Match when={kind() === "doc-legacy"}>
        <Notice>Legacy .doc files cannot be previewed — save the document as .docx and try again.</Notice>
      </Match>
      <Match when={kind() === "mesh" && VIEWER_EXT.has(ext())}>
        <MeshViewer
          bytes={props.state.bytes!}
          ext={ext()}
          path={props.state.path}
          onLoadError={() => props.onMeshLoadError?.(props.state.path)}
        />
      </Match>
      <Match when={kind() === "mesh"}>
        <Notice>This format has no in-panel viewer yet — ask the agent to export STL or GLB.</Notice>
      </Match>
      <Match when={kind() === "dicom"}>
        <Notice>
          DICOM slice — the Medical View reads NIfTI, so a series has to be converted before it can be viewed. Ask the
          agent in chat to import this folder, and the volume opens here automatically.
        </Notice>
      </Match>
      <Match when={kind() === "text" && (props.state.bytes?.length ?? 0) > TEXT_DISPLAY_CAP}>
        <Notice>This file is too large to display as text (over 2 MB).</Notice>
      </Match>
      <Match when={kind() === "text"}>
        <pre class="flex-1 min-h-0 overflow-auto px-4 py-3 text-12-regular font-mono whitespace-pre-wrap break-words">
          {text()}
        </pre>
      </Match>
      <Match when={kind() === "binary"}>
        <Notice>This file type cannot be previewed.</Notice>
      </Match>
    </Switch>
  )
}
