"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { getToken, clearToken } from "../../lib/storage";

type Election = null | {
  id: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
};

export default function VotePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [election, setElection] = useState<Election>(null);
  const [candidates, setCandidates] = useState<Array<{ id: string; name: string; party: string }>>([]);
  const [candidateId, setCandidateId] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const t = getToken();
    setToken(t);
    if (!t) router.replace("/login");
  }, [router]);

  useEffect(() => {
    if (!token) return;

    async function load() {
      setStatus(null);
      try {
        const [e, c] = await Promise.all([
          apiFetch<{ election: Election }>("/public/election/active", { method: "GET" }),
          apiFetch<{ candidates: any[] }>("/public/candidates", { method: "GET" }),
        ]);
        setElection(e.election);
        setCandidates((c.candidates || []).map((x) => ({ id: x.id, name: x.name, party: x.party })));
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Failed to load election data");
      }
    }

    void load();
  }, [token]);

  async function onCast() {
    if (!token) return;
    if (!candidateId) return;
    setStatus("Submitting vote...");
    try {
      await apiFetch("/voting/cast", {
        method: "POST",
        token,
        body: { candidateId },
      });
      // Security/UX: logout automatically right after a successful vote.
      clearToken();
      setToken(null);
      setStatus("Vote submitted successfully. Logging out...");
      router.replace("/login");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Vote failed");
      if ((err as Error).message?.toLowerCase().includes("token")) clearToken();
    }
  }

  const electionActive = !!election;

  return (
    <main className="mx-auto max-w-xl p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Cast Vote</h1>
        <button
          className="rounded border px-3 py-2 text-sm"
          type="button"
          onClick={() => {
            clearToken();
            setToken(null);
            router.replace("/login");
          }}
        >
          Logout
        </button>
      </div>
      {status ? <div className="mt-3 text-sm text-amber-700">{status}</div> : null}

      {!electionActive ? (
        <div className="mt-4 rounded border p-4 text-sm text-neutral-600">No active election window right now.</div>
      ) : (
        <div className="mt-4 rounded border p-4">
          <label className="block text-sm">
            Candidate
            <select
              className="mt-1 w-full rounded border p-2"
              value={candidateId}
              onChange={(e) => setCandidateId(e.target.value)}
            >
              <option value="" disabled>
                Select a candidate
              </option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.party ? `(${c.party})` : ""}
                </option>
              ))}
            </select>
          </label>

          <button
            className="mt-4 w-full rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
            disabled={!candidateId}
            onClick={() => void onCast()}
          >
            Submit Vote
          </button>
        </div>
      )}

      <button className="mt-6 w-full rounded border px-4 py-2" onClick={() => router.push("/analytics")} type="button">
        View Analytics
      </button>
    </main>
  );
}

