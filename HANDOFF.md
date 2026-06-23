# HANDOFF — full project context (read this first to resume)

**To the Claude reading this:** This is a complete handoff covering the whole
history of this project across many sessions, so you can continue with full
context. Read it top to bottom. After reading, greet the user, confirm you're
caught up, and ask what they want to work on next (then ask "local or online?").

---

## 0. Who the user is — how to work with them
- Owner of **LBS Garage Door** (a.k.a. Door System 317), an Indianapolis-area
  garage-door business. Email `317garagedoor@gmail.com`.
- **Command-line beginner.** Give **small, concrete, copy-pasteable steps**, one
  decision at a time. Spell out things power users skip. Don't assume tools are
  installed — check first.
- **Secrets-handling rule (important):** never invite the user to paste a secret
  (token/key/password) into chat — they have a recurring habit of doing exactly
  that. Always give a shell-only path. When inspecting files that may hold secrets
  (e.g. `.env.local`), print key *names* only, never values.

## 1. Project overview
- **LBS Garage Door CRM + Finance Portal** — Next.js 16 (App Router, Turbopack),
  React 19. Project root on the original PC: `/home/yehonatancohen/lbs-garage-door-main`
  (on the Mac it'll be wherever they cloned it, e.g. `~/Finance-System-V1`).
- **Repo:** `github.com/garagedor/Finance-System-V1` (**public**). GitHub auth is the
  `garagedor` account. `main` is the only deploy branch.
- **Live site:** `new-system-v1.vercel.app` (Vercel, Hobby plan, project
  `new-system-v1` under `garagedors-projects`). **Pushing `main` auto-deploys.**
  `next.config.ts` has `typescript.ignoreBuildErrors: true` — don't remove without
  cleaning the TS errors first.
- **Backends:**
  - **MongoDB Atlas**, DB name **`ag`** — primary CRM data. The connection string is
    **hardcoded in ~28 source files** (so the DB works from any machine, no setup).
    Key collections: `Job`, `Technician` (its `_id` IS the tech's name), `Location`,
    `users`, `finance_role`, `Dispute`, and many `finance_*` collections
    (`finance_bank_txn_synced`, `finance_payout`, `finance_ledger`, etc.).
  - **Lovable Cloud Supabase** (`weekly_reports` table) — used by the verify-reports
    feature. Creds live in `.env.local` (`SUPABASE_*`).
  - **Plaid** — bank sync. Keys in `.env.local` (`PLAID_*`).
  - `.env.local` is git-ignored (holds the above secrets + `FINANCE_ENCRYPTION_KEY`).
    Without it, core app + DB still work; only bank-sync / verify-reports / encrypted
    fields need it. Login does NOT need it (JWT secret falls back to a default).

## 2. Working rules (follow these)
- **Before each distinct task, ASK "local or online?"** and route accordingly.
- **Online** = push to `origin/main` → auto-deploys. **Stage ONLY the relevant files
  — never `git add -A` onto main.** The working tree carries lots of unrelated WIP.
  If one file mixes deploy + WIP changes, surgically extract only the deploy hunks.
  The clean way used this session: build the change in a fresh `git worktree` off
  `origin/main`, commit only those files, push.
- **Local** = work lives uncommitted (or on a named branch). The **user runs
  `npm run dev` themselves** in their own terminal (Claude's sandbox SIGKILLs the dev
  server — exit 144 — every way tried; don't waste turns retrying). To debug runtime
  errors, ask the user to paste them. Static code + direct MongoDB inspection (Node
  scripts with sandbox disabled) DO work — use those.
- Writing RBAC/permission changes or bulk data to the prod DB can trip a safety
  classifier — get explicit per-write user approval.

## 3. History highlights (so you don't repeat mistakes)
- **v1 shipped 2026-05-11**; v1 and v2-WIP were later unified onto `main` (single
  branch, auto-deploy).
- **A full ServiceTitan-style field-service layer (customers, work orders, dispatch
  board, tech mobile, invoicing) was BUILT then DELETED at the user's request
  (2026-06-07). Do NOT rebuild it unprompted.** If operational-CRM features come up,
  ask what they want *different* this time. Leftover harmless DB artifacts may remain
  (extra seeded `finance_role` rows like csr/dispatcher/technician/etc., orphan
  `crm_*` collections) — not dropped, pending explicit OK.
- The user has been burned by a git mix-up before — **warn before destructive git ops**
  (force push, branch delete).

## 4. Major features & their state
### Area-Manager / Technician Ledger (BIG feature — built, LOCAL/uncommitted, now on `wip/transfer`)
- A **true append-only ledger**: every money movement = one immutable entry;
  **balance = SUM of entries** (NOT a spreadsheet recompute). Modeled on the user's
  Hebrew Excel workbook (`ניהול כספים מינסוטה` = the CRM location "Minneapolis").
- **Sign:** negative/red = company owes them; positive/green = they owe company.
- **Dispute/refund % is owned by the TECHNICIAN** (25 / 30 / 32.5 / 35 / 40 / special),
  looked up per entry, NOT a property of the area manager.
- Built across `src/app/portal/ledger/*`, `src/lib/finance-ledger*`,
  `src/lib/portal-tech-rates.ts`, `src/app/api/portal/ledger/*`. Phases 1–4 + payments
  DONE: ledger CRUD + running balance; "Add CRM Balance Report" (reuses
  `/api/balance-report`, Tech/Location, closed jobs only); tech-rate overrides
  (`finance_technician_rate`); one-click reversing entries; record-payment with
  optional matching to bank txns (Plaid) or portal payouts (`finance_payout` is
  currently empty). **Never shipped to prod.** Remaining-optional: import Excel
  history as opening entries; optimize location roll-up (currently N self-fetches).

### Verify-Reports (verifier side only)
- `src/app/verify-reports/*` + `src/app/api/verify/*` is the **verifier/admin** side —
  reads Supabase `weekly_reports`, PATCHes status. The **technician submit/resubmit app
  is a SEPARATE Lovable app**, not in this repo.
- **Known bug (fix pending in Lovable, user's job):** when a tech resubmits a
  *Returned* report, Lovable leaves `status='Returned'` and doesn't re-stamp
  `submitted_at`, so it never re-enters the queue.
- Shipped mitigations (online): a "resubmitted" badge that surfaces Returned reports
  edited after return (commit 97dee59); and auto-step approve so a Returned report can
  be Approved in one click (commit 62b04a3).

## 5. Known open issues / pending work
- 🔴 **Security (from RBAC audit 2026-06-24):** Atlas DB user+password hardcoded in ~28
  files in a PUBLIC repo + Atlas firewall open `0.0.0.0/0`. Needs: rotate password,
  move to env var, re-close firewall. Also `Scanpay` user is "simple" type but wired
  to the admin role (effectively full admin); ~10 of 14 users have full/near-full
  admin. Legacy CRM APIs (`/api/jobs`, `/api/disputes`, `/api/verify/*`) have no
  server-side role check (client-gated only). Portal write routes only check "any
  finance/system perm," not the specific action.
- 🟠 **Prod is slow on mobile (diagnosed 2026-06-17, fix deferred):** Vercel functions
  (`fra1`) AND Atlas are both in **Frankfurt**, users are in the US. Fix = move BOTH to
  US-East (`iad1` + a new us-east-1 Atlas cluster, migrate data). Don't move only one.
  Interim: lazy-load recharts/ag-grid to slim the ~1.1MB bundle (helps mobile, not
  latency).
- 🟠 **Pending hygiene:** rotate the shared `admin123`-style passwords; move Mongo URI
  to `MONGODB_URI`; move JWT secret to `JWT_SECRET` env (currently falls back to
  `'super-secret-key-for-development'` in login/middleware/users — must all match).
  User also needs to set `JWT_SECRET` in Vercel.
- **5,572 jobs have NO `date` field** — invisible to date filters; left untouched.
- **Recurring expenses:** analyzed Plaid `finance_bank_txn_synced`. True fixed monthly
  bills ≈ $3,900/mo (RingCentral, storage units, RPS, software subs); LightingPR is
  recurring-but-variable advertising (~$20k+/mo). User may want them recorded as
  recurring expenses or a "Recurring" view. (Data spans ~Feb–Jun 2026 only.)
- **Disputes import:** ~198 disputes imported into `Dispute` collection earlier;
  a few date+total-only matches need verification (one flagged likely-wrong), plus
  ambiguous/not-in-CRM/no-amount leftovers. Backup of created IDs is in user's Downloads.

## 6. What we did THIS session (2026-06-24)
1. **Users/roles audit.** Login/RBAC sound. **FIXED:** added the 2 missing
   `finance:area_managers:create`/`:delete` perms to the `admin` role in Atlas (admins
   couldn't create/delete area managers). Existing logins must log out/in to refresh.
2. **CRM sidebar world clocks — SHIPPED to `main`/live.** New
   `src/components/SidebarClocks.tsx` + wired into `AuthShell.tsx`. Live Indianapolis /
   Chicago / Israel clocks + "+" to add cities (localStorage) + per-clock remove.
3. **Job.date format fix (DB).** Balance-report "wrong dates" was NOT timezones —
   `Job.date` had two formats: ISO `YYYY-MM-DD` (newer) and US `M/D/YYYY` (older), and
   the report compares dates as plain text. Normalized **13,174** `M/D/YYYY` → ISO,
   backing up each original to **`date_legacy`**. 0 non-ISO remain.
4. **Penalty/report tech-filter "no data" fixes (DB).** The report sends the tech
   `_id` (= the name) and the server trims it, so name mismatches hid jobs.
   - Case/whitespace auto-fixed: `RON→Ron`, `ilan→Ilan`, `sean→Sean`, `liad→Liad`,
     `Sub Indiana→Sub indiana` (106 jobs). Backup → **`tech_legacy`**.
   - Trailing-space techs renamed (`"Yanai "`→`Yanai`, `"Yosef "`→`Yosef`,
     `"Aharon "`→`Aharon`): renamed the `Technician._id` + retagged 833 jobs.
   - **PENDING — spelling-variant merges (need user OK, then apply):**
     high-confidence `Omri→Omari` (27 penalty jobs), `Jonathan Jobs→Jonathan` (14),
     `Anzulay→Azulay`, `Kfir Fort Wayne`+`Kifr Fort Wayne→Kfir`, `SN garag→SN Garage`.
     Ambiguous (ask): `Yarin Abutbul`, `Oriel`, `Neria`. Probably leave / make tech
     records: `Golan Sub`, `Sub Ben`, `GDS`, `No Tech` (placeholder — leave).

## 7. Reversibility of today's DB changes
- `Job.date_legacy` — every original date string we changed.
- `Job.tech_legacy` — every original tech value we changed.
- The world-clocks code is on `main`; everything else above is data in Atlas (shared,
  so it affected the live site too).

## 8. How the user got here / resuming
- The user moved from a Windows/WSL PC to a MacBook for a business trip. All WIP +
  this file are on branch **`wip/transfer`**. They cloned the repo, checked out that
  branch, ran `npm install`, and carried `.env.local` over by hand.
- **Your first move:** confirm you've read this, then ask whether to continue with the
  pending **tech-name merges** (start with `Omri→Omari`, 27 hidden penalty jobs) or
  something else — and ask "local or online?" for whatever they choose.
