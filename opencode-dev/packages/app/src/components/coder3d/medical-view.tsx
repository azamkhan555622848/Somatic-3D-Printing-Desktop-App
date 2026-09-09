// Medical View (spec §3.1): NiiVue tri-planar + volume rendering with
// radiology window/level presets, segmentation overlays with a legend from
// labels.json, and a clip plane. Input is always NIfTI: dcm2niix converted at
// import, so NiiVue never parses DICOM.
import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js"
import { Niivue, NVImage } from "@niivue/niivue"

type ReadFileError = "invalid-path" | "not-found" | "too-large"
type ReadFile = (
  dir: string,
  rel: string,
) => Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: ReadFileError }>

type LabelEntry = { file: string; volume_ml?: number }
type Overlay = { name: string; rel: string; colormap: string; volumeMl?: number }

// Radiology presets as center/width -> cal_min/cal_max
const PRESETS = [
  { id: "bone", label: "Bone", level: 400, width: 1800 },
  { id: "soft", label: "Soft tissue", level: 50, width: 400 },
  { id: "lung", label: "Lung", level: -600, width: 1500 },
] as const

const OVERLAY_COLORMAPS = ["red", "green", "blue", "yellow", "cyan", "violet"]

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

// cases/<case>/nifti/vol.nii.gz -> overlays under cases/<case>/segmentations/<stem>/
function overlayDirFor(volumePath: string): string | undefined {
  const m = volumePath.match(/^(.*)\/nifti\/([^/]+?)(\.nii(\.gz)?)$/i)
  return m ? `${m[1]}/segmentations/${m[2]}` : undefined
}

export function MedicalView(props: { dir: string; volumePath: string; readFile: ReadFile }) {
  let canvas: HTMLCanvasElement | undefined
  const [nv, setNv] = createSignal<Niivue>()
  const [overlays, setOverlays] = createSignal<Overlay[]>([])
  const [render3d, setRender3d] = createSignal(false)
  const [clip, setClip] = createSignal(1) // 1 = off (depth >= 1 disables)
  const [error, setError] = createSignal<string>()
  let loadToken = 0

  onMount(() => {
    const inst = new Niivue({ backColor: [0, 0, 0, 1], show3Dcrosshair: true })
    inst.attachToCanvas(canvas!)
    setNv(inst)
    void loadAll(props.volumePath)
  })
  onCleanup(() => {
    const inst = nv() as { cleanup?: () => void } | undefined
    inst?.cleanup?.()
  })

  const loadAll = async (volumePath: string) => {
    const inst = nv()
    if (!inst) return
    const token = ++loadToken
    setError(undefined)
    try {
      // Base volume
      const vol = await props.readFile(props.dir, volumePath)
      if (!vol.ok) throw new Error(`cannot read volume: ${vol.error}`)
      if (token !== loadToken) return
      while (inst.volumes.length) inst.removeVolume(inst.volumes[0])
      const base = await NVImage.loadFromBase64({
        base64: toBase64(vol.bytes),
        name: volumePath.split("/").pop()!,
      })
      inst.addVolume(base)
      // Overlays: masks beside labels.json, one colormap per structure
      const dir = overlayDirFor(volumePath)
      const found: Overlay[] = []
      if (dir) {
        const labelsFile = await props.readFile(props.dir, `${dir}/labels.json`)
        if (labelsFile.ok) {
          const labels = JSON.parse(new TextDecoder().decode(labelsFile.bytes)) as Record<string, LabelEntry>
          let i = 0
          for (const [name, entry] of Object.entries(labels)) {
            const rel = `${dir}/${entry.file}`
            const mask = await props.readFile(props.dir, rel)
            if (!mask.ok) continue
            if (token !== loadToken) return
            const colormap = OVERLAY_COLORMAPS[i++ % OVERLAY_COLORMAPS.length]
            const img = await NVImage.loadFromBase64({ base64: toBase64(mask.bytes), name: entry.file })
            img.colormap = colormap
            img.opacity = 0.5
            inst.addVolume(img)
            found.push({ name, rel, colormap, volumeMl: entry.volume_ml })
          }
        }
      }
      setOverlays(found)
      inst.setSliceType(render3d() ? inst.sliceTypeRender : inst.sliceTypeMultiplanar)
      inst.updateGLVolume()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  createEffect(on(() => props.volumePath, (p) => void loadAll(p), { defer: true }))

  const applyPreset = (level: number, width: number) => {
    const inst = nv()
    if (!inst || !inst.volumes.length) return
    inst.volumes[0].cal_min = level - width / 2
    inst.volumes[0].cal_max = level + width / 2
    inst.updateGLVolume()
  }

  const toggleRender = (on3d: boolean) => {
    setRender3d(on3d)
    const inst = nv()
    if (!inst) return
    inst.setSliceType(on3d ? inst.sliceTypeRender : inst.sliceTypeMultiplanar)
    if (!on3d) inst.setClipPlane([2, 0, 0]) // disable clip outside render mode
  }

  const applyClip = (v: number) => {
    setClip(v)
    const inst = nv()
    if (!inst) return
    // depth < 1 clips; >= 1 disables (NiiVue convention)
    inst.setClipPlane([v >= 1 ? 2 : v, 270, 0])
  }

  return (
    <div class="flex-1 min-h-0 flex flex-col">
      <div class="flex items-center gap-2 px-2 h-7 shrink-0 border-b border-border-weaker-base overflow-x-auto">
        <For each={PRESETS}>
          {(p) => (
            <button
              type="button"
              class="text-12-regular text-text-weak hover:text-text-base shrink-0"
              onClick={() => applyPreset(p.level, p.width)}
            >
              {p.label}
            </button>
          )}
        </For>
        <div class="flex-1" />
        <button
          type="button"
          class="text-12-regular shrink-0"
          classList={{ "text-text-base": !render3d(), "text-text-weak hover:text-text-base": render3d() }}
          onClick={() => toggleRender(false)}
        >
          Slices
        </button>
        <button
          type="button"
          class="text-12-regular shrink-0"
          classList={{ "text-text-base": render3d(), "text-text-weak hover:text-text-base": !render3d() }}
          onClick={() => toggleRender(true)}
        >
          3D
        </button>
        <Show when={render3d()}>
          <label class="flex items-center gap-1 text-12-regular text-text-weak shrink-0">
            clip
            <input
              type="range"
              min="-1"
              max="1"
              step="0.02"
              value={clip()}
              onInput={(e) => applyClip(Number(e.currentTarget.value))}
            />
          </label>
        </Show>
      </div>
      <div class="flex-1 min-h-0 relative">
        <canvas ref={canvas} class="absolute inset-0 w-full h-full" />
        <Show when={error()}>
          <div class="absolute inset-0 flex items-center justify-center px-8 bg-background-base/80">
            <div class="text-12-regular text-red-500 text-center max-w-72">{error()}</div>
          </div>
        </Show>
        <Show when={overlays().length > 0}>
          <div class="absolute bottom-2 left-2 rounded bg-background-base/80 px-2 py-1.5 flex flex-col gap-1">
            <For each={overlays()}>
              {(o) => (
                <div class="flex items-center gap-1.5 text-12-regular text-text-base">
                  <span class="size-2 rounded-full" style={{ background: o.colormap }} />
                  <span>{o.name}</span>
                  <Show when={o.volumeMl !== undefined}>
                    <span class="text-text-weak">{o.volumeMl} ml</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
