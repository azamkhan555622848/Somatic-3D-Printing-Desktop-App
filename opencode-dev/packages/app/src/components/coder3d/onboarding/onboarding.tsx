import { For, Show, createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import {
  TOUR_EVENT,
  WELCOME_SLIDES,
  hasSeenOnboarding,
  markOnboardingSeen,
  nextSlide,
  prevSlide,
  visibleStops,
  type TourStop,
  type WelcomeSlide,
} from "./onboarding-steps"

/**
 * First-run onboarding: four welcome screens in a glass card, then a spotlight
 * tour that points at the real interface. Shown once (versioned, see
 * onboarding-steps.ts) and again on demand from the launcher's link.
 *
 * Styling is plain CSS over the theme's own custom properties rather than
 * Tailwind utilities: the glass needs color-mix() against --background-* so it
 * is right in both schemes, and the spotlight is a box-shadow cut-out that no
 * utility expresses. Vignettes are code-drawn, never screenshots, so they
 * follow the theme and cannot go stale.
 */

type Phase = "hidden" | "welcome" | "tour"

const storage = () => (typeof localStorage === "undefined" ? undefined : localStorage)

const anchorEl = (anchor: string) => document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`)

// Spotlight padding around the anchor, and the gap between anchor and callout.
const PAD = 6
const GAP = 14
const CALLOUT_W = 320

type Rect = { top: number; left: number; width: number; height: number }

function measure(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect()
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
}

/** Where the callout goes for a stop: the preferred side, flipped when it would leave the viewport. */
function place(rect: Rect, side: TourStop["side"], calloutH: number): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clampX = (x: number) => Math.min(Math.max(12, x), vw - CALLOUT_W - 12)
  const clampY = (y: number) => Math.min(Math.max(12, y), vh - calloutH - 12)
  const centerX = rect.left + rect.width / 2 - CALLOUT_W / 2
  const centerY = rect.top + rect.height / 2 - calloutH / 2
  const fits = {
    right: rect.left + rect.width + GAP + CALLOUT_W <= vw - 12,
    left: rect.left - GAP - CALLOUT_W >= 12,
    bottom: rect.top + rect.height + GAP + calloutH <= vh - 12,
    top: rect.top - GAP - calloutH >= 12,
  }
  const order: TourStop["side"][] = [side, ...(["right", "left", "bottom", "top"] as const).filter((s) => s !== side)]
  const chosen = order.find((s) => fits[s]) ?? side
  switch (chosen) {
    case "right":
      return { top: clampY(centerY), left: clampX(rect.left + rect.width + GAP) }
    case "left":
      return { top: clampY(centerY), left: clampX(rect.left - GAP - CALLOUT_W) }
    case "bottom":
      return { top: clampY(rect.top + rect.height + GAP), left: clampX(centerX) }
    case "top":
      return { top: clampY(rect.top - GAP - calloutH), left: clampX(centerX) }
  }
}

export function Onboarding() {
  const [phase, setPhase] = createSignal<Phase>("hidden")
  const [slide, setSlide] = createSignal<WelcomeSlide>("welcome")
  const [stops, setStops] = createSignal<TourStop[]>([])
  const [index, setIndex] = createSignal(0)
  const [rect, setRect] = createSignal<Rect | undefined>()
  const [calloutH, setCalloutH] = createSignal(160)
  let calloutEl: HTMLDivElement | undefined
  let primaryEl: HTMLButtonElement | undefined

  const stop = () => stops()[index()]

  const begin = () => {
    setSlide("welcome")
    setPhase("welcome")
  }

  const finish = () => {
    markOnboardingSeen(storage())
    setPhase("hidden")
  }

  const startTour = () => {
    const visible = visibleStops((anchor) => anchorEl(anchor) !== null)
    if (visible.length === 0) return finish()
    setStops(visible)
    setIndex(0)
    setPhase("tour")
  }

  const nextStop = () => {
    if (index() + 1 >= stops().length) return finish()
    setIndex(index() + 1)
  }

  const prevStop = () => setIndex(Math.max(0, index() - 1))

  onMount(() => {
    // Let the first paint settle so the card does not fight the app's own
    // mount; a beat of the real interface first also makes the tour make sense.
    const timer = setTimeout(() => {
      if (!hasSeenOnboarding(storage())) begin()
    }, 700)
    const onTour = () => begin()
    window.addEventListener(TOUR_EVENT, onTour)
    onCleanup(() => {
      clearTimeout(timer)
      window.removeEventListener(TOUR_EVENT, onTour)
    })
  })

  // Follow the anchor while the tour is open: layout can shift under it (a
  // panel resizing, the window changing size), so re-measure on those and on
  // a slow tick as a backstop. Only while a stop is on screen.
  createEffect(() => {
    if (phase() !== "tour") return
    const current = stop()
    if (!current) return
    const el = anchorEl(current.anchor)
    if (!el) return nextStop()
    el.scrollIntoView({ block: "nearest", inline: "nearest" })
    const update = () => {
      setRect(measure(el))
      if (calloutEl) setCalloutH(calloutEl.offsetHeight)
    }
    update()
    requestAnimationFrame(update)
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    const tick = setInterval(update, 300)
    onCleanup(() => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
      clearInterval(tick)
    })
  })

  // Keyboard: Escape leaves, arrows and Enter move. Bound only while shown.
  createEffect(() => {
    if (phase() === "hidden") return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        finish()
      } else if (event.key === "ArrowRight" || event.key === "Enter") {
        if (event.target instanceof HTMLTextAreaElement) return
        event.preventDefault()
        if (phase() === "welcome") {
          const n = nextSlide(slide())
          n ? setSlide(n) : startTour()
        } else nextStop()
      } else if (event.key === "ArrowLeft") {
        event.preventDefault()
        if (phase() === "welcome") {
          const p = prevSlide(slide())
          if (p) setSlide(p)
        } else prevStop()
      }
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  // Keep focus on the primary action so Enter/Space keep working after a click.
  createEffect(() => {
    phase()
    slide()
    index()
    requestAnimationFrame(() => primaryEl?.focus({ preventScroll: true }))
  })

  const position = () => {
    const r = rect()
    const s = stop()
    if (!r || !s) return { top: 0, left: 0 }
    return place(r, s.side, calloutH())
  }

  return (
    <Show when={phase() !== "hidden"}>
      <Portal>
        <Style />
        <Show when={phase() === "welcome"}>
          <div class="so-backdrop" role="presentation">
            <div
              class="so-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="so-headline"
              data-slide={slide()}
            >
              <div class="so-enter" data-key={slide()}>
                <Slide id={slide()} />
              </div>
              <div class="so-footer">
                <Dots count={WELCOME_SLIDES.length} current={WELCOME_SLIDES.indexOf(slide())} />
                <div class="so-actions">
                  <Show
                    when={nextSlide(slide())}
                    fallback={
                      <>
                        <button type="button" class="so-btn so-btn-quiet" onClick={finish}>
                          Start without the tour
                        </button>
                        <button type="button" class="so-btn so-btn-primary" ref={primaryEl} onClick={startTour}>
                          Show me around
                        </button>
                      </>
                    }
                  >
                    <button type="button" class="so-btn so-btn-quiet" onClick={finish}>
                      Skip
                    </button>
                    <Show when={prevSlide(slide())}>
                      <button type="button" class="so-btn" onClick={() => setSlide(prevSlide(slide())!)}>
                        Back
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="so-btn so-btn-primary"
                      ref={primaryEl}
                      onClick={() => setSlide(nextSlide(slide())!)}
                    >
                      Next
                    </button>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={phase() === "tour" && rect() && stop()}>
          <div class="so-tour" role="presentation">
            <div
              class="so-spot"
              style={{
                top: `${rect()!.top}px`,
                left: `${rect()!.left}px`,
                width: `${rect()!.width}px`,
                height: `${rect()!.height}px`,
              }}
            />
            <div
              ref={calloutEl}
              class="so-callout so-enter"
              data-key={stop()!.id}
              role="dialog"
              aria-modal="true"
              aria-labelledby="so-stop-title"
              style={{ top: `${position().top}px`, left: `${position().left}px`, width: `${CALLOUT_W}px` }}
            >
              <div class="so-stop-count">
                {index() + 1} of {stops().length}
              </div>
              <div id="so-stop-title" class="so-stop-title">
                {stop()!.title}
              </div>
              <div class="so-stop-body">{stop()!.body}</div>
              <div class="so-actions so-actions-tour">
                <button type="button" class="so-btn so-btn-quiet" onClick={finish}>
                  {index() + 1 >= stops().length ? "Done" : "Skip tour"}
                </button>
                <span class="so-spacer" />
                <Show when={index() > 0}>
                  <button type="button" class="so-btn" onClick={prevStop}>
                    Back
                  </button>
                </Show>
                <button type="button" class="so-btn so-btn-primary" ref={primaryEl} onClick={nextStop}>
                  {index() + 1 >= stops().length ? "Finish" : "Next"}
                </button>
              </div>
            </div>
          </div>
        </Show>
      </Portal>
    </Show>
  )
}

function Dots(props: { count: number; current: number }) {
  return (
    <div class="so-dots" role="img" aria-label={`Screen ${props.current + 1} of ${props.count}`}>
      <For each={Array.from({ length: props.count })}>
        {(_, i) => (
          <span
            class="so-dot"
            data-active={i() === props.current ? "" : undefined}
            data-done={i() < props.current ? "" : undefined}
          />
        )}
      </For>
    </div>
  )
}

function Slide(props: { id: WelcomeSlide }) {
  switch (props.id) {
    case "welcome":
      return (
        <SlideFrame vignette={<MarkVignette />} headline="Welcome to Somatic">
          <p>
            From a patient scan to a part that is safe to print, in one window. Import the scan, build the part as
            CAD, check the mesh, slice it, and pass the Print Gate before anything reaches the printer.
          </p>
          <p class="so-muted">This is an alpha for the lab. Nothing it produces is a medical device.</p>
        </SlideFrame>
      )
    case "path":
      return (
        <SlideFrame vignette={<PathVignette />} headline="One path, four views">
          <p>
            Medical reads the scan and segments it. Design builds and inspects the part. Print slices it and runs the
            gate. Files holds every case.
          </p>
          <p>Open anything from Files and every view follows that case, never a mix of two.</p>
        </SlideFrame>
      )
    case "agent":
      return (
        <SlideFrame vignette={<AgentVignette />} headline="It runs on your own agent">
          <p>
            Somatic drives the Claude Code or Codex you already have, on your own subscription. The vendor's app stays
            the one that is signed in, and turns bill to your account. Somatic keeps no credentials.
          </p>
          <p>If one is missing or signed out, the chat says which and what to run.</p>
        </SlideFrame>
      )
    case "gate":
      return (
        <SlideFrame vignette={<GateVignette />} headline="The gate says no before the printer does">
          <p>
            A job passes six checks before it can be sent: watertight, wall thickness, fits the bed, the right machine
            profile, supports, and provenance. A failed check names the fix.
          </p>
          <p class="so-muted">Patient data stays in the lab. Only the synthetic demo case is ever shared.</p>
        </SlideFrame>
      )
  }
}

function SlideFrame(props: { vignette: JSX.Element; headline: string; children: JSX.Element }) {
  return (
    <div class="so-slide">
      <div class="so-vignette">{props.vignette}</div>
      <div id="so-headline" class="so-headline">
        {props.headline}
      </div>
      <div class="so-copy">{props.children}</div>
    </div>
  )
}

/* ---- Vignettes: drawn in code so they follow the theme. ------------------ */

/** The Somatic mark: stacked slices, the way a scan and a print are both built. */
function MarkVignette() {
  const slices = [
    { w: 44, y: 14 },
    { w: 64, y: 30 },
    { w: 76, y: 46 },
    { w: 64, y: 62 },
    { w: 44, y: 78 },
  ]
  return (
    <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
      <For each={slices}>
        {(s, i) => (
          <rect
            x={48 - s.w / 2}
            y={s.y}
            width={s.w}
            height={9}
            rx={4.5}
            class="so-mark-slice"
            style={{ "animation-delay": `${i() * 70}ms` }}
          />
        )}
      </For>
    </svg>
  )
}

/** Scan → Design → Print → Files, one line through four tiles. */
function PathVignette() {
  const tiles = ["Medical", "Design", "Print", "Files"]
  return (
    <div class="so-path" aria-hidden="true">
      <div class="so-path-line" />
      <For each={tiles}>
        {(label, i) => (
          <div class="so-tile" data-lit={i() < 3 ? "" : undefined}>
            <span class="so-tile-dot" />
            <span>{label}</span>
          </div>
        )}
      </For>
    </div>
  )
}

/** Two agent chips with the same live dot the header uses. */
function AgentVignette() {
  return (
    <div class="so-agents" aria-hidden="true">
      <div class="so-chip" data-active="">
        <span class="so-status" data-tone="ok" />
        Claude Code
        <span class="so-chip-sub">Opus 5 · high</span>
      </div>
      <div class="so-chip">
        <span class="so-status" data-tone="ok" />
        Codex
        <span class="so-chip-sub">gpt-6-astra</span>
      </div>
    </div>
  )
}

/** A gate report: two rows pass, one names its fix. */
function GateVignette() {
  return (
    <div class="so-gate" aria-hidden="true">
      <div class="so-gate-title">Print Gate</div>
      <div class="so-gate-row" data-ok="">
        <span class="so-gate-mark">✓</span>watertight
      </div>
      <div class="so-gate-row" data-ok="">
        <span class="so-gate-mark">✓</span>wall thickness ≥ 1.2 mm
      </div>
      <div class="so-gate-row" data-fail="">
        <span class="so-gate-mark">✕</span>machine · sliced for A1, reslice for X2D
      </div>
    </div>
  )
}

/* ---- Styles ---------------------------------------------------------------- */

function Style() {
  return (
    <style>{`
      .so-backdrop {
        position: fixed; inset: 0; z-index: 1000;
        display: flex; align-items: center; justify-content: center;
        background: color-mix(in srgb, var(--background-base) 55%, transparent);
        backdrop-filter: blur(10px);
        padding: 24px;
      }
      .so-card {
        width: min(460px, 100%);
        background: color-mix(in srgb, var(--background-strong) 84%, transparent);
        backdrop-filter: blur(28px) saturate(140%);
        border: 1px solid color-mix(in srgb, var(--border-weak-base) 60%, transparent);
        border-radius: 16px;
        box-shadow:
          0 24px 80px -24px rgba(0, 0, 0, 0.45),
          inset 0 1px 0 color-mix(in srgb, var(--background-stronger) 50%, transparent);
        padding: 22px 22px 18px;
        display: flex; flex-direction: column; gap: 18px;
        color: var(--text-base);
      }
      .so-enter { animation: so-enter 180ms ease-out; }
      @keyframes so-enter {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: none; }
      }
      .so-slide { display: flex; flex-direction: column; gap: 14px; }
      .so-vignette {
        display: flex; align-items: center; justify-content: center;
        height: 140px; border-radius: 12px; overflow: hidden;
        background: var(--surface-inset-base);
        border: 1px solid color-mix(in srgb, var(--border-weak-base) 70%, transparent);
      }
      .so-headline { font-size: 18px; font-weight: 600; letter-spacing: -0.014em; line-height: 1.25; }
      .so-copy { display: flex; flex-direction: column; gap: 8px; font-size: 14px; line-height: 1.5; color: var(--text-weak); }
      .so-copy p { margin: 0; }
      .so-muted { opacity: 0.75; }

      .so-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .so-dots { display: flex; align-items: center; gap: 6px; color: var(--text-weak); }
      .so-dot {
        width: 6px; height: 6px; border-radius: 999px; background: currentColor; opacity: 0.25;
        transition: width 160ms ease, opacity 160ms ease;
      }
      .so-dot[data-active] { width: 18px; opacity: 0.9; background: #2dd4bf; }
      .so-dot[data-done] { opacity: 0.55; }

      .so-actions { display: flex; align-items: center; gap: 6px; }
      .so-actions-tour { margin-top: 4px; }
      .so-spacer { flex: 1; }
      .so-btn {
        font: inherit; font-size: 13px; line-height: 1; padding: 8px 12px; border-radius: 8px;
        border: 1px solid color-mix(in srgb, var(--border-weak-base) 80%, transparent);
        background: var(--background-stronger); color: var(--text-base); cursor: pointer;
      }
      .so-btn:hover { background: var(--background-strongest, var(--background-stronger)); }
      .so-btn:focus-visible { outline: 2px solid #2dd4bf; outline-offset: 2px; }
      .so-btn-quiet { border-color: transparent; background: transparent; color: var(--text-weak); }
      .so-btn-quiet:hover { color: var(--text-base); background: transparent; }
      .so-btn-primary { background: #14b8a6; border-color: #14b8a6; color: #04201c; font-weight: 600; }
      .so-btn-primary:hover { background: #2dd4bf; border-color: #2dd4bf; }

      /* Vignettes */
      .so-mark-slice { fill: #2dd4bf; opacity: 0; animation: so-slice 320ms ease-out forwards; }
      .so-mark-slice:nth-child(2n) { fill: color-mix(in srgb, #2dd4bf 70%, var(--text-base)); }
      @keyframes so-slice { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

      .so-path { position: relative; display: flex; gap: 10px; padding: 0 14px; width: 100%; justify-content: center; }
      .so-path-line {
        position: absolute; left: 32px; right: 32px; top: 50%; height: 2px;
        background: linear-gradient(90deg, #2dd4bf 0 70%, var(--border-base, var(--border-weak-base)) 70%);
      }
      .so-tile {
        position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px;
        min-width: 66px; padding: 10px 8px; border-radius: 10px; font-size: 11px;
        background: var(--background-stronger); border: 1px solid var(--border-weak-base); color: var(--text-weak);
      }
      .so-tile[data-lit] { color: var(--text-base); border-color: color-mix(in srgb, #2dd4bf 45%, var(--border-weak-base)); }
      .so-tile-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--border-base, var(--border-weak-base)); }
      .so-tile[data-lit] .so-tile-dot { background: #2dd4bf; }

      .so-agents { display: flex; gap: 10px; }
      .so-chip {
        display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 10px; font-size: 13px;
        background: var(--background-stronger); border: 1px solid var(--border-weak-base); color: var(--text-base);
      }
      .so-chip[data-active] { border-color: color-mix(in srgb, #2dd4bf 60%, var(--border-weak-base)); }
      .so-chip-sub { font-size: 11px; color: var(--text-weak); }
      .so-status { width: 7px; height: 7px; border-radius: 999px; }
      .so-status[data-tone="ok"] { background: #2dd4bf; }

      .so-gate {
        width: 250px; padding: 10px 12px; border-radius: 10px; font-size: 12px;
        background: var(--background-stronger); border: 1px solid var(--border-weak-base); color: var(--text-base);
        display: flex; flex-direction: column; gap: 5px;
      }
      .so-gate-title { font-weight: 600; margin-bottom: 2px; }
      .so-gate-row { display: flex; align-items: center; gap: 8px; color: var(--text-weak); }
      .so-gate-row[data-fail] { color: #f59e0b; }
      .so-gate-mark { width: 14px; text-align: center; }
      .so-gate-row[data-ok] .so-gate-mark { color: #2dd4bf; }

      /* Spotlight tour */
      .so-tour { position: fixed; inset: 0; z-index: 1000; pointer-events: none; }
      .so-spot {
        position: fixed; border-radius: 10px;
        box-shadow: 0 0 0 9999px color-mix(in srgb, var(--background-base) 62%, transparent), 0 0 0 2px #2dd4bf;
        transition: top 160ms ease, left 160ms ease, width 160ms ease, height 160ms ease;
      }
      .so-callout {
        position: fixed; pointer-events: auto;
        background: color-mix(in srgb, var(--background-strong) 92%, transparent);
        backdrop-filter: blur(20px) saturate(140%);
        border: 1px solid color-mix(in srgb, var(--border-weak-base) 70%, transparent);
        border-radius: 12px; padding: 14px 16px 12px;
        box-shadow: 0 18px 60px -20px rgba(0, 0, 0, 0.5);
        display: flex; flex-direction: column; gap: 6px; color: var(--text-base);
        transition: top 160ms ease, left 160ms ease;
      }
      .so-stop-count { font-size: 11px; color: var(--text-weak); }
      .so-stop-title { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
      .so-stop-body { font-size: 13px; line-height: 1.5; color: var(--text-weak); }

      @media (prefers-reduced-motion: reduce) {
        .so-enter, .so-mark-slice { animation: none; opacity: 1; }
        .so-dot, .so-spot, .so-callout { transition: none; }
      }
    `}</style>
  )
}
