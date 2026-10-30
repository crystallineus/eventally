import { cookies } from "next/headers";
import { createDemo, DEMO_DAYS, deleteOldDemos, ensureSamplePhotos } from "@/lib/demo";
import { DEMO_COOKIE, DEMO_USER_COOKIE } from "@/lib/session";

const COOKIE = { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * DEMO_DAYS } as const;

/** Start a fresh demo for this browser, viewed as the given role. */
export async function startDemo(origin: string, role: "landlord" | "tenant") {
  // Sample photos come from public/demo/ the first time (the seed script loads them from disk).
  await ensureSamplePhotos(async (name) => {
    const res = await fetch(`${origin}/demo/${name}`);
    if (!res.ok) throw new Error(`Couldn't load sample photo ${name} (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  });
  await deleteOldDemos();
  const demo = await createDemo();
  const jar = await cookies();
  jar.set(DEMO_COOKIE, demo.demoId, COOKIE);
  jar.set(DEMO_USER_COOKIE, role === "landlord" ? demo.tomId : demo.mayaId, COOKIE);
  return demo;
}
