import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listWorkspaceFiles, readWorkspaceFile, resolveWithin } from "./files"

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "coder3d-files-"))
  mkdirSync(join(dir, "cases", "demo", "cad"), { recursive: true })
  mkdirSync(join(dir, "node_modules", "junk"), { recursive: true })
  mkdirSync(join(dir, ".git"), { recursive: true })
  mkdirSync(join(dir, ".coder3d"), { recursive: true })
  mkdirSync(join(dir, "cases", ".identity"), { recursive: true })
  writeFileSync(join(dir, "cases", "demo", "cad", "rack.py"), "PARAMS = {}")
  writeFileSync(join(dir, "notes.txt"), "hello")
  writeFileSync(join(dir, "node_modules", "junk", "x.js"), "skip me")
  writeFileSync(join(dir, ".git", "HEAD"), "skip me")
  writeFileSync(join(dir, ".coder3d", "session.json"), "private")
  writeFileSync(join(dir, "cases", ".identity", "demo.json"), "private")
  return dir
}

describe("listWorkspaceFiles", () => {
  test("lists files recursively, skipping internal and protected directories", async () => {
    const dir = makeWorkspace()
    const r = await listWorkspaceFiles(dir)
    expect(r.truncated).toBe(false)
    expect(r.files).toContain("cases/demo/cad/rack.py")
    expect(r.files).toContain("notes.txt")
    expect(
      r.files.some(
        (f) => f.includes("node_modules") || f.includes(".git") || f.includes(".coder3d") || f.includes(".identity"),
      ),
    ).toBe(false)
  })

  test("caps the listing", async () => {
    const dir = makeWorkspace()
    const r = await listWorkspaceFiles(dir, 1)
    expect(r.files.length).toBe(1)
    expect(r.truncated).toBe(true)
  })
})

describe("resolveWithin", () => {
  test("rejects traversal and the base itself", () => {
    const dir = makeWorkspace()
    expect(resolveWithin(dir, "../outside.txt")).toBeUndefined()
    expect(resolveWithin(dir, ".")).toBeUndefined()
    expect(resolveWithin(dir, "notes.txt")).toBeDefined()
  })

  test("rejects protected workspace metadata", () => {
    const dir = makeWorkspace()
    expect(resolveWithin(dir, ".coder3d/session.json")).toBeUndefined()
    expect(resolveWithin(dir, "cases/.identity/demo.json")).toBeUndefined()
    expect(resolveWithin(dir, "cases\\.identity\\demo.json")).toBeUndefined()
  })
})

describe("readWorkspaceFile", () => {
  test("reads a file and enforces the cap", async () => {
    const dir = makeWorkspace()
    const ok = await readWorkspaceFile(dir, "notes.txt")
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(new TextDecoder().decode(ok.bytes)).toBe("hello")
    const tooBig = await readWorkspaceFile(dir, "notes.txt", 1)
    expect(tooBig).toEqual({ ok: false, error: "too-large" })
    const missing = await readWorkspaceFile(dir, "nope.txt")
    expect(missing).toEqual({ ok: false, error: "not-found" })
    const invalid = await readWorkspaceFile(dir, "../evil")
    expect(invalid).toEqual({ ok: false, error: "invalid-path" })
    const protectedFile = await readWorkspaceFile(dir, "cases/.identity/demo.json")
    expect(protectedFile).toEqual({ ok: false, error: "invalid-path" })
  })
})
