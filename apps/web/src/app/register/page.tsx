import Link from "next/link";

export default function RegisterPage() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">Self registration is disabled</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Voter and admin accounts are provisioned by authorized administrators.
      </p>
      <Link className="mt-6 inline-block rounded border px-4 py-2" href="/login">
        Back to login
      </Link>
    </main>
  );
}

