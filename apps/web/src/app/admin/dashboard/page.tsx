"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../../lib/api";
import { getToken, clearToken } from "../../../lib/storage";

type Role = "voter" | "admin" | "super_admin";

export default function AdminDashboardPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [candidates, setCandidates] = useState<Array<{ id: string; name: string; party: string }>>([]);
  const [endTimeLocal, setEndTimeLocal] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const t = getToken();
    setToken(t);
    if (!t) router.replace("/login");
  }, [router]);

  useEffect(() => {
    if (!token) return;
    async function loadMe() {
      try {
        const me = await apiFetch<{ user: { role: Role } }>("/auth/me", { method: "GET", token: token ?? undefined });
        const r = me.user.role;
        setRole(r);
        if (r !== "admin" && r !== "super_admin") router.replace("/vote");
      } catch {
        clearToken();
        router.replace("/login");
      }
    }
    void loadMe();
  }, [router, token]);

  useEffect(() => {
    if (!token) return;
    async function loadCandidates() {
      const res = await apiFetch<{ candidates: Array<{ id: string; name: string; party: string }> }>("/public/candidates", {
        method: "GET",
      });
      setCandidates(res.candidates || []);
    }
    void loadCandidates();
  }, [token]);

  async function refreshCandidates() {
    const res = await apiFetch<{ candidates: Array<{ id: string; name: string; party: string }> }>("/public/candidates", {
      method: "GET",
    });
    setCandidates(res.candidates || []);
  }

  async function onStartElection() {
    if (!token || !endTimeLocal) return;
    setStatus("Starting election...");
    try {
      const endTimeIso = new Date(endTimeLocal).toISOString();
      await apiFetch("/admin/election/start", { method: "POST", token, body: { end_time: endTimeIso } });
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to start election");
    }
  }

  async function onEndElection() {
    if (!token) return;
    setStatus("Ending election...");
    try {
      await apiFetch("/admin/election/end", { method: "POST", token });
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to end election");
    }
  }

  const [candName, setCandName] = useState("");
  const [candParty, setCandParty] = useState("");

  async function onCreateCandidate() {
    if (!token || !candName) return;
    setStatus("Creating candidate...");
    try {
      await apiFetch("/admin/candidates", { method: "POST", token, body: { name: candName, party: candParty } });
      setCandName("");
      setCandParty("");
      await refreshCandidates();
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Candidate creation failed");
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
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
      {status ? <div className="mt-2 text-sm text-amber-700">{status}</div> : null}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section className="rounded border p-4">
          <h2 className="font-medium">Election Control</h2>
          <div className="mt-3">
            <label className="block text-sm">
              End time
              <input
                className="mt-1 w-full rounded border p-2"
                type="datetime-local"
                value={endTimeLocal}
                onChange={(e) => setEndTimeLocal(e.target.value)}
              />
            </label>
            <button
              className="mt-3 w-full rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
              onClick={() => void onStartElection()}
              disabled={!token || !endTimeLocal || !role || (role !== "admin" && role !== "super_admin")}
              type="button"
            >
              Start Election
            </button>
            <button
              className="mt-2 w-full rounded border px-4 py-2 disabled:opacity-60"
              onClick={() => void onEndElection()}
              disabled={!token || !role || (role !== "admin" && role !== "super_admin")}
              type="button"
            >
              End Election
            </button>
          </div>
        </section>

        <section className="rounded border p-4">
          <h2 className="font-medium">Candidates</h2>
          <div className="mt-3 space-y-2">
            <label className="block text-sm">
              Name
              <input className="mt-1 w-full rounded border p-2" value={candName} onChange={(e) => setCandName(e.target.value)} />
            </label>
            <label className="block text-sm">
              Party
              <input className="mt-1 w-full rounded border p-2" value={candParty} onChange={(e) => setCandParty(e.target.value)} />
            </label>
            <button
              className="w-full rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
              onClick={() => void onCreateCandidate()}
              disabled={!token || !candName}
              type="button"
            >
              Add Candidate
            </button>
          </div>

          <div className="mt-4 max-h-80 overflow-auto">
            {candidates.length === 0 ? (
              <div className="text-sm text-neutral-600">No candidates yet.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-neutral-600">{c.party ? c.party : "—"}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <button className="mt-6 w-full rounded border px-4 py-2" onClick={() => router.push("/analytics")} type="button">
        View Analytics
      </button>
    </main>
  );
}
