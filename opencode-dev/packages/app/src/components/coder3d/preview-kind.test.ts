import { describe, expect, test } from "bun:test"
import { classifyPreviewKind, extensionOf, looksLikeUtf8Text } from "./preview-kind"

const utf8 = (s: string) => new TextEncoder().encode(s)

// DICOM part-10: 128 bytes of preamble, then the "DICM" magic.
const dicom = () => {
  const bytes = new Uint8Array(200)
  bytes.set(utf8("DICM"), 128)
  return bytes
}

describe("extensionOf", () => {
  test("lowercases and handles nested paths", () => {
    expect(extensionOf("cases/a/meshes/RACK.STL")).toBe("stl")
    expect(extensionOf("notes.txt")).toBe("txt")
    expect(extensionOf("no-extension")).toBe("")
    expect(extensionOf(".hidden")).toBe("")
  })
})

describe("classifyPreviewKind", () => {
  test("mesh formats classify as mesh", () => {
    expect(classifyPreviewKind("cases/a/meshes/rack.stl", utf8("solid rack"))).toBe("mesh")
    expect(classifyPreviewKind("RACK.GLB", new Uint8Array([0x67, 0x6c, 0x54, 0x46]))).toBe("mesh")
    expect(classifyPreviewKind("cad/rack.step", utf8("ISO-10303-21;"))).toBe("mesh")
    expect(classifyPreviewKind("part.3mf", new Uint8Array([0x50, 0x4b, 3, 4]))).toBe("mesh")
  })
  test("ascii stl never false-positives as text", () => {
    expect(classifyPreviewKind("x.stl", utf8("solid x\nfacet normal 0 0 1\n"))).toBe("mesh")
  })
  test("documents and images", () => {
    expect(classifyPreviewKind("report.pdf", new Uint8Array([0x25, 0x50]))).toBe("pdf")
    expect(classifyPreviewKind("scan.png", new Uint8Array([0x89, 0x50]))).toBe("image")
    expect(classifyPreviewKind("notes.docx", new Uint8Array([0x50, 0x4b]))).toBe("docx")
    expect(classifyPreviewKind("old.doc", new Uint8Array([0xd0]))).toBe("doc-legacy")
  })
  test("known text and gcode", () => {
    expect(classifyPreviewKind("cad/rack.py", utf8("PARAMS = {}"))).toBe("text")
    expect(classifyPreviewKind("job.gcode", utf8("G28\nG1 X0"))).toBe("text")
  })
  test("unknown extensions fall back to the utf8 sniff", () => {
    expect(classifyPreviewKind("data.xyz", utf8("1 2 3\n4 5 6"))).toBe("text")
    expect(classifyPreviewKind("data.xyz", new Uint8Array([0, 1, 2, 3]))).toBe("binary")
  })
  test("dicom by extension", () => {
    expect(classifyPreviewKind("cases/demo-ct/dicom/00000.dcm", dicom())).toBe("dicom")
    expect(classifyPreviewKind("SCAN.DCM", dicom())).toBe("dicom")
  })
  test("dicom by magic, for the extensionless slices real exports produce", () => {
    expect(classifyPreviewKind("cases/demo-ct/dicom/IM_0001", dicom())).toBe("dicom")
  })
  test("a zero-prefixed non-dicom binary is not mistaken for dicom", () => {
    expect(classifyPreviewKind("data.xyz", new Uint8Array(200))).toBe("binary")
  })
  test("a file too short to hold the magic is not dicom", () => {
    expect(classifyPreviewKind("stub", new Uint8Array(64))).toBe("binary")
  })
})

describe("looksLikeUtf8Text", () => {
  test("rejects NUL bytes, accepts utf8", () => {
    expect(looksLikeUtf8Text(new Uint8Array([65, 0, 66]))).toBe(false)
    expect(looksLikeUtf8Text(utf8("héllo wörld"))).toBe(true)
  })
})
