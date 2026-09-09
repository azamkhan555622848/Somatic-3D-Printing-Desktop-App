// 3D-Coder vendor code — keep out of packages/ui (upstream-merge safety).
// Imperative three.js inside a Solid component: STL/GLB display with CAD
// conventions (Z-up, mm), bbox dims overlay, and a two-double-click measure tool.
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { cameraCacheKey } from "./camera-cache"
import { isValidHex, readStored, writeStored } from "./print-model"

// Camera survives artifact reloads and tab-aways, keyed by path AND size - see
// cameraCacheKey for why the size has to be in there.
const cameraCache = new Map<string, { pos: THREE.Vector3; target: THREE.Vector3 }>()

const APPEARANCE_KEY = "coder3d.mesh.appearance"

// A model is a solid opaque object by default, which hides exactly the
// internal features an anatomical or prosthetic part is checked for — a
// cavity, a socket wall, a channel. These give the operator a way in.
type Appearance = { color: string; opacity: number; edges: boolean; background: BackgroundId }
const DEFAULT_APPEARANCE: Appearance = { color: "#9FB4C7", opacity: 1, edges: false, background: "slate" }

// Backdrop choices. A part reads differently against each: pale geometry
// disappears on a light ground, dark geometry disappears on black, and the
// grid needs to follow or it either glares or vanishes.
export type BackgroundId = "slate" | "light" | "dark"
export const BACKGROUNDS: { id: BackgroundId; label: string; scene: number; grid: [number, number] }[] = [
  { id: "slate", label: "Slate", scene: 0x1a1a1e, grid: [0x555555, 0x333333] },
  { id: "light", label: "Light", scene: 0xd8d8dc, grid: [0x8a8a92, 0xb4b4bc] },
  { id: "dark", label: "Dark", scene: 0x000000, grid: [0x3a3a40, 0x222226] },
]
export function backgroundFor(id: string | undefined) {
  return BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0]
}

const PRESET_COLORS = ["#9FB4C7", "#E8E2D5", "#D96A6A", "#E0A458", "#79B473", "#6C8EBF", "#B07FCE", "#4A4A52"]

export function MeshViewer(props: {
  bytes: Uint8Array
  ext: string
  path: string
  onLoadError?: (reason: string) => void
}) {
  let host!: HTMLDivElement
  let dims!: HTMLDivElement
  let measureEl!: HTMLDivElement
  // Assigned inside onMount; the toolbar button calls it at click time.
  let resetView: (() => void) | undefined

  const stored = readStored<Appearance>(APPEARANCE_KEY, DEFAULT_APPEARANCE)
  const [appearance, setAppearanceRaw] = createSignal<Appearance>({ ...DEFAULT_APPEARANCE, ...stored })
  const [panelOpen, setPanelOpen] = createSignal(false)
  const setAppearance = (patch: Partial<Appearance>) => {
    const next = { ...appearance(), ...patch }
    setAppearanceRaw(next)
    writeStored(APPEARANCE_KEY, next)
  }

  onMount(() => {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(backgroundFor(appearance().background).scene)
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10_000)
    // Z-up like CAD, and set BEFORE OrbitControls exists: the controls capture
    // the orbit axis from camera.up once in their constructor and never
    // recompute it. Setting it afterwards left them orbiting around Y while
    // the camera was Z-up, which is why dragging felt inverted.
    camera.up.set(0, 0, 1)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    host.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.2))
    const key = new THREE.DirectionalLight(0xffffff, 1.5)
    key.position.set(1, -1, 2)
    scene.add(key)

    const group = new THREE.Group()
    scene.add(group)
    const measurePts: THREE.Vector3[] = []
    let lastBox: THREE.Box3 | undefined
    let cacheKey = props.path

    function fit(box: THREE.Box3, ignoreCache = false) {
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const gridColors = backgroundFor(appearance().background).grid
      const grid = new THREE.GridHelper(Math.max(size.x, size.y, 1) * 2.5, 20, gridColors[0], gridColors[1])
      grid.rotation.x = Math.PI / 2 // Z-up like CAD
      grid.position.set(center.x, center.y, box.min.z)
      group.add(grid)
      dims.textContent = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`
      lastBox = box.clone()
      cacheKey = cameraCacheKey(props.path, size)
      const cached = ignoreCache ? undefined : cameraCache.get(cacheKey)
      if (cached) {
        camera.position.copy(cached.pos)
        controls.target.copy(cached.target)
      } else {
        const d = Math.max(size.length(), 1) * 1.4
        camera.position.set(center.x + d, center.y - d, center.z + d * 0.7)
        controls.target.copy(center)
      }
      controls.update()
    }

    // Escape hatch. Before this there was no way back from a bad camera short
    // of restarting the app: fit() ran only on load and always deferred to the
    // cache, so a pose that put the part off screen simply persisted.
    resetView = () => {
      if (!lastBox) return
      cameraCache.delete(cacheKey)
      fit(lastBox, true)
    }

    // An agent rebuilding a case rewrites meshes while the panel is watching,
    // so a read can land mid-write. A truncated buffer makes the loaders throw
    // (RangeError out of GLTFLoader), which used to take the whole renderer
    // down — parse defensively and let the panel re-read instead.
    function looksComplete(bytes: Uint8Array, ext: string): boolean {
      if (ext === "glb") {
        if (bytes.length < 12) return false
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        if (view.getUint32(0, true) !== 0x46546c67) return false // "glTF"
        return view.getUint32(8, true) === bytes.length // declared total length
      }
      if (ext === "stl") {
        if (bytes.length < 84) return false
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const triangles = view.getUint32(80, true)
        // ASCII STL has no count field; only validate the binary layout.
        const binaryLength = 84 + triangles * 50
        return binaryLength !== bytes.length ? bytes.length > 84 : true
      }
      return true
    }

    // group.clear() only detaches; GPU buffers stay allocated until disposed.
    function disposeGroup() {
      group.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose?.()
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material?.dispose?.()
      })
      group.clear()
    }

    // Re-skinning the loaded mesh must not re-parse it: a colour change on a
    // 14k-triangle organ should be instant, and reloading would also throw the
    // camera back to its default framing.
    function applyAppearance() {
      const { color, opacity, edges } = appearance()
      const transparent = opacity < 1
      group.traverse((object) => {
        if (object.userData["edges"]) {
          object.visible = edges
          return
        }
        const mesh = object as THREE.Mesh
        const material = mesh.material as THREE.MeshStandardMaterial | undefined
        if (!material || Array.isArray(mesh.material) || !("color" in material)) return
        material.color.set(color)
        material.opacity = opacity
        material.transparent = transparent
        // Without this the far side of a translucent part is culled and the
        // model reads as a hollow shell instead of something you can see into.
        material.side = transparent ? THREE.DoubleSide : THREE.FrontSide
        material.depthWrite = !transparent
        material.needsUpdate = true
      })
    }

    function addEdges(mesh: THREE.Mesh) {
      const geometry = mesh.geometry as THREE.BufferGeometry
      const lines = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 25),
        new THREE.LineBasicMaterial({ color: 0x1b1b20 }),
      )
      lines.userData["edges"] = true
      lines.visible = appearance().edges
      mesh.add(lines)
    }

    function load(bytes: Uint8Array, ext: string) {
      disposeGroup()
      measurePts.length = 0
      measureEl.textContent = ""
      const material = new THREE.MeshStandardMaterial({
        color: appearance().color,
        metalness: 0.1,
        roughness: 0.75,
      })
      if (!looksComplete(bytes, ext)) {
        dims.textContent = ""
        props.onLoadError?.("incomplete")
        return
      }
      try {
        if (ext === "stl") {
          const geo = new STLLoader().parse(bytes.slice().buffer)
          geo.computeVertexNormals()
          const mesh = new THREE.Mesh(geo, material)
          group.add(mesh)
          addEdges(mesh)
          fit(new THREE.Box3().setFromObject(mesh))
          applyAppearance()
        } else if (ext === "glb" || ext === "gltf") {
          new GLTFLoader().parse(
            bytes.slice().buffer,
            "",
            (g) => {
              group.add(g.scene)
              g.scene.traverse((object) => {
                if ((object as THREE.Mesh).isMesh) addEdges(object as THREE.Mesh)
              })
              fit(new THREE.Box3().setFromObject(g.scene))
              applyAppearance()
            },
            () => {
              dims.textContent = ""
              props.onLoadError?.("parse")
            },
          )
        }
      } catch (error) {
        dims.textContent = ""
        props.onLoadError?.(error instanceof Error ? error.message : String(error))
      }
    }

    renderer.domElement.addEventListener("dblclick", (ev) => {
      // two double-clicks measure point-to-point distance in mm
      const rect = renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      )
      const ray = new THREE.Raycaster()
      ray.setFromCamera(ndc, camera)
      const hit = ray.intersectObjects(group.children, true).find((h) => !(h.object instanceof THREE.GridHelper))
      if (!hit) return
      measurePts.push(hit.point.clone())
      if (measurePts.length === 2) {
        const [a, b] = measurePts
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([a, b]),
          new THREE.LineBasicMaterial({ color: 0xffcc00 }),
        )
        group.add(line)
        measureEl.textContent = `measure: ${a.distanceTo(b).toFixed(2)} mm`
        measurePts.length = 0
      } else {
        measureEl.textContent = "measure: pick second point (double-click)"
      }
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

    // Switching backdrop repaints without a reload: the scene colour is a
    // direct set, and the grid is recoloured in place so it neither glares on
    // the light ground nor disappears on black.
    createEffect(() => {
      const chosen = backgroundFor(appearance().background)
      scene.background = new THREE.Color(chosen.scene)
      group.traverse((child) => {
        if (!(child instanceof THREE.GridHelper)) return
        const mat = child.material as THREE.Material | THREE.Material[]
        const mats = Array.isArray(mat) ? mat : [mat]
        for (const m of mats) {
          const c = (m as THREE.Material & { color?: THREE.Color }).color
          if (c) c.setHex(chosen.grid[0])
        }
      })
    })

    let raf = 0
    const loop = () => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(loop)
    }
    loop()

    createEffect(() => load(props.bytes, props.ext.toLowerCase()))
    createEffect(() => {
      appearance()
      applyAppearance()
    })

    onCleanup(() => {
      cameraCache.set(cacheKey, { pos: camera.position.clone(), target: controls.target.clone() })
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      disposeGroup()
      // dispose() alone leaves the GL context alive on Chromium; without the
      // forced loss a handful of reloads exhausts the context pool and the
      // browser starts killing the oldest ones ("Too many active WebGL
      // contexts"), which eventually takes the window down.
      renderer.forceContextLoss()
      renderer.dispose()
      renderer.domElement.remove()
    })
  })

  return (
    <div class="relative flex-1 min-h-0 min-w-0">
      <div ref={host} class="absolute inset-0" />
      <div ref={dims} class="absolute bottom-2 left-2 text-12-regular font-mono opacity-70 pointer-events-none" />
      <div ref={measureEl} class="absolute bottom-2 right-2 text-12-regular font-mono text-yellow-400 pointer-events-none" />

      <div class="absolute top-3 right-3 flex flex-col items-end gap-2">
        {/* One instrument cluster, not two loose chips: a single surface with
            a divider reads as one control the eye can dismiss, which matters
            when the model is the thing being judged. */}
        <div class="flex items-stretch overflow-hidden rounded-lg border border-white/10 bg-[rgba(12,16,18,0.78)] backdrop-blur-sm shadow-[0_1px_8px_rgba(0,0,0,0.35)]">
          <button
            type="button"
            class="px-2.5 py-1.5 text-12-regular text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-300/70"
            title="Frame the part again — recovers a camera that has drifted off the model"
            onClick={() => resetView?.()}
          >
            Reset view
          </button>
          <span class="w-px self-stretch bg-white/10" aria-hidden="true" />
          <button
            type="button"
            class="flex items-center gap-1.5 px-2.5 py-1.5 text-12-regular transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-300/70"
            classList={{
              "bg-white/15 text-white": panelOpen(),
              "text-white/70 hover:text-white": !panelOpen(),
            }}
            title="Colour, transparency, edges and background"
            aria-pressed={panelOpen()}
            onClick={() => setPanelOpen(!panelOpen())}
          >
            <span
              class="size-3 rounded-[3px] ring-1 ring-inset ring-white/25"
              style={{ "background-color": appearance().color }}
            />
            Appearance
          </button>
        </div>

        <Show when={panelOpen()}>
          <div class="w-60 rounded-xl border border-white/10 bg-[rgba(12,16,18,0.86)] backdrop-blur-md p-3 flex flex-col gap-3 shadow-[0_4px_24px_rgba(0,0,0,0.45)] text-white">
            <div class="flex flex-col gap-2">
              <span class="text-12-regular text-white/60">Colour</span>
              <div class="flex flex-wrap gap-1.5">
                <For each={PRESET_COLORS}>
                  {(swatch) => (
                    <button
                      type="button"
                      // The selected swatch gets a teal ring with a gap rather
                      // than a heavier border, so picking a colour never
                      // changes the size of the row.
                      class="size-5 rounded-[5px] ring-1 ring-inset ring-white/20 transition-shadow"
                      classList={{
                        "outline outline-2 outline-offset-2 outline-teal-300":
                          appearance().color.toLowerCase() === swatch.toLowerCase(),
                      }}
                      style={{ "background-color": swatch }}
                      title={swatch}
                      aria-pressed={appearance().color.toLowerCase() === swatch.toLowerCase()}
                      onClick={() => setAppearance({ color: swatch })}
                    />
                  )}
                </For>
                <input
                  type="color"
                  class="size-5 shrink-0 cursor-pointer rounded-[5px] border-0 bg-transparent p-0"
                  value={appearance().color}
                  title="Pick any colour"
                  onInput={(e) => {
                    if (isValidHex(e.currentTarget.value)) setAppearance({ color: e.currentTarget.value })
                  }}
                />
              </div>
            </div>

            <label class="flex flex-col gap-1.5">
              <span class="flex items-baseline justify-between text-12-regular text-white/60">
                Transparency
                <span class="font-mono text-white">{Math.round((1 - appearance().opacity) * 100)}%</span>
              </span>
              <input
                type="range"
                min={10}
                max={100}
                class="w-full cursor-pointer accent-teal-300"
                value={Math.round(appearance().opacity * 100)}
                onInput={(e) => setAppearance({ opacity: Number(e.currentTarget.value) / 100 })}
              />
            </label>

            <label class="flex cursor-pointer items-center gap-2 text-12-regular text-white/70 hover:text-white">
              <input
                type="checkbox"
                class="size-3.5 cursor-pointer accent-teal-300"
                checked={appearance().edges}
                onChange={(e) => setAppearance({ edges: e.currentTarget.checked })}
              />
              Show edges
            </label>

            {/* Backdrop: a pale part vanishes on the light ground and a dark
                one vanishes on black, so this is a real inspection control,
                not decoration. */}
            <div class="flex flex-col gap-1.5">
              <span class="text-12-regular text-white/60">Background</span>
              <div class="flex gap-1 rounded-lg bg-white/[0.06] p-1">
                <For each={BACKGROUNDS}>
                  {(bg) => (
                    <button
                      type="button"
                      class="flex flex-1 items-center justify-center gap-1.5 rounded-md px-1.5 py-1 text-11-regular transition-colors"
                      classList={{
                        "bg-white/20 text-white shadow-[0_1px_2px_rgba(0,0,0,0.3)]":
                          appearance().background === bg.id,
                        "text-white/60 hover:text-white": appearance().background !== bg.id,
                      }}
                      aria-pressed={appearance().background === bg.id}
                      onClick={() => setAppearance({ background: bg.id })}
                    >
                      <span
                        class="inline-block size-2.5 rounded-[3px] ring-1 ring-inset ring-white/25"
                        style={{ "background-color": `#${bg.scene.toString(16).padStart(6, "0")}` }}
                      />
                      {bg.label}
                    </button>
                  )}
                </For>
              </div>
            </div>

            <button
              type="button"
              class="-mb-0.5 mt-0.5 border-t border-white/10 pt-2.5 text-12-regular text-white/60 transition-colors hover:text-white"
              title="Put colour, transparency, edges and background back to their defaults"
              onClick={() => setAppearance(DEFAULT_APPEARANCE)}
            >
              Reset appearance
            </button>
          </div>
        </Show>
      </div>
    </div>
  )
}
