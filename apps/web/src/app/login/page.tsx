"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { clearToken, getToken, setToken } from "../../lib/storage";

type LoginStep = "credentials" | "biometric";

export default function LoginPage() {
  const router = useRouter();
  const token = getToken();

  useEffect(() => {
    if (!token) return;
    const authToken = token;
    async function redirectByRole() {
      try {
        const me = await apiFetch<{ user: { role: "voter" | "admin" | "super_admin" } }>("/auth/me", {
          method: "GET",
          token: authToken,
        });
        if (me.user.role === "super_admin") router.replace("/super-admin/dashboard");
        else if (me.user.role === "admin") router.replace("/admin/dashboard");
        else router.replace("/vote");
      } catch {
        clearToken();
      }
    }
    void redirectByRole();
  }, [router, token]);

  const webcamRef = useRef<Webcam | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<LoginStep>("credentials");
  const [cameraReady, setCameraReady] = useState(false);

  const cameraConstraints = useMemo(
    () => ({ facingMode: "user", width: 640, height: 480 }),
    []
  );

  async function captureFrames(): Promise<string[]> {
    const frames: string[] = [];
    const start = Date.now();
    const duration = 5000;
    const interval = 200;
    while (Date.now() - start < duration) {
      const shot = webcamRef.current?.getScreenshot();
      if (shot) frames.push(shot);
      await new Promise((r) => setTimeout(r, interval));
    }
    return frames;
  }

  async function onCredentialSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    setBusy(true);
    try {
      const data = await apiFetch<{ token: string; role: string }>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      setToken(data.token);
      setStatus(null);
      redirectUser(data.role);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      const lowered = msg.toLowerCase();
      if (lowered.includes("re-enroll")) {
        setStep("biometric");
        setStatus("Face profile needs refresh. Please continue with camera to re-enroll.");
      } else if (
        msg.includes("Face verification required") ||
        msg.includes("Face mismatch") ||
        msg.includes("Liveness") ||
        msg.includes("biometric")
      ) {
        setStep("biometric");
        setStatus("Credentials verified. Now verify your face - look at the camera and blink naturally.");
      } else {
        setStatus(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onBiometricSubmit() {
    setStatus(null);
    setBusy(true);
    try {
      if (!cameraReady) {
        setStatus("Camera not ready. Please allow webcam access.");
        setBusy(false);
        return;
      }

      setStatus("Capturing... look at the camera and blink naturally.");
      const framesBase64 = await captureFrames();

      if (framesBase64.length < 5) {
        setStatus("Not enough camera frames captured. Try again.");
        setBusy(false);
        return;
      }

      setStatus(`Captured ${framesBase64.length} frames. Verifying face and liveness...`);
      const data = await apiFetch<{ token: string; role: string }>("/auth/login", {
        method: "POST",
        body: { email, password, framesBase64 },
      });
      setToken(data.token);
      setStatus(null);
      redirectUser(data.role);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Biometric verification failed");
    } finally {
      setBusy(false);
    }
  }

  function redirectUser(role: string) {
    if (role === "super_admin") router.replace("/super-admin/dashboard");
    else if (role === "admin") router.replace("/admin/dashboard");
    else router.replace("/vote");
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">SecureVote Login</h1>
      <p className="mt-2 text-sm text-neutral-600">
        {step === "credentials"
          ? "Enter your email and password to continue."
          : "Step 2: Face verification. Look at the camera and blink naturally."}
      </p>

      {step === "credentials" ? (
        <form className="mt-6 space-y-4" onSubmit={onCredentialSubmit}>
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

          {status ? <div className="text-sm text-amber-700">{status}</div> : null}

          <button
            className="w-full rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
            disabled={busy || !email || !password}
            type="submit"
          >
            {busy ? "Checking..." : "Continue"}
          </button>
        </form>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="rounded border p-3">
            <Webcam
              audio={false}
              ref={(r) => {
                webcamRef.current = r;
              }}
              screenshotFormat="image/jpeg"
              videoConstraints={cameraConstraints}
              onUserMedia={() => setCameraReady(true)}
              onUserMediaError={() => {
                setCameraReady(false);
                setStatus("Camera access blocked. Please allow webcam permission.");
              }}
              style={{ width: "100%", borderRadius: 8 }}
            />
            <p className="mt-2 text-xs text-neutral-600">
              Keep your face centered and blink naturally during capture.
            </p>
          </div>

          {status ? <div className="text-sm text-amber-700">{status}</div> : null}

          <button
            className="w-full rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
            disabled={busy || !cameraReady}
            onClick={() => void onBiometricSubmit()}
            type="button"
          >
            {busy ? "Verifying..." : "Verify Face & Blink"}
          </button>

          <button
            className="w-full rounded border px-4 py-2 text-sm"
            type="button"
            onClick={() => {
              setStep("credentials");
              setStatus(null);
            }}
          >
            Back to credentials
          </button>
        </div>
      )}
    </main>
  );
}
