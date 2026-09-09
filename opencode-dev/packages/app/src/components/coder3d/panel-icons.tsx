// The shared v2 icon set has `expand`/`collapse`, but those are vertical arrows — they
// read as "expand this row", not "make this panel take over the window". The diagonal
// pair below is the maximize/restore idiom. They live here rather than in packages/ui
// because that package is vendor code an upstream merge would overwrite.
// (3D-Coder vendor code, verbatim port of Paperino's panel-icons.tsx.)

type Props = { class?: string }

export function ExpandDiagonalIcon(props: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <polyline points="14 4 20 4 20 10" />
      <polyline points="10 20 4 20 4 14" />
      <line x1="20" y1="4" x2="13" y2="11" />
      <line x1="4" y1="20" x2="11" y2="13" />
    </svg>
  )
}

export function CollapseDiagonalIcon(props: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <polyline points="20 10 14 10 14 4" />
      <polyline points="4 14 10 14 10 20" />
      <line x1="13" y1="11" x2="20" y2="4" />
      <line x1="11" y1="13" x2="4" y2="20" />
    </svg>
  )
}

// Mode icons for the launcher and header strip. Medical = scan crosshair,
// Design = isometric cube, Print = printer gantry over a bed.

export function MedicalViewIcon(props: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <line x1="12" y1="9" x2="12" y2="15" />
      <line x1="9" y1="12" x2="15" y2="12" />
    </svg>
  )
}

export function DesignViewIcon(props: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <polyline points="4 7.5 12 12 20 7.5" />
      <line x1="12" y1="12" x2="12" y2="21" />
    </svg>
  )
}

export function PrintViewIcon(props: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <path d="M4 4h16" />
      <path d="M4 4v16h16V4" />
      <path d="M12 4v4" />
      <path d="M10 8h4l-2 3-2-3z" />
      <path d="M7 17h10" />
    </svg>
  )
}

// The composer's attach glyph. The shared v2 map only has `image-plus`, which
// reads as "insert a picture"; a paperclip is the universal "attach a file".
export function PaperclipIcon(props: Props) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <path d="M11.5 6.5 6.7 11.3a1.9 1.9 0 0 1-2.7-2.7l5.2-5.2a3.1 3.1 0 0 1 4.4 4.4l-5.2 5.2a4.3 4.3 0 0 1-6.1-6.1L7 1.9" />
    </svg>
  )
}

// The composer's interrupt glyph. opencode's prompt uses an icon named "stop"
// from its own set; the shared v2 icon map here has no such entry, so the
// filled square — the universal stop mark — is drawn locally.
export function StopIcon(props: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" class={props.class} aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1" />
    </svg>
  )
}

// Marks the "Open in Blender" action. Deliberately NOT Blender's logo (their
// trademark) — a wireframe sphere in Blender orange reads as "the mesh editor"
// beside the label without pretending to be their brand mark.
export function BlenderIcon(props: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" class={props.class} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="#E87D0D" stroke-width="1.6" />
      <ellipse cx="12" cy="12" rx="8.5" ry="3.4" stroke="#E87D0D" stroke-width="1.6" />
      <path d="M12 3.5v17" stroke="#E87D0D" stroke-width="1.6" />
    </svg>
  )
}

// Marks the "Open in FreeCAD" action. Deliberately NOT FreeCAD's gear logo
// (their trademark) — a plain six-tooth gear in FreeCAD red reads as "the CAD
// app" beside the label without copying their mark.
export function FreeCADIcon(props: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" class={props.class} aria-hidden="true">
      <circle cx="12" cy="12" r="6" stroke="#CB333B" stroke-width="1.6" />
      <circle cx="12" cy="12" r="2" stroke="#CB333B" stroke-width="1.6" />
      <path
        d="M12 6V3M12 21v-3M6.8 8.4 4.7 6.3M19.3 17.7l-2.1-2.1M6 12H3M21 12h-3M6.8 15.6l-2.1 2.1M19.3 6.3l-2.1 2.1"
        stroke="#CB333B"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
  )
}

// Marks the "Open in Bambu Studio" action. Deliberately NOT Bambu's own logo —
// that is their trademark and we do not ship their asset. It is a green cube on
// a plate, which reads as "the slicer" beside the label without pretending to
// be their brand mark.
export function BambuStudioIcon(props: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" class={props.class} aria-hidden="true">
      <path
        d="M12 3.2 19 7v10l-7 3.8L5 17V7l7-3.8z"
        stroke="#00AE42"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      <path d="M5 7l7 3.8L19 7" stroke="#00AE42" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M12 10.8V20.8" stroke="#00AE42" stroke-width="1.6" stroke-linejoin="round" />
    </svg>
  )
}
