// Minimal PayPal sandbox helpers for spikes. Run scripts with: node --env-file=.env <script>
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.PAYPAL_API_BASE;
const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "results");

for (const key of ["PAYPAL_API_BASE", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]) {
  if (!process.env[key]) throw new Error(`Missing ${key} in .env`);
}

let token;
export async function getToken() {
  if (token) return token;
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`OAuth failed: ${res.status} ${await res.text()}`);
  token = (await res.json()).access_token;
  return token;
}

// Returns { status, body } and never throws on HTTP errors, so spikes can record failures.
export async function pp(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

export function usd(cents) {
  return { currency_code: "USD", value: (cents / 100).toFixed(2) };
}

export function saveResult(name, data) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, `${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}
