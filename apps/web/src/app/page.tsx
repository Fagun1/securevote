export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-semibold">SecureVote AI</h1>
      <p className="mt-2 text-neutral-600">Secure online voting with biometric liveness verification.</p>
      <div className="mt-6 flex gap-3">
        <a className="rounded bg-neutral-900 px-4 py-2 text-white" href="/login">
          Login
        </a>
        <a className="rounded border px-4 py-2" href="/register">
          Register
        </a>
        <a className="rounded border px-4 py-2" href="/admin">
          Admin
        </a>
      </div>
    </main>
  );
}
