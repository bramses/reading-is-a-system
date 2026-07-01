import { connection } from "next/server";

import { readSiteData } from "./site-data";
import StrategyExplorer from "./strategy-explorer";

export const runtime = "nodejs";

export default async function Home() {
  await connection();
  const site = await readSiteData();

  return <StrategyExplorer site={site} />;
}
