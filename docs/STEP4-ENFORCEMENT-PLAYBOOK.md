# Step 4 — enforcing `session_version`

**Prepared, not enabled.** This is the step that signs everyone out once, and
the one that actually closes the defect where disabling a CRM user leaves them
working for up to seven days.

Steps 2 and 3 (`639f591`) already record the version and bump it. Nothing reads
it for a decision yet. This document is the switch.

---

## 1. The exact code switch

One place: `readSession()` in `src/lib/rbac.ts`, after the claims are parsed.

```ts
// After the existing permission hydration, before the return:
if (claims._id) {
  const stored = await storedSessionVersion(claims._id);   // new, one indexed read
  const presented = typeof claims.session_version === "number" ? claims.session_version : 0;
  if (presented < stored) return null;   // the session has been invalidated
}
```

`return null` is deliberate: every caller already treats a null session as
signed out, so no route needs changing. The 401 path is the one that already
exists.

Two supporting pieces, both small:

* `storedSessionVersion(userId)` in `src/lib/session-version.ts` — a projected
  `findOne` on `_id` returning `session_version ?? 0`.
* A short per-request memo, because `readSession()` is called more than once in
  some requests and this adds a database read to the hot path.

**Deleted users.** A deleted user has no record to read, so `storedSessionVersion`
returns 0 and their token survives — as it does today. Closing that is a
one-line change to return `null` on a missing user, which also signs out
anyone whose record is temporarily unreadable. **Recommend doing it**, and
knowing that it couples the auth path to database availability.

---

## 2. Why existing sessions are invalidated

They are not, strictly — not by the switch itself.

Every token issued **before** step 2 shipped has no `session_version` claim,
which reads as `0`. Every user's stored version is also `0` until something
bumps it. `0 < 0` is false, so **pre-existing sessions keep working** under
option B below.

Under option A — the strict cutover — they do not, because a token with no
claim is rejected outright regardless of the stored value. That is a policy
choice, not a consequence.

---

## 3. Expected user-visible behaviour

| | Strict (A) | Compatible (B) |
|---|---|---|
| Signed-in user, token from before step 2 | **signed out at next request** | keeps working until the cookie expires |
| Signed-in user, token issued after step 2 | keeps working | keeps working |
| User disabled by an admin | **refused on the next request** | refused on the next request |
| Role permissions edited | holders refused on next request, sign in again with the new set | same |
| Anyone signing in | normal | normal |

A signed-out user sees the normal login screen. There is no error state and no
data loss: nothing is mid-flight that a re-login does not restore.

---

## 4. Blast radius

Everyone holding a session issued before step 2 deployed — under option A, up
to **every active user**, bounded by the 7-day cookie. Under option B, **zero**.

The practical number depends on when step 2 ships relative to step 4. If step 2
is deployed and left for eight days, every live token already carries the claim
and option A's blast radius is zero too. **That is the cheapest way to get a
strict cutover without signing anyone out: ship step 2, wait out the cookie
lifetime, then enforce.**

---

## 5. Recommended sequence

1. Deploy steps 2–3 (already committed, not deployed).  ✅ **done**
2. **Wait 7 days** — the cookie lifetime. Every live token now carries the claim.
3. Confirm with the query in §6.
4. Deploy step 4 at a quiet hour, announced.
5. Run §8.

### The clock

```
AUTH_BASELINE_DEPLOYED_AT    = 2026-10-06T17:40:26Z
EARLIEST_STEP4_ENFORCEMENT   = 2026-10-13T17:40:26Z
```

`AUTH_BASELINE_DEPLOYED_AT` is the Vercel Production *ready* timestamp for
deployment `dpl_CiQT4a5KKT5kKEqxeDpjXp2fSKw2` (SHA `e48e0e7`, alias
`new-system-v1.vercel.app`), not the commit date. The session cookie's
lifetime is 7 days, so a token issued in the last second before that
deployment expires at `EARLIEST_STEP4_ENFORCEMENT`. Enforcing before then
signs out people whose only fault is that they logged in early.

### Residual risk while the clock runs

Sessions issued before `AUTH_BASELINE_DEPLOYED_AT` carry no `session_version`
claim. Enforcement is off, so they behave exactly as they did before — which
means the original gap is still open for them: **disabling a user does not end
their session**, for up to 7 days. That is the pre-existing behaviour, not a
regression introduced here, and it is precisely what the wait is burning off.
It is deliberately *not* patched with a compatibility shim that would treat a
missing claim as invalid, because that shim is a mass sign-out wearing a
different name. If a specific account must lose access before
`EARLIEST_STEP4_ENFORCEMENT`, change its password — that path already works
today.

Done this way, A and B are indistinguishable in effect and A is chosen for the
stronger property.

If step 4 must ship sooner, pick A anyway and tell people they will sign in
again once.

---

## 6. Pre-deployment checks

- [ ] Steps 2–3 have been in production for longer than the cookie lifetime.
- [ ] `JWT_SECRET` present in Production and Preview *(confirmed 2026-10-06)*.
- [ ] How many live tokens predate step 2 — proxy query:
      `db.users.countDocuments({ session_version: { $exists: false } })`
      counts users never invalidated, not stale tokens. There is no server-side
      record of issued tokens, so **the only reliable bound is the 7-day cookie**.
- [ ] At least two admin accounts exist, so enforcing cannot lock out the only one.
- [ ] A rollback deploy is one revert away and someone is available to run it.

---

## 7. Deployment steps

1. Merge the enforcement commit.
2. Deploy.
3. Watch 401 rate for 10 minutes. A step change means option A is signing out
   pre-step-2 tokens — expected; a *rising* rate afterwards is not.
4. Run the smoke tests.

---

## 8. Smoke tests

1. **Normal sign-in** — sign out, sign in, load `/portal/dashboard`, load `/`.
   Confirms minting and verification agree on the claim.
2. **Disabled user is refused immediately** — as admin, disable a test account
   that is signed in elsewhere. In the other session, trigger any API call.
   Expect **401 on the first request**, not after a delay. *This is the test the
   whole gate exists for.*
3. **Role change invalidates** — edit a role's permissions while a holder is
   signed in. Their next request is 401; after signing in again they hold the
   new set. Check the role audit line reads `N session(s) invalidated`.
4. **A rename does not invalidate** — rename a signed-in user. They keep
   working. Guards against over-invalidating.
5. **Re-enable** — re-enable the account from (2), sign in, normal access.

---

## 9. Rollback

Revert the enforcement commit and deploy. Tokens become acceptable again
immediately; nothing persisted needs undoing, because steps 2–3 only ever wrote
a number nobody was reading.

Users signed out by the cutover stay signed out — they simply sign in again,
which they could do throughout.

---

## 10–12. Confirming each guarantee

Covered by smoke tests 2, 3 and 1 respectively. Each is a direct observation
rather than an inference: a disabled user's next request, a role holder's next
request, and a fresh sign-in.

---

## A vs B — the trade-off

**A. Strict cutover.** A token with no `session_version` is rejected.

*For:* no window in which an old token is exempt. One rule, no special case,
nothing to remember to remove later. The property is simple enough to state in
a sentence: every valid session carries a version and every version is checked.

*Against:* signs out everyone holding a pre-step-2 token, once.

**B. Absent reads as 0.**

*For:* nobody is signed out.

*Against:* it is a **permanent** exemption unless someone removes it, and it is
indistinguishable from the real thing on every normal request — the only time
it matters is the one time it matters, when an attacker presents an old token
after a user has been disabled. A compatibility shim that only fails during an
incident is the worst kind.

It is also not needed, because waiting out the cookie lifetime achieves B's
outcome with A's property.

**Recommendation: A, after waiting out the cookie lifetime.** That is the
deliberate strict cutover, with a blast radius of zero. If waiting is not
acceptable, still A — one sign-in is a small price and a temporary exemption
nobody removes is not temporary.
