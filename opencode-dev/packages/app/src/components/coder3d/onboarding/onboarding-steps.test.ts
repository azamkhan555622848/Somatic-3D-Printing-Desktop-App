import { describe, expect, test } from "bun:test"
import {
  ONBOARDING_KEY,
  ONBOARDING_VERSION,
  SLIDES,
  TOUR_STOPS,
  WELCOME_SLIDES,
  slideCopy,
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

describe("welcome slide copy", () => {
  test("every slide in the flow has copy, in the same order", () => {
    expect(SLIDES.map((s) => s.id)).toEqual(WELCOME_SLIDES)
    for (const id of WELCOME_SLIDES) expect(slideCopy(id).id).toBe(id)
  })

  test("no two screens read the same", () => {
    // The card once rendered a switch inside a SolidJS component body, which
    // runs once, so every Next redrew the first screen. Distinct headlines are
    // what makes that visible if the copy is ever duplicated by hand.
    const headlines = SLIDES.map((s) => s.headline)
    expect(new Set(headlines).size).toBe(headlines.length)
    const first = SLIDES.map((s) => s.body[0])
    expect(new Set(first).size).toBe(first.length)
  })

  test("each screen says something, and any muted paragraph exists", () => {
    for (const slide of SLIDES) {
      expect(slide.headline.length).toBeGreaterThan(0)
      expect(slide.body.length).toBeGreaterThan(0)
      for (const paragraph of slide.body) expect(paragraph.trim().endsWith(".")).toBe(true)
      if (slide.muted !== undefined) expect(slide.body[slide.muted]).toBeDefined()
    }
  })

  test("an unknown slide is a loud failure, not a blank card", () => {
    expect(() => slideCopy("nope" as never)).toThrow()
  })
})
