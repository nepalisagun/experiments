# Q4 grades: API token authentication, storage, and read-only scope

Repo: phuryn/staygreen at e73a0df.

## Reference answer

**Authentication**
- Routes: `src/app/mcp/route.ts` calls `mcpRequest`, and `src/app/api/v1/route.ts` plus `src/app/api/v1/[...operation]/route.ts` call `restRequest`. Both call `requireAgent`: MCP passes `oauth=true` and REST passes `oauth=false`. `assertAgentOrigin` runs after that (`src/lib/agent-transport.ts:69,73,112,26-31`).
- A header matching `Bearer sg_` takes the token path (`src/lib/agent-auth.ts:91`). `parseApiToken` requires `sg_<24 hex>.<43 base64url>` (`src/lib/api-token-crypto.ts:11-14`). The row is looked up by `kid` (`agent-auth.ts:94`). `matchesApiToken` recomputes `HMAC-SHA256(pepper, ["staygreen/agent/v1","token",[workspace_id, secret]])` and compares it with `timingSafeEqual`. A missing row or a malformed hash is compared against zeros (`api-token-crypto.ts:3-5,15-18`). A missing row, a wrong secret and a revoked token all get the same 401 `invalid_token` (`agent-auth.ts:97`).
- The principal is the token's workspace, with `actor` = token id, `scope` = the token's scope, and `auth` = `api_token` (`agent-auth.ts:98-101`). Two budgets apply: a 120/min token-admission budget per workspace, and the plan's `apiPerMin` (Free 30, Builder 120). Both are stored as HMAC-keyed rows in `agent_budgets` (`agent-auth.ts:103,129-130,57-61`; `src/lib/plans.ts:89,107`). `last_used_at` is updated at most once a minute (`agent-auth.ts:104`).
- A non-`sg_` bearer is rejected on REST. On MCP it is verified as a Clerk OAuth JWT: audience, issuer, `user:org:read`, and live membership. The resulting principal always gets `scope: "write"` (`agent-auth.ts:107-126`).

**Storage**
- `newApiToken` generates a 12-byte hex kid and a 32-byte base64url secret. The plaintext is returned once and only the HMAC is stored (`api-token-crypto.ts:6-10`; `src/lib/api-tokens.ts:30-38`).
- `api_tokens` has these columns: id, workspace_id, name (1-60), kid (unique, 24 hex), hash (64 hex), scope (read/write), created_at, last_used_at, revoked_at (`supabase/migrations/20261023150000_agent_surface.sql:5-13`). RLS is on, browser roles are revoked, and only `service_role` has grants (`:53-59`).
- Minting needs `tokens:manage`, is limited to 10 per minute per workspace and member, and is capped at 100 active tokens per workspace (`api-tokens.ts:27,29`; `agent_surface.sql:66`). Revoking sets `revoked_at` (`api-tokens.ts:41-43`). The API itself cannot manage tokens (`agent-transport.ts:14`). `API_TOKEN_PEPPER` is a required 32-byte secret, and rotating it invalidates every token (`docs/environment.md:11`).

**Can a read-only token change anything?**
- Not workspace content. Scope `read` maps to `monitors:read` only (`src/lib/agent-contract.ts:13-18`). Every call requires `monitors:read` (`src/lib/agent-service.ts:213`). The four write tools (`agent-contract.ts:85`) go through `write()`, which requires `monitors:write` or `incidents:draft` before any DB read, ownership check or network test (`agent-service.ts:151`). This is tested in `tests/unit/mcp-tool-schemas.test.ts:107-109`.
- The database has its own checks. `agent_write` raises PT403 unless `p_scope = 'write'` (`agent_surface.sql:126`). For a `tok_` actor it then re-reads the token row `FOR SHARE` and requires it to be unrevoked with `scope = 'write'`, raising PT401 otherwise (`:135-137`). Errors are mapped to 403 and 401 (`agent-service.ts:28-29`).
- Side effects a read token still causes:
  - `last_used_at` is updated.
  - Rows in `agent_budgets` change.
  - An `agent_calls` log row is written for both REST and MCP (`agent-transport.ts:53-64`).
  - `scan_app` makes outbound fetches, limited by `admit_scan` (`agent-service.ts:217-219`).
  - In self-hosted mode, `syncWorkspacePlan` can set the stored plan to builder and rewrite monitor intervals (`agent-auth.ts:134-136`; `src/lib/workspace-plan.ts:6-20`).
- Even a write token can only draft incident updates. Publishing them stays in the dashboard (`agent-service.ts:203`; `docs/architecture.md:44`).

## Per-answer notes

**A (9/8/9).** Nearly every claim checks out with accurate line citations: the token format, the HMAC and pepper, the dummy-hash compare, the uniform 401, both budgets with plan values, the app-level checks at `:151` and `:213`, and the SQL PT403 before any lock. It gives the strongest side-effects list: `last_used_at`, budgets, `scan_app` fetches, the self-hosted plan sync, and `tools/list` exposing the write tools. The one slip: it says *MCP* calls are logged to `agent_calls` and cites line 84, but REST calls are logged too, through `logged()`. Its main omission is the token-row re-check inside `agent_write` (`:135-137`). That check is what makes the SQL layer independent of the app-supplied scope and catches a revocation that races the request.

**B (9/9/9).** This is the most complete answer. It names the entry routes, the origin and 64 KiB body checks, the exact regex and HMAC formula, the principal fields, the full table schema, token management, "the API can't manage tokens", both scope layers, and a correct side-effects list (`agent_calls`, `scan_app`, self-hosted plan). One low inaccuracy: it says the `write()` check runs "before any input parsing", but `executeAgentTool` parses the input at `:214` first. Like A, it misses the `:135-137` token re-check. Its claim that "a TypeScript bug still couldn't let a read token write" is in fact secured by that re-check, not by the `p_scope` test it cites.

**C (9/7/7).** It is accurate throughout, and it is one of only two answers that catch the in-transaction token-row re-check (`L136`), with the revocation and downgrade rationale. It has the same low "before any input is parsed" inaccuracy as B, and its phrase "the most a write token can do is draft an incident update" reads loosely. It is thinner on the read-only side effects (only `last_used_at` and counters). It does not name the write tools or the entry routes. It uses few line citations, so a newcomer has less to navigate by.

**D (5/6/5).** It covers the auth flow and storage correctly and correctly locates the SQL PT403 guard. But it asserts that `requireAgentPermission()` has no caller, so "the SQL check is what actually enforces it". That is false: the helper is called at `agent-service.ts:151` and `:213`, and a unit test asserts the 403 for all four write tools. On a security question this misstates where enforcement lives. Every `agent-auth.ts` line citation is off by about three. It hedges that a read token "possibly" writes activity and call logs: `agent_calls` is always written, and `agent_activity` never is for a read token. It misses the token-row re-check, `scan_app` and the self-hosted plan sync.

**E (9/8/8).** It is accurate and well cited, and it includes both DB-layer checks (`:126` and `:135-137`), the origin check, the `SUMMARY` projection, and the point that only API tokens can be read-only because OAuth is always write. One low imprecision: it says OAuth can write "if the member's role allows it", but the role is only checked for `monitors:read` and write is granted unconditionally. Its read-only section lists only reads and budget use (`last_used_at` appears earlier). It omits `agent_calls` logging, the outbound fetches from `scan_app`, and the self-hosted plan and interval sync, so its flat "cannot change anything" slightly overclaims.
