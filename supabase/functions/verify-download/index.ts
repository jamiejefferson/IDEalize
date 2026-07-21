// verify-download — checks a 6-digit code and, on success, returns a short-lived
// signed URL to the private release and logs the download. Public (verify_jwt=false).
// The atomic verify+redeem (attempts cap of 5, single-use) lives in the
// redeem_download_code() RPC — see supabase/migrations/0001_init.sql.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const BUCKET = "releases";
const FILE = "IDEalize-macOS.zip";
const SIGNED_TTL_S = 120;
const EMAIL_RE = /^[^\s@]+@eqtr\.com$/i;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
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

  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code))
    return json({ error: "Invalid or expired code. Request a new one." }, 400);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // One atomic transaction: caps attempts, enforces single-use. The hash
  // comparison happens inside Postgres, so no client-side compare remains.
  const code_hash = await sha256(`${email}:${code}`);
  const { data: status, error: rpcErr } = await sb.rpc("redeem_download_code", {
    p_email: email,
    p_code_hash: code_hash,
  });
  if (rpcErr) { console.error("redeem", rpcErr); return json({ error: "server error" }, 500); }

  if (status === "too_many_attempts") return json({ error: "Too many attempts. Request a new code." }, 429);
  if (status !== "redeemed") return json({ error: "Invalid or expired code. Request a new one." }, 400);

  const { data: signed, error: signErr } = await sb.storage.from(BUCKET)
    .createSignedUrl(FILE, SIGNED_TTL_S, { download: FILE });
  if (signErr || !signed) { console.error("sign", signErr); return json({ error: "Couldn't prepare the download." }, 500); }

  await sb.from("download_log").insert({ email, user_agent: req.headers.get("user-agent") ?? null });

  return json({ ok: true, url: signed.signedUrl });
});
