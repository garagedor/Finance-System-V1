# Auth Integration Gate — CRM-side implementation plan

**Status: plan only. Nothing here has been executed.**

Warehouse is finished against the target contract and fails closed without it.
This is the CRM-side work that lets Warehouse go live, and it closes two
existing defects in the CRM on the way.

Every step marked **🔴 APPROVAL** is production-sensitive and must be approved
explicitly before it runs.

---

## 0. Two things to fix before any of this

These are prerequisites, not part of the gate. They are described here because
the gate replaces the mechanism they are broken in.

### 0a. 🔴 A hardcoded signing secret in a live admin route

`src/app/api/verify/backfill-lm/route.ts:20`

```ts
const JWT_SECRET = new TextEncoder().encode('super-secret-key-for-development');
```

No environment variable, no fallback — a literal. `requireAdmin()` in that file
verifies the `session` cookie against it, so a token signed with a string that
is in the repository is accepted as an admin session **regardless of what
`JWT_SECRET` is set to in production**. The route then writes to Supabase
(`weekly_report_jobs.lm_cash / lm_check / lm_parts`) when called with
`?dryRun=false`.

This is an authentication bypass for that one route. It does not weaken the
rest of the application, which uses the real secret.

**Fix:** delete the local constant and the local `requireAdmin`, and use the
shared `readSession()` / `hasPermission()` like every other route. No
behavioural change for a legitimate admin.

### 0b. 🔴 A development fallback in the real verifier

`src/lib/rbac.ts:17` and `src/middleware.ts:18`

```ts
process.env.JWT_SECRET ?? "super-secret-key-for-development"
```

If `JWT_SECRET` is ever unset — a new environment, a renamed variable, a
preview deployment — the entire application silently signs and verifies with a
publicly known string. It fails open, which is the opposite of what an auth
fallback should do.

**Fix:** throw at boot when `JWT_SECRET` is absent. Warehouse's `env.ts` is the
pattern: validate, never default.

> **Verify in production before and after:** confirm `JWT_SECRET` is actually
> set on the Vercel project. If it is not, every session in production is
> currently signed with the string above, and rotating it is urgent and will
> sign everyone out.

---

## 1. `session_version` data model

Add to the `User` document (`src/types/user.ts`):

```ts
/** Bumped to invalidate every session already issued for this user. */
session_version?: number;   // absent is treated as 0
```

* **Absent means 0.** No migration writes a field to every user; a user who has
  never had a version bumped simply has none, and both sides read it as zero.
* The claim is **always** written into new tokens, as a number.
* Index: none required. It is read on a `_id` lookup that is already indexed.

**Migration:** none. 🟢 Non-destructive by construction.

---

## 2. Invalidation rules

One helper, called from every place that changes what a session may do:

```ts
// src/lib/auth/session-version.ts
export async function bumpSessionVersion(userId: string, reason: string): Promise<number>
```

| Event | Bump | Why |
|---|---|---|
| User disabled (`active: false`) | ✅ | **The defect this closes.** Today a disabled user keeps working for up to 7 days. |
| User deleted | ✅ | Same. |
| Password changed | ✅ | A changed password must end other sessions. |
| `role_id` changed | ✅ | Permissions are baked into the token; otherwise the old set survives. |
| `extra_permissions` / `denied_permissions` changed | ✅ | Same reason. |
| A **role's** permission set edited | ✅ for every user holding it | Otherwise an admin removing a permission changes nothing for anyone signed in. |
| Name, email, phone changed | ❌ | Display only. |
| User re-enabled | ❌ | They sign in again and get a current token. |

The role-edit case is a fan-out: bump every user with that `role_id`. It is a
single `updateMany` with `$inc`.

---

## 3. RS256 signing and key storage

| | Holds | Can mint | Can verify |
|---|---|---|---|
| CRM / auth | private + public | ✅ | ✅ |
| Warehouse | **public only** | ❌ | ✅ |

* 2048-bit RSA, PKCS#8 private / SPKI public, PEM.
* 🔴 **APPROVAL** — generate the pair and store the private half as a Vercel
  **Secret** environment variable (`WAREHOUSE_JWT_PRIVATE_KEY`) on the CRM
  project only. It must never appear in the repository, in a log, or in a
  client bundle.
* The public half is not a secret. It goes to Warehouse as
  `WAREHOUSE_JWT_PUBLIC_KEY`.
* Rotation: both applications accept a key id (`kid`) in the header from day
  one, so a second key can be introduced without a flag day. Warehouse's
  verifier is already strict about the algorithm; adding `kid` selection is a
  small, contained change there.

**The CRM session cookie stays HS256.** This gate does not migrate CRM's own
sessions — that is a separate, larger piece of work. What RS256 buys here is
that *Warehouse* tokens are verifiable without sharing a secret.

---

## 4. Warehouse token issuance

A new, short-lived, separately-signed token. It is **not** the CRM session
cookie with extra claims.

```
POST /api/auth/warehouse-token        (authenticated by the CRM session)
→ { token, expiresIn }
```

```jsonc
{
  "iss": "https://<crm-origin>",
  "aud": ["warehouse"],
  "sub": "<user _id>",
  "iat": …, "exp": …,                 // 15 minutes
  "session_version": 7,
  "account_type": "employee",         // or "warehouse_agent"
  "modules": ["crm", "finance", "warehouse"],
  "warehouse_permissions": ["wh:receiving:count", …],
  "warehouse_ids": ["MIA"],           // omit for every warehouse
  "name": "…", "email": "…"           // display only
}
```

Rules the issuer must hold to, because Warehouse's verifier enforces them and
will refuse a token that breaks them:

* `aud` **must** include `warehouse`.
* `modules` **must** include `warehouse`, or the identity is not entitled to it.
* An identity with `account_type: "warehouse_agent"` **must not** carry `crm`
  or `finance` in `modules`. Warehouse refuses that combination outright.
* `warehouse_permissions` are the `wh:*` keys only. CRM and Finance
  permissions are never copied in.

**Mapping CRM permissions to `wh:*` claims** is the one piece of real design
left. The simplest correct approach: a new permission module `warehouse` in
`PERMISSION_CATALOG` whose keys are exactly Warehouse's, granted through the
existing role editor. No translation table, no inference from job title.

---

## 5. `POST /api/internal/auth/session-state`

```
Authorization: Bearer <WAREHOUSE_AUTH_SERVICE_TOKEN>
{ "userId": "…", "sessionVersion": 7 }
→ { "live": true, "currentVersion": 7 }
→ { "live": false, "reason": "revoked" | "unknown_user" }
```

* Authenticated by a **dedicated service credential** — not a user token, not
  the signing key. 🔴 **APPROVAL** to create it.
* Returns `live: false` when the user is absent, `active === false`, or the
  stored version is higher than the presented one.
* Must not be reachable from the browser: no CORS, and the route rejects any
  request carrying a session cookie instead of the service credential.
* Rate limit: this is called at most once per user per 30s by Warehouse's
  cache, so a low ceiling is safe and worth having.

---

## 6. Rollout — order matters

Each step is independently reversible and leaves the system working.

| # | Step | Reversible | |
|---|---|---|---|
| 1 | Fix 0a and 0b | ✅ | 🔴 |
| 2 | Add `session_version` to the type; write it into new CRM tokens; read it tolerantly | ✅ | 🟢 |
| 3 | Add `bumpSessionVersion` and wire the invalidation rules | ✅ | 🟢 |
| 4 | **Enforce** it: CRM `readSession` rejects a token whose version is below the stored one | ⚠️ signs out anyone with an older token | 🔴 |
| 5 | Add the `warehouse` permission module to the role editor | ✅ | 🟢 |
| 6 | Generate the key pair; store the private half | ✅ | 🔴 |
| 7 | Add `/api/auth/warehouse-token` | ✅ | 🟢 |
| 8 | Add `/api/internal/auth/session-state` + service credential | ✅ | 🔴 |
| 9 | Give Warehouse the public key and the service credential | ✅ | 🔴 |
| 10 | Add the `/warehouse/*` rewrite | ✅ | 🔴 |

**There is no hard cutover.** Warehouse has no users today, so steps 5–10 add
capability without changing anything that exists. The only step with
user-visible effect is **4**, and its effect is that everybody signs in again
once.

Run step 4 at a quiet hour and say so in advance.

---

## 7. Rollback

| Step | Rollback |
|---|---|
| 1 | Revert the commit. The fix only removes a bypass. |
| 2–3 | Revert. An unread claim is inert. |
| 4 | Revert the enforcement check. Tokens become acceptable again immediately. |
| 5 | Revert; granted permissions become inert, not harmful. |
| 6 | Delete the environment variable. Nothing reads it until step 7. |
| 7 | Remove the route. Warehouse cannot obtain a token and fails closed. |
| 8 | Remove the route. Warehouse's liveness check fails closed — which denies access rather than granting it. |
| 9–10 | Remove the variables / the rewrite. Warehouse becomes unreachable. |

**Every failure mode denies access.** There is no rollback state in which
Warehouse is reachable with weaker checking than intended.

---

## 8. Tests

**CRM**

* A token with a `session_version` below the stored one is rejected.
* A token with no `session_version` is rejected once step 4 lands *(decide:
  reject, or treat as 0? See open questions).*
* Disabling a user ends an existing session **on the next request**, not in 7
  days. This is the regression test for the defect being closed.
* Editing a role bumps every holder of it.
* Changing a display name bumps nobody.
* `/api/auth/warehouse-token` refuses a user without the warehouse module.
* An agent identity never receives `crm` or `finance` in `modules`.
* `/api/internal/auth/session-state` refuses a session cookie and refuses a
  wrong service credential.

**Cross-application**

* A real CRM-issued token verifies in Warehouse's verifier unmodified. This is
  the one test that proves the two contracts actually meet; it belongs in CI
  for both repositories.
* A CRM session cookie presented to Warehouse is refused (wrong audience).
* Bumping the version in CRM makes Warehouse refuse within the 30s cache
  window.

---

## 9. Open questions for the owner

1. **Tokens with no `session_version` at step 4** — reject (everyone signs in
   again at deploy) or treat as 0 (gentler, but a pre-gate token stays valid
   until it expires, up to 7 days)? *Recommend: treat as 0, then reject after
   7 days have passed.*
2. **Does `JWT_SECRET` exist in production?** If not, 0b is not a latent risk,
   it is the current state.
3. **Who are the first `warehouse_agent` identities**, and do they exist as CRM
   users today or do they need creating?

---

## 10. Every step needing explicit approval

| | Why |
|---|---|
| 🔴 Fix 0a | Touches live auth code on a mutating admin route |
| 🔴 Fix 0b | May reveal that production has no `JWT_SECRET` |
| 🔴 Step 4 — enforce `session_version` | Signs users out |
| 🔴 Step 6 — generate and store the private key | Creates a production secret |
| 🔴 Step 8 — service credential | Creates a production secret |
| 🔴 Step 9 — hand Warehouse its keys | Production environment change |
| 🔴 Step 10 — `/warehouse/*` rewrite | Production routing change |
| 🔴 Any Vercel or Atlas resource creation | Outside this repository |
