import { describe, expect, test } from "bun:test"
import {
  ONBOARDING_KEY,
  ONBOARDING_VERSION,
  TOUR_STOPS,
  WELCOME_SLIDES,
  hasSeenOnboarding,
  markOnboardingSeen,
  nextSlide,
  prevSlide,
  visibleStops,
} from "./onboarding-steps"

const memory = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

describe("welcome slides", () => {
  test("run in order and end", () => {
    expect(nextSlide("welcome")).toBe("path")
    expect(nextSlide("gate")).toBeUndefined()
    expect(prevSlide("welcome")).toBeUndefined()
    expect(prevSlide("path")).toBe("welcome")
    expect(WELCOME_SLIDES[0]).toBe("welcome")
  })
})

describe("tour stops", () => {
  test("a stop whose anchor is off screen is dropped, order kept", () => {
    // The preview panel closed takes the views bar and quick start with it;
    // the tour must not point at nothing.
    const ids = visibleStops((a) => a !== "views" && a !== "quickstart").map((s) => s.id)
    expect(ids).toEqual(["sessions", "agent", "composer"])
  })

  test("every stop has a distinct anchor and copy that reads as a sentence", () => {
    const anchors = new Set(TOUR_STOPS.map((s) => s.anchor))
    expect(anchors.size).toBe(TOUR_STOPS.length)
    for (const stop of TOUR_STOPS) expect(stop.body.endsWith(".")).toBe(true)
  })
})

describe("seen state", () => {
  test("unseen until marked, then seen at this version", () => {
    const s = memory()
    expect(hasSeenOnboarding(s)).toBe(false)
    markOnboardingSeen(s)
    expect(s.getItem(ONBOARDING_KEY)).toBe(String(ONBOARDING_VERSION))
    expect(hasSeenOnboarding(s)).toBe(true)
  })

  test("an older version counts as unseen, so a bigger tour shows once more", () => {
    const s = memory()
    s.setItem(ONBOARDING_KEY, String(ONBOARDING_VERSION - 1))
    expect(hasSeenOnboarding(s)).toBe(false)
  })

  test("unavailable storage never loops the tour on every launch", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    }
    expect(hasSeenOnboarding(broken)).toBe(true)
    expect(() => markOnboardingSeen(broken)).not.toThrow()
    expect(hasSeenOnboarding(undefined)).toBe(false)
  })
})
