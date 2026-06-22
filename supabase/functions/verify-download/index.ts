// verify-download — checks a 6-digit code and, on success, returns a short-lived
// signed URL to the private release and logs the download. Public (verify_jwt=false).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "releases";
const FILE = "IDEalize-macOS.zip";
const MAX_ATTEMPTS = 5;
const SIGNED_TTL_S = 120;
const EMAIL_RE = /^[^\s@]+@eqtr\.com$/i;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let email = "", code = "";
  try {
    const b = (await req.json()) ?? {};
    email = (b.email ?? "").toString().trim().toLowerCase();
    code = (b.code ?? "").toString().trim();
  } catch { return json({ error: "bad request" }, 400); }

  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return json({ error: "Invalid code." });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: rows } = await sb.from("download_codes")
    .select("*").eq("email", email).is("consumed_at", null)
    .order("created_at", { ascending: false }).limit(1);
  const row = rows?.[0];

  if (!row) return json({ error: "No active code. Request a new one." });
  if (new Date(row.expires_at).getTime() < Date.now()) return json({ error: "Code expired. Request a new one." });
  if (row.attempts >= MAX_ATTEMPTS) return json({ error: "Too many attempts. Request a new code." });

  const hash = await sha256(`${email}:${code}`);
  if (hash !== row.code_hash) {
    await sb.from("download_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    return json({ error: "That code didn't match. Try again." });
  }

  await sb.from("download_codes").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);

  const { data: signed, error: signErr } = await sb.storage.from(BUCKET)
    .createSignedUrl(FILE, SIGNED_TTL_S, { download: FILE });
  if (signErr || !signed) { console.error("sign", signErr); return json({ error: "Couldn't prepare the download." }, 500); }

  await sb.from("download_log").insert({ email, user_agent: req.headers.get("user-agent") ?? null });

  return json({ ok: true, url: signed.signedUrl });
});
