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

### 2026-07-29 — Windows PC — LOCAL (JARVIS Phase 1)
- Started **JARVIS Live Executive Mode** (plan approved: `.claude/plans/sprightly-frolicking-
  rivest.md`). **Phase 1 — Live Assistant Foundation** done, READ-ONLY, no navigation yet.
  Provider-independent voice: `src/lib/ai/live/voice/` (types.ts interfaces STT/TTS/Realtime,
  web-speech.ts browser impl — $0, no dep, audio never leaves device). Presentation plan:
  `plan-schema.ts` (speak/show_evidence/ask now; navigate/highlight/propose_action declared for
  later). `orchestrator.ts` reuses the existing engine (`runAssistant`) → packages blocks into a
  plan. `session-log.ts` → `finance_ai_session` audit (command/tools/model/usage — NO audio/keys).
  API `POST /api/portal/ai/live` (gated admin/ai:live/ai:view, 503 w/o key). Client: global
  `LiveAssistant.tsx` orb mounted in `AuthShell` (persists across routes; renders only for
  AI-permitted users on portal paths), lightweight `AiBlocksLite.tsx` (NO recharts — global
  bundle stays small). State machine idle/listening/thinking/speaking + mic/stop/mute/transcript/
  subtitles. Added `system:ai:live` perm + `finance_ai_session` collection. Verified server-side:
  plan endpoint returns [speak,show_evidence] w/ trace+usage, 401 gate, session row written,
  portal pages render 200 with orb mounted. VOICE + visual = owner tests in browser (Chrome
  best for speech recognition; mic only on explicit press). Not committed, not deployed.

### 2026-07-29 — Windows PC — LOCAL (detector framework)
- Built the **Proactive Intelligence Framework** — scales to 100+ detectors; adding one =
  adding a DEFINITION, no engine change. New `src/lib/ai/monitors/`: `framework.ts`
  (DetectorDefinition: id/title/category/executives[]/severity/enabledByDefault/configFields/
  detect; RawFinding with priority inputs + recommendation fields; DetectorContext;
  CATEGORY_OWNERS), `priority.ts` (0–100 score from financial impact/severity/urgency/
  probability/risk/confidence + quick-win), `context.ts` (shared context built ONCE),
  `detectors.ts` (8 finance detectors refactored as definitions w/ configurable thresholds),
  `registry.ts` (ALL_DETECTORS; categories plug in), `config.ts` (per-detector enable/disable
  + tunables in `finance_ai_detector_config`), `run.ts` (ISOLATED runner — a throwing detector
  is logged+skipped, never breaks the run; returns priority-ranked ScoredFindings). Alerts now
  carry priority/category/executives[]/financialImpact/confidence/recommendedAction/effort.
  API `GET|POST /api/portal/ai/detectors` (list + toggle, manage-gated). New page
  `/portal/ai/detectors` with per-detector on/off toggles (`DetectorToggle.tsx`); "Detectors"
  tab added. `AlertFeed.tsx` rewritten to show priority badge + exposure + confidence + fix
  time + recommended action. Verified: regenerated brief via framework → 17 priority-scored
  alerts (dup payments P80-81, $50k outflow P74), toggle persists, pages render, isolated
  runner. Coverage grows gradually (finance done; technicians/customers/ops/inventory/strategy
  = just more definitions). Not committed, not deployed.

### 2026-07-29 — Windows PC — LOCAL (proactive engine)
- Built the **proactive engine** (Slice 2/3). Cost-aware design: deterministic detectors =
  FREE (no AI), ONE synthesis call per brief. New: `src/lib/ai/monitors/` (detectors.ts — 8
  detectors: negative cash, cash-flow decline, expense spike, duplicate payments, unusual
  outflow, unmatched bank txns, open disputes, ledger outliers — all grounded, defensive),
  `src/lib/ai/brief.ts` (runDetectors → persist alerts dedup-per-day → `provider.synthesize`
  → persist brief; getLatestBrief/getAlerts), provider gained `synthesize()` (structured
  one-shot, stays in provider layer). Collections `finance_ai_alert` + `finance_ai_brief`
  added to FINANCE_COLLECTIONS. API `POST|GET /api/portal/ai/brief/run` (admin/AI session OR
  Vercel-cron `Authorization: Bearer $CRON_SECRET`). UI: Command Center renders Morning Brief
  (overnight/attention/decisions/risks/opportunities/do-first) + AI Alerts feed + "Run now"
  button + per-exec alert badges; each executive desk shows its own flagged feed
  (`AlertFeed.tsx`, `RunBriefButton.tsx`). `vercel.json` nightly cron `0 11 * * *` (activates
  on deploy; needs `CRON_SECRET` in Vercel). Live test: generated brief_2026-07-29 → 29 alerts
  (auditor 28, controller 1), all 6 sections populated, model claude-opus-5, synthesis usage
  7313in/4315out (~$0.14). Renders correctly. NOTE: duplicate-payment detector is sensitive
  (flagged 25 pairs incl. recurring same-amount supplier payments like Amarr) — tunable. Not
  deployed, not committed.

### 2026-07-29 — Windows PC — LOCAL (engine live-tested)
- Owner added `ANTHROPIC_API_KEY`. Ran the full battery (read-only, nothing deployed):
  health OK; **auto-selected `claude-opus-5`** from 10 models (no `ANTHROPIC_MODEL` set) by
  the capability+recency policy; simple non-tool question → structured blocks, `toolsUsed:[]`;
  **AI CFO "how much can I safely spend today?"** → full dashboard (text+KPIs+table+alerts+bar
  chart+recommendations) off real Chase Plaid data ($860,636.86 net cash), called
  get_bank_balances/get_upcoming_payouts/get_recurring_expenses, correctly FLAGGED that the
  payout + recurring-expense collections are empty (data gap, not invented); trace carried
  dateRange/tools/freshness/usage/notes. Unauthorized: no-cookie + forged-JWT → 401 on both
  routes; permission guard (`admin` or `system:ai:view`) present. Added token `usage` to the
  trace. Cost of the whole battery ≈ $0.13. Slice-1 engine COMPLETE & working. Not committed,
  not deployed.

### 2026-07-29 — Windows PC — LOCAL (engine)
- Built the **AI engine** — provider-independent, read-only. New `src/lib/ai/`:
  `types.ts` (AiBlock union, Trace, ToolDef, AiProvider interface — no Anthropic refs),
  `model.ts` (NO hardcoded model id anywhere: if `ANTHROPIC_MODEL` is set it's validated
  against the live Models API — error, no silent switch — else the engine auto-selects the
  best model from the Models API by an explicit capability+recency policy, logs it, caches
  10min; `getModelStatus()` powers the health screen; thinking enabled only if the resolved
  model reports support), `providers/anthropic.ts`
  (tool-use loop → structured blocks + trace; final answer delivered via a `present_report`
  tool so responses are visual, not chat-only), `tools/finance.ts`+`index.ts` (read tools
  wrapping fetchDashboardData / bank-synced / payouts / recurring / ledger-sum, each reports
  freshness + is permission-gated), `engine.ts` (persona + permitted tools → provider).
  APIs: `POST /api/portal/ai/chat` (gated admin-or-`system:ai:view`, 503 w/o key) and
  `GET /api/portal/ai/health` (verifies key+model). Rewrote `ChatPanel.tsx` to render blocks
  (KPI cards, recharts line/bar, tables, recommendations, alerts) + a "Sources & method"
  trace panel. Added `@anthropic-ai/sdk@0.115`. Typecheck clean; health returns graceful
  `key:false` and chat 503 without a key; pages render. **Read-only only** (no write tools).
  Addressed owner's 7 principles: no hardcoded model, live model verification, structured
  (not chat-only) responses, full traceability, provider abstraction, read-only, engine done.
  BLOCKED on owner adding `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`) to `.env.local`.

### 2026-07-29 — Windows PC — LOCAL
- Started the **AI Workspace** ("executive team") — Slice 1 SHELL, local on wip/transfer,
  NOT deployed. New module under `src/app/portal/ai/`: `executives.ts` (6 personas — AI CFO,
  Controller, Operations, Analyst, Auditor, Strategy — each with role/mindset/systemPrompt/
  tools/watches/starters), `AiTabs.tsx`, `ChatPanel.tsx`, `access.ts` (admin-or-`system:ai:view`
  gate + `engineReady`), `parts.tsx`, `layout.tsx`, and pages: Command Center (`page.tsx`),
  executive desk (`[slug]/page.tsx`), Ask the Team (`ask/`), Action Center (`actions/`).
  Added `system:ai:view` + `system:ai:manage` to the permission catalog (`src/types/rbac.ts`)
  and a `🤖 AI` nav group + item (`src/app/portal/nav.ts`, FiCpu). Typecheck clean; all routes
  render 200; Command Center shows the exec grid + Morning Brief + "engine not connected".
  Design: personas = lenses over ONE engine + tool layer (per plan
  `.claude/plans/sprightly-frolicking-rivest.md`). NEXT: the engine — `@anthropic-ai/sdk`
  (provider-agnostic tool-use loop) + read tools wrapping existing logic + `POST /api/portal/ai/chat`.
  BLOCKED on the owner adding `ANTHROPIC_API_KEY` to `.env.local`. Write/execute tools wait
  for the DB-credentials security fix.

### 2026-07-27 — Windows PC — LIVE (config)
- Chase Plaid item showed status=error "Unsupported state or unable to authenticate
  data" (that's the Node AES-256-GCM decrypt-failure message). Cause: the prior fix
  added the 6 PLAID_* vars to Vercel but NOT `FINANCE_ENCRYPTION_KEY` (used to
  decrypt the stored access_token, `src/lib/portal-crypto.ts`). Online site could
  attempt syncs but fell back to the insecure dev-default key → GCM auth-tag fail →
  item flagged errored (token itself never damaged). Fix: added
  FINANCE_ENCRYPTION_KEY to Vercel Production (piped from .env.local), redeployed
  existing prod deployment. Verified: online sync HTTP 200 (added 29), item status
  back to `active`, status_message null. LESSON: when adding secrets to Vercel,
  include FINANCE_ENCRYPTION_KEY + SUPABASE_* too, not just PLAID_*.

### 2026-07-24 — Windows PC — LIVE (config)
- ROOT CAUSE of the "Plaid not configured" banner: the user was viewing the ONLINE
  (Vercel) site, which never had the PLAID_* env vars (they live only in local
  `.env.local`, git-ignored). Added all 6 (PLAID_CLIENT_ID/SECRET/ENV/PRODUCTS/
  COUNTRY_CODES/REDIRECT_URI) to Vercel Production via `vercel env add` (values piped
  from .env.local, never printed), then `vercel redeploy` of the existing prod
  deployment (NOT local WIP). Verified live: banner gone, mode=production,
  link-token=link-production HTTP 200. Required a one-time `vercel login` by the user.

### 2026-07-24 — Windows PC — diagnosis (no change, superseded by the LIVE fix above)
- "Plaid not configured / sandbox mode" banner on the banking page was a STALE
  RENDER, not a real problem. The connections page (`src/app/portal/banking/
  connections/page.tsx`) is a server component reading `process.env.PLAID_*` at
  render; an earlier dev-server incarnation started before `.env.local` was loaded
  and its render got cached. Freshly-restarted server renders correctly:
  "production" mode, no warning, link-token = `link-production`. Fix = hard-refresh
  the browser. If it persists, the browser is hitting a different dev server.

### 2026-07-24 — Windows PC — DATA
- Checked reported "Plaid connection issue" — connection is HEALTHY (creds valid,
  Chase item active, link-token + sync both HTTP 200). Real problem was STALE DATA:
  last sync was 2026-07-08 (16 days old). Ran a manual sync → added 340 new bank
  transactions, removed 31, into `finance_bank_txn_synced`. Awaiting user detail on
  exactly what looked broken (possible stale-data UI warning vs a real error).

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
