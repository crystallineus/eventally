/** The origin the browser used, behind a proxy too (Codespaces, Vercel), for links PayPal sends people back to. */
export function publicOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  if (!host) return new URL(request.url).origin;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
  return `${proto}://${host}`;
}
