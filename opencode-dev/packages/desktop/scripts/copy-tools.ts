#!/usr/bin/env bun
/**
 * Put Somatic's Python tool servers, and a copy of `uv`, into resources/ so
 * electron-builder can ship them.
 *
 * Only the source goes in - about 1.2 MB across the five packages. The
 * environments themselves come to several gigabytes and are built on the
 * machine that will run them, by the app, on first launch. `uv` fetches its
 * own Python, so a lab member needs nothing installed beforehand.
 */
import { $ } from "bun"
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const desktopDir = join(import.meta.dir, "..")
const repoRoot = join(desktopDir, "..", "..", "..")
const resources = join(desktopDir, "resources")

/** Matches the directories in src/main/coder3d/toolchain.ts. */
const PACKAGES = ["cad-mcp", "mesh-mcp", "medimage-mcp", "print-mcp", "claude-mcp"]

/** Everything that is a build artifact, a cache, or somebody's environment. */
const SKIP = new Set([".venv", "__pycache__", ".pytest_cache", ".ruff_cache", "dist", "build", ".git"])

export const UV_VERSION = "0.12.12"

function uvTarget(): string {
  const { platform, arch } = process
  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  if (platform === "win32") return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
  if (platform === "linux") return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  throw new Error(`No uv build for ${platform}/${arch}`)
}

function copyPackages() {
  const dest = join(resources, "tools")
  rmSync(dest, { recursive: true, force: true })
  for (const name of PACKAGES) {
    const from = join(repoRoot, name)
    if (!existsSync(from)) throw new Error(`Tool package missing: ${from}`)
    cpSync(from, join(dest, name), {
      recursive: true,
      filter: (src) => !src.split(/[\\/]/).some((part) => SKIP.has(part)),
    })
  }
  console.log(`Copied ${PACKAGES.length} tool packages to resources/tools`)
}

async function copyUv() {
  const target = uvTarget()
  const windows = process.platform === "win32"
  const archive = windows ? `uv-${target}.zip` : `uv-${target}.tar.gz`
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${archive}`
  const dest = join(resources, "uv")

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not download uv: ${response.status} ${url}`)

  const scratch = await mkdtemp(join(tmpdir(), "somatic-uv-"))
  try {
    const bundle = join(scratch, archive)
    await Bun.write(bundle, await response.arrayBuffer())
    // bsdtar handles both zip and tar.gz, and ships with Windows 10 onwards.
    // Named explicitly there: a Git-for-Windows GNU tar earlier on PATH reads
    // "C:/..." as a remote host and fails with "Cannot connect to C:".
    const tarBin = windows ? join(process.env["SystemRoot"] ?? "C:/Windows", "System32", "tar.exe") : "tar"
    await $`${tarBin} -xf ${bundle} -C ${scratch}`.quiet()

    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dest, { recursive: true })
    // The tarball nests the binary under a directory; the zip does not.
    const binary = windows ? "uv.exe" : "uv"
    const nested = join(scratch, `uv-${target}`, binary)
    const source = existsSync(nested) ? nested : join(scratch, binary)
    if (!existsSync(source)) throw new Error(`uv binary not found after extracting ${archive}`)
    cpSync(source, join(dest, binary))
    if (!windows) await $`chmod +x ${join(dest, binary)}`.quiet()
    console.log(`Copied uv ${UV_VERSION} (${target}) to resources/uv`)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

copyPackages()
await copyUv()
