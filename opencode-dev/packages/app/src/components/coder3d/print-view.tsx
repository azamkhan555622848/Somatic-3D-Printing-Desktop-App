// 3D-Coder vendor code — keep out of packages/ui (upstream-merge safety).
// Print View: the X2D build plate with the sliced toolpath drawn layer by
// layer, a slider over the layers, and the stats + Print Gate verdict beside
// it. Geometry comes from the two sidecars print-mcp writes next to the job,
// never from the .gcode.3mf itself.
import { Show, createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount } from "solid-js"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import {
  SINGLE_COLOR,
  clampRange,
  failedChecks,
  gateRemediation,
  featureLegend,
  formatGrams,
  formatSettings,
  gateBadge,
  initialLayerIndex,
  isValidHex,
  plateFor,
  readStored,
  sidecarPaths,
  slotSwatch,
  writeStored,
  type ColorMode,
  type PrintLayers,
  type PrintStats,
} from "./print-model"

const COLORS_KEY = "coder3d.print.featureColors"
const HIDDEN_KEY = "coder3d.print.hiddenFeatures"
const MODE_KEY = "coder3d.print.colorMode"

type ReadFile = (
  dir: string,
  relPath: string,
) => Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }>

async function readJson<T>(readFile: ReadFile, dir: string, rel: string): Promise<T | undefined> {
  try {
    const result = await readFile(dir, rel)
    if (!result.ok) return undefined
    return JSON.parse(new TextDecoder().decode(result.bytes)) as T
  } catch {
    // A sidecar can be missing (an older job) or read mid-write; an empty
    // panel with a hint is the right answer, not a renderer crash.
    return undefined
  }
}

function PlateCanvas(props: {
  layers: PrintLayers | undefined
  bottom: number
  top: number
  plate: { x: number; y: number }
  colorFor: (featureIndex: number) => string | null
  highlightTop: boolean
}) {
  let host!: HTMLDivElement

  onMount(() => {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x121216)
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10_000)
    camera.up.set(0, 0, 1) // Z-up, like the rest of the app and like the printer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    host.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)

    const plate = new THREE.Group()
    const paths = new THREE.Group()
    scene.add(plate, paths)

    function disposeGroup(group: THREE.Group) {
      group.traverse((object) => {
        const drawable = object as THREE.Mesh
        drawable.geometry?.dispose?.()
        const material = drawable.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material?.dispose?.()
      })
      group.clear()
    }

    createEffect(() => {
      const { x, y } = props.plate
      disposeGroup(plate)
      const grid = new THREE.GridHelper(Math.max(x, y), 16, 0x4a4a52, 0x2c2c33)
      grid.rotation.x = Math.PI / 2
      grid.position.set(x / 2, y / 2, 0)
      plate.add(grid)
      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(x, 0, 0),
          new THREE.Vector3(x, y, 0),
          new THREE.Vector3(0, y, 0),
        ]),
        new THREE.LineBasicMaterial({ color: 0x6b7280 }),
      )
      plate.add(outline)
    })

    // One LineSegments for everything drawn: a mesh per path would put
    // thousands of draw calls on the plate and stutter the slider.
    createEffect(() => {
      const data = props.layers
      const [lo, hi] = clampRange(props.bottom, props.top, data?.layers?.length ?? 0)
      const colorFor = props.colorFor
      const highlightTop = props.highlightTop
      disposeGroup(paths)
      if (!data?.layers?.length) return
      const points: number[] = []
      const colors: number[] = []
      const tint = new THREE.Color()
      const current = new THREE.Color(0xffc94d)
      for (let index = lo; index <= hi; index++) {
        const layer = data.layers[index]
        for (const path of layer.paths) {
          // A hidden feature returns null: not drawn at all, so an operator can
          // strip the walls away and look at the infill underneath.
          const hex = colorFor(path.f)
          if (!hex) continue
          const color = highlightTop && index === hi ? current : tint.set(hex)
          for (let p = 1; p < path.p.length; p++) {
            const [ax, ay] = path.p[p - 1]
            const [bx, by] = path.p[p]
            points.push(ax, ay, layer.z, bx, by, layer.z)
            colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
          }
        }
      }
      if (!points.length) return
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3))
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
      paths.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true })))
    })

    // Frame the PART, not the plate. A 22 mm prosthesis centred on a 256 mm
    // bed is four pixels wide if the camera fits the whole plate, and the
    // operator has to zoom before they can see anything at all.
    let framed = false
    createEffect(() => {
      const data = props.layers
      const { x, y } = props.plate
      if (framed) return
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let maxZ = 0
      for (const layer of data?.layers ?? []) {
        maxZ = Math.max(maxZ, layer.z)
        for (const path of layer.paths) {
          for (const [px, py] of path.p) {
            if (px < minX) minX = px
            if (px > maxX) maxX = px
            if (py < minY) minY = py
            if (py > maxY) maxY = py
          }
        }
      }
      const hasPart = Number.isFinite(minX) && maxX > minX
      if (!hasPart && !data) return // still loading; the plate alone is not a frame
      framed = true
      const centerX = hasPart ? (minX + maxX) / 2 : x / 2
      const centerY = hasPart ? (minY + maxY) / 2 : y / 2
      const span = hasPart ? Math.max(maxX - minX, maxY - minY, maxZ, 20) : Math.max(x, y)
      controls.target.set(centerX, centerY, maxZ / 2)
      const distance = span * 1.9
      camera.position.set(centerX + distance * 0.75, centerY - distance * 0.85, maxZ / 2 + distance * 0.55)
      controls.update()
    })

    const resize = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    resize()

    let raf = 0
    const loop = () => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(loop)
    }
    loop()

    onCleanup(() => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      disposeGroup(plate)
      disposeGroup(paths)
      // dispose() alone leaves the GL context alive on Chromium; without the
      // forced loss a handful of reloads exhausts the context pool (same
      // lesson as the mesh viewer).
      renderer.forceContextLoss()
      renderer.dispose()
      renderer.domElement.remove()
    })
  })

  return <div ref={host} class="absolute inset-0" />
}

export function PrintView(props: { dir: string; job: string; readFile: ReadFile }) {
  const paths = createMemo(() => sidecarPaths(props.job))
  const [stats] = createResource(
    () => ({ dir: props.dir, rel: paths().stats }),
    (k) => readJson<PrintStats>(props.readFile, k.dir, k.rel),
  )
  const [layers] = createResource(
    () => ({ dir: props.dir, rel: paths().layers }),
    (k) => readJson<PrintLayers>(props.readFile, k.dir, k.rel),
  )

  const [layerIndex, setLayerIndex] = createSignal(0)
  const [bottomIndex, setBottomIndex] = createSignal(0)
  // A new job opens on its full height; the sliders then belong to the operator.
  createEffect(() => {
    setLayerIndex(initialLayerIndex(layers()))
    setBottomIndex(0)
  })

  // Appearance is the operator's, and it persists: colours picked for one
  // review should still be there for the next job.
  const [colorMode, setColorMode] = createSignal<ColorMode>(readStored<ColorMode>(MODE_KEY, "feature"))
  const [colorOverrides, setColorOverrides] = createSignal<Record<string, string>>(readStored(COLORS_KEY, {}))
  const [hidden, setHidden] = createSignal<string[]>(readStored<string[]>(HIDDEN_KEY, []))

  const legend = createMemo(() => featureLegend(layers(), colorOverrides()))
  const colorFor = (featureIndex: number): string | null => {
    const entry = legend()[featureIndex]
    if (!entry) return SINGLE_COLOR
    if (hidden().includes(entry.name)) return null
    return colorMode() === "single" ? SINGLE_COLOR : entry.color
  }

  const setFeatureColor = (name: string, value: string) => {
    if (!isValidHex(value)) return
    const next = { ...colorOverrides(), [name]: value }
    setColorOverrides(next)
    writeStored(COLORS_KEY, next)
  }
  const toggleFeature = (name: string) => {
    const next = hidden().includes(name) ? hidden().filter((n) => n !== name) : [...hidden(), name]
    setHidden(next)
    writeStored(HIDDEN_KEY, next)
  }
  const pickMode = (mode: ColorMode) => {
    setColorMode(mode)
    writeStored(MODE_KEY, mode)
  }
  const resetAppearance = () => {
    setColorOverrides({})
    setHidden([])
    writeStored(COLORS_KEY, {})
    writeStored(HIDDEN_KEY, [])
  }

  const badge = createMemo(() => gateBadge(stats()))
  const failures = createMemo(() => failedChecks(stats()))
  const layerCount = createMemo(() => layers()?.layers?.length ?? 0)
  const currentZ = createMemo(() => layers()?.layers?.[layerIndex()]?.z)
  const bottomZ = createMemo(() => layers()?.layers?.[bottomIndex()]?.z)

  return (
    <div class="flex-1 min-h-0 flex">
      <div class="flex-1 min-w-0 min-h-0 relative flex flex-col">
        <div class="flex-1 min-h-0 relative">
          <PlateCanvas
            layers={layers()}
            bottom={bottomIndex()}
            top={layerIndex()}
            plate={plateFor(stats())}
            colorFor={colorFor}
            highlightTop={colorMode() === "single"}
          />
          <Show when={!layers.loading && !layerCount()}>
            <div class="absolute inset-0 flex items-center justify-center px-8 pointer-events-none">
              <div class="text-12-regular text-text-weak text-center max-w-72">
                No layer preview for this job. Slice it through the print tools — they write the preview beside the
                sliced file.
              </div>
            </div>
          </Show>
        </div>
        <Show when={layerCount() > 0}>
          <div class="shrink-0 border-t border-border-weaker-base px-3 py-2 flex flex-col gap-1.5">
            <div class="flex items-center gap-3">
              <span class="text-12-regular text-text-weak font-mono shrink-0 w-40">
                top {layerIndex() + 1}/{layerCount()}
                <Show when={currentZ() !== undefined}>{` · z ${currentZ()!.toFixed(2)}`}</Show>
              </span>
              <input
                type="range"
                class="flex-1 min-w-0"
                min={0}
                max={Math.max(0, layerCount() - 1)}
                value={layerIndex()}
                onInput={(e) => {
                  const [lo, hi] = clampRange(bottomIndex(), Number(e.currentTarget.value), layerCount())
                  setBottomIndex(lo)
                  setLayerIndex(hi)
                }}
              />
              <Show when={layers()?.truncated}>
                <span
                  class="text-12-regular text-text-weak shrink-0"
                  title="The preview samples across the full height; the printed job has more layers than are drawn."
                >
                  sampled
                </span>
              </Show>
            </div>
            {/* A second handle cuts the bottom away, which is the only way to
                look inside a part that is otherwise a solid opaque mass. */}
            <div class="flex items-center gap-3">
              <span class="text-12-regular text-text-weak font-mono shrink-0 w-40">
                bottom {bottomIndex() + 1}
                <Show when={bottomZ() !== undefined}>{` · z ${bottomZ()!.toFixed(2)}`}</Show>
              </span>
              <input
                type="range"
                class="flex-1 min-w-0"
                min={0}
                max={Math.max(0, layerCount() - 1)}
                value={bottomIndex()}
                onInput={(e) => {
                  const [lo, hi] = clampRange(Number(e.currentTarget.value), layerIndex(), layerCount())
                  setBottomIndex(lo)
                  setLayerIndex(hi)
                }}
              />
              <button
                type="button"
                class="text-12-regular text-text-weak hover:text-text-base shrink-0"
                title="Show only the top layer"
                onClick={() => setBottomIndex(layerIndex())}
              >
                one layer
              </button>
              <button
                type="button"
                class="text-12-regular text-text-weak hover:text-text-base shrink-0"
                title="Show the whole job"
                onClick={() => {
                  setBottomIndex(0)
                  setLayerIndex(layerCount() - 1)
                }}
              >
                all
              </button>
            </div>
          </div>
        </Show>
      </div>

      <div class="w-72 shrink-0 border-l border-border-weaker-base overflow-y-auto p-3 flex flex-col gap-3">
        <div
          class="rounded-md px-2 py-1.5 text-12-regular"
          classList={{
            "bg-green-950 text-green-300": badge().tone === "pass",
            "bg-red-950 text-red-300": badge().tone === "fail",
            "bg-background-stronger-base text-text-weak": badge().tone === "unknown",
          }}
        >
          <div class="font-medium">{badge().label}</div>
          <div class="opacity-80">{badge().detail}</div>
        </div>

        <Show when={failures().length}>
          <ul class="flex flex-col gap-1.5">
            <For each={failures()}>
              {(check) => (
                <li class="text-12-regular">
                  <span class="font-mono text-red-300">{check.name}</span>
                  <div class="text-text-weak">{check.detail}</div>
                  {/* The detail says what is wrong; this says what to do about
                      it. Absent for a check we have no guidance for — a wrong
                      guess costs an operator more than silence. */}
                  <Show when={gateRemediation(check.name)}>
                    {(fix) => (
                      <div class="mt-1 rounded border-l-2 border-border-weaker-base pl-2 text-text-weak">
                        <span class="text-text-base">Fix: </span>
                        {fix()}
                      </div>
                    )}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <dl class="text-12-regular flex flex-col gap-1">
          <Row label="Print time" value={stats()?.print_time_human ?? "—"} />
          <Row label="Material" value={formatGrams(stats()?.weight_g)} />
          <Row label="Printer" value={stats()?.printer_settings_id || stats()?.printer_model_id || "—"} />
          <Row label="Support" value={stats()?.support_strategy ?? (stats()?.support_used ? "used" : "—")} />
          <Row label="Filament" value={stats()?.material ?? "—"} />
          <Row label="Intended use" value={stats()?.intended_use ?? "—"} />
          <Show when={layers()?.layer_height_mm}>
            <Row label="Layer height" value={`${layers()!.layer_height_mm.toFixed(2)} mm`} />
          </Show>
          {/* Only when something was changed away from the template: it is the
              reason the weight differs from what the profile alone would give. */}
          <Show when={formatSettings(stats()?.settings)}>
            <Row label="Adjusted" value={formatSettings(stats()?.settings)} />
          </Show>
        </dl>

        <Show when={legend().length}>
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center gap-2">
              <span class="text-12-regular text-text-weak">Colour by</span>
              <div class="flex rounded-md overflow-hidden border border-border-weaker-base">
                <For each={["feature", "single"] as ColorMode[]}>
                  {(mode) => (
                    <button
                      type="button"
                      class="text-12-regular px-2 py-0.5"
                      classList={{
                        "bg-background-stronger-base text-text-base": colorMode() === mode,
                        "text-text-weak hover:text-text-base": colorMode() !== mode,
                      }}
                      onClick={() => pickMode(mode)}
                    >
                      {mode === "feature" ? "Feature" : "Solid"}
                    </button>
                  )}
                </For>
              </div>
              <button
                type="button"
                class="ml-auto text-12-regular text-text-weak hover:text-text-base"
                title="Restore the default colours and show every feature"
                onClick={resetAppearance}
              >
                Reset
              </button>
            </div>
            <For each={legend()}>
              {(feature) => (
                <div class="flex items-center gap-2 text-12-regular">
                  {/* The swatch IS the picker: click it to recolour this feature. */}
                  <input
                    type="color"
                    class="size-4 shrink-0 bg-transparent border-0 p-0 cursor-pointer"
                    value={feature.color}
                    title={`Colour for ${feature.name}`}
                    onInput={(e) => setFeatureColor(feature.name, e.currentTarget.value)}
                  />
                  <button
                    type="button"
                    class="text-left flex-1 min-w-0 truncate"
                    classList={{
                      "text-text-weak line-through": hidden().includes(feature.name),
                      "hover:text-text-base": true,
                    }}
                    title={hidden().includes(feature.name) ? "Show this feature" : "Hide this feature"}
                    onClick={() => toggleFeature(feature.name)}
                  >
                    {feature.name}
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={stats()?.slots?.length}>
          <div class="flex flex-col gap-1.5">
            <div class="text-12-regular text-text-weak">AMS slots</div>
            <For each={stats()!.slots!}>
              {(slot) => (
                <div class="flex items-center gap-2 text-12-regular">
                  <span
                    class="size-3 rounded-sm border border-border-weaker-base shrink-0"
                    style={{ "background-color": slotSwatch(slot) }}
                  />
                  <span class="font-mono">{slot.slot}</span>
                  <span class="text-text-weak">{slot.type}</span>
                  <span class="ml-auto font-mono">{formatGrams(slot.used_g)}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}

function Row(props: { label: string; value: string }) {
  return (
    <div class="flex items-baseline gap-2">
      <dt class="text-text-weak shrink-0">{props.label}</dt>
      <dd class="ml-auto text-right font-mono break-all">{props.value}</dd>
    </div>
  )
}
