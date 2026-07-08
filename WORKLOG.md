# WORKLOG — shared running log between machines/sessions

**Purpose:** This is the shared memory between Claude sessions (e.g. the Windows PC
and the MacBook). Whichever session makes a change records it here, so the other
session is fully caught up after a `git pull` ("get the latest").

**To the Claude reading/updating this:**
- When you start work, READ the top entries to see what the other session did.
- When you make any change, ADD a new entry at the **top** of the Log section.
- Use this format and tag each entry **DATA** (cloud database — auto-shared),
  **LIVE** (deployed to `main`/Vercel), or **LOCAL** (code on the workbench branch,
  not yet deployed). Note any pending follow-ups.
- Keep it short — one line per change. This file lives on the `wip/transfer` branch.

```
### YYYY-MM-DD — <machine> — <DATA | LIVE | LOCAL>
- what changed (and any backup field / commit / pending note)
```

---

## Log

### 2026-07-08 — Mac — LIVE
- **BIG DEPLOY:** merged `wip/transfer` into `main` (commit `70049d3`) → Vercel
  auto-deploy. Ships the full Portal (dashboard, banking, reconcile, imports,
  admin/users/roles, TOTP), the **append-only Area-Manager / Technician Ledger**
  (first prod release), Plaid integration, and legacy-route rewrites
  (`disputes`, `home-stats`, `login`, `report`, `refunds`). 151 files.
- Rollback path: Vercel Dashboard → project → Deployments → previous good one →
  "Promote to Production" (instant, no rebuild). Rollback does NOT undo DB writes.
- Pending post-deploy check: verify `PLAID_ENV`, `SUPABASE_*`, `FINANCE_ENCRYPTION_KEY`
  are set in Vercel; without them, bank-sync / verify-reports / encrypted-field
  features silently break in prod. Core app + login work regardless.
- Also pushed `chore: package-lock 'peer: true' bump` (`2036ede`) as the pre-merge
  clean-up on `wip/transfer`.

### 2026-06-24 — Windows PC — setup
- Created this shared WORKLOG.md so the Windows and Mac sessions stay in sync.
- Pushed all WIP + `HANDOFF.md` to branch **`wip/transfer`** for the move to the Mac.
- Reminder of the user's commands: **"save"** = back up to `wip/transfer` (no deploy);
  **"deploy"** = push `main` (goes live, confirm first); **"get the latest"** = pull.

### 2026-06-24 — Windows PC — DATA
- Fixed tech-name filter "no data" in the report: case/whitespace normalized
  (`RON→Ron`, `ilan→Ilan`, `sean→Sean`, `liad→Liad`, `Sub Indiana→Sub indiana`,
  106 jobs) and trailing-space techs renamed (`Yanai`/`Yosef`/`Aharon`, 833 jobs +
  Technician `_id` rename). Originals backed up to `Job.tech_legacy`.
- **PENDING (needs user OK):** spelling-variant merges — `Omri→Omari` (27 penalty
  jobs), `Jonathan Jobs→Jonathan` (14), `Anzulay→Azulay`, `Kfir`/`Kifr Fort Wayne→Kfir`,
  `SN garag→SN Garage`; ambiguous: `Yarin Abutbul`, `Oriel`, `Neria`.

### 2026-06-24 — Windows PC — DATA
- Normalized `Job.date`: 13,174 US `M/D/YYYY` dates → ISO `YYYY-MM-DD` (fixed the
  balance-report "wrong dates"). Originals backed up to `Job.date_legacy`.
  (5,572 jobs still have no date at all — untouched.)

### 2026-06-24 — Windows PC — LIVE
- Shipped CRM sidebar world clocks (Indianapolis / Chicago / Israel + "add city")
  to `main` → live. New `src/components/SidebarClocks.tsx` + `AuthShell.tsx` wiring.

### 2026-06-24 — Windows PC — DATA
- Users/roles audit. Added the 2 missing `finance:area_managers:create`/`:delete`
  perms to the `admin` role in Atlas (admins can create/delete area managers again;
  existing logins must log out/in to refresh).
