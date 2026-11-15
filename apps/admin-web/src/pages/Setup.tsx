export default function Setup() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">Setup needed</h1>
      <p className="mt-2 text-muted">
        This dashboard needs to know where your Supabase project and API are. Create a file named <code className="rounded bg-raised px-1">.env</code> in
        <code className="rounded bg-raised px-1">apps/admin-web</code> (or set the variables in Vercel) with:
      </p>
      <pre className="tile mt-4 overflow-x-auto text-sm">{`VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
VITE_API_URL=https://your-service.onrender.com`}</pre>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted">
        <li><b className="text-ink">VITE_SUPABASE_URL</b> and <b className="text-ink">VITE_SUPABASE_ANON_KEY</b>: Supabase project settings, API page. Required.</li>
        <li><b className="text-ink">VITE_API_URL</b>: the FastAPI base URL, no trailing slash. Needed for route preview and the API status light.</li>
        <li>Restart <code className="rounded bg-raised px-1">npm run dev</code> after editing the file.</li>
      </ul>
    </main>
  );
}
