// Bill Bachao meter reader: one photo of an electricity meter display -> strict JSON reading.
// - Gemini vision with a response schema at temperature 0; the prompt forbids guessing (unreadable -> null).
// - The photo is never stored: only its SHA-256 is returned (for duplicate checks) and a hashed IP is logged for daily caps.
// - Returns 503 until the GEMINI_API_KEY secret is set, 429 when a daily cap is reached.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

const MAX_BYTES = 6 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const IP_CAP = 20;      // photos per IP per day
const GLOBAL_CAP = 300; // photos per day for the whole public demo

const PROMPT =
  "You read Bangladeshi electricity meter displays (prepaid or postpaid). " +
  "Return ONLY the numbers you can clearly see. If a value is not visible, return null. Never guess. " +
  "kwh_cumulative = the total kWh register; balance_tk = the remaining prepaid balance in taka. " +
  "confidence = how sure you are that the digits are exactly right (0 to 1). " +
  "notes = one short sentence on what you saw (screen type, any problem such as glare or blur).";

const SCHEMA = {
  type: "OBJECT",
  properties: {
    kwh_cumulative: { type: "NUMBER", nullable: true },
    balance_tk: { type: "NUMBER", nullable: true },
    confidence: { type: "NUMBER" },
    notes: { type: "STRING", nullable: true },
  },
  required: ["confidence"],
};

async function sha256Hex(data: Uint8Array | string) {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST a photo as multipart form field 'photo'" }, 405);

  let photo: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("photo");
    photo = f instanceof File ? f : null;
  } catch {
    return json({ error: "Send multipart/form-data with a 'photo' field" }, 400);
  }
  if (!photo) return json({ error: "No photo received" }, 400);
  if (!TYPES.includes(photo.type)) return json({ error: "Upload a JPG, PNG or WEBP photo" }, 415);
  if (photo.size > MAX_BYTES) return json({ error: "Photo too large (max 6 MB)" }, 413);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "Meter reading is not switched on yet (the team still has to add the Gemini key)." }, 503);

  const bytes = new Uint8Array(await photo.arrayBuffer());
  const photoHash = await sha256Hex(bytes);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const ipHash = await sha256Hex("bill-bachao:" + ip);
  const { data: quota, error: qErr } = await db.rpc("take_api_quota", {
    p_feature: "ocr_meter", p_ip_hash: ipHash, p_ip_cap: IP_CAP, p_global_cap: GLOBAL_CAP,
  });
  if (qErr) return json({ error: "Usage check failed, please try again" }, 500);
  if (quota !== "ok") {
    return json({ error: quota === "ip_limit"
      ? `Daily limit reached (${IP_CAP} photos per person). Please try again tomorrow.`
      : "The demo's daily photo limit is reached. Please try again tomorrow." }, 429);
  }

  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: photo.type, data: encodeBase64(bytes) } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA, maxOutputTokens: 300 },
    }),
  });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 200);
    return json({ error: `The AI model could not read this photo (HTTP ${r.status}). Please retake it.`, detail }, 502);
  }
  const j = await r.json();
  const text = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  let reading: { kwh_cumulative?: number | null; balance_tk?: number | null; confidence?: number; notes?: string | null };
  try { reading = JSON.parse(text); } catch { return json({ error: "The AI reply was not valid JSON; no number is shown. Please retake the photo." }, 502); }

  const conf = Math.min(Math.max(Number(reading.confidence) || 0, 0), 1);
  const u = j?.usageMetadata;
  if (u) await db.from("token_usage").insert({ feature: "ocr_meter", model, input_tokens: u.promptTokenCount, output_tokens: u.candidatesTokenCount });

  return json({
    kwh_cumulative: reading.kwh_cumulative ?? null,
    balance_tk: reading.balance_tk ?? null,
    confidence: conf,
    notes: reading.notes ?? null,
    needs_confirmation: conf < 0.85 || (reading.kwh_cumulative == null && reading.balance_tk == null),
    photo_sha256: photoHash,
    model,
    photo_stored: false,
  });
});
