"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from "chart.js";
import { apiFetch } from "../../lib/api";
import { clearToken, getToken } from "../../lib/storage";
import { connectAdminSocket, type AdminSnapshot } from "../../lib/socket";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export default function AnalyticsPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AdminSnapshot>({
    election: null,
    voterTotal: 0,
    votesTotal: 0,
    turnout: 0,
    candidates: [],
  });
  const [status, setStatus] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const t = getToken();
    setToken(t);
    if (!t) router.replace("/login");
  }, [router]);

  useEffect(() => {
    if (!token) return;

    let socket: ReturnType<typeof connectAdminSocket> | null = null;

    async function bootstrapSocket() {
      try {
        // Confirm the user is actually an admin before attempting socket auth.
        const me = await apiFetch<{ user: any }>("/auth/me", {
          method: "GET",
          token: token ?? undefined,
        });

        const role = me.user?.role as string | undefined;
        if (role !== "admin" && role !== "super_admin") {
          setStatus("Admin access required.");
          router.replace("/vote");
          return;
        }

        socket = connectAdminSocket(token!);
        socket.on("connect", () => {
          socket?.emit("dashboard:getSnapshot");
        });

        socket.on("dashboard:snapshot", (data: AdminSnapshot) => {
          setSnapshot(data);
          setStatus(null);
        });

        socket.on("dashboard:updated", (data: AdminSnapshot) => {
          setSnapshot(data);
        });

        socket.on("connect_error", (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          setStatus(`Admin websocket connection failed: ${message}`);
        });
      } catch (err) {
        clearToken();
        router.replace("/login");
      }
    }

    void bootstrapSocket();

    return () => {
      socket?.disconnect();
      socket = null;
    };
  }, [token, router]);

  const chartData = useMemo(() => {
    const labels = snapshot.candidates.map((c) => c.name);
    const votes = snapshot.candidates.map((c) => c.vote_count_in_window);
    return { labels, votes };
  }, [snapshot.candidates]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    if (chartRef.current) {
      chartRef.current.data.labels = chartData.labels;
      chartRef.current.data.datasets[0]!.data = chartData.votes as any;
      chartRef.current.update();
      return;
    }

    chartRef.current = new Chart(ctx, {
      type: "bar",
      data: {
        labels: chartData.labels,
        datasets: [
          {
            label: "Votes (Active Window)",
            data: chartData.votes,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true } },
      },
    });
  }, [chartData]);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Analytics</h1>
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

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="rounded border p-4 text-sm">
          <div className="text-neutral-600">Voters</div>
          <div className="text-xl font-semibold">{snapshot.voterTotal}</div>
        </div>
        <div className="rounded border p-4 text-sm">
          <div className="text-neutral-600">Votes (Window)</div>
          <div className="text-xl font-semibold">{snapshot.votesTotal}</div>
        </div>
        <div className="rounded border p-4 text-sm">
          <div className="text-neutral-600">Turnout</div>
          <div className="text-xl font-semibold">{(snapshot.turnout * 100).toFixed(1)}%</div>
        </div>
      </div>

      {!snapshot.election ? (
        <div className="mt-6 rounded border p-4 text-sm text-neutral-600">No active election window currently.</div>
      ) : (
        <div className="mt-6 rounded border p-4">
          <h2 className="font-medium">Votes by Candidate</h2>
          <div className="mt-3">
            <canvas ref={canvasRef} />
          </div>
        </div>
      )}

      <button
        className="mt-6 w-full rounded border px-4 py-2"
        type="button"
        onClick={() => router.push("/admin")}
      >
        Back to Admin
      </button>
    </main>
  );
}

