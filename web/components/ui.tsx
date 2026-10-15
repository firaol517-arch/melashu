"use client";
export const Empty = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="card p-8 text-center"><p className="font-display text-2xl">{title}</p>{hint && <p className="mt-2 text-sage">{hint}</p>}</div>
);
export async function api(path: string, method: string, body?: unknown) {
  const r = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: j as any };
}
