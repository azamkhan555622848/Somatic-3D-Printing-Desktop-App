import { describe, expect, test } from "bun:test"
import { createRunQueue } from "./run-queue"

const defer = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe("createRunQueue", () => {
  test("runs never overlap, even across different keys", async () => {
    let active = 0
    let maxActive = 0
    const queue = createRunQueue(async (_key: string, _req: number) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return "done"
    })
    await Promise.all([
      queue.submit("a.py", 1),
      queue.submit("b.py", 2),
      queue.submit("c.py", 3),
    ])
    // The three writers of a case are separate processes; in-process we at
    // least guarantee one python build at a time.
    expect(maxActive).toBe(1)
  })

  test("a request arriving mid-run is coalesced, last one wins", async () => {
    const seen: number[] = []
    const gate = defer<void>()
    const queue = createRunQueue(async (_key: string, req: number) => {
      seen.push(req)
      if (seen.length === 1) await gate.promise
      return "done"
    })
    const first = queue.submit("a.py", 1)
    const second = queue.submit("a.py", 2) // queued behind the running one
    const third = queue.submit("a.py", 3) // replaces the queued request
    gate.resolve()
    await Promise.all([first, second, third])
    expect(seen).toEqual([1, 3])
  })

  test("every waiter for a coalesced request gets the result", async () => {
    const gate = defer<void>()
    const queue = createRunQueue(async (_key: string, req: string) => {
      if (req === "first") await gate.promise
      return `ran ${req}`
    })
    const first = queue.submit("a.py", "first") // occupies the runner
    const [a, b] = [queue.submit("a.py", "x"), queue.submit("a.py", "y")] // both wait, y wins
    gate.resolve()
    expect(await first).toBe("ran first")
    expect(await a).toBe("ran y")
    expect(await b).toBe("ran y")
  })

  test("a failing run does not wedge the queue", async () => {
    const queue = createRunQueue(async (_key: string, req: number) => {
      if (req === 1) throw new Error("boom")
      return "ok"
    })
    await expect(queue.submit("a.py", 1)).rejects.toThrow("boom")
    expect(await queue.submit("a.py", 2)).toBe("ok")
  })
})
