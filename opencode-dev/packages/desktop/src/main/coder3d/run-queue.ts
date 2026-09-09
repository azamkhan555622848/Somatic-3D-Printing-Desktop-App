// One build at a time. The parameter sidebar, the file watcher, and (in
// another process) the agent's cad_run tool all write the same case; two of
// those live here, so they share this queue. Requests for a key that is
// already waiting collapse into the newest one — a burst of edits should
// produce the final geometry, not a queue of stale builds.
export type RunQueue<Req, Res> = {
  submit(key: string, request: Req): Promise<Res>
}

export function createRunQueue<Req, Res>(run: (key: string, request: Req) => Promise<Res>): RunQueue<Req, Res> {
  type Waiting = {
    request: Req
    resolvers: Array<(value: Res) => void>
    rejecters: Array<(reason: unknown) => void>
  }
  const waiting = new Map<string, Waiting>()
  let draining = false

  async function drain() {
    if (draining) return
    draining = true
    try {
      while (waiting.size > 0) {
        const [key, entry] = waiting.entries().next().value as [string, Waiting]
        waiting.delete(key)
        try {
          const result = await run(key, entry.request)
          for (const resolve of entry.resolvers) resolve(result)
        } catch (error) {
          for (const reject of entry.rejecters) reject(error)
        }
      }
    } finally {
      draining = false
    }
  }

  return {
    submit(key, request) {
      return new Promise<Res>((resolve, reject) => {
        const entry = waiting.get(key)
        if (entry) {
          entry.request = request // newest request wins
          entry.resolvers.push(resolve)
          entry.rejecters.push(reject)
        } else {
          waiting.set(key, { request, resolvers: [resolve], rejecters: [reject] })
        }
        void drain()
      })
    },
  }
}
