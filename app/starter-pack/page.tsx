import { connection } from "next/server";

import { readSiteData } from "../site-data";
import { StarterPackPage } from "../strategy-explorer";

export const runtime = "nodejs";

export default async function Page() {
  await connection();
  const site = await readSiteData();

  return <StarterPackPage site={site} />;
}
