# Deploy guide (free tiers)

Time needed: about 1–1.5 hours the first time. Do the steps in order: each one gives you a value the next one needs.
Keep a private note open and paste each key into it as you go. **Never paste keys into chats, commits or screenshots.**

You will create 5 free accounts: **GitHub**, **Supabase**, **Google AI Studio**, **Render**, **Vercel**. On the phone you need **Expo Go** from the Play Store.

---

## 0. Put the code on GitHub (Render needs it)

Render only deploys from a Git repository, so the zip has to become a repo once.

1. Unzip `accessable-ai.zip`.
2. Create a **private** repo on GitHub (for example `accessable-ai`) with no README.
3. In the unzipped folder:
   ```bash
   git init
   git add .
   git commit -m "AccessAble AI initial import"
   git branch -M main
   git remote add origin https://github.com/<you>/accessable-ai.git
   git push -u origin main
   ```
   The `.gitignore` files already keep `.env` files and `node_modules` out.

## 1. Supabase (database, login, live alerts, photos)

1. Create a new project. Pick the region closest to Mysore (Mumbai). Save the **database password**.
2. Open **SQL Editor** and run these files **in this order**, one at a time (open each file, copy all of it, paste, Run):
   1. `supabase/migrations/0001_schema.sql`
   2. `supabase/migrations/0002_rls.sql`
   3. `supabase/migrations/0003_functions.sql`
   4. `supabase/migrations/0004_realtime_storage.sql`
   5. `supabase/seed.sql`: the lab-building map
   Each should finish with "Success". If one fails, stop and fix it before running the next.
3. **Authentication → Sign In / Providers → Email:** for the demo, turn **Confirm email** off, so demo accounts can log in straight away.
4. Collect these values:
   - **Project URL**, e.g. `https://abcd.supabase.co`, from Project Settings → API / Data API.
   - **anon / publishable key**: safe to put in the apps.
   - **service_role / secret key**: **secret**. It's only used once, by the seed script in step 2. Never put it in an app.
   - **Session pooler connection string**: click **Connect** at the top of the project and choose **Session pooler**. It looks like
     `postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`.
     Put your database password in it. (Use the *session pooler* one: Render can't reach the "direct" address.)
   - Optional: **Legacy JWT secret**, from Project Settings → JWT Keys, if your project shows one. The API checks
     both the new and the legacy token types.

## 2. Demo accounts

From the unzipped folder, on your laptop (Python 3.11+):
```bash
cd services/api
pip install -r requirements.txt
# Windows PowerShell:  $env:SUPABASE_URL="..."; $env:SUPABASE_SERVICE_ROLE_KEY="..."
export SUPABASE_URL=https://abcd.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service_role / secret key>
python scripts/seed_demo_users.py
```
This creates these accounts (password `Demo@12345` for all):

| Email | Role |
|---|---|
| student@accessable.demo | student (phone app) |
| admin@accessable.demo | admin (dashboard) |
| responder@accessable.demo | responder / security |
| maintenance@accessable.demo | maintenance |
| mapeditor@accessable.demo | map editor |

**If the script fails**, you can do the same by hand:
1. Add the users in Authentication → Users → Add user.
2. In the SQL Editor run, once per staff user:
   ```sql
   insert into role_assignments (user_id, institution_id, role)
   select id, '00000000-0000-0000-0000-000000000001', 'admin'
   from auth.users where email = 'admin@accessable.demo';
   ```
   For the other staff users, change the email and the role (`responder`, `maintenance`, `map_editor`).

## 3. Gemini API key

1. Go to Google AI Studio and use **Get API key**, then **Create API key**.
2. The free tier is enough for a demo but has small limits. AI Studio shows the real limits for your key, so check them there.
   The app retries once on "busy" and tells the user to try again in a minute.
3. Free-tier requests may be used by Google to improve their products, so don't photograph anything private during testing.

## 4. Render (the API)

1. Go to Render, then New, then **Blueprint**, and pick your GitHub repo. Render reads `services/api/render.yaml`.
   Or: New, then Web Service, root directory `services/api`, build `pip install -r requirements.txt`,
   start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, plan **Free**.
2. Set the environment variables:

   | Key | Value |
   |---|---|
   | `ENV` | `production` |
   | `SUPABASE_URL` | Project URL |
   | `SUPABASE_JWT_SECRET` | legacy JWT secret, or leave empty |
   | `DATABASE_URL` | session pooler string |
   | `GEMINI_API_KEY` | from step 3 |
   | `GEMINI_MODEL` | `gemini-flash-latest` |
   | `CORS_ORIGINS` | your Vercel URL from step 5 (come back and fill it in) |

   **Do not** set `DEV_AUTH` on Render.
3. Deploy, then open `https://<your-service>.onrender.com/health`. It should show `{"status":"ok",...}`.
4. Know the free tier: the server **sleeps after 15 minutes with no traffic** and takes about **a minute** to wake.
   The dashboard pings it every 10 minutes while it's open, and the app says "Waking up the server…" when it's slow.
   **SOS does not depend on this server at all.** It goes straight to Supabase.

## 5. Vercel (the dashboard)

1. Go to Vercel, then Add New, then Project, and import the GitHub repo. Set the **Root Directory** to `apps/admin-web`. The framework is Vite.
2. Set the environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_API_URL` = `https://<your-service>.onrender.com` (no trailing slash)
3. Deploy. Copy the Vercel URL into Render's `CORS_ORIGINS` and redeploy Render.
4. Log in as `admin@accessable.demo`. Click **Enable sound alerts** once. Browsers block sound until you click.

## 6. Phone app (Expo Go)

On your laptop (Node 20+):
```bash
cd apps/mobile
npm install
cp .env.example .env      # fill EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_API_URL
npx expo start            # phone and laptop on the same Wi-Fi
# different networks / college Wi-Fi blocks it:
npx expo start --tunnel
```
1. Open **Expo Go** on the Android phone and scan the QR shown in the terminal.
2. Log in as `student@accessable.demo`.
3. Allow camera and microphone when asked.

Expo Go has to support the project's SDK (58). If Expo Go says the SDK is unsupported, update Expo Go from the Play Store.

## 7. Print the checkpoints

Print `data/sample-campus/qr_checkpoints.pdf`, which has the 6 QR codes. For the demo you need at least:
- **Ground floor — Near the lift**. This is where the demo starts.
- **Floor 2 — Outside the Department Library**

Stick them at about 1.2 m height. The positions come from one photo, so walk the building and correct the map first
(`data/sample-campus/README.md` has the checklist; edit labels and positions in the dashboard's Map page).

## 8. Before every demo (15 minutes before)

- [ ] Open the dashboard as admin. This wakes the API. Click **Enable sound alerts**. Check that the top bar shows **Live** and the API dot is green.
- [ ] Open a second browser profile as `responder@accessable.demo`, so you can show role separation.
- [ ] On the phone: log in as the student and run Read Sign once, which checks the Gemini key and quota.
- [ ] Check that the corridor `Floor 2 north corridor` is **open** in Map. Reopen it if a previous rehearsal left it blocked.
- [ ] Phone volume up, TalkBack optional, airplane mode off.
- [ ] Have a backup: a screen recording of one full rehearsal.

## Troubleshooting

| Symptom | Fix |
|---|---|
| App says "You need to sign in again" on every API call | Render `SUPABASE_URL` is wrong, or your project uses the legacy secret: set `SUPABASE_JWT_SECRET`. |
| Route planning says map unavailable | `DATABASE_URL` is wrong. It must be the **session pooler** string with your password. |
| Dashboard shows "Reconnecting…" forever | Realtime: re-run `0004_realtime_storage.sql`, then check Database → Publications → `supabase_realtime` lists `emergency_alerts`. |
| "AI service is busy" | Gemini free quota hit. Wait a minute. Check the limits in AI Studio. |
| Report photo upload fails | Re-run `0004_realtime_storage.sql` (it creates the `report-photos` bucket). |
| First request takes a minute | Render waking up. This is expected on the free tier. |
