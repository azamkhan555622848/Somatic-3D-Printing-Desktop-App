import { describe, expect, test } from "bun:test"

import { cameraCacheKey } from "./camera-cache"

const size = (x: number, y: number, z: number) => ({ x, y, z })

describe("cameraCacheKey", () => {
  test("same path and same size shares a key, so the view survives a rebuild", () => {
    const a = cameraCacheKey("cases/a/meshes/cuff.glb", size(158.31, 104.57, 90))
    const b = cameraCacheKey("cases/a/meshes/cuff.glb", size(158.31, 104.57, 90))
    expect(a).toBe(b)
  })

  test("a resized rebuild at the same path gets a different key", () => {
    // the cuff went 155x156x90 -> 158x91x90 -> 193x87x90 across one session,
    // all at one path; reusing the camera across those put it out of frame
    const slug = cameraCacheKey("cases/a/meshes/cuff.glb", size(155.83, 155.82, 90))
    const wrapped = cameraCacheKey("cases/a/meshes/cuff.glb", size(158.33, 91.44, 90))
    expect(slug).not.toBe(wrapped)
  })

  test("different paths never collide at the same size", () => {
    const one = cameraCacheKey("cases/a/meshes/cuff.glb", size(90, 90, 90))
    const two = cameraCacheKey("cases/b/meshes/cuff.glb", size(90, 90, 90))
    expect(one).not.toBe(two)
  })

  test("sub-0.1mm jitter does not count as a resize", () => {
    // tessellation noise between builds must not throw the camera away
    const a = cameraCacheKey("p.glb", size(158.310, 104.570, 90.0))
    const b = cameraCacheKey("p.glb", size(158.312, 104.573, 90.0))
    expect(a).toBe(b)
  })

  test("a 1mm change does count", () => {
    const a = cameraCacheKey("p.glb", size(158.3, 104.5, 90))
    const b = cameraCacheKey("p.glb", size(159.3, 104.5, 90))
    expect(a).not.toBe(b)
  })
})
