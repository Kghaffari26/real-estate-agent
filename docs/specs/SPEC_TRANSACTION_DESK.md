# SPEC: Transaction Desk: merging Coastal Estates into Metro Pulse

Status: draft 2026-10-07. Source project: `Kghaffari26/luxury-realestate-dashboard` ("Coastal Estates — AI Concierge", Next.js 16 + Supabase). Target: this repo's Desk (`dashboard/` + `supabase/` + `agents/`).
**Runs after Listing Prep P6 / Gate G** (owner decision). It sits between Listing Prep and R4 in `SPEC_REGIONAL_DESK.md` §5.

---

## 0. How to use this spec (Claude Code)

Kickoff, after Gate G is approved:

> Read `docs/specs/SPEC_TRANSACTION_DESK.md`, then `SPEC_REGIONAL_DESK.md`, `SPEC_LISTING_PREP.md` §3, `docs/DESK_SETUP.md`, `STATUS.md` and `DECISIONS.md`. The Coastal Estates source is at `../projects/luxury-realestate-dashboard` (read-only reference; never copy its `.env.local`). Execute phases C0–C9 in order on a `transaction-desk` branch, stopping at each GATE. Log every judgment call as one line in `DECISIONS.md`.

**Rules:**

- **Port capabilities, not code.** Coastal's UI (dark-and-gold, Next.js server routes) does not come across. Every feature is rebuilt with the Desk's design system, data layer (zod, tolerant parsing), team RLS, test suites and worker/Edge Function patterns.
- **The Desk's existing tests stay green.** Coastal's code isn't coming across, so its own tests don't apply. These are the PGlite and real-stack RLS suites, `desk-db`, unit tests, e2e + axe, the bundle budget, the secret scan and the Python tests.

---

## 1. What Coastal Estates has, and what happens to each piece

| Coastal feature | How Coastal built it | Verdict in Metro Pulse |
|---|---|---|
| **Transaction Monitor**: paste a contract, and the AI extracts address, price, parties, dates and deadlines | Next.js route → Claude with the raw text, including names and contacts. | **Port, redact-first** (C2). Deadline dates are computed in code from extracted terms; the agent confirms before saving. |
| **Contract watcher**: drop PDFs into `deals/<slug>/`, which are extracted and posted to `/api/ingest-deal` | Local chokidar script plus JSON files in `public/`. | **Replace** with in-app upload to private storage, which queues an extraction job (C2). No local watcher, and no deal data in `public/`. |
| **Deadline Watch**: red ≤48 h, amber ≤7 d, green beyond | Computed client-side from the `deadlines` jsonb. | **Port** (C3) with a real `deadlines` table, clear/complete actions, an ICS calendar feed and an opt-in daily email digest to team members. |
| **Deadline alert settings**: SMS and email toggles | A **mock** (localStorage; "production fires SMS + email"). | **Port the real thing** (C3): email digest only, team members only. SMS is out of scope (A2P 10DLC registration). Nothing goes to clients automatically. |
| **Morning Briefing**: an executive summary of the pipeline | Claude over the full transactions JSON. | **Port** (C4). Facts are computed in code, the narration uses placeholders only, the number/date guard applies, and there's a template fallback. |
| **Instagram Studio**: 3 caption styles, hashtags, history, photo/video post package (ZIP), posting-time tips | Claude route, `instagram_posts` table, video metadata in localStorage. | **Port as Listing Studio** (C5): built from the property's confirmed facts and consented photos, with the fair-housing screen, California advertising disclosures and a ZIP package. Posting tips are labeled as a general heuristic. |
| **Market Pulse**: a city briefing via live `web_search`, cached 24 h | Claude with web search; Redfin/Zillow numbers quoted from search results. | **Replace** (C6) with a briefing narrated from **our own computed ZIP/city data** (region files, Desk market context), cited. Live web search becomes an optional, flagged "In the news" section that never supplies the stats. |
| **Document Vault** | localStorage demo. | **Port** (C7) to a private `deal-docs` storage bucket with team RLS. |
| **Client portal** `/client-portal/[id]` | Requires a Supabase login and shows the transaction row (including parties). | **Rebuild** (C7) as a **revocable, expiring share link** that needs no client account and shows an allow-listed subset only. |
| **Shared Leads Inbox + Quick-add lead** | localStorage demo. | **Port** (C8) as `clients` with stage `lead` (pulling the minimal R7 `clients` table forward), assignment, dedupe and do-not-call. |
| **Activity feed** | Demo events. | **Port** (C8) as an `activity` log written by database triggers. |
| **Listings map** (Mapbox/Google keys pasted into localStorage) | Third-party keys in the browser. | **Drop.** Transactions and leads pin on the existing atlas (C8) using the Desk's geocoded properties. |
| **Roles**: `agent` / `owner` (global) | `profiles.role`, `is_owner()`. | **Map to the Desk's team roles:** owner → manager, agent → agent, team-scoped. No global owner. |
| **Demo mode** (`NEXT_PUBLIC_DEMO_BYPASS_AUTH`, `demo-data.ts`, `sample-agent-pack`) | Auth bypass. | **No auth bypass.** A seeded **demo team** with clearly fictional data from the sample agent pack (C9), plus the existing fake backend for e2e. |

---

## 2. Decisions (owner, 2026-10-07)

| Question | Decision |
|---|---|
| Client personal data and AI | **Redact first.** Names, emails, phones and other identifiers are replaced with placeholders (`[Buyer 1]`, `[Seller 1]`, `[Escrow Officer]`, `[Phone 1]`…) **on the server** before any model call, then restored server-side after. This keeps the Desk rule from `SPEC_REGIONAL_DESK.md` §2: no personal data in an LLM prompt. |
| Timing | After Listing Prep P6 / Gate G. |
| Look | The Metro Pulse design system. Optionally, per-team branding (logo, accent, brokerage name) for client-facing outputs only: portal, studio package, briefing PDF. |
| Coastal repo afterwards | Commit its pending local changes first. After C9, mark it **archived** with a README pointer to Metro Pulse. Its sample pack (fictional data) seeds the demo team. |

---

## 3. Principles

1. **Dates and numbers come from code.** The model extracts **terms with their source quotes**, e.g. `{"term": "inspection contingency", "days": 17, "anchor": "acceptance", "quote": "…within 17 days after Acceptance…"}`. Python or TypeScript computes the date from the confirmed anchor date, so the model never outputs a computed date. If the contract states an explicit date, it's taken verbatim with its quote.
   - Do **not** hard-code statutory or form defaults (e.g. CAR RPA timelines) unless counsel provides them as a team setting.
   - **Day counting is part of each term.** The model also extracts, with quotes where the contract says so:
     - `day_type`: `calendar` or `business`;
     - `count_anchor_day`: whether the anchor day itself counts (usually not: "within 17 days after" starts the next day);
     - `roll`: what happens when the result lands on a weekend or holiday (`next_business_day`, `none`).
   - When the contract is silent on any of these, the draft marks the field **unresolved** and the agent picks before confirming. Code never guesses.
   - Holidays come from a team-setting calendar (seeded with US federal holidays, editable by managers), never from the model.
   - The date math is one shared function with shared test vectors in Python and TypeScript, including weekend and holiday rolls, business-day spans across holidays, and year-end.
2. **The agent confirms before anything is saved.** Extraction produces a **draft** shown side by side with highlighted source quotes. Nothing becomes a transaction or deadline until the agent confirms it, the same pattern as confirmed facts in Listing Prep.
3. **The server is the privacy boundary.** The browser may preview redaction, but the Edge Function or worker **re-runs redaction itself** and refuses to call the model if a detector still finds an identifier. The placeholder ↔ value map is stored only in Postgres (team RLS), never in a prompt, a log line or the model's output.
4. **No automatic messages to clients, ever.** Email digests go only to team members who opt in. Everything client-facing (portal link, captions, packages) is an artifact the agent chooses to share.
5. **Marketing copy is fair-housing screened** with the same screen as Listing Prep (`agents/listing_prep/fair_housing.py`). The rules are ported to a shared JSON rule file used by both Python and TypeScript, with shared test vectors.
6. **Costs are capped.** Every AI call logs tokens and USD to an `ai_usage` table, with a per-team daily cap (a team setting; default $2/day) and a per-call worst-case pre-check. This mirrors `agents_core.costs`.
   - The check is an **atomic reservation**, so concurrent calls can't all pass it. `ai_reserve(team, function, worst_case_usd)` is an RPC that locks the team's row for the day (`SELECT … FOR UPDATE`), then either inserts a `reserved` `ai_usage` row or refuses when spent plus reserved plus this call would exceed the cap.
   - After the call, `ai_settle(reservation, tokens_in, tokens_out, usd)` replaces the worst case with the actual cost. A failed call settles at what was actually billed (often $0).
   - Reservations left unsettled for over 15 minutes expire at their worst case, so a crashed function can't free budget it may have spent.
   - Test: N parallel reservations against a nearly exhausted cap; exactly the ones that fit succeed.

---

## 4. Architecture

- **Interactive AI** (extraction, captions, on-demand briefing): **Supabase Edge Functions**:
  - `ai-extract`, `ai-captions` and `ai-brief`. `ai-market` is added only if the C6 news flag is on.
  - Each one checks the caller's JWT and team membership, applies redaction (Deno port with shared vectors), enforces the cost cap, then calls Anthropic. The key is `ANTHROPIC_API_KEY` as a **Supabase secret**, never in the site.
  - Model IDs come from a shared config mirrored from `config/models.toml`:
    - fast tier: extraction and captions
    - smart tier: briefings
  - Each function returns structured output validated by zod, with one schema-repair retry and then a clear error.
- **Non-AI public endpoint:** `ics-feed`, an Edge Function deployed without JWT verification. It serves `/ics-feed?token=…` as `text/calendar` from `ics_tokens` (§5). It never logs the token (only its hash prefix) and returns 404 for an unknown, revoked or rate-limited token, so the response doesn't reveal which.
- **Scheduled AI and jobs:** the existing **Python worker** (`listing-prep-worker.yml` pattern). It handles:
  - the 06:30 PT daily briefings
  - deadline digests
  - extraction jobs queued from uploads, polled every 5 minutes; the UI shows "Extracting…" and also offers an immediate path through `ai-extract` for pasted text
- **PDF text:** extracted server-side in the worker (pdfplumber/pypdf).
  - If a PDF has no text layer, it's treated as scanned. The UI says "Scanned document: paste the text or enter details manually". OCR is out of scope for C2.
  - Raw files live in the private `deal-docs` bucket. Extracted text is stored redacted (`deal_documents.redacted_text`), and the raw text goes in `deal_document_raw` (§5) for the agent's own review.

---

## 5. Data model (new migrations; team RLS; tests in PGlite + real stack)

| Table | Key columns | Access |
|---|---|---|
| `transactions` | `team_id`, `property_id` (nullable FK to `properties`), `assigned_agent`, `status` (`active`, `pending`, `closed`, `cancelled`), `price_cents` (bigint, **not text**), `acceptance_date`, `closing_date`, `notes`, `confirmed_at`, `confirmed_by` | Assigned agent + team managers read and write. Other agents on the team see only address, status and dates through a view (`transactions_team_board`), never parties. |
| `transaction_parties` | `transaction_id`, `role` (enum: buyer, seller, listing_agent, buyers_agent, escrow, lender, title, attorney, other), `name`, `email`, `phone`, `placeholder` (e.g. `[Buyer 1]`) | Same as the parent transaction. Personal data. |
| `deadlines` | `transaction_id`, `label`, `due_date`, `source_quote`, `computed_from` (jsonb: term, days, anchor), `status` (open, done, waived), `done_by`, `done_at` | Same as the parent. A derived `urgency` view uses ≤48 h critical and ≤7 d warning, team-timezone aware (default America/Los_Angeles). |
| `deal_documents` + `deal-docs` bucket | `transaction_id`, `kind` (contract, addendum, disclosure, inspection, other), `path`, `redacted_text`, `text_status` | Same as the parent. Storage path `team/<team>/deal/<txn>/…` enforced by storage policies. |
| `deal_document_raw` | `document_id` (PK, FK), `raw_text`, `extracted_at` | Same as the parent document. Encrypted at rest by Supabase's disk encryption. There is no column-level encryption, because pgsodium is deprecated on Supabase; revisit with Vault if the owner wants it. **Never selected by any function that builds a prompt** (prompt builders read only `redacted_text`). The same test as `redaction_maps` asserts this. Deleted with the document. |
| `extraction_jobs` | `document_id`, `status`, `draft` (jsonb with placeholders), `error`, `cost_usd` | Same as the parent. Written by the worker (service role). |
| `clients` (minimal R7, pulled forward) | `team_id`, `assigned_agent`, `stage` (lead, active, under_contract, closed, lost), `name`, `email`, `phone`, `source`, `budget_min`, `budget_max`, `target_areas` (ZIP/city ids), `do_not_call`, `notes` | Team-visible. Do-not-call blocks future call logging (R7). Export and delete by request (RPC). |
| `social_posts` | `team_id`, `property_id`, `agent`, `captions` (jsonb), `screen_result`, `created_at` | Team-visible. |
| `portal_links` | `transaction_id`, `token_hash`, `fields` (allow-list), `expires_at`, `revoked_at`, `last_viewed_at`, `view_count` | Managers + assigned agent. Public read **only** through `portal_view(token)`, a SECURITY DEFINER RPC that hashes the token and returns allow-listed fields. Tokens are 256-bit random, so guessing is infeasible. The limit protects against a leaked link being hammered. |
| `portal_hits` | `token_hash`, `minute` (timestamptz truncated), `count` | No direct access. `portal_view` upserts the current minute's row and refuses past **30 views/minute per token**, or 500/day. Unknown tokens are counted the same way, by their hash, so probing costs the same. Rows older than 2 days are purged by the worker. Postgres doesn't see the client IP reliably, so the limit is per token, not per IP. |
| `ics_tokens` | `user_id`, `token_hash`, `created_at`, `revoked_at`, `last_fetched_at` | The user only (create, revoke). One active token per user; rotating it revokes the old one. Read publicly **only** through the `ics-feed` Edge Function (§4), which hashes the token, looks it up with the service role, and returns that user's open deadlines. The feed has labels, dates and a property address, but no party names and no prices. Same rate limit as the portal, via `portal_hits` keyed by the token hash. |
| `alert_prefs` | `user_id`, `email_digest` (bool), `digest_hour`, `include_team` (managers only) | The user only. |
| `activity` | `team_id`, `actor`, `kind`, `subject_type`, `subject_id`, `summary` (no personal data), `at` | Written by triggers. Team-visible, filtered by the subject's own RLS through a view. Trigger summaries are built only from ids, statuses, labels, the property address and placeholders (`[Buyer 1]`), **never** from `transaction_parties`, `clients` name/email/phone, `notes` or document text. The UI resolves names at read time under the reader's own RLS. Test: fire every trigger on fixtures with known identifiers and assert that no `activity` row contains any of them. |
| `ai_usage` | `team_id`, `user_id`, `function`, `model`, `status` (reserved, settled, expired), `reserved_usd`, `tokens_in`, `tokens_out`, `usd`, `at` | Managers read; service writes through `ai_reserve` / `ai_settle` only (§3.6). |
| `redaction_maps` | `subject_type`, `subject_id`, `placeholder`, `value` | Same as the subject. **Never selected by any function that builds a prompt;** a test asserts this. |

**Data migration from Coastal:**
- `scripts/import_coastal.py` is a dry-run by default. It maps Coastal `profiles` to Desk team members by email and `transactions` (text price → cents, jsonb parties/deadlines → tables) into one target team.
- It runs **only if** the owner confirms Coastal's Supabase holds real data. Otherwise skip it and seed the demo team (C9).

---

## 6. Redaction (the part that must not fail)

**Detectors, in order:**
1. Structured identifiers by pattern:
   - emails
   - US phone numbers (all common formats)
   - SSN/ITIN
   - bank, loan, escrow and APN-like account numbers
   - URLs with query strings
   - DRE license numbers of non-team agents
2. **Labeled parties:** names following role labels ("Buyer:", "Seller(s):", "Escrow Officer", "Listing Agent", signature blocks, "by and between X and Y").
3. **Known parties:** for re-runs and briefings, every `transaction_parties` name and its variants (first-last, last-first, initials).
4. **Agent preview:** the extraction screen shows *exactly* the redacted text the model will see. The agent can click any span to redact it (it's added to the map) before sending.

**What is not redacted:** the property address (needed for the deal, and not client personal data in this context), prices, dates, contract terms, and the team's own agent names. The team can opt to redact these too.

**Enforcement:**
- The Edge Function and worker re-run detectors 1–3 on the final prompt.
- Any hit → refuse with the reason, and log the detector name only.
- Output rehydration happens server-side, and only into fields the agent sees.

**Tests:**
- A labelled set built from Coastal's `deals/sample-agent-pack` (fictional) plus synthetic variants: 30+ documents with tricky cases (names inside sentences, "Jr.", hyphenated names, phones with extensions, emails in signatures).
- **Leak test:** for every fixture, the final prompt contains none of its known identifiers. **Target: 0 leaks.** Recall on labelled names ≥ 0.98, with the agent preview as the backstop.
- A snapshot test that no log line, `ai_usage` row or error message contains raw identifiers.

---

## 7. Phases and gates

| Phase | Work | Done when |
|---|---|---|
| **C0 Prep** | Commit Coastal's pending local changes (owner, or with the owner's OK). Inventory Coastal's prompts, schemas and sample pack. Port the sample pack (fictional) as fixtures. Port the fair-housing rules to a shared JSON. Confirm whether Coastal's Supabase holds real data. | `DECISIONS.md` entries; the fixture set is labelled. |
| **C1 Data model** | The §5 migrations, storage policies, triggers, views and RPCs (`portal_view`, `ai_reserve`/`ai_settle`, client export/delete). | RLS suites (PGlite + real stack) prove: team isolation; agents can't read other agents' parties; portal tokens expose only allow-listed fields; the portal rate limit holds; `redaction_maps` and `deal_document_raw` are unreachable from prompt builders; no activity summary contains an identifier; parallel cost reservations can't exceed the cap. |
| **C2 Contract intake** | Upload (PDF/DOCX/TXT) or paste → redaction preview → `ai-extract` (or a worker job for files) → a draft with source quotes → code-computed deadlines → agent confirm → transaction, parties and deadlines saved. Link to an existing property or create one through the geocode function. | Extraction eval on the labelled set: field accuracy ≥ 0.95 on address, price and explicit dates; `day_type`/`count_anchor_day`/`roll` correct or marked unresolved (never wrong); deadline dates exact against hand labels, with fixtures that include business-day terms and weekend/holiday rolls; 0 redaction leaks; e2e on desktop + 360 px. |
| **C3 Deadline Watch** | A board (48 h / 7 d / later, grouped by transaction), mark done or waived, an ICS feed per agent (`ics_tokens` + the `ics-feed` function: secret URL, revocable, rotatable), and an opt-in daily email digest to team members only (Resend or SMTP via a worker; the owner supplies the key and a verified domain). | **GATE H:** screenshots plus a real digest email received by the owner. |
| **C4 Briefings** | Facts computed in code (counts, items due, stale deals, closings this week) → narration from placeholders with a number/date guard → template fallback. Daily per agent and per manager, plus on demand. Optional team-branded PDF. | Guard tests; an eval on 5 recorded pipelines (no invented deals or dates); 0 leaks. |
| **C5 Listing Studio** | From a property's confirmed facts and **consented** photos: 3 caption styles, a fair-housing screen with explanations, a banned-cliché list, required disclosures as team settings (brokerage name, agent name and **DRE license number** for California advertising; counsel confirms the rule), history, a ZIP package (photos, captions, optional video in storage), and posting tips labelled "general heuristic". | Fair-housing test vectors pass in both languages; e2e; axe. |
| **C6 Market briefing** | A ZIP/city briefing narrated from our published region data and market context (every number from data, with citations). Optional `ai-market` "In the news" via web search behind a team flag: separate section, linked sources, never mixed into the stats. | Number guard: 100% of figures traceable to region JSON; template fallback. |
| **C7 Documents + client portal** | The deal-documents vault (upload, kinds, share toggles per document) and portal links (expiring and revocable). The portal shows status, a milestone timeline, upcoming deadline labels and dates, agent contact, shared documents (short signed URLs) and team branding. It never shows other parties' contacts, notes or prices unless explicitly allow-listed. | **GATE I:** the owner opens a portal link on a phone; revocation verified; axe. |
| **C8 Leads, activity, map** | Leads inbox (quick-add, assignment, dedupe on email/phone, do-not-call, convert to client), activity feed, and transactions/leads layers on the atlas (by property) with the manager view (pipeline by stage, deadlines due, leads by area). | e2e; data-export and delete tests. |
| **C9 Demo team, docs, archive** | Seed a "Demo — Coastal Estates" team with fictional data (sample pack + synthetic), a `DESK_SETUP.md` section (new secrets, email domain, costs), screenshots, README. Coastal's README points here and the repo is archived (owner action). | **GATE J:** final review; merge; live verify. |

---

## 8. Out of scope (for now)

- SMS
- OCR of scanned contracts
- e-signature
- sending anything to clients automatically
- payments
- MLS listing data (R4)
- posting to Instagram via API (the package is downloaded and posted by the agent)

---

## 9. What the owner provides

- **Anthropic API key** as a **Supabase secret** (`supabase secrets set ANTHROPIC_API_KEY=…`), never in GitHub Pages or chat.
- **For the C3 email digest:** an email provider key (e.g. Resend) and a **verified sending domain**.
- **Brokerage disclosures:** brokerage name, each agent's DRE license number, and counsel's confirmation of the advertising and portal wording.
- **Coastal's data:** whether its Supabase project contains real data to import, and the target team. Also commit Coastal's pending local changes before C0.
- **Per-team AI cost cap** (default $2/day).
