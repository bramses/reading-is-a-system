import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ResourceLink, SiteData, Strategy } from "./site-types";

const SITE_DATA_PATH = path.join(process.cwd(), "app", "data", "site.json");

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value.map((item, index) => readString(item, `${label}.${index}`));
}

function readResourceLinks(value: unknown, label: string): ResourceLink[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value.map((item, index) => {
    const link = readObject(item, `${label}.${index}`);

    return {
      label: readString(link.label, `${label}.${index}.label`),
      url: readString(link.url, `${label}.${index}.url`),
    };
  });
}

function readStrategy(value: unknown, index: number): Strategy {
  const strategy = readObject(value, `strategies.${index}`);

  return {
    id: readString(strategy.id, `strategies.${index}.id`),
    title: readString(strategy.title, `strategies.${index}.title`),
    subtitle: readString(strategy.subtitle, `strategies.${index}.subtitle`),
    tags: readStringArray(strategy.tags, `strategies.${index}.tags`),
    pairedWithIds: readStringArray(
      strategy.pairedWithIds,
      `strategies.${index}.pairedWithIds`,
    ),
    body: readString(strategy.body, `strategies.${index}.body`),
    assets: readResourceLinks(strategy.assets, `strategies.${index}.assets`),
    youtubeLinks: readResourceLinks(
      strategy.youtubeLinks,
      `strategies.${index}.youtubeLinks`,
    ),
    imageUrls: readStringArray(
      strategy.imageUrls,
      `strategies.${index}.imageUrls`,
    ),
    audioFileUrls: readStringArray(
      strategy.audioFileUrls,
      `strategies.${index}.audioFileUrls`,
    ),
  };
}

function normalizeSiteData(value: unknown): SiteData {
  const site = readObject(value, "site");
  const links = readObject(site.links, "links");

  if (!Array.isArray(site.strategies)) {
    throw new Error("strategies must be an array.");
  }

  return {
    title: readString(site.title, "title"),
    subtitle: readString(site.subtitle, "subtitle"),
    links: {
      discord: readString(links.discord, "links.discord"),
      slides: readString(links.slides, "links.slides"),
      github: readString(links.github, "links.github"),
      schedule: readString(links.schedule, "links.schedule"),
    },
    tags: readStringArray(site.tags, "tags"),
    strategies: site.strategies.map(readStrategy),
  };
}

export async function readSiteData(): Promise<SiteData> {
  const rawSiteData = await readFile(SITE_DATA_PATH, "utf8");

  return normalizeSiteData(JSON.parse(rawSiteData));
}

export async function writeSiteData(site: SiteData) {
  await writeFile(SITE_DATA_PATH, `${JSON.stringify(site, null, 2)}\n`, "utf8");
}
