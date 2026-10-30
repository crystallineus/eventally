import { cookies } from "next/headers";
import { createDemo, DEMO_DAYS, deleteOldDemos, ensureSamplePhotos } from "@/lib/demo";
import { DEMO_COOKIE, DEMO_USER_COOKIE } from "@/lib/session";

const COOKIE = { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * DEMO_DAYS } as const;

/** Start a fresh demo for this browser, viewed as the given role. */
export async function startDemo(role: "landlord" | "tenant") {
  await ensureSamplePhotos();
  await deleteOldDemos();
  const demo = await createDemo();
  const jar = await cookies();
  jar.set(DEMO_COOKIE, demo.demoId, COOKIE);
  jar.set(DEMO_USER_COOKIE, role === "landlord" ? demo.tomId : demo.mayaId, COOKIE);
  return demo;
}
