// 3D-Coder vendor code — the "editable features" surface: sliders generated from
// the CAD script's PARAMS, re-running the script through the main process.
import { For, Show, createSignal } from "solid-js"

type ParamMeta = { value: number; default: number; min: number; max: number; step: number; unit: string }
export type Manifest = {
  script: string
  name: string
  params: Record<string, ParamMeta>
  outputs: Record<string, string>
  bbox_mm: number[] | null
  volume_mm3: number | null
  watertight: boolean | null
  error: string | null
}

export function ParamSidebar(props: {
  manifest: Manifest
  busy: boolean
  onRun: (params: Record<string, number>) => void
}) {
  const [draft, setDraft] = createSignal<Record<string, number>>(
    Object.fromEntries(Object.entries(props.manifest.params).map(([k, m]) => [k, m.value])),
  )
  const dirty = () => Object.entries(props.manifest.params).some(([k, m]) => draft()[k] !== m.value)

  return (
    <div class="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border-weaker-base p-3">
      <div class="text-12-regular text-text-base font-medium truncate" title={props.manifest.script}>
        {props.manifest.name}
      </div>
      <For each={Object.entries(props.manifest.params)}>
        {([name, m]) => (
          <label class="flex flex-col gap-1">
            <span class="flex justify-between text-12-regular text-text-weak">
              <span class="truncate">{name}{m.unit ? ` (${m.unit})` : ""}</span>
              <span class="font-mono shrink-0">{draft()[name]}</span>
            </span>
            <input
              type="range"
              min={m.min}
              max={m.max}
              step={m.step}
              value={draft()[name]}
              onInput={(e) => setDraft({ ...draft(), [name]: Number(e.currentTarget.value) })}
            />
          </label>
        )}
      </For>
      <button
        type="button"
        class="rounded border border-border-weaker-base px-2 py-1 text-12-regular text-text-base disabled:opacity-40"
        disabled={props.busy || !dirty()}
        onClick={() => props.onRun(draft())}
      >
        {props.busy ? "Rebuilding…" : "Rebuild"}
      </button>
      <Show when={props.manifest.bbox_mm}>
        {(bbox) => (
          <div class="text-12-regular text-text-weak font-mono">
            {bbox().map((v) => v.toFixed(1)).join(" × ")} mm
          </div>
        )}
      </Show>
      <Show when={props.manifest.watertight === false}>
        <div class="text-12-regular text-red-500">not watertight — run mesh_repair</div>
      </Show>
      <Show when={props.manifest.error}>
        <div class="text-12-regular text-red-500 whitespace-pre-wrap break-words">{props.manifest.error}</div>
      </Show>
    </div>
  )
}
