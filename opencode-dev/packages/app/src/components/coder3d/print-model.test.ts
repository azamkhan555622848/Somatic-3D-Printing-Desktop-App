import { describe, expect, test } from "bun:test"
import {
  FEATURE_COLORS,
  PLATE_AUX_MM,
  PLATE_MM,
  clampRange,
  defaultFeatureColor,
  failedChecks,
  featureLegend,
  formatGrams,
  gateBadge,
  gateRemediation,
  initialLayerIndex,
  isValidHex,
  plateFor,
  readStored,
  sidecarPaths,
  slotSwatch,
  writeStored,
} from "./print-model"

describe("sidecarPaths", () => {
  test("names the sidecars off the stem, not off .gcode", () => {
    expect(sidecarPaths("cases/demo/prints/finger.gcode.3mf")).toEqual({
      stats: "cases/demo/prints/finger.stats.json",
      layers: "cases/demo/prints/finger.layers.json",
    })
  })

  test("handles windows separators and a bare filename", () => {
    expect(sidecarPaths("cases\\demo\\prints\\finger.gcode.3mf").stats).toBe("cases/demo/prints/finger.stats.json")
    expect(sidecarPaths("finger.gcode.3mf").layers).toBe("finger.layers.json")
  })
})

describe("plateFor", () => {
  test("dual-nozzle mode narrows the plate", () => {
    expect(plateFor({ use_aux_nozzle: false })).toEqual(PLATE_MM)
    expect(plateFor({ use_aux_nozzle: true })).toEqual(PLATE_AUX_MM)
    expect(plateFor(undefined)).toEqual(PLATE_MM)
  })
})

describe("gateBadge", () => {
  test("a passed gate reads as passed", () => {
    expect(gateBadge({ gate: { passed: true, checks: {} } }).tone).toBe("pass")
  })

  test("a failed gate names the checks that failed", () => {
    const badge = gateBadge({
      gate: {
        passed: false,
        checks: { machine: { passed: false }, plate_fit: { passed: true }, material_fit: { passed: false } },
      },
    })
    expect(badge.tone).toBe("fail")
    expect(badge.detail).toContain("machine")
    expect(badge.detail).toContain("material_fit")
    expect(badge.detail).not.toContain("plate_fit")
  })

  test("a job with no verdict is not silently treated as passing", () => {
    expect(gateBadge({}).tone).toBe("unknown")
    expect(gateBadge(undefined).tone).toBe("unknown")
  })
})

describe("failedChecks", () => {
  test("carries the detail an operator has to read", () => {
    const failures = failedChecks({
      gate: {
        passed: false,
        checks: {
          machine: { passed: false, detail: "sliced for Bambu Lab A1 0.4 nozzle, not the X2D" },
          stats_attached: { passed: true, detail: "40m / 6.47 g" },
        },
      },
    })
    expect(failures).toEqual([{ name: "machine", detail: "sliced for Bambu Lab A1 0.4 nozzle, not the X2D" }])
  })
})

describe("slotSwatch", () => {
  test("uses the tray colour when it is a hex", () => {
    expect(slotSwatch({ slot: 0, type: "PLA", color: "#00AE42", used_g: 1, used_m: 1 })).toBe("#00AE42")
  })

  test("falls back to a visible grey rather than an invalid css colour", () => {
    expect(slotSwatch({ slot: 0, type: "PLA", color: "", used_g: 1, used_m: 1 })).toBe("#7a7a80")
    expect(slotSwatch({ slot: 0, type: "PLA", color: "GFA00", used_g: 1, used_m: 1 })).toBe("#7a7a80")
  })
})

describe("formatGrams", () => {
  test("renders two decimals, and a dash when there is nothing to show", () => {
    expect(formatGrams(6.473)).toBe("6.47 g")
    expect(formatGrams(0)).toBe("—")
    expect(formatGrams(undefined)).toBe("—")
  })
})

describe("initialLayerIndex", () => {
  test("opens on the top layer, which is what gets checked", () => {
    expect(
      initialLayerIndex({
        layer_height_mm: 0.2,
        truncated: false,
        layers: [
          { z: 0.2, paths: [] },
          { z: 0.4, paths: [] },
        ],
      }),
    ).toBe(1)
  })

  test("an empty preview does not produce a negative index", () => {
    expect(initialLayerIndex({ layer_height_mm: 0, truncated: false, layers: [] })).toBe(0)
    expect(initialLayerIndex(undefined)).toBe(0)
  })
})

describe("featureLegend", () => {
  test("names every feature the slicer used, with a distinct colour", () => {
    const legend = featureLegend({
      layer_height_mm: 0.2,
      truncated: false,
      layers: [],
      features: ["Outer wall", "Sparse infill", "Bridge"],
    })
    expect(legend.map((f) => f.name)).toEqual(["Outer wall", "Sparse infill", "Bridge"])
    expect(legend[0].color).toBe(FEATURE_COLORS["Outer wall"])
    expect(new Set(legend.map((f) => f.color)).size).toBe(3)
  })

  test("a user's colour overrides the default", () => {
    const legend = featureLegend(
      { layer_height_mm: 0.2, truncated: false, layers: [], features: ["Outer wall"] },
      { "Outer wall": "#123456" },
    )
    expect(legend[0].color).toBe("#123456")
  })

  test("a feature the table has never seen still gets a colour", () => {
    expect(isValidHex(defaultFeatureColor("Some New Bambu Feature", 0))).toBe(true)
    expect(defaultFeatureColor("A", 0)).not.toBe(defaultFeatureColor("B", 1))
  })

  test("a job with no features listed produces an empty legend, not a crash", () => {
    expect(featureLegend(undefined)).toEqual([])
    expect(featureLegend({ layer_height_mm: 0.2, truncated: false, layers: [] })).toEqual([])
  })
})

describe("clampRange", () => {
  test("keeps the range ordered and inside the job", () => {
    expect(clampRange(10, 40, 100)).toEqual([10, 40])
    expect(clampRange(-5, 500, 100)).toEqual([0, 99])
  })

  test("a bottom above the top collapses to a single layer rather than inverting", () => {
    expect(clampRange(60, 20, 100)).toEqual([20, 20])
  })

  test("an empty job has no range to clamp", () => {
    expect(clampRange(3, 9, 0)).toEqual([0, 0])
  })
})

describe("gateRemediation", () => {
  test("every check gate.py can fail has a next step", () => {
    // The check detail says what is wrong; an operator still needs to know what
    // to do about it. These are the six names print-mcp/gate.py emits.
    for (const name of [
      "slicer_ok",
      "machine",
      "support_strategy",
      "plate_fit",
      "material_fit",
      "stats_attached",
    ]) {
      expect(gateRemediation(name)?.length ?? 0).toBeGreaterThan(20)
    }
  })

  test("the machine failure names the template export that fixes it", () => {
    // The failure a tester hits first: no X2D template exists, so every slice
    // reports the wrong printer. "Reslice with the X2D profile" is not
    // actionable until you know the profile comes from an exported project.
    const fix = gateRemediation("machine")!
    expect(fix).toContain("Bambu Studio")
    expect(fix).toContain("print-templates")
  })

  test("an unknown check yields nothing rather than a guess", () => {
    expect(gateRemediation("something_new")).toBeUndefined()
  })
})

describe("readStored", () => {
  test("round-trips a value", () => {
    writeStored("coder3d-test-key", { "Outer wall": "#ff0000" })
    expect(readStored("coder3d-test-key", {})).toEqual({ "Outer wall": "#ff0000" })
  })

  test("corrupt storage falls back instead of throwing", () => {
    localStorage.setItem("coder3d-test-bad", "{not json")
    expect(readStored("coder3d-test-bad", { a: 1 })).toEqual({ a: 1 })
    expect(readStored("coder3d-test-missing", "fallback")).toBe("fallback")
  })
})
