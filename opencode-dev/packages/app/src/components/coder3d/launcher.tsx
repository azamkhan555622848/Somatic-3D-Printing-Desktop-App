// The panel's empty state: a ChatGPT-desktop-style launcher. Each row opens a
// mode that fills the whole pane; not-ready modes are dimmed with a "soon" tag.
import { For, Show, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { MODES, MODE_ORDER, type PanelMode } from "./panel-mode"
import { DesignViewIcon, MedicalViewIcon, PrintViewIcon } from "./panel-icons"
import { TOUR_EVENT } from "./onboarding/onboarding-steps"

export function modeIcon(id: PanelMode, cls: string): JSX.Element {
  switch (id) {
    case "medical":
      return <MedicalViewIcon class={cls} />
    case "design":
      return <DesignViewIcon class={cls} />
    case "print":
      return <PrintViewIcon class={cls} />
    case "files":
      return <Icon name="folder" class={cls} />
    case "terminal":
      return <Icon name="terminal" class={cls} />
  }
}

export function Coder3dLauncher(props: {
  terminalKeys?: string[]
  onSelect: (mode: PanelMode) => void
  // One-click start for a first-run tester, when the workspace has a scan to
  // open. Without it the launcher asks people to pick a mode before they have
  // seen the app do anything.
  quickStartLabel?: string
  onQuickStart?: () => void
}) {
  return (
    <div class="flex-1 min-h-0 flex items-center justify-center overflow-y-auto px-6 py-6">
      <div class="w-full max-w-80 flex flex-col gap-2">
        <Show when={props.quickStartLabel && props.onQuickStart}>
          <button
            type="button"
            class="flex items-center gap-3 rounded-lg px-4 h-11 text-left bg-background-stronger-base hover:bg-background-strongest-base cursor-pointer border border-border-weaker-base"
            data-tour="quickstart"
            onClick={() => props.onQuickStart!()}
          >
            <span class="shrink-0 flex items-center text-text-base">
              <MedicalViewIcon class="size-4" />
            </span>
            <span class="text-14-regular flex-1 truncate text-text-base">{props.quickStartLabel}</span>
            <Icon name="outline-square-arrow" class="size-4 shrink-0 text-text-weak" />
          </button>
          <div class="h-px bg-border-weaker-base my-1" />
        </Show>
        <For each={MODE_ORDER}>
          {(id) => {
            const def = MODES[id]
            return (
              <>
                <Show when={id === "files"}>
                  <div class="h-px bg-border-weaker-base my-1" />
                </Show>
                <button
                  type="button"
                  disabled={!def.ready}
                  class="flex items-center gap-3 rounded-lg px-4 py-2 text-left bg-background-stronger-base"
                  classList={{
                    "hover:bg-background-strongest-base text-text-base cursor-pointer": def.ready,
                    "opacity-45 cursor-default": !def.ready,
                  }}
                  onClick={() => def.ready && props.onSelect(id)}
                >
                  <span class="shrink-0 flex items-center">{modeIcon(id, "size-4")}</span>
                  <span class="flex-1 min-w-0 flex flex-col">
                    <span class="text-14-regular truncate">{def.label}</span>
                    <span class="text-12-regular text-text-weak truncate">{def.hint}</span>
                  </span>
                  <Show when={!def.ready}>
                    <span class="text-12-regular text-text-weak border border-border-weaker-base rounded px-1.5 py-0.5">
                      soon
                    </span>
                  </Show>
                  <Show when={id === "terminal" && props.terminalKeys?.length}>
                    <KeybindV2 keys={props.terminalKeys!} variant="neutral" />
                  </Show>
                </button>
              </>
            )
          }}
        </For>
        {/* The tour shows itself once; this is how someone finds it again. */}
        <button
          type="button"
          class="mt-2 self-center text-12-regular text-text-weak hover:text-text-base"
          onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))}
        >
          Show me around Somatic
        </button>
      </div>
    </div>
  )
}
