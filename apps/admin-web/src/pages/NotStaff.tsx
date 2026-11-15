import { useAuth } from '../hooks/useAuth';

export default function NotStaff() {
  const { signOut, email } = useAuth();
  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="tile max-w-md space-y-4 text-center">
        <h1 className="text-xl font-bold">This dashboard is for campus staff.</h1>
        <p className="text-sm text-muted">
          You are signed in as {email}, but this account has no staff role. Ask an administrator to give you a role.
        </p>
        <button className="btn-primary" onClick={() => void signOut()}>Sign out</button>
      </div>
    </main>
  );
}
