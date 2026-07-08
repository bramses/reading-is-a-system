import { connection } from "next/server";

import { readSiteData } from "../site-data";
import type { SiteData } from "../site-types";
import ReadingJournalViewer, {
  type ReadingJournalVideo,
} from "../reading-journal-viewer";

export const runtime = "nodejs";

function extractYouTubeVideoId(url: string) {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.replace(/^www\./, "");

    if (hostname === "youtu.be") {
      return parsedUrl.pathname.split("/").filter(Boolean)[0] ?? null;
    }

    if (
      hostname === "youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "youtube-nocookie.com"
    ) {
      const watchId = parsedUrl.searchParams.get("v");

      if (watchId) {
        return watchId;
      }

      const [firstSegment, secondSegment] = parsedUrl.pathname
        .split("/")
        .filter(Boolean);

      if (
        firstSegment === "embed" ||
        firstSegment === "shorts" ||
        firstSegment === "live"
      ) {
        return secondSegment ?? null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function knownYouTubeTitles(site: SiteData) {
  const titleByVideoId = new Map<string, string>();

  site.strategies.forEach((strategy) => {
    strategy.youtubeLinks.forEach((link) => {
      const videoId = extractYouTubeVideoId(link.url);

      if (videoId) {
        titleByVideoId.set(videoId, link.label);
      }
    });
  });

  return titleByVideoId;
}

async function readYouTubeTitle(url: string, fallbackTitle: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1800);

  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      {
        next: { revalidate: 60 * 60 * 24 },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return fallbackTitle;
    }

    const payload = (await response.json()) as { title?: unknown };

    return typeof payload.title === "string" && payload.title.trim()
      ? payload.title
      : fallbackTitle;
  } catch {
    return fallbackTitle;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function resolveReadingJournalVideos(site: SiteData) {
  const titleByVideoId = knownYouTubeTitles(site);
  const seenVideoIds = new Set<string>();

  const videos = await Promise.all(
    site.readingJournalYoutubeUrls.map(async (url, index) => {
      const videoId = extractYouTubeVideoId(url);

      if (!videoId || seenVideoIds.has(videoId)) {
        return null;
      }

      seenVideoIds.add(videoId);

      const fallbackTitle =
        titleByVideoId.get(videoId) ?? `Reading journal video ${index + 1}`;
      const title = await readYouTubeTitle(url, fallbackTitle);

      return {
        id: videoId,
        title,
        url,
      };
    }),
  );

  return videos.filter(
    (video): video is ReadingJournalVideo => video !== null,
  );
}

export default async function Page() {
  await connection();
  const site = await readSiteData();
  const videos = await resolveReadingJournalVideos(site);

  return <ReadingJournalViewer videos={videos} />;
}
