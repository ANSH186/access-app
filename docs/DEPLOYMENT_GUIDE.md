# AccessAble AI — TechExpo Complete Deployment & Operations Manual

Repository: [singhhanshh16/ASSISTIVE-APP](https://github.com/singhhanshh16/ASSISTIVE-APP)

## 1. Automated Setup Summary

- **GitHub Repository**: Initialized, tracked on `main`, and pushed to [https://github.com/singhhanshh16/ASSISTIVE-APP.git](https://github.com/singhhanshh16/ASSISTIVE-APP.git).
- **Supabase Cloud**: Active on Mumbai region (`nlbobzgamrbhdesiqdhs.supabase.co`).
  - Database schema & storage buckets confirmed.
  - Campus map seed loaded: 107 nodes, 116 edges, 6 QR checkpoints.
- **Demo Accounts Created**:
  - `student@accessable.demo` (Role: Student)
  - `admin@accessable.demo` (Role: Admin)
  - `responder@accessable.demo` (Role: Responder)
  - `maintenance@accessable.demo` (Role: Maintenance)
  - `mapeditor@accessable.demo` (Role: Map Editor)
  - Password for all accounts: `Demo@12345`
- **Verification Tests**:
  - `data/sample-campus/validate_map.py`: **Pass**
  - `services/api` pytest suite (69 tests): **Pass**
  - `apps/admin-web` production build: **Pass**
  - `apps/mobile` TypeScript typecheck: **Pass**

---

## 2. Deploy to Render (Backend API)

1. Go to [dashboard.render.com](https://dashboard.render.com/) &rarr; **New +** &rarr; **Blueprint**.
2. Connect your GitHub account and choose `singhhanshh16/ASSISTIVE-APP`.
3. Render reads `services/api/render.yaml` and sets up `accessable-ai-api`.
4. Enter the required environment variables:
   - `ENV`: `production`
   - `SUPABASE_URL`: `https://nlbobzgamrbhdesiqdhs.supabase.co`
   - `DATABASE_URL`: `postgresql://postgres.nlbobzgamrbhdesiqdhs:<DB_PASSWORD>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`
   - `GEMINI_API_KEY`: *(From [Google AI Studio](https://aistudio.google.com/))*
   - `GEMINI_MODEL`: `gemini-flash-latest`
   - `CORS_ORIGINS`: *(Fill after Vercel deployment)*
5. Click **Apply / Deploy**.
6. Once deployed, test `https://<render-url>/health` (should return `{"status":"ok"}`).

---

## 3. Deploy to Vercel (Admin Web Dashboard)

1. Go to [vercel.com](https://vercel.com/) &rarr; **Add New...** &rarr; **Project**.
2. Import `singhhanshh16/ASSISTIVE-APP`.
3. Set **Root Directory** to `apps/admin-web`.
4. Add Environment Variables:
   - `VITE_SUPABASE_URL`: `https://nlbobzgamrbhdesiqdhs.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: `sb_publishable_MG6k_aUH1JSy20-r9q4SqQ_sdtJp4NT`
   - `VITE_API_URL`: `https://<your-render-url>` *(no trailing slash)*
5. Click **Deploy**.
6. Copy the Vercel URL and update `CORS_ORIGINS` in your Render service environment settings.

---

## 4. Run Mobile App on Phone (Expo Go)

1. Open `apps/mobile/.env` and ensure `EXPO_PUBLIC_API_URL` has your Render API URL:
   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://nlbobzgamrbhdesiqdhs.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_MG6k_aUH1JSy20-r9q4SqQ_sdtJp4NT
   EXPO_PUBLIC_API_URL=https://<your-render-url>
   ```
2. Run Metro bundler:
   ```powershell
   cd apps/mobile
   npx expo start --tunnel
   ```
3. Open **Expo Go** on Android phone, scan the terminal QR code, and log in with `student@accessable.demo` / `Demo@12345`.
