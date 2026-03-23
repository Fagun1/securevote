const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000";

export type ApiError = { error: string; details?: unknown };

export async function apiFetch<
  T,
  O extends Omit<RequestInit, "body"> = Omit<RequestInit, "body">
>(
  path: string,
  options?: (O & { token?: string; body?: unknown }) | undefined
): Promise<T> {
  const token = options?.token;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body:
      options && "body" in options && options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
  });

  const text = await res.text();
  const json = text ? safeJsonParse<ApiError>(text) : null;
  if (!res.ok) {
    const msg = json?.error || `Request failed with status ${res.status}`;
    throw new Error(msg);
  }
  return (json as T) ?? ({} as T);
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

