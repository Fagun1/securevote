"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { clearToken, getToken, setToken } from "../../lib/storage";

export default function LoginPage() {
  const router = useRouter();
  const token = getToken();

  useEffect(() => {
    if (token) router.replace("/vote");
  }, [router, token]);

  const webcamRef = useRef<Webcam | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const captureIntervalMs = 250; // ~4 fps keeps payload manageable
  const captureDurationMs = 4500; // liveness window (more samples for blink detector)

  const cameraConstraints = useMemo(
    () => ({
      facingMode: "user",
      width: 640,
      height: 480,
    }),
    []
  );

  async function captureFrames(): Promise<string[]> {
    const frames: string[] = [];
    const start = Date.now();
    while (Date.now() - start < captureDurationMs) {
      const shot = webcamRef.current?.getScreenshot();
      if (shot) frames.push(shot);
      await new Promise((r) => setTimeout(r, captureIntervalMs));
    }
    return frames;
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    setBusy(true);

    try {
      const framesBase64 = await captureFrames();
      setStatus(`Captured ${framesBase64.length} frames. Verifying liveness and face...`);
      const data = await apiFetch<{ token: string; role: string }>("/auth/login", {
        method: "POST",
        body: { email, password, framesBase64 },
      });
      setToken(data.token);
      setStatus(null);
      router.replace(data.role === "admin" || data.role === "super_admin" ? "/admin" : "/vote");
    } catch (err) {
      clearToken();
      setStatus(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">Login (Face + Blink)</h1>
      <p className="mt-2 text-sm text-neutral-600">Blink liveness and face match are verified by the server.</p>

      <form className="mt-6 space-y-4" onSubmit={onLogin}>
        <label className="block">
          <span className="text-sm">Email</span>
          <input
            className="mt-1 w-full rounded border p-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm">Password</span>
          <input
            className="mt-1 w-full rounded border p-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            required
          />
        </label>

        <div className="rounded border p-3">
          <Webcam
            audio={false}
            ref={(r) => {
              webcamRef.current = r;
            }}
            screenshotFormat="image/jpeg"
            videoConstraints={cameraConstraints}
            style={{ width: "100%", borderRadius: 8 }}
          />
          <p className="mt-2 text-xs text-neutral-600">Keep your face in frame and blink naturally.</p>
        </div>

        {status ? <div className="text-sm text-amber-700">{status}</div> : null}

        <button
          className="w-full rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
          disabled={busy || !email || !password}
          type="submit"
        >
          {busy ? "Verifying..." : "Login"}
        </button>

        <button
          className="w-full rounded border px-4 py-2"
          type="button"
          onClick={() => router.push("/register")}
          disabled={busy}
        >
          Create account
        </button>
      </form>
    </main>
  );
}

