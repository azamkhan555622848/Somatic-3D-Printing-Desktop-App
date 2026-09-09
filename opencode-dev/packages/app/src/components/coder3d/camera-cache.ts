// 3D-Coder vendor code — keep out of packages/ui (upstream-merge safety).
//
// Keying for the mesh viewer's camera cache. Split out of mesh-viewer.tsx so it
// can be tested without pulling in three.js.

export type MeshSize = { x: number; y: number; z: number }

// Rounded to 0.1 mm: fine enough that a real dimensional change refits, coarse
// enough that tessellation jitter between two builds of the same geometry does
// not.
const PRECISION = 1

/**
 * Cache key for a camera pose.
 *
 * Keying on path alone is wrong for this app. A parametric case is rebuilt over
 * and over at one path while its dimensions change - a cuff went 155x156x90,
 * then 158x91x90, then 193x87x90 inside a single session. Restoring a camera
 * framed for one of those onto another leaves the part outside the view
 * frustum, and the viewer renders black with a correct dimension readout, which
 * looks for all the world like a failed load.
 *
 * Including the size means a rebuild that changes the part refits, while a
 * re-skin, a tab-away, or a parameter tweak that leaves dimensions alone keeps
 * whatever view the operator set up.
 */
export function cameraCacheKey(path: string, size: MeshSize): string {
  const dims = [size.x, size.y, size.z].map((v) => v.toFixed(PRECISION)).join("x")
  return `${path}@${dims}`
}
