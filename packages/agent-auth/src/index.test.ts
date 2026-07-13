import { describe, expect, it, vi } from "vitest"

import {
  createToolRouteHandler,
  evaluateApiToken,
  generateApiToken,
  hashApiToken,
  isApiTokenFormat,
  type ApiTokenRow,
} from "./index"

const PREFIX = "metis_sk_"

describe("token primitives", () => {
  it("mints prefixed, high-entropy, unique tokens", () => {
    const a = generateApiToken(PREFIX)
    const b = generateApiToken(PREFIX)
    expect(a.startsWith(PREFIX)).toBe(true)
    expect(a.length).toBe(PREFIX.length + 43)
    expect(a).not.toBe(b)
  })

  it("recognizes its own format and rejects JWTs / other prefixes", () => {
    expect(isApiTokenFormat(generateApiToken(PREFIX), PREFIX)).toBe(true)
    expect(isApiTokenFormat("eyJhbGciOi.x.y", PREFIX)).toBe(false)
    expect(isApiTokenFormat("kairos_sk_x", PREFIX)).toBe(false)
  })

  it("hashes deterministically without leaking the plaintext", () => {
    const token = generateApiToken(PREFIX)
    const hash = hashApiToken(token)
    expect(hash).toHaveLength(64)
    expect(hash).toBe(hashApiToken(token))
    expect(hash).not.toContain(token)
  })
})

describe("evaluateApiToken", () => {
  const hash = hashApiToken(generateApiToken(PREFIX))
  const row: ApiTokenRow = {
    id: "tok1",
    user_id: "u1",
    token_hash: hash,
    scopes: ["read"],
    revoked_at: null,
    expires_at: null,
  }

  it("accepts a matching, live token", () => {
    expect(evaluateApiToken(hash, row, new Date())).toEqual({
      userId: "u1",
      tokenId: "tok1",
      scopes: ["read"],
    })
  })

  it("returns null scopes (full access) when the row has none", () => {
    expect(evaluateApiToken(hash, { ...row, scopes: null }, new Date())?.scopes).toBeNull()
  })

  it("rejects missing row, wrong hash, revoked, and expired", () => {
    expect(evaluateApiToken(hash, null, new Date())).toBeNull()
    expect(evaluateApiToken(hashApiToken("other"), row, new Date())).toBeNull()
    expect(evaluateApiToken(hash, { ...row, revoked_at: "2020-01-01" }, new Date())).toBeNull()
    expect(
      evaluateApiToken(hash, { ...row, expires_at: "2020-01-01" }, new Date())
    ).toBeNull()
  })
})

describe("createToolRouteHandler", () => {
  type Actor = { userId: string }
  const actor: Actor = { userId: "u1" }

  function makeReq(body: unknown, correlationId?: string): Request {
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (correlationId) headers["x-correlation-id"] = correlationId
    return new Request("https://x/api/ai/tools/echo", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  }

  const ctx = { params: Promise.resolve({ toolName: "echo" }) }

  function deps(over: Partial<Parameters<typeof createToolRouteHandler<Actor>>[0]> = {}) {
    return {
      resolveActor: vi.fn(async () => actor as Actor | null),
      canUseTool: vi.fn(() => true),
      withinRateLimit: vi.fn(async () => true),
      runTool: vi.fn(async () => ({ echoed: true })),
      ...over,
    }
  }

  it("401 when the actor cannot be resolved", async () => {
    const POST = createToolRouteHandler(deps({ resolveActor: vi.fn(async () => null) }))
    const res = await POST(makeReq({}), ctx)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, error: "Unauthorized" })
  })

  it("403 when the tool is out of scope", async () => {
    const POST = createToolRouteHandler(deps({ canUseTool: vi.fn(() => false) }))
    const res = await POST(makeReq({}), ctx)
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toContain("echo")
  })

  it("429 when rate limited", async () => {
    const POST = createToolRouteHandler(deps({ withinRateLimit: vi.fn(async () => false) }))
    expect((await POST(makeReq({}), ctx)).status).toBe(429)
  })

  it("400 on an invalid JSON body", async () => {
    const POST = createToolRouteHandler(deps())
    const bad = new Request("https://x/api/ai/tools/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    })
    expect((await POST(bad, ctx)).status).toBe(400)
  })

  it("200 with { ok, data } and forwards a valid correlation id", async () => {
    const d = deps()
    const POST = createToolRouteHandler(d)
    const cid = "123e4567-e89b-12d3-a456-426614174000"
    const res = await POST(makeReq({ n: 1 }, cid), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { echoed: true } })
    expect(d.runTool).toHaveBeenCalledWith("echo", { n: 1 }, actor, { correlationId: cid })
  })

  it("drops a malformed correlation id (undefined, not an error)", async () => {
    const d = deps()
    const POST = createToolRouteHandler(d)
    await POST(makeReq({}, "not-a-uuid"), ctx)
    expect(d.runTool).toHaveBeenCalledWith("echo", {}, actor, { correlationId: undefined })
  })

  it("404 when the tool is not implemented, 400 for other tool errors", async () => {
    const notImpl = createToolRouteHandler(
      deps({
        runTool: vi.fn(async () => {
          throw new Error("Tool not implemented: echo")
        }),
      })
    )
    expect((await notImpl(makeReq({}), ctx)).status).toBe(404)

    const boom = createToolRouteHandler(
      deps({
        runTool: vi.fn(async () => {
          throw new Error("bad input")
        }),
      })
    )
    expect((await boom(makeReq({}), ctx)).status).toBe(400)
  })
})
