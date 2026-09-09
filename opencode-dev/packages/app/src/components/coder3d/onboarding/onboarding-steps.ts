/**
 * The first-run flow's shape, kept apart from its JSX so the ordering rules can
 * be tested without a DOM. Same split as panel-mode.ts beside the launcher.
 *
 * Two halves. The welcome screens are read in a card before anything is
 * touched; the tour then points at the real interface, one element at a time.
 * A tour stop whose anchor is not on screen (the preview panel closed, say) is
 * dropped rather than pointed at nothing.
 */

export type WelcomeSlide = "welcome" | "path" | "agent" | "gate"

export const WELCOME_SLIDES: WelcomeSlide[] = ["welcome", "path", "agent", "gate"]

export type TourStop = {
  id: string
  /** Matches a `data-tour` attribute on the element the stop points at. */
  anchor: string
  title: string
  body: string
  /** Which side of the anchor the callout prefers; it flips if there is no room. */
  side: "right" | "left" | "top" | "bottom"
}

export const TOUR_STOPS: TourStop[] = [
  {
    id: "sessions",
    anchor: "sessions",
    title: "Every session is its own conversation",
    body: "Start one per part or per case. Opening a different folder starts a fresh one, and the history comes back when you return.",
    side: "right",
  },
  {
    id: "agent",
    anchor: "agent",
    title: "Your agent and model",
    body: "Switch between Claude Code and Codex and pick the model and reasoning effort. The dot is live: teal means it can take a turn now, amber means sign in, red means it is not installed.",
    side: "bottom",
  },
  {
    id: "composer",
    anchor: "composer",
    title: "Ask in plain words",
    body: "Describe the part, the change, or the check you want. The paperclip attaches a scan, a photo, or a reference. Shift+Enter adds a line.",
    side: "top",
  },
  {
    id: "views",
    anchor: "views",
    title: "Four views, one case",
    body: "Medical for the scan, Design for the part, Print for the sliced job and its gate, Files for everything in the workspace. Whatever you open, every view shows that same case.",
    side: "bottom",
  },
  {
    id: "quickstart",
    anchor: "quickstart",
    title: "Try it on the demo scan",
    body: "A synthetic case ships with Somatic. It runs the whole path from scan to gate without touching patient data, so it is the safe place to learn.",
    side: "left",
  },
]

/** The stops whose anchors are actually on screen, in tour order. */
export function visibleStops(present: (anchor: string) => boolean, stops: TourStop[] = TOUR_STOPS): TourStop[] {
  return stops.filter((stop) => present(stop.anchor))
}

/** The next slide, or undefined when the welcome screens are over. */
export function nextSlide(current: WelcomeSlide): WelcomeSlide | undefined {
  return WELCOME_SLIDES[WELCOME_SLIDES.indexOf(current) + 1]
}

export function prevSlide(current: WelcomeSlide): WelcomeSlide | undefined {
  const index = WELCOME_SLIDES.indexOf(current)
  return index > 0 ? WELCOME_SLIDES[index - 1] : undefined
}

/**
 * Seen-state. Versioned so a future tour with new stops can show itself once
 * more to people who finished this one; bump ONBOARDING_VERSION when the
 * stops change materially, not for copy edits.
 */
export const ONBOARDING_KEY = "somatic-onboarding-seen"
export const ONBOARDING_VERSION = 1

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">

export function hasSeenOnboarding(storage: Storage | undefined): boolean {
  try {
    const raw = storage?.getItem(ONBOARDING_KEY)
    return raw !== null && raw !== undefined && Number(raw) >= ONBOARDING_VERSION
  } catch {
    // Storage unavailable (private mode, blocked): do not loop the tour on
    // every launch — treat it as seen and let the launcher's link re-open it.
    return true
  }
}

export function markOnboardingSeen(storage: Storage | undefined): void {
  try {
    storage?.setItem(ONBOARDING_KEY, String(ONBOARDING_VERSION))
  } catch {
    // Nothing to do; the next launch will offer it again.
  }
}

/** The custom event the launcher's "Show me around" link dispatches. */
export const TOUR_EVENT = "somatic:tour"
