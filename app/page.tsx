import site from "./data/site.json";
import StrategyExplorer from "./strategy-explorer";

export default function Home() {
  return <StrategyExplorer site={site} />;
}
