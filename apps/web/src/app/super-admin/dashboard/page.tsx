"use client";

import type { ChangeEvent, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Webcam from "react-webcam";
import { apiFetch } from "../../../lib/api";
import { clearToken, getToken } from "../../../lib/storage";

export default function SuperAdminDashboardPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminFaceImageBase64, setAdminFaceImageBase64] = useState("");
  const [showAdminCamera, setShowAdminCamera] = useState(false);
  const [voterName, setVoterName] = useState("");
  const [voterEmail, setVoterEmail] = useState("");
  const [voterFaceImageBase64, setVoterFaceImageBase64] = useState("");
  const [showVoterCamera, setShowVoterCamera] = useState(false);
  const adminWebcamRef = useRef<Webcam | null>(null);
  const voterWebcamRef = useRef<Webcam | null>(null);

  useEffect(() => {
    const t = getToken();
    setToken(t);
    if (!t) router.replace("/login");
  }, [router]);

  useEffect(() => {
    if (!token) return;
    const authToken = token;
    async function verifySuperAdmin() {
      try {
        const me = await apiFetch<{ user: { role: string } }>("/auth/me", { method: "GET", token: authToken });
        if (me.user.role !== "super_admin") router.replace("/admin/dashboard");
      } catch {
        clearToken();
        router.replace("/login");
      }
    }
    void verifySuperAdmin();
  }, [router, token]);

  async function fileToBase64(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  }

  async function onSelectFaceFile(
    event: ChangeEvent<HTMLInputElement>,
    setBase64: (value: string) => void,
    label: string
  ) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await fileToBase64(file);
      setBase64(base64);
      setStatus(`${label} face image loaded from file.`);
    } catch {
      setStatus(`Failed to load ${label.toLowerCase()} face image.`);
    } finally {
      event.target.value = "";
    }
  }

  function captureFromWebcam(
    webcamRef: RefObject<Webcam | null>,
    setBase64: (value: string) => void,
    label: string
  ) {
    const shot = webcamRef.current?.getScreenshot();
    if (!shot) {
      setStatus(`Camera not ready for ${label.toLowerCase()} face capture.`);
      return;
    }
    setBase64(shot);
    setStatus(`${label} face image captured from webcam.`);
  }

  async function onCreateAdmin() {
    if (!token) return;
    setStatus("Creating admin...");
    try {
      await apiFetch("/admin/create", {
        method: "POST",
        token,
        body: { name: adminName, email: adminEmail, faceImageBase64: adminFaceImageBase64.trim() },
      });
      setAdminName("");
      setAdminEmail("");
      setAdminFaceImageBase64("");
      setShowAdminCamera(false);
      setStatus("Admin created. Credentials sent by email.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to create admin");
    }
  }

  async function onCreateVoter() {
    if (!token) return;
    setStatus("Creating voter...");
    try {
      await apiFetch("/admin/voters/create", {
        method: "POST",
        token,
        body: {
          name: voterName,
          email: voterEmail,
          ...(voterFaceImageBase64.trim() ? { faceImageBase64: voterFaceImageBase64.trim() } : {}),
        },
      });
      setVoterName("");
      setVoterEmail("");
      setVoterFaceImageBase64("");
      setShowVoterCamera(false);
      setStatus("Voter created. Credentials sent by email.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to create voter");
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Super Admin Dashboard</h1>
        <div className="flex gap-2">
          <button className="rounded border px-3 py-2 text-sm" onClick={() => router.push("/admin/dashboard")} type="button">
            Open Admin Dashboard
          </button>
          <button
            className="rounded border px-3 py-2 text-sm"
            onClick={() => {
              clearToken();
              setToken(null);
              router.replace("/login");
            }}
            type="button"
          >
            Logout
          </button>
        </div>
      </div>

      {status ? <p className="mt-3 text-sm text-amber-700">{status}</p> : null}

      <section className="mt-6 rounded border p-4">
        <h2 className="font-medium">Create Admin</h2>
        <div className="mt-3 grid gap-2">
          <input
            className="rounded border p-2"
            placeholder="Admin name"
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
          />
          <input
            className="rounded border p-2"
            placeholder="Admin email"
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
          />
          <textarea
            className="rounded border p-2"
            placeholder="Admin face image base64 (auto-filled from upload/camera)"
            value={adminFaceImageBase64}
            onChange={(e) => setAdminFaceImageBase64(e.target.value)}
            rows={4}
          />
          <div className="rounded border p-3">
            <div className="flex flex-wrap gap-2">
              <label className="cursor-pointer rounded border px-3 py-2 text-sm">
                Upload Face Image
                <input
                  className="hidden"
                  type="file"
                  accept="image/*"
                  onChange={(e) => void onSelectFaceFile(e, setAdminFaceImageBase64, "Admin")}
                />
              </label>
              <button
                className="rounded border px-3 py-2 text-sm"
                type="button"
                onClick={() => setShowAdminCamera((v) => !v)}
              >
                {showAdminCamera ? "Hide Camera" : "Use Webcam"}
              </button>
              <button
                className="rounded border px-3 py-2 text-sm"
                type="button"
                onClick={() => captureFromWebcam(adminWebcamRef, setAdminFaceImageBase64, "Admin")}
                disabled={!showAdminCamera}
              >
                Capture Face
              </button>
            </div>
            {showAdminCamera ? (
              <div className="mt-3 max-w-md overflow-hidden rounded border">
                <Webcam
                  audio={false}
                  ref={(r) => {
                    adminWebcamRef.current = r;
                  }}
                  screenshotFormat="image/jpeg"
                  videoConstraints={{ facingMode: "user", width: 640, height: 480 }}
                  style={{ width: "100%" }}
                />
              </div>
            ) : null}
          </div>
        </div>
        <button
          className="mt-3 rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
          onClick={() => void onCreateAdmin()}
          disabled={!adminName || !adminEmail || !adminFaceImageBase64.trim()}
          type="button"
        >
          Create Admin
        </button>
      </section>

      <section className="mt-6 rounded border p-4">
        <h2 className="font-medium">Create Voter</h2>
        <div className="mt-3 grid gap-2">
          <input
            className="rounded border p-2"
            placeholder="Voter name"
            value={voterName}
            onChange={(e) => setVoterName(e.target.value)}
          />
          <input
            className="rounded border p-2"
            placeholder="Voter email"
            type="email"
            value={voterEmail}
            onChange={(e) => setVoterEmail(e.target.value)}
          />
          <textarea
            className="rounded border p-2"
            placeholder="Optional voter face image base64 (auto-filled from upload/camera)"
            value={voterFaceImageBase64}
            onChange={(e) => setVoterFaceImageBase64(e.target.value)}
            rows={4}
          />
          <div className="rounded border p-3">
            <div className="flex flex-wrap gap-2">
              <label className="cursor-pointer rounded border px-3 py-2 text-sm">
                Upload Face Image
                <input
                  className="hidden"
                  type="file"
                  accept="image/*"
                  onChange={(e) => void onSelectFaceFile(e, setVoterFaceImageBase64, "Voter")}
                />
              </label>
              <button
                className="rounded border px-3 py-2 text-sm"
                type="button"
                onClick={() => setShowVoterCamera((v) => !v)}
              >
                {showVoterCamera ? "Hide Camera" : "Use Webcam"}
              </button>
              <button
                className="rounded border px-3 py-2 text-sm"
                type="button"
                onClick={() => captureFromWebcam(voterWebcamRef, setVoterFaceImageBase64, "Voter")}
                disabled={!showVoterCamera}
              >
                Capture Face
              </button>
            </div>
            {showVoterCamera ? (
              <div className="mt-3 max-w-md overflow-hidden rounded border">
                <Webcam
                  audio={false}
                  ref={(r) => {
                    voterWebcamRef.current = r;
                  }}
                  screenshotFormat="image/jpeg"
                  videoConstraints={{ facingMode: "user", width: 640, height: 480 }}
                  style={{ width: "100%" }}
                />
              </div>
            ) : null}
          </div>
        </div>
        <button
          className="mt-3 rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
          onClick={() => void onCreateVoter()}
          disabled={!voterName || !voterEmail}
          type="button"
        >
          Create Voter
        </button>
      </section>
    </main>
  );
}
