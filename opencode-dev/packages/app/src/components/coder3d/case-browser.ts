export type CaseArtifactKind = "scan" | "segmentation" | "model" | "qa" | "print" | "source"

export type CaseArtifact = {
  kind: CaseArtifactKind
  name: string
  path: string
  badges: string[]
}

export type CaseSummary = {
  id: string
  name: string
  dicomCount: number
  artifacts: CaseArtifact[]
}

export type GateStatus = "passed" | "failed"

const ORDER: Record<CaseArtifactKind, number> = {
  scan: 0,
  segmentation: 1,
  model: 2,
  qa: 3,
  print: 4,
  source: 5,
}

const FORMAT_ORDER = ["GLB", "STL", "3MF"]

function words(value: string) {
  return value
    .replace(/^_+/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

export function friendlyName(value: string) {
  const parts = words(value)
  if (!parts.length) return value
  return parts
    .map((part) => {
      const lower = part.toLowerCase()
      if (["ct", "mr", "mri", "qa", "cad"].includes(lower)) return lower.toUpperCase()
      return lower[0].toUpperCase() + lower.slice(1)
    })
    .join(" ")
}

function stem(value: string) {
  return value.replace(/\.nii(?:\.gz)?$/i, "").replace(/\.gcode\.3mf$/i, "").replace(/\.[^.]+$/i, "")
}

function protectedPath(path: string) {
  return path.split("/").some((segment) => segment === ".identity" || segment === ".coder3d")
}

export function caseIDForPath(path: string) {
  const normalized = path.replaceAll("\\", "/")
  const match = normalized.match(/^cases\/([^/]+)\//i)
  if (!match || match[1].startsWith(".")) return
  return match[1]
}

export function buildCaseSummaries(paths: readonly string[]): CaseSummary[] {
  const cases = new Map<string, CaseSummary>()
  const modelGroups = new Map<string, { artifact: CaseArtifact; formats: Set<string> }>()

  const getCase = (id: string) => {
    const current = cases.get(id)
    if (current) return current
    const next = { id, name: friendlyName(id), dicomCount: 0, artifacts: [] }
    cases.set(id, next)
    return next
  }

  paths.forEach((rawPath) => {
    const path = rawPath.replaceAll("\\", "/").replace(/^\/+/, "")
    if (protectedPath(path)) return
    const id = caseIDForPath(path)
    if (!id) return
    const summary = getCase(id)
    const rel = path.slice(`cases/${id}/`.length)

    if (/^dicom\//i.test(rel)) {
      summary.dicomCount++
      return
    }

    const scan = rel.match(/^nifti\/([^/]+\.nii(?:\.gz)?)$/i)
    if (scan) {
      summary.artifacts.push({ kind: "scan", name: summary.name, path, badges: ["NIfTI"] })
      return
    }

    const segmentation = rel.match(/^segmentations\/[^/]+\/([^/]+\.nii(?:\.gz)?)$/i)
    if (segmentation) {
      summary.artifacts.push({
        kind: "segmentation",
        name: friendlyName(stem(segmentation[1])),
        path,
        badges: ["SEG"],
      })
      return
    }

    const model = rel.match(/^meshes\/(?!qa\/)([^/]+)\.(stl|glb|3mf)$/i)
    if (model) {
      const name = friendlyName(model[1])
      const format = model[2].toUpperCase()
      const key = `${id}\0${name}`
      const current = modelGroups.get(key)
      if (current) {
        current.formats.add(format)
        if (format === "GLB") current.artifact.path = path
        return
      }
      const artifact = { kind: "model" as const, name, path, badges: [format] }
      summary.artifacts.push(artifact)
      modelGroups.set(key, { artifact, formats: new Set([format]) })
      return
    }

    const qa = rel.match(/^meshes\/qa\/(.+)\.gate\.json$/i)
    if (qa) {
      summary.artifacts.push({ kind: "qa", name: friendlyName(qa[1]), path, badges: ["QA"] })
      return
    }

    const print = rel.match(/^prints\/(.+)\.(gcode\.3mf|3mf|gcode)$/i)
    if (print) {
      summary.artifacts.push({
        kind: "print",
        name: friendlyName(stem(print[1])),
        path,
        badges: [print[2].toUpperCase()],
      })
      return
    }

    const source = rel.match(/^cad\/(.+)\.py$/i)
    if (source) {
      summary.artifacts.push({ kind: "source", name: friendlyName(source[1]), path, badges: ["CAD"] })
    }
  })

  modelGroups.forEach(({ artifact, formats }) => {
    artifact.badges = FORMAT_ORDER.filter((format) => formats.has(format))
  })

  return [...cases.values()]
    .map((summary) => ({
      ...summary,
      artifacts: summary.artifacts.sort(
        (a, b) => ORDER[a.kind] - ORDER[b.kind] || a.name.localeCompare(b.name) || a.path.localeCompare(b.path),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The first artifact of a kind anywhere in the workspace. Empty states use it
 *  to offer the thing that already exists instead of telling someone to go and
 *  find it — a panel that says "nothing here" while a job sits one click away
 *  is just a dead end. */
export function firstArtifactPath(
  cases: readonly CaseSummary[],
  kind: CaseArtifactKind,
): string | undefined {
  for (const summary of cases) {
    const match = summary.artifacts.find((artifact) => artifact.kind === kind)
    if (match) return match.path
  }
  return undefined
}

/** The same lookup, confined to one case. Views must not drift apart: offering
 *  "the first job in the workspace" put a knee brace in Design View and a hand
 *  prosthesis in Print View at the same time, which reads as two unrelated
 *  things pretending to be one. Returns nothing rather than crossing cases. */
export function artifactInCase(
  cases: readonly CaseSummary[],
  caseID: string | undefined,
  kind: CaseArtifactKind,
): string | undefined {
  const scoped = caseID ? cases.filter((summary) => summary.id === caseID) : cases
  return firstArtifactPath(scoped, kind)
}

/** The scan a first-run tester should open. The launcher offers it as one click
 *  so an empty app is not the first thing a new tester has to solve. */
export function firstScanPath(cases: readonly CaseSummary[]): string | undefined {
  return firstArtifactPath(cases, "scan")
}

export function filterCaseSummaries(cases: readonly CaseSummary[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...cases]
  return cases
    .map((summary) => {
      if (`${summary.name} ${summary.id}`.toLowerCase().includes(needle)) return summary
      const artifacts = summary.artifacts.filter((artifact) =>
        `${artifact.name} ${artifact.path} ${artifact.badges.join(" ")}`.toLowerCase().includes(needle),
      )
      return artifacts.length ? { ...summary, artifacts } : undefined
    })
    .filter((summary): summary is CaseSummary => !!summary)
}

export function parseGateStatus(value: string): GateStatus | undefined {
  try {
    const parsed = JSON.parse(value) as { passed?: unknown }
    if (parsed.passed === true) return "passed"
    if (parsed.passed === false) return "failed"
  } catch {
    return
  }
}
