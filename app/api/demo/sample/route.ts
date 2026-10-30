import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SAMPLE_PHOTOS } from "@/lib/demo";

// One sample photo by name (e.g. ?name=hood-light-replacement/light-receipt.jpg), for the
// "use sample photos" buttons. They're fictional demo files, also offered as a zip.
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!(SAMPLE_PHOTOS as readonly string[]).includes(name)) return new Response("Not found", { status: 404 });
  const [photo] = await db().select().from(schema.demoPhotos).where(eq(schema.demoPhotos.name, name));
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.data), {
    headers: { "Content-Type": photo.mimeType, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
}
