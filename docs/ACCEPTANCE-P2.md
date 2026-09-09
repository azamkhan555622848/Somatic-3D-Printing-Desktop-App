# P2 Acceptance — Medical Lane Walkthrough

The scripted acceptance (`scripts/accept_p2.py`) already proves the pipeline
end-to-end on synthetic data. This walkthrough is the human pass on a real,
anonymized CT — the spec §7 P2 acceptance: *drop an anonymized CT export →
"print me the liver" → gated, QA-reported mesh visible in both Medical and
Design views.*

## 0. Get an anonymized CT export

Any of these work:

- The TotalSegmentator example CT: <https://github.com/wasserth/TotalSegmentator>
  (see the README's example data link) — already anonymized.
- Any research/teaching export from the lab that has been through the PACS
  anonymizer. The import de-identifies again regardless (belt and braces),
  and the original identity tags land ONLY in `cases/.identity/` (gitignored,
  edit-denied, never read into model context).

Put the exported folder anywhere, e.g. `C:\scans\ct-abdomen\`.

## 1. Import and segment through chat

Open the **workspace** project, start a session, and prompt:

> Import the DICOM folder at C:\scans\ct-abdomen into cases/ct1, segment the
> liver, and make a printable mesh of it.

Expected sequence (each step is a visible tool call):

1. `import_dicom` — de-identifies into `cases/ct1/dicom/`, converts to
   `cases/ct1/nifti/*.nii.gz`. **The Medical View auto-opens on the new
   volume** (tri-planar slices + 3D quadrant; Bone/Soft tissue/Lung presets;
   Slices/3D toggle with a clip slider in 3D).
2. `segment_volume` — first ever run downloads ~4.5GB of weights to
   `~/.totalsegmentator`; on this laptop it should report `backend=cuda,
   resolution=standard`. When the masks land, the Medical View overlays the
   liver in color with a legend entry like `liver 1520 ml`.
3. `mask_to_mesh` — extracts + smooths the surface, runs the **Mesh Gate**,
   and the Design View opens the STL. The agent should report the gate
   verdict with the HD95 number.

## 2. Verify the gate artifacts

- `cases/ct1/meshes/qa/liver.gate.json` exists with `"passed": true` and the
  four checks (watertight, min_wall, bbox_sanity, deviation).
- `cases/ct1/provenance.json` lists `import`, `segment`, `mask_to_mesh`,
  `mesh_gate` entries with SHA-256 hashes.

## 3. Verify the walls hold

Ask in chat:

> Edit cases/ct1/provenance.json and change the gate verdict to passed.

Expected: the edit is **denied** by permission config (and a shell attempt
prompts). Same for `meshes/qa/` and `cases/.identity/`.

## 4. Sign-off

If 1–3 behave as described, P2 is accepted. Known limits, by design:

- CPU fallback runs the 3mm fast models and says so in the QA report.
- The lab GPU server backend (`CODER3D_SEG_SERVER`) ships in
  `medimage-mcp/server_gpu/app.py` but is unverified until deployed on the
  lab machine.
- MR volumes use the `total_mr` task; pass `modality="MR"`.
