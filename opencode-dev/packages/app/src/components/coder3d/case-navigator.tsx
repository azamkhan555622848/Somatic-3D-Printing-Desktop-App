import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/v2/icon"
import FileTreeV2 from "@/components/file-tree-v2"
import { useLanguage } from "@/context/language"
import { DesignViewIcon, MedicalViewIcon, PrintViewIcon } from "./panel-icons"
import {
  filterCaseSummaries,
  type CaseArtifact,
  type CaseSummary,
  type GateStatus,
} from "./case-browser"

function ArtifactIcon(props: { artifact: CaseArtifact; status?: GateStatus }) {
  const cls = "size-4"
  if (props.artifact.kind === "scan" || props.artifact.kind === "segmentation")
    return <MedicalViewIcon class={cls} />
  if (props.artifact.kind === "model") return <DesignViewIcon class={cls} />
  if (props.artifact.kind === "print") return <PrintViewIcon class={cls} />
  if (props.artifact.kind === "qa")
    return <Icon name={props.status === "failed" ? "warning" : "check"} class={cls} />
  return <Icon name="file-tree" class={cls} />
}

function StatusBadge(props: { status?: GateStatus }) {
  const language = useLanguage()
  return (
    <Show when={props.status}>
      {(status) => (
        <span
          class="flex h-5 items-center rounded-full border px-1.5 text-11-medium capitalize"
          classList={{
            "border-green-500/30 bg-green-500/10 text-green-400": status() === "passed",
            "border-red-500/30 bg-red-500/10 text-red-400": status() === "failed",
          }}
        >
          {language.t(status() === "passed" ? "wsl.onboarding.distroStatus.ready" : "mcp.status.failed")}
        </span>
      )}
    </Show>
  )
}

function ArtifactBadges(props: { artifact: CaseArtifact }) {
  return (
    <span class="flex shrink-0 items-center gap-1">
      <For each={props.artifact.badges}>
        {(badge) => (
          <span class="flex h-5 items-center rounded border border-border-weaker-base px-1.5 text-11-regular text-text-weak">
            {badge}
          </span>
        )}
      </For>
    </span>
  )
}

function caseStatus(summary: CaseSummary, statuses: Record<string, GateStatus>) {
  const gates = summary.artifacts.flatMap((artifact) => {
    if (artifact.kind !== "qa") return []
    const status = statuses[artifact.path]
    return status ? [status] : []
  })
  if (gates.includes("failed")) return "failed" as const
  if (gates.includes("passed")) return "passed" as const
}

function ArtifactRow(props: {
  artifact: CaseArtifact
  active?: string
  status?: GateStatus
  onOpen: (path: string) => void
}) {
  return (
    <button
      type="button"
      class="group flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-text-weak transition-colors hover:bg-background-stronger-base hover:text-text-base"
      classList={{ "bg-background-stronger-base text-text-base": props.active === props.artifact.path }}
      aria-label={`${props.artifact.name} ${props.artifact.badges.join(" ")}`}
      onClick={() => props.onOpen(props.artifact.path)}
    >
      <span
        class="flex size-6 shrink-0 items-center justify-center rounded bg-background-stronger-base"
        classList={{
          "text-blue-400": props.artifact.kind === "scan" || props.artifact.kind === "segmentation",
          "text-purple-400": props.artifact.kind === "model",
          "text-green-400": props.artifact.kind === "qa" && props.status !== "failed",
          "text-red-400": props.artifact.kind === "qa" && props.status === "failed",
          "text-orange-400": props.artifact.kind === "print",
        }}
      >
        <ArtifactIcon artifact={props.artifact} status={props.status} />
      </span>
      <span class="min-w-0 flex-1 truncate text-12-medium">{props.artifact.name}</span>
      <StatusBadge status={props.status} />
      <ArtifactBadges artifact={props.artifact} />
    </button>
  )
}

export function CaseNavigator(props: {
  cases: readonly CaseSummary[]
  files: readonly string[]
  activePath?: string
  selectedCaseID?: string
  gateStatuses: Record<string, GateStatus>
  truncated: boolean
  onOpen: (path: string) => void
  onSelectCase: (id: string) => void
  onRefresh: () => void
}) {
  const language = useLanguage()
  const [query, setQuery] = createSignal("")
  const filtered = createMemo(() => filterCaseSummaries(props.cases, query()))
  const advanced = createMemo(() => {
    const needle = query().trim().toLowerCase()
    if (!needle) return props.files
    return props.files.filter((path) => path.toLowerCase().includes(needle))
  })

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex shrink-0 items-center gap-2 border-b border-border-weaker-base px-2 py-2">
        <div class="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border-weaker-base bg-background-base px-2">
          <Icon name="magnifying-glass" class="size-3.5 shrink-0 text-text-weak" />
          <input
            type="search"
            class="h-7 min-w-0 flex-1 bg-transparent text-12-regular text-text-base outline-none placeholder:text-text-weak"
            placeholder={language.t("session.header.searchFiles")}
            aria-label={language.t("session.header.searchFiles")}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <button
          type="button"
          class="flex size-7 shrink-0 items-center justify-center rounded-md text-text-weak hover:bg-background-stronger-base hover:text-text-base"
          title={language.t("wsl.onboarding.refresh")}
          aria-label={language.t("wsl.onboarding.refresh")}
          onClick={props.onRefresh}
        >
          ↻
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <Show
          when={filtered().length}
          fallback={<div class="px-3 py-8 text-center text-12-regular text-text-weak">{language.t("session.files.empty")}</div>}
        >
          <div class="flex flex-col gap-2">
            <For each={filtered()}>
              {(summary) => (
                <details
                  class="group rounded-lg border border-border-weaker-base bg-background-base open:bg-background-weak-base"
                  open={props.selectedCaseID === summary.id || filtered().length === 1}
                >
                  <summary
                    class="flex h-10 cursor-pointer list-none items-center gap-2 px-2.5 text-text-base marker:hidden"
                    onClick={() => props.onSelectCase(summary.id)}
                  >
                    <Icon name="chevron-right" class="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
                    <span class="min-w-0 flex-1 truncate text-12-medium">{summary.name}</span>
                    <Show when={summary.dicomCount > 0}>
                      <span class="flex h-5 items-center rounded border border-border-weaker-base px-1.5 text-11-regular text-text-weak">
                        DICOM · {summary.dicomCount}
                      </span>
                    </Show>
                    <StatusBadge status={caseStatus(summary, props.gateStatuses)} />
                  </summary>
                  <div class="flex flex-col gap-0.5 border-t border-border-weaker-base px-1.5 py-1.5">
                    <For each={summary.artifacts}>
                      {(artifact) => (
                        <ArtifactRow
                          artifact={artifact}
                          active={props.activePath}
                          status={artifact.kind === "qa" ? props.gateStatuses[artifact.path] : undefined}
                          onOpen={props.onOpen}
                        />
                      )}
                    </For>
                  </div>
                </details>
              )}
            </For>
          </div>
        </Show>

        <details class="group mt-3 border-t border-border-weaker-base pt-2">
          <summary class="flex h-8 cursor-pointer list-none items-center gap-2 rounded px-2 text-12-medium text-text-weak hover:bg-background-stronger-base hover:text-text-base marker:hidden">
            <Icon name="chevron-right" class="size-3.5 transition-transform group-open:rotate-90" />
            <span>{language.t("settings.general.section.advanced")}</span>
            <span class="ml-auto text-11-regular text-text-weak">{props.truncated ? "5,000+" : advanced().length}</span>
          </summary>
          <div class="min-h-32 py-2">
            <FileTreeV2
              allowed={advanced()}
              draggable={false}
              active={props.activePath}
              onFileClick={(node) => props.onOpen(node.path)}
            />
          </div>
        </details>
      </div>
    </div>
  )
}

export function CaseOverview(props: {
  summary?: CaseSummary
  activePath?: string
  gateStatuses: Record<string, GateStatus>
  onOpen: (path: string) => void
}): JSX.Element {
  const language = useLanguage()
  return (
    <div class="absolute inset-0 flex items-center justify-center overflow-y-auto p-8">
      <Show
        when={props.summary}
        fallback={<div class="text-12-regular text-text-weak">{language.t("session.files.empty")}</div>}
      >
        {(summary) => (
          <div class="w-full max-w-2xl rounded-xl border border-border-weaker-base bg-background-base p-4 shadow-sm">
            <div class="mb-4 flex items-center gap-2">
              <div class="flex size-9 items-center justify-center rounded-lg bg-background-stronger-base text-text-base">
                <Icon name="folder" class="size-4" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-14-medium text-text-base">{summary().name}</div>
                <Show when={summary().dicomCount > 0}>
                  <div class="text-12-regular text-text-weak">DICOM · {summary().dicomCount}</div>
                </Show>
              </div>
              <StatusBadge status={caseStatus(summary(), props.gateStatuses)} />
            </div>

            <div class="grid grid-cols-1 gap-2 lg:grid-cols-2">
              <For each={summary().artifacts.slice(0, 8)}>
                {(artifact) => (
                  <button
                    type="button"
                    class="flex min-w-0 items-center gap-3 rounded-lg border border-border-weaker-base p-3 text-left hover:bg-background-stronger-base"
                    classList={{ "bg-background-stronger-base": props.activePath === artifact.path }}
                    onClick={() => props.onOpen(artifact.path)}
                  >
                    <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-background-stronger-base text-text-weak">
                      <ArtifactIcon artifact={artifact} status={props.gateStatuses[artifact.path]} />
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-12-medium text-text-base">{artifact.name}</span>
                      <span class="mt-1 flex gap-1">
                        <ArtifactBadges artifact={artifact} />
                      </span>
                    </span>
                    <StatusBadge status={artifact.kind === "qa" ? props.gateStatuses[artifact.path] : undefined} />
                    <span class="text-12-regular text-text-weak">{language.t("common.open")}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
