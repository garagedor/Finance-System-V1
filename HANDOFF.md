# HANDOFF — read this to resume the project

**To the Claude reading this:** This file is a session handoff so you can continue
seamlessly. The user (owner of LBS Garage Door, an Indianapolis-area garage-door
business) is a command-line beginner — explain things simply, give exact steps,
and confirm before anything destructive or anything that touches the live site.

---

## What this project is
- **LBS Garage Door CRM + Finance Portal** — a Next.js 16 (App Router, React 19) app.
- **Repo:** `github.com/garagedor/Finance-System-V1` (currently **public**).
- **Live site:** `new-system-v1.vercel.app` — auto-deploys when `main` is pushed.
- **Database:** MongoDB Atlas, DB name `ag`. The connection string is hardcoded in
  source (e.g. `src/lib/finance-db.ts`, `src/app/api/login/route.ts`), so the DB
  works from any machine with no setup. Collections of note: `Job`, `Technician`,
  `Location`, `users`, `finance_role`, plus many `finance_*` collections.
- **Secrets** (Plaid bank-sync, Supabase verify-reports, encryption key) live in
  `.env.local`, which is git-ignored. Without it, the core app/DB still work; only
  bank-sync / verify-reports / encrypted fields need it.

## How to work on this repo (important rules)
- **Before each distinct task, ASK the user: "local or online?"** Route accordingly.
- **Online** = push to `origin/main` → auto-deploys. Stage ONLY the relevant files;
  the working tree has lots of WIP — **never `git add -A` onto main**.
- **Local** = the dev server (`npm run dev` → http://localhost:3000), shows the
  uncommitted WIP. The **user runs the dev server themselves** in their own Terminal
  tab (Claude's sandbox tends to kill it). They paste errors back.
- For DB scripts, run Node with the sandbox disabled.
- **Never** ask the user to paste secrets/tokens into chat — give a shell-only path.

## Current branch / state
- All work-in-progress (ledger, finance portal, bank-txn calc, etc.) is on branch
  **`wip/transfer`**. `main` has only the shipped, reviewed work.
- The WIP is large and unfinished — the **area-manager ledger** feature (append-only
  ledger, balance = SUM of entries; tech-owned dispute/refund %) is built but never
  shipped. See `src/app/portal/ledger/*` and `src/lib/finance-ledger*`.

---

## What we did THIS session (June 2026)

1. **Users/roles audit.** Login/RBAC engine is sound (bcrypt, rate-limit, 2FA,
   permission catalog in `src/types/rbac.ts`, roles in `finance_role`).
   - **FIXED:** the `admin` role was missing `finance:area_managers:create` and
     `:delete` (seeded before those perms existed; seeder never overwrites). Added
     them directly in Atlas, so admins can create/delete area managers again.
     (Existing logins must log out/in to refresh their JWT permissions.)
   - **STILL OPEN (security):** DB credentials are hardcoded in ~28 files in a PUBLIC
     repo (+ Atlas firewall open `0.0.0.0/0`) — rotate + move to env + lock down.
     `Scanpay` user is type "simple" but wired to the admin role (effectively full
     admin). Legacy CRM APIs (`/api/jobs`, `/api/disputes`, `/api/verify/*`) have no
     server-side role check (client-gated only). Portal write routes only check
     "any finance/system perm," not the specific action.

2. **CRM sidebar world clocks (SHIPPED to `main`/live).** New `src/components/
   SidebarClocks.tsx` + wired into `src/components/AuthShell.tsx`. Live
   Indianapolis / Chicago / Israel clocks at the bottom of the sidebar, with a "+"
   to add more cities (saved to localStorage) and per-clock remove.

3. **Job.date format fix (DB data).** Balance-report "wrong dates" was NOT a timezone
   bug — `Job.date` was stored in TWO formats: ISO `YYYY-MM-DD` and US `M/D/YYYY`.
   The report filters/sorts by lexical string compare, which only works for ISO.
   Normalized all **13,174** `M/D/YYYY` values → ISO, backing up each original to a
   new `date_legacy` field. Verified 0 non-ISO remain. (Shared DB → fixed live too.)
   - **Still open:** 5,572 jobs have NO `date` field at all (invisible to date
     filters); left untouched.

4. **Penalty/report tech filter "no data" fixes (DB data).** `Technician._id` IS the
   tech's name; the report sends the tech `_id` and the server trims it
   (`route.ts` ~line 192). Mismatches hid jobs:
   - **Case/whitespace auto-fixed:** `RON→Ron`, `ilan→Ilan` (36 jobs), `sean→Sean`
     (65), `liad→Liad`, `Sub Indiana→Sub indiana`. Originals backed up to `tech_legacy`.
   - **Trailing-space techs renamed** (their names were stored as e.g. `"Yanai "`):
     **Yanai** (507 jobs/70 penalty), **Yosef** (308/37), **Aharon** (18/5). Renamed
     the `Technician` `_id` (copy+delete) and retagged the jobs; `tech_legacy` backup.
   - **PENDING — spelling-variant merges (need user confirmation, then apply):**
     - High-confidence: `Omri→Omari` (76 jobs / 27 penalty), `Jonathan Jobs→Jonathan`
       (61/14), `Anzulay→Azulay`, `Kfir Fort Wayne`+`Kifr Fort Wayne→Kfir`,
       `SN garag→SN Garage`.
     - Ambiguous (ask user): `Yarin Abutbul→?` (Yarin / Yarin Austin / abutbul),
       `Oriel→?` (Orel / Ariel), `Neria→?` (own tech / Neorhi).
     - Probably leave or create tech records: `Golan Sub`, `Sub Ben`, `GDS`,
       `No Tech` (placeholder — leave).

## Other open threads (from earlier in the project)
- **Recurring expenses:** analyzed Plaid `finance_bank_txn_synced` — fixed monthly
  bills ≈ $3,900/mo (RingCentral, storage units, RPS, software); LightingPR is
  recurring-but-variable advertising (~$20k+/mo). User may want these recorded as
  recurring expenses or a "Recurring" view. Data spans ~Feb–Jun 2026 only.
- **Disputes import:** imported 198 disputes into `Dispute` collection earlier.
  Remaining: verify a few date+total-only matches (esp. one flagged likely-wrong),
  process ambiguous/not-in-CRM/no-amount leftovers. Backup file with created IDs
  exists in the user's Downloads.
- **User-side TODOs:** set `JWT_SECRET` in Vercel; fix the Lovable tech-app resubmit
  (resubmitted weekly reports don't flip status back to Submitted); optional
  US-East migration (prod is slow — Vercel + Atlas both in Frankfurt, users in US).

## Reversibility of today's DB changes
- `Job.date_legacy` holds every original date string we changed.
- `Job.tech_legacy` holds every original tech value we changed.
- To inspect/rollback, query those fields.

---

## How to resume on a new machine (the user just moved to a MacBook)
1. They cloned the repo and checked out **`wip/transfer`**, ran `npm install`.
2. `.env.local` carried over by hand (it's git-ignored).
3. They run `claude` and point you at this file.
**First thing to do:** greet them, confirm you've read this, and ask whether they
want to continue with the pending **tech-name merges** (Omri→Omari etc.) or
something else. Then ask "local or online?" for whatever they pick.
