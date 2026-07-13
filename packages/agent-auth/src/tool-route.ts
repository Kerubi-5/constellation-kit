/**
 * The shared guard for a service's `POST /api/ai/tools/[toolName]` endpoint.
 * Both apps ran a byte-identical handler; this factory owns that orchestration
 * (resolve actor → 401, scope-check → 403, rate-limit → 429, parse body → 400,
 * dispatch → `{ ok, data }`) and takes the app-specific, DB-bound pieces as
 * injected dependencies.
 *
 * Framework-agnostic on purpose: it returns a Web-standard `Response` (which
 * Next.js route handlers accept) rather than `NextResponse`, and validates the
 * correlation-id header with a plain regex — so this package never has to
 * import `next` or `zod`. Generic over the actor type, since the guard only
 * reads `actor.userId`.
 */

/** Loose 8-4-4-4-12 hex UUID shape — any real correlation id passes, garbage doesn't. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseCorrelationId(req: Request): string | undefined {
  const raw = req.headers.get("x-correlation-id")?.trim()
  return raw && UUID_RE.test(raw) ? raw : undefined
}

/** Next.js passes the dynamic route params as a promise. */
export type ToolRouteContext = { params: Promise<{ toolName: string }> }

/** The app-specific pieces the guard orchestrates; everything DB-bound lives here. */
export type ToolRouteHandlers<TActor extends { userId: string }> = {
  /** Resolve the caller from the request (session or API token), or `null`. */
  resolveActor: (req: Request) => Promise<TActor | null>
  /** Whether this actor's scopes permit the named tool. */
  canUseTool: (actor: TActor, toolName: string) => boolean
  /** Whether the actor is under its rate limit right now. */
  withinRateLimit: (userId: string) => Promise<boolean>
  /** Execute the tool and return its result payload. */
  runTool: (
    toolName: string,
    input: unknown,
    actor: TActor,
    opts: { correlationId?: string }
  ) => Promise<unknown>
}

/**
 * Builds the `POST` handler for the tool endpoint. Each app wires its own
 * dependencies:
 *
 * ```ts
 * export const POST = createToolRouteHandler({
 *   resolveActor: resolveRequestActor,
 *   canUseTool: actorCanUseTool,
 *   withinRateLimit: withinToolRateLimit,
 *   runTool,
 * })
 * ```
 */
export function createToolRouteHandler<TActor extends { userId: string }>(
  deps: ToolRouteHandlers<TActor>
) {
  return async function POST(
    req: Request,
    context: ToolRouteContext
  ): Promise<Response> {
    const actor = await deps.resolveActor(req)
    if (!actor) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    }

    const { toolName } = await context.params

    if (!deps.canUseTool(actor, toolName)) {
      return Response.json(
        { ok: false, error: `Token not permitted to use ${toolName}` },
        { status: 403 }
      )
    }

    if (!(await deps.withinRateLimit(actor.userId))) {
      return Response.json(
        { ok: false, error: "Rate limit exceeded. Try again shortly." },
        { status: 429 }
      )
    }

    let input: unknown
    try {
      input = await req.json()
    } catch {
      return Response.json(
        { ok: false, error: "Invalid JSON body" },
        { status: 400 }
      )
    }

    try {
      const correlationId = parseCorrelationId(req)
      const data = await deps.runTool(toolName, input, actor, { correlationId })
      return Response.json({ ok: true, data })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Tool execution failed"
      const status = message.startsWith("Tool not implemented") ? 404 : 400
      return Response.json({ ok: false, error: message }, { status })
    }
  }
}
