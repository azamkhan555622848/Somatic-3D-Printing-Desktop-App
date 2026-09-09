// 3D-Coder vendor code (ported from Paperino's files.ts) — keep upstream-merge safe.
import { readFile as fsReadFile, readdir, stat } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

export const LIST_CAP = 5000
export const READ_CAP = 50 * 1024 * 1024

const SKIP_DIRS = new Set([".git", "node_modules", ".coder3d", ".identity"])

function hasProtectedSegment(relPath: string) {
  return relPath
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment === ".coder3d" || segment === ".identity")
}

export type ListFilesResult = { files: string[]; truncated: boolean }
export type ReadFileResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: "invalid-path" | "not-found" | "too-large" }

export async function listWorkspaceFiles(dir: string, cap = LIST_CAP): Promise<ListFilesResult> {
  const files: string[] = []
  let truncated = false
  const walk = async (abs: string, rel: string) => {
    if (truncated) return
    let entries
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (truncated) return
      if (SKIP_DIRS.has(entry.name)) continue
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      // withFileTypes reports symlinks as symlinks, not as their target,
      // so neither branch matches — links are never traversed or listed.
      if (entry.isDirectory()) {
        await walk(join(abs, entry.name), childRel)
      } else if (entry.isFile()) {
        if (files.length >= cap) {
          truncated = true
          return
        }
        files.push(childRel)
      }
    }
  }
  await walk(dir, "")
  return { files, truncated }
}

export function resolveWithin(dir: string, relPath: string): string | undefined {
  if (!relPath || typeof relPath !== "string") return undefined
  if (hasProtectedSegment(relPath)) return undefined
  const base = resolve(dir)
  const target = resolve(base, relPath)
  if (target === base) return undefined
  if (!target.startsWith(base + sep)) return undefined
  return target
}

export async function readWorkspaceFile(dir: string, relPath: string, cap = READ_CAP): Promise<ReadFileResult> {
  const target = resolveWithin(dir, relPath)
  if (!target) return { ok: false, error: "invalid-path" }
  let info
  try {
    info = await stat(target)
  } catch {
    return { ok: false, error: "not-found" }
  }
  if (!info.isFile()) return { ok: false, error: "not-found" }
  if (info.size > cap) return { ok: false, error: "too-large" }
  try {
    return { ok: true, bytes: new Uint8Array(await fsReadFile(target)) }
  } catch {
    return { ok: false, error: "not-found" }
  }
}
