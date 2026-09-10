#!/usr/bin/env bun
import { $ } from "bun"

import { downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`
// The Python tool servers and uv. The app builds their environments itself
// on first launch; only the source ships.
await $`bun ./scripts/copy-tools.ts`

await $`cd ../opencode && bun script/build-node.ts`
if (channel === "dev") await downloadCliToResources()
