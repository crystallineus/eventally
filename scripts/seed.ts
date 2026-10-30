// Resets the database: WIPES ALL DATA, then stores the shared sample photos. There's no shared
// Tom and Maya any more: each visitor gets their own demo when they pick one on the home page
// (lib/demo.ts). Usage: npm run db:seed
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { ensureSamplePhotos, SAMPLE_PHOTOS } from "../lib/demo";

async function main() {
  await db().execute(
    sql`truncate ${schema.events}, ${schema.payouts}, ${schema.ledgerEntries}, ${schema.invoices}, ${schema.evidence}, ${schema.claims}, ${schema.leases}, ${schema.users}, ${schema.demos}, ${schema.demoPhotos} cascade`,
  );
  await ensureSamplePhotos((name) => readFile(path.join(process.cwd(), "public", "demo", name)));
  console.log(`Database cleared; ${SAMPLE_PHOTOS.length} sample photos stored. Open the app and pick Maya or Tom to start a demo.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
