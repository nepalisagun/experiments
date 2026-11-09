# Question 4

How does the REST/MCP API authenticate a request that uses an API token, how are tokens stored, and can a read-only token change anything?

## Answer 4A

Short answer: an API token is looked up by its public id, checked against a peppered HMAC with a constant-time compare, and turned into a principal with scope read or write. Only the HMAC is stored, never the token. A read-only token cannot create, change, pause or delete anything: the scope is checked in the app and again inside the one SQL function that performs agent writes. A read call still has small side effects, listed at the end. Paths are relative to the clone at <clone>, and no files were changed.

Token format and storage

Minting. newApiToken creates a random 12-byte kid (24 hex characters) and a random 32-byte secret. The token is sg_<kid>.<secret> (src/lib/api-token-crypto.ts:6-10).
What is stored. The api_tokens row holds the kid, the scope (read or write), the name, timestamps and hash (supabase/migrations/20261023150000_agent_surface.sql:5-13).
  hash is HMAC-SHA256 keyed with the server secret API_TOKEN_PEPPER, over the workspace id and the secret. So a hash is tied to one workspace and is useless without the pepper (api-token-crypto.ts:3-5,9).
  The plaintext is returned once to the member who created it and never stored (src/lib/api-tokens.ts:30-38).
Database access. The table has row-level security on and all browser-role grants revoked. Only the app's service_role can read it (agent_surface.sql:53-59).
Who can manage tokens. Creating, listing and revoking tokens require the member permission tokens:manage (api-tokens.ts:20,27,41).
  Creating is limited to 10 per minute (api-tokens.ts:29).
  A workspace can have at most 100 active tokens (agent_surface.sql:66).
  Revoking sets revoked_at and keeps the row (api-tokens.ts:43).

How a token request is authenticated

The MCP endpoint and the REST endpoint both call requireAgent. The MCP endpoint (/mcp) passes oauth=true, so it accepts tokens or OAuth. The REST endpoint (/api/v1) passes oauth=false, so it accepts tokens only (src/lib/agent-transport.ts:69,73,112). For a header that starts with Bearer sg_ (src/lib/agent-auth.ts:91-105):

Parse. parseApiToken requires exactly sg_ + 24 hex + . + 43 base64url characters; anything else is rejected (api-token-crypto.ts:11-14).
Look up. The row is fetched by kid (agent-auth.ts:94).
Verify. matchesApiToken recomputes the HMAC with the row's workspace id and compares it with timingSafeEqual. A missing row gets a dummy hash, so the comparison still runs (api-token-crypto.ts:15-18).
Reject failures the same way. A missing row, wrong secret or revoked token all return the same 401 invalid_token (agent-auth.ts:97).
Load the workspace. Its Clerk organization and stored plan are loaded. The principal carries the token's scope and uses the token id as the actor (agent-auth.ts:98-101).
Rate limits.
   Before the workspace's own limit, token traffic shares a fixed budget of 120 calls per minute (agent-auth.ts:103).
   last_used_at is updated at most once a minute (agent-auth.ts:104).
   Then the plan's per-minute limit applies: Free 30, Builder 120 (agent-auth.ts:129-130).

OAuth tokens, by comparison, are accepted only at /mcp. They are verified as Clerk JWTs, the user's current organization membership is rechecked, and the principal always gets scope write (agent-auth.ts:107-126).

Can a read-only token change anything?

No. The scope check happens twice:

In the app. A read scope grants only monitors:read, while write adds monitors:write and incidents:draft (src/lib/agent-contract.ts:13-18).
   Every tool call first requires monitors:read (src/lib/agent-service.ts:213).
   The four write tools are provision_app, create_monitor, pause and draft_incident_update (agent-contract.ts:85). Each goes through write(), which first requires monitors:write, or incidents:draft for the draft tool. It does this before reading the stored request record, checking ownership or making any network test (agent-service.ts:150-151).
In the database. All four writes run through one SQL function, agent_write. It receives the scope and refuses anything other than write with PT403, before it locks or writes anything (agent_surface.sql:116-126). The app turns that into 403 insufficient_scope (agent-service.ts:29).

Even a write token can't publish an incident update: draft_incident_update only returns a draft and an approval link, and publishing stays a dashboard action (agent-service.ts:203, docs/architecture.md:44).

Side effects a read-only token still has:
Each call updates the token's last_used_at and spends rate-limit budgets, which are counter rows in agent_budgets (agent-auth.ts:103-104,130).
MCP calls are logged to agent_calls (agent_surface.sql:39-50, agent-transport.ts:84).
scan_app counts as a read, so a read token can make Staygreen fetch a URL and analyze it. It is limited by the scan admission budget (agent-service.ts:217-219).
In self-hosted mode, any authenticated call can set the workspace's stored plan to Builder (agent-auth.ts:134-136).

tools/list shows all tools to every caller. Write tools are only labeled with readOnlyHint: false, and a read token gets the 403 when it calls one (agent-transport.ts:97, agent-contract.ts:121).

## Answer 4B

API tokens on the Staygreen REST and MCP API

Short answer: A token looks like sg_<kid>.<secret>. The server finds the token row by its kid and compares a keyed hash of the secret in constant time. Only the HMAC is stored, never the token itself. A read-only token cannot change any monitors, apps, pages or incidents. The write check happens twice, once in TypeScript and again inside the SQL write function. Its calls do still update a few bookkeeping records and run budgeted outbound fetches; details are at the end.

Entry points

REST: src/app/api/v1/[...operation]/route.ts → restRequest
MCP: src/app/mcp/route.ts → mcpRequest

Both are in src/lib/agent-transport.ts. Each one first calls authenticate, which is requireAgent, and then assertAgentOrigin (agent-transport.ts:73, 112). REST accepts only API tokens. MCP accepts API tokens or Clerk OAuth access tokens (src/lib/agent-auth.ts:107).

Authenticating an API token (src/lib/agent-auth.ts:86-138)

Parse. A header that starts with Bearer sg_ must match ^Bearer sg_([0-9a-f]{24})\.([A-Za-z0-9_-]{43})$. Otherwise the request gets a 401 invalid_token (src/lib/api-token-crypto.ts:11-14, agent-auth.ts:91-93).
Look up by kid. It reads api_tokens where kid = <kid>; kid is a unique column (agent-auth.ts:94).
Verify the secret. matchesApiToken recomputes HMAC-SHA256(API_TOKEN_PEPPER, ["staygreen/agent/v1","token",[workspace_id, secret]]) and compares it with timingSafeEqual. If no row was found or the stored hash is malformed, it compares against zeros, so the work done looks the same either way (api-token-crypto.ts:3-5, 15-18; agent-auth.ts:96). A missing row, a wrong secret or a revoked token all get the same 401 (agent-auth.ts:97).
Build the principal. It loads the owning workspace and builds a principal with these fields (agent-auth.ts:98-101):
   actor: the token's id
   client: the token's label
   scope: the token's stored scope
   auth: "api_token"
Rate budgets and last use.
   120 admission calls per minute per workspace for token traffic (agent-auth.ts:103).
   last_used_at is updated at most once a minute (agent-auth.ts:104).
   The plan's apiPerMin budget: 30 on Free, 120 on Builder (agent-auth.ts:129-130).

   Budgets are counted in Postgres by agent_budget, keyed by an HMAC (agent-auth.ts:57-61).

Other admission checks:
Origin: browser requests from other sites are refused. Native clients that send neither Origin nor Sec-Fetch-Site are allowed, because cookies are never consulted (agent-transport.ts:26-31).
Body: must be JSON and at most 64 KiB (agent-transport.ts:32-40).

OAuth on /mcp uses a different path:
Clerk verifies the JWT and checks the audience and issuer (agent-auth.ts:30-56).
Org membership is checked live against Clerk (agent-auth.ts:118-125).
An OAuth principal always gets scope: "write" (agent-auth.ts:126).

How tokens are stored and managed

Table: public.api_tokens has these columns (supabase/migrations/20261023150000_agent_surface.sql:5-13):
  id
  workspace_id
  name, 1–60 characters
  kid: unique, 24 hex characters
  hash: 64 hex characters
  scope: 'read' or 'write'
  created_at, last_used_at, revoked_at
No plaintext and no reversible secret are stored. newApiToken generates a 12-byte random kid and a 32-byte random secret. It returns the full sg_<kid>.<secret> once and stores only the HMAC, which binds the token to its workspace id under the server-side pepper (api-token-crypto.ts:6-10). The pepper is an app environment variable (env().API_TOKEN_PEPPER), so a leaked table alone can't be used to check guesses offline.
Creating tokens happens only in the dashboard (src/lib/api-tokens.ts:27-40):
  It requires the member permission tokens:manage.
  It is limited to 10 per budget window per member.
  The plaintext is shown once.
  The SQL agent_token_create locks the workspace and allows at most 100 active tokens (agent_surface.sql:61-67).
Revoking sets revoked_at (api-tokens.ts:41-46). Revoked tokens are refused at authentication.
The table can't be reached directly. Table and function grants go only to service_role, so the browser roles have no access (agent_surface.sql:323-324; docs/architecture.md:30).
The API can't manage tokens. The MCP instructions say "Deletion, alert-channel or teammate changes, billing, tokens and publishing are unavailable" (agent-transport.ts:14).

Can a read-only token change anything?

It can't make any of the four writes, and two separate layers block them:

TypeScript. AGENT_PERMISSIONS maps read to ["monitors:read"] only. write adds monitors:write and incidents:draft (src/lib/agent-contract.ts:13-17).
   Every tool call starts with requireAgentPermission(p, "monitors:read") (src/lib/agent-service.ts:212-213).
   The write tools are provision_app, create_monitor, pause and draft_incident_update (agent-contract.ts:85). They go through write(), which first requires monitors:write, or incidents:draft for drafts. This check runs before any input parsing or database work (agent-service.ts:150-151). A read token gets a 403 insufficient_scope.
SQL. The writes are committed through public.agent_write, which receives the principal's scope. It raises insufficient_scope (PT403) unless the scope is 'write' (agent_surface.sql:116-126; called at agent-service.ts:196; error mapped at agent-service.ts:29). A bug in the TypeScript layer still couldn't let a read token write.

Also, "write" itself is narrow. Even a write token or an OAuth grant can't:
delete anything
change alert channels or teammates
touch billing or tokens
publish incident updates. draft_incident_update only saves a draft for a member to approve in the dashboard (agent-transport.ts:14; agent-contract.ts:115).

What a read-only call still writes. These are side effects of being allowed to call the API at all, not changes to workspace content:
Its last_used_at timestamp (agent-auth.ts:104).
Rate-budget counters (agent-auth.ts:103, 130).
An agent_calls usage-log row (agent-transport.ts:53-64).
scan_app is a read tool, but it makes outbound fetches to the URL you give it, limited by a scan budget (admitScan). It creates no monitors (agent-service.ts:217-219; agent-transport.ts:14).
In self-hosted mode (SELF_HOSTED_PLAN=builder), any authenticated call can update the workspace's stored plan to builder (agent-auth.ts:134-136).

## Answer 4C

Used 4 tools

The REST API and the MCP server check API tokens the same way, in requireAgent (src/lib/agent-auth.ts). Tokens are never stored in readable form. A read-only token can't change anything in the workspace: it's refused once in the app code and again inside the database's write function.

How a request with a token is checked (src/lib/agent-auth.ts, requireAgent)
The header picks the path. Authorization: Bearer sg_… takes the token path. Anything else is treated as a sign-in (OAuth) token, which only /mcp accepts; REST answers "REST requires a workspace API token" (401).
The format is checked. parseApiToken (src/lib/api-token-crypto.ts) only accepts sg_<24 hex characters>.<43 base64url characters>. The first part is a public key ID (kid), the second the secret.
The token row is looked up by its key ID. The query is api_tokens … .eq("kid", token.kid), which returns the row's workspace_id, hash, scope and revoked_at.
The secret is compared. matchesApiToken recomputes the hash and compares it with timingSafeEqual, which doesn't leak timing. It still runs a comparison when no row was found. A missing row, a wrong secret or a revoked token all return the same invalid_token 401, with no hint which one it was.
The token's details are attached to the request. The workspace comes from the token row (workspaces … .eq("id", data.workspace_id)). The actor is the token's own id (tok_…), and the scope is the token's scope.
Rate limits apply.
120 requests per minute per workspace for token sign-ins (admission-token).
The plan's own per-workspace limit (entitlements.limits.apiPerMin: 30 on Free, 120 on Builder).
Both are counted by the agent_budget database function.
Last use is recorded. last_used_at is updated at most once a minute.
How tokens are stored
Creation (newApiToken in src/lib/api-token-crypto.ts): the key ID is 12 random bytes as hex and the secret is 32 random bytes as base64url. The plaintext sg_<kid>.<secret> is returned once and never saved.
What's saved: hash = HMAC-SHA256(API_TOKEN_PEPPER, ["staygreen/agent/v1","token",[workspaceId, secret]]), via agentHash. The pepper is a server-only setting, and the hash is tied to the workspace.
The table is public.api_tokens (supabase/migrations/20261023150000_agent_surface.sql, L5–14). It holds id, workspace_id, name, kid (unique), hash (64 hex characters), scope ('read' or 'write'), created_at, last_used_at and revoked_at.
Access to the table: row-level security is on, and browser roles have no access (L53–59). Only the server's privileged role can read it.
Who can create tokens: mintApiToken (src/lib/api-tokens.ts) requires the tokens:manage permission and allows 10 token actions per minute per member. agent_token_create caps a workspace at 100 active tokens (token_limit).
Revoking sets revoked_at (revokeApiToken). Revoked tokens are refused at step 4.
Can a read-only token change anything?

No. Each scope maps to a set of permissions (AGENT_PERMISSIONS in src/lib/agent-contract.ts):

read → monitors:read only.
write → monitors:read, monitors:write, incidents:draft.

There are two independent barriers:

In the app. Every write tool goes through write() in src/lib/agent-service.ts (~L151), which calls requireAgentPermission first. A read token gets 403 insufficient_scope before any input is parsed.
In the database. agent_write (20261023150000_agent_surface.sql) re-checks independently:
It refuses unless p_scope = 'write' (L126, PT403).
For token callers, it locks the token row and requires revoked_at is null and scope = 'write' (L136). A token revoked mid-request, or one whose scope was lowered, is refused inside the transaction.

Two points to be precise about:

A read token does cause some bookkeeping writes: its last_used_at and the rate-limit counters. These are Staygreen's own records, not workspace data.
The most a write token can do is draft an incident update. Publishing it remains a dashboard action (docs/architecture.md).

## Answer 4D

A read-only token can't change any workspace data: every API change goes through one SQL function, and that function refuses unless the token's scope is write. Tokens are stored only as an HMAC hash, never in plain text.

How a token request is authenticated

requireAgent() in src/lib/agent-auth.ts:89-138 handles every REST and MCP request.

Check the shape. A header matching Bearer sg_… is treated as an API token. parseApiToken() requires exactly sg_<24 hex characters>.<43 base64url characters>. The first part is the key id (kid), the second the secret (src/lib/api-token-crypto.ts:11-14).
Look up the token. It loads api_tokens by kid (agent-auth.ts:97).
Compare the hash. matchesApiToken() recomputes HMAC-SHA256(API_TOKEN_PEPPER, ["staygreen/agent/v1", "token", [workspaceId, secret]]) and compares it in constant time with timingSafeEqual (api-token-crypto.ts:3-5,15-18).
   When no row matches, it still runs the comparison against a dummy all-zero hash.
   The workspace id is part of the hash, so a token can't be moved to another workspace.
   A missing token, a wrong secret and a revoked token all return the same 401 invalid_token (agent-auth.ts:99-100).
Load the workspace. The token's workspace becomes the principal, with scope copied from the token row and auth: "api_token" (agent-auth.ts:101-104).
Apply rate limits. One budget of 120 requests is shared by all token requests for the workspace. A second budget comes from the plan: 30 per minute on Free, 120 on Builder (agent-auth.ts:106,130; spendAgentBudget → agent_budget RPC at :57-61).
Record use. last_used_at is updated at most once a minute (agent-auth.ts:107).

REST accepts only API tokens. An OAuth (Clerk JWT) access token is accepted only at /mcp, and those sessions always get scope: "write" after the user's membership and role are checked again (agent-auth.ts:110-127).

How tokens are stored

Creation: newApiToken() generates a random 12-byte kid and a random 32-byte secret. It returns the plaintext sg_<kid>.<secret> once and keeps only the hash (api-token-crypto.ts:6-10).
Who can create one: mintApiToken() requires the tokens:manage permission and allows 10 token operations per budget. It stores the token through agent_token_create, with at most 100 active tokens per workspace (src/lib/api-tokens.ts:26-35).
Table: api_tokens(id, workspace_id, name, kid unique, hash (64 hex), scope in ('read','write'), created_at, last_used_at, revoked_at) (supabase/migrations/20261023150000_agent_surface.sql:5-13).
Revocation sets revoked_at; the row stays.
Access: RLS is enabled with no policies, and every grant is revoked from anon and authenticated. Only the server's service_role can read the table (agent_surface.sql:53-59).
The key: the pepper is the app secret API_TOKEN_PEPPER. Without it, a leaked hash can't be checked against guessed secrets.

Can a read-only token change anything?

Not workspace data.

agent-service.ts makes every API change through one RPC, agent_write (src/lib/agent-service.ts:196). The other calls there are reads such as agent_history, agent_response_times and agent_check_times.
agent_write starts with if p_scope is distinct from 'write' then raise exception 'insufficient_scope' using errcode = 'PT403' (agent_surface.sql:126). It accepts only four tools: provision_app, create_monitor, pause and draft_incident_update.
The app turns that error into HTTP 403 insufficient_scope (agent-service.ts:29).

So the guard is in the database, inside the only write path. The scope map in src/lib/agent-contract.ts:13-18 says the same thing: read gets only monitors:read, while write also gets monitors:write and incidents:draft. However, I found no caller of its requireAgentPermission() helper, so the SQL check is what actually enforces it.

A read-only token does cause some bookkeeping writes:
last_used_at on its own token row;
the rate-limit counters in agent_budgets;
possibly activity and call logging (the agent_activity and agent_calls tables are set up for it in agent_surface.sql:58-59).

Even with write scope, the API can't publish an incident update; it can only create a draft (docs/architecture.md, "publishing an incident update remains a dashboard action"). API tokens also can't create or revoke tokens, because that requires a member session with tokens:manage (api-tokens.ts:27).

## Answer 4E

A request with a workspace API token is authenticated by looking up the token's id and comparing a keyed hash of its secret. A read-only token cannot change anything through the REST or MCP API. Two checks stop it: one in application code and one inside the database function that does the write.

How a token request is authenticated

The code is requireAgent in src/lib/agent-auth.ts:86. The REST endpoint calls it with OAuth disabled, and MCP calls it with OAuth enabled (src/lib/agent-transport.ts:73 and :112).

Recognise the token. An Authorization: Bearer sg_… header goes down the API-token path (agent-auth.ts:91). parseApiToken accepts only sg_<24 hex>.<43 base64url chars>, a key id plus a secret (src/lib/api-token-crypto.ts:11-14).
Look up the row by key id. The code selects the row from api_tokens where kid equals the token's key id (agent-auth.ts:94).
Compare the hash. matchesApiToken recomputes HMAC-SHA256(API_TOKEN_PEPPER, ["staygreen/agent/v1", "token", [workspaceId, secret]]). It compares that with the stored hash using timingSafeEqual (api-token-crypto.ts:3-5 and :15-18). If no row is found, it compares against a dummy all-zero hash, so a miss takes about the same time as a bad secret.
Reject revoked tokens. A missing row, a mismatch or a non-null revoked_at all give the same 401 invalid_token (agent-auth.ts:97).
Resolve the workspace. The token's workspace is read from the database. The principal is built with scope taken from the token row and auth: "api_token" (agent-auth.ts:98-101).
Spend rate-limit budgets and record use.
   A fixed budget of 120 per workspace-token admission (agent-auth.ts:103).
   A per-workspace budget of entitlements.limits.apiPerMin, which is 30 on Free and 120 on Builder (agent-auth.ts:129-130).
   last_used_at is updated at most once a minute (agent-auth.ts:104).
Check the origin. After authentication, assertAgentOrigin rejects a cross-origin browser request (agent-transport.ts:26-30).

REST refuses anything but a workspace token, with the message "OAuth access tokens are accepted only at /mcp" (agent-auth.ts:107). MCP also accepts a Clerk OAuth JWT. That path is a different mechanism, with its own checks on signature, audience, scope and live organization membership (agent-auth.ts:106-127).

How tokens are stored

Table: public.api_tokens has id, workspace_id, name, kid (unique), hash, scope ('read' or 'write'), created_at, last_used_at and revoked_at (supabase/migrations/20261023150000_agent_surface.sql:5-13).
What is stored: only the 64-hex HMAC of the secret. The hash column is constrained to ^[0-9a-f]{64}$. The plaintext sg_<kid>.<secret> is returned once at creation and is not kept (mintApiToken in src/lib/api-tokens.ts:26-38).
How it is generated: a 12-byte random key id and a 32-byte random secret (newApiToken, api-token-crypto.ts:6-10).
Pepper: the HMAC key is the server-side API_TOKEN_PEPPER. The hash is also bound to the workspace id, so the same secret would not match in another workspace.
Table access: row-level security is on, and access is revoked from public, anon and authenticated. Only service_role, the app server, has grants (agent_surface.sql:53-59).
Management: creating and revoking tokens needs the tokens:manage permission (api-tokens.ts:27 and :41). Creation is rate-limited to 10 per user, and a workspace may hold at most 100 active tokens (api-tokens.ts:29; agent_surface.sql:66). Revoking only sets revoked_at (api-tokens.ts:43). The settings screen lists tokens without their hashes (SUMMARY, api-tokens.ts:11).

Can a read-only token change anything?

No, based on the checks below.

Application check. AGENT_PERMISSIONS gives read only monitors:read, and gives write monitors:read, monitors:write and incidents:draft (src/lib/agent-contract.ts:13-15). requireAgentPermission throws 403 insufficient_scope when the scope lacks the permission (agent-contract.ts:16-18). src/lib/agent-service.ts:151 calls it for every write tool, and line 213 calls it for reads.
Database check. The write tools are provision_app, create_monitor, pause and draft_incident_update (agent-contract.ts:85). All of them go through the agent_write SQL function (agent-service.ts:196). That function raises insufficient_scope unless the passed scope is 'write' (agent_surface.sql:126). For a token actor it then re-reads the token row, requiring it to be unrevoked and scope = 'write' (agent_surface.sql:135-137). So a token revoked or downgraded mid-request cannot complete a write.
Other write paths. agent-contract.ts:119 flags write tools by name. The agent surface exposes only the four write tools above, and publishing an incident update is a dashboard-only action (docs/architecture.md, "Alerts and public status"). Minting or revoking tokens is a dashboard action behind tokens:manage, not an API-token action. I did not check whether any other route accepts API tokens beyond api/v1 and mcp.

A read token can still read workspace data that monitors:read allows, and using it consumes the rate-limit budgets above. There is one exception to token scopes. OAuth principals are always created with scope: "write" (agent-auth.ts:126), so an OAuth connection can write if the member's role allows it. Only API tokens can be read-only.

The scope check at agent-service.ts:151 is easy to read, so it is probably covered by tests. I did not look at them.
