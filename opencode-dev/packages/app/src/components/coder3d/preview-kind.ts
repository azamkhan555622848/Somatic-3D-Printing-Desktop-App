// 3D-Coder vendor code (ported from Paperino's preview-kind.ts, + mesh kinds).
export type PreviewKind = "pdf" | "image" | "docx" | "doc-legacy" | "mesh" | "dicom" | "text" | "binary"

export const TEXT_DISPLAY_CAP = 2 * 1024 * 1024

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"])

// 3D geometry the Design View can (or will learn to) show.
const MESH_EXT = new Set(["stl", "glb", "gltf", "3mf", "step", "stp"])

const TEXT_EXT = new Set([
  "txt", "md", "json", "jsonc", "yaml", "yml", "csv", "tsv", "toml",
  "py", "js", "ts", "tsx", "jsx", "mjs", "log", "cmd", "sh", "bat",
  "xml", "html", "css", "ini", "cfg", "r", "m", "gcode",
])

// Extensions we know are binary — without this, formats whose header happens to
// decode as UTF-8 (zip's "PK") would false-positive the text sniff.
const BINARY_EXT = new Set([
  "zip", "gz", "7z", "rar", "tar", "exe", "dll", "so", "dylib", "bin", "dat",
  "fcstd", "pyc", "class", "o", "obj", "wasm",
  "ttf", "otf", "woff", "woff2", "eot",
  "mp4", "mov", "avi", "mkv", "webm", "mp3", "wav", "flac", "ogg",
])

const DICOM_EXT = new Set(["dcm", "dicom"])

// DICOM part-10 is a 128-byte preamble followed by the "DICM" magic. Match on
// the magic as well as the extension: exported series are routinely
// extensionless (IM_0001, 00000), and the all-zero preamble means the utf8
// sniff would otherwise file every slice as an anonymous "binary".
const DICM = [0x44, 0x49, 0x43, 0x4d]

export function hasDicomMagic(bytes: Uint8Array) {
  return bytes.length >= 132 && DICM.every((byte, i) => bytes[128 + i] === byte)
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
}

export function extensionOf(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

export function imageMime(ext: string) {
  return MIME[ext] ?? "application/octet-stream"
}

export function looksLikeUtf8Text(bytes: Uint8Array) {
  const sample = bytes.subarray(0, 8192)
  if (sample.includes(0)) return false
  try {
    // stream: true tolerates a multibyte sequence cut off at the sample boundary
    new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: true })
    return true
  } catch {
    return false
  }
}

export function classifyPreviewKind(path: string, bytes: Uint8Array): PreviewKind {
  const ext = extensionOf(path)
  if (ext === "pdf") return "pdf"
  if (IMAGE_EXT.has(ext)) return "image"
  if (ext === "docx") return "docx"
  if (ext === "doc") return "doc-legacy"
  // before the text/binary checks: ASCII STL would sniff as text otherwise
  if (MESH_EXT.has(ext)) return "mesh"
  if (DICOM_EXT.has(ext) || hasDicomMagic(bytes)) return "dicom"
  if (TEXT_EXT.has(ext)) return "text"
  if (BINARY_EXT.has(ext)) return "binary"
  return looksLikeUtf8Text(bytes) ? "text" : "binary"
}
