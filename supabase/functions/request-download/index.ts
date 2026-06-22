// request-download — issues a 6-digit code to an @eqtr.com address and emails it
// via Resend. No link anywhere in the email (immune to Safe Links scanners).
// Public function (verify_jwt=false); the domain check + rate limit are the gate.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DOMAIN = "eqtr.com";
const CODE_TTL_MIN = 10;
const MAX_PER_WINDOW = 3;   // codes per email...
const WINDOW_MIN = 15;      // ...per this many minutes
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

  let email = "";
  try { email = (((await req.json()) ?? {}).email ?? "").toString().trim().toLowerCase(); }
  catch { return json({ error: "bad request" }, 400); }

  if (!EMAIL_RE.test(email)) return json({ error: `Only @${DOMAIN} addresses are eligible.` });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // rate limit: at most MAX_PER_WINDOW codes per email per WINDOW_MIN
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const { count } = await sb.from("download_codes")
    .select("*", { count: "exact", head: true })
    .eq("email", email).gte("created_at", since);
  if ((count ?? 0) >= MAX_PER_WINDOW)
    return json({ error: "Too many requests. Wait a few minutes and try again." });

  // 6-digit code, stored only as a hash
  const rnd = new Uint32Array(1);
  crypto.getRandomValues(rnd);
  const code = String(rnd[0] % 1_000_000).padStart(6, "0");
  const code_hash = await sha256(`${email}:${code}`);
  const expires_at = new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString();

  const { error: insErr } = await sb.from("download_codes").insert({ email, code_hash, expires_at });
  if (insErr) { console.error("insert", insErr); return json({ error: "server error" }, 500); }

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "IDEalize <no-reply@projject.ai>",
      to: [email],
      subject: "Your IDEalize download code",
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;line-height:1.5">
        <h2 style="font-weight:600;margin:0 0 8px">Your IDEalize download code</h2>
        <p style="margin:0 0 4px">Enter this code on the download page:</p>
        <p style="font-size:30px;letter-spacing:8px;font-weight:700;margin:16px 0">${code}</p>
        <p style="color:#666;font-size:13px;margin:0">Expires in ${CODE_TTL_MIN} minutes. If you didn't request it, ignore this email.</p>
      </div>`,
    }),
  });
  if (!r.ok) { console.error("resend", r.status, await r.text()); return json({ error: "Couldn't send the email. Try again." }, 502); }

  return json({ ok: true });
});
