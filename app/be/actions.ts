"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { writeSiteData } from "../site-data";
import type { ResourceLink, SiteData, Strategy } from "../site-types";
import {
  clearAdminSession,
  requireAdmin,
  setAdminSession,
  verifyPassword,
} from "./auth";

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);

  return typeof value === "string" ? value.trim() : "";
}

function blockValue(formData: FormData, name: string) {
  const value = formData.get(name);

  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

function listFromText(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function labelFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function assertUrl(value: string, label: string) {
  if (!value) {
    return;
  }

  try {
    new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
}

function parseResourceLinks(value: string, label: string): ResourceLink[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const pipeIndex = line.indexOf("|");
      const rawLabel = pipeIndex >= 0 ? line.slice(0, pipeIndex).trim() : "";
      const url = pipeIndex >= 0 ? line.slice(pipeIndex + 1).trim() : line;

      assertUrl(url, `${label} line ${index + 1}`);

      return {
        label: rawLabel || labelFromUrl(url),
        url,
      };
    });
}

function assertRequired(value: string, label: string) {
  if (!value) {
    throw new Error(`${label} is required.`);
  }
}

function readStrategy(formData: FormData, prefix: string, fallbackLabel: string) {
  const title = textValue(formData, `${prefix}_title`);
  const generatedId = slugify(title);
  const id = slugify(textValue(formData, `${prefix}_id`) || generatedId);
  const subtitle = blockValue(formData, `${prefix}_subtitle`);
  const body = blockValue(formData, `${prefix}_body`);

  assertRequired(id, `${fallbackLabel} ID`);
  assertRequired(title, `${fallbackLabel} title`);
  assertRequired(subtitle, `${fallbackLabel} subtitle`);
  assertRequired(body, `${fallbackLabel} body`);

  return {
    id,
    title,
    subtitle,
    tags: listFromText(blockValue(formData, `${prefix}_tags`)),
    pairedWithIds: listFromText(blockValue(formData, `${prefix}_pairedWithIds`)),
    body,
    assets: parseResourceLinks(
      blockValue(formData, `${prefix}_assets`),
      `${fallbackLabel} assets`,
    ),
    youtubeLinks: listFromText(blockValue(formData, `${prefix}_youtubeLinks`)),
    imageUrls: listFromText(blockValue(formData, `${prefix}_imageUrls`)),
    audioFileUrls: listFromText(
      blockValue(formData, `${prefix}_audioFileUrls`),
    ),
  } satisfies Strategy;
}

function formDataToSiteData(formData: FormData): SiteData {
  const site: SiteData = {
    title: textValue(formData, "title"),
    subtitle: blockValue(formData, "subtitle"),
    links: {
      discord: textValue(formData, "link_discord"),
      slides: textValue(formData, "link_slides"),
      github: textValue(formData, "link_github"),
      schedule: textValue(formData, "link_schedule"),
    },
    tags: listFromText(blockValue(formData, "tags")),
    strategies: [],
  };

  assertRequired(site.title, "Page title");
  assertRequired(site.subtitle, "Page subtitle");
  assertRequired(site.links.discord, "Discord link");
  assertRequired(site.links.slides, "Slides link");
  assertRequired(site.links.github, "GitHub link");
  assertRequired(site.links.schedule, "Schedule link");
  assertUrl(site.links.discord, "Discord link");
  assertUrl(site.links.slides, "Slides link");
  assertUrl(site.links.github, "GitHub link");
  assertUrl(site.links.schedule, "Schedule link");

  const strategyIndexes = formData
    .getAll("strategyIndex")
    .filter((value): value is string => typeof value === "string");

  site.strategies = strategyIndexes
    .filter((index) => formData.get(`strategy_${index}_delete`) !== "on")
    .map((index) =>
      readStrategy(formData, `strategy_${index}`, `Strategy ${index}`),
    );

  const hasNewStrategy = [
    "new_id",
    "new_title",
    "new_subtitle",
    "new_body",
    "new_tags",
  ].some((field) => textValue(formData, field).length > 0);

  if (hasNewStrategy) {
    site.strategies.push(readStrategy(formData, "new", "New strategy"));
  }

  const strategyIds = new Set<string>();

  for (const strategy of site.strategies) {
    if (strategyIds.has(strategy.id)) {
      throw new Error(`Strategy ID "${strategy.id}" is duplicated.`);
    }

    strategyIds.add(strategy.id);
  }

  return site;
}

function statusRedirect(status: string, message?: string) {
  const params = new URLSearchParams({ status });

  if (message) {
    params.set("message", message);
  }

  redirect(`/be?${params.toString()}`);
}

export async function loginToEditor(formData: FormData) {
  const password = textValue(formData, "password");

  if (verifyPassword(password)) {
    await setAdminSession();
    statusRedirect("signed-in");
  }

  statusRedirect("bad-password");
}

export async function logoutOfEditor() {
  await clearAdminSession();
  statusRedirect("signed-out");
}

export async function saveSiteContent(formData: FormData) {
  await requireAdmin();

  let redirectStatus = "saved";
  let redirectMessage: string | undefined;

  try {
    const site = formDataToSiteData(formData);
    await writeSiteData(site);
    revalidatePath("/");
    revalidatePath("/be");
  } catch (error) {
    redirectStatus = "error";
    redirectMessage =
      error instanceof Error ? error.message : "The content could not be saved.";
  }

  statusRedirect(redirectStatus, redirectMessage);
}
