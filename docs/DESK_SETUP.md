# Setting up the Desk's backend (Supabase)

The Desk (`#/desk`, spec `docs/specs/SPEC_REGIONAL_DESK.md` R3) signs people in by
email link and keeps team data in a Supabase project. The site only ever gets the
project URL and the **anon (publishable) key**. Both are public by design, and
row-level security (`supabase/migrations/`) protects every row. The **service-role
key never goes into the site, a GitHub secret the build reads, or a chat**. The build
refuses a config that isn't `{ url, anonKey }` with an anon key, and
`npm run check:secrets` fails CI if a service-role JWT or an `sb_secret_` key appears
anywhere in `dashboard/dist/`.

## 1. Create the project

1. In [supabase.com](https://supabase.com), create a new project. Pick a region near
   Orange County, e.g. *West US (North California)*. Save the database password in
   your password manager; you need it only to apply migrations.
2. **Project Settings → API**: copy the **Project URL** and the **anon / publishable**
   key. Ignore the `service_role` / secret key.

## 2. Apply the database migrations

From a machine with the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

`db push` applies `supabase/migrations/*.sql`: the tables, row-level security policies,
the `create_team` / `my_invites` / `accept_invite` / `confirm_facts` functions, and the
private `property-photos` storage bucket with its policies (Listing Prep intake). To check the result,
run `select tablename, rowsecurity from pg_tables where schemaname = 'public'` in the
SQL editor. Every row should show `true`.

Then deploy the address lookup, an Edge Function that proxies the Census Bureau geocoder.
The geocoder has no CORS headers, so the browser can't call it directly:

```bash
supabase functions deploy geocode
```

It holds no secrets and reads no rows. Supabase checks the caller's sign-in before it
runs (`verify_jwt`), so only signed-in team members can use it.

## 3. Auth URLs

**Authentication → URL Configuration**:

| Setting | Value |
| --- | --- |
| Site URL | `https://kghaffari26.github.io/real-estate-agent/` |
| Redirect URLs | `https://kghaffari26.github.io/real-estate-agent/**` |
| | `http://localhost:5173/real-estate-agent/**` (dev server) |
| | `http://localhost:4173/real-estate-agent/**` (preview) |

Sign-in uses PKCE. The link returns to `…/real-estate-agent/?code=…#/desk`, and the
page exchanges the code and strips it from the address. A link has to be opened in the
same browser that asked for it, because the PKCE verifier is stored there.

**Authentication → Providers → Email**: leave Email enabled and turn *Confirm email*
off. The magic link is itself the confirmation.

## 4. Email: custom SMTP and the rate limit

Supabase's built-in email sender is for trying things out. It sends only a handful of
auth emails per hour per project, and only to addresses on the project's team. When the
cap is hit, the API answers `429 over_email_send_rate_limit`. The Desk then shows
"Too many sign-in emails were sent in the last hour…" instead of a generic error. If
someone asks again for the same address within about a minute, the Desk tells them how
many seconds to wait.

For a real team, plug in your own SMTP:

1. Pick a transactional email provider, such as Resend, Postmark, Amazon SES or SendGrid.
   Verify the sending domain there (SPF/DKIM records on your brokerage's domain), and
   create SMTP credentials.
2. **Authentication → Emails → SMTP Settings** (*Project Settings → Authentication* in
   older dashboards): enable custom SMTP and enter the host, port (465 or 587), user,
   password, sender email (e.g. `desk@yourbrokerage.com`) and sender name
   (`Metro Pulse Desk`).
3. **Authentication → Rate Limits**: raise *Emails sent per hour* to fit the team.
   About 30–100 is plenty for a brokerage. This setting is only editable once custom
   SMTP is on.
4. Optional: **Authentication → Emails → Templates → Magic Link**. Brand the email and
   keep `{{ .ConfirmationURL }}` as the link.

The SMTP password lives only in the Supabase dashboard. It never goes in this repo or
in a GitHub secret the site's build can read.

**Local stack**: `supabase/config.toml` keeps `[auth.rate_limit] email_sent = 2`, so the
limit is easy to hit and test. `supabase start` catches every email in Inbucket/Mailpit
at http://127.0.0.1:54324, so no SMTP is needed. To test real delivery locally,
uncomment `[auth.email.smtp]` there and export the password as `SMTP_PASSWORD`. The file
reads it with `env(SMTP_PASSWORD)`, so it's never committed.

## 5. GitHub secrets (Settings → Secrets and variables → Actions)

| Secret | Value | Used by |
| --- | --- | --- |
| `SUPABASE_URL` | the Project URL (`https://<ref>.supabase.co`) | `dashboard.yml` build → `desk-config.json` |
| `SUPABASE_ANON_KEY` | the **anon / publishable** key | same |

That's all the site needs. Without them, the Desk says "not configured" and the rest of
the site is unchanged. The site never gets the service-role key: the build fails if it's
pasted into `SUPABASE_ANON_KEY` by mistake, and `check:secrets` scans the built site for it.

### The Listing Prep worker (photo findings and photo housekeeping)

The worker (`agents/listing_prep/worker.py`, run by `.github/workflows/listing-prep-worker.yml`
every 15 minutes) works on the backend with the **service role**: it reads queued
analyses, writes findings, and deletes photo files through the Storage API. That key is a
secret of this workflow only. The site's build never reads it. Add it in GitHub
yourself, and never paste it into a chat.

| Secret / variable | Value | Used by |
| --- | --- | --- |
| secret `SUPABASE_URL` | (already added above) | the worker |
| secret `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` / secret key | the worker only |
| secret `ANTHROPIC_API_KEY` | (already used by the market agent) | the worker's photo analysis |
| **variable** `DESK_WORKER_ENABLED` | `true` | turns the scheduled worker on |

Until the variable is set, the workflow doesn't run. Without the Anthropic key, it does
housekeeping only (deleting removed and expired photos), and analyses stay queued.
The repository is public, so its logs are too. The worker logs counts and ids only:
no addresses, names, photos or findings.

The Edge Function (`geocode`) gets its own service key from Supabase automatically. It
uses that key only to write the shared address cache.

## 6. First team

Open the live site → **Desk**, sign in with the first manager's email, and create the
team. That account becomes its manager and invites everyone else from the Team panel.
Invites are tied to an email address and expire after 14 days.

## Local development against a local stack

```bash
supabase start                      # needs Docker; applies the migrations
supabase status                     # prints the local API URL and anon key
cd dashboard
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<local anon key> npm run dev
DESK_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run src/backend/rls.test.ts
```

The `desk-db` workflow runs that last command on every change to `supabase/` or
`dashboard/src/backend/`. Every other test run proves the same policies on PGlite.
