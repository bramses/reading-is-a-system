"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

export type ReadingJournalVideo = {
  id: string;
  title: string;
  url: string;
};

type ReadingJournalViewerProps = {
  videos: ReadingJournalVideo[];
};

function ArrowLeftIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

function videoEmbedUrl(videoId: string, active: boolean) {
  const params = new URLSearchParams({
    autoplay: active ? "1" : "0",
    controls: "1",
    enablejsapi: "1",
    modestbranding: "1",
    mute: "1",
    playsinline: "1",
    rel: "0",
  });

  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

export default function ReadingJournalViewer({
  videos,
}: ReadingJournalViewerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  const activeVideo = videos[activeIndex];

  const scrollToIndex = useCallback((index: number) => {
    const nextIndex = Math.min(Math.max(index, 0), videos.length - 1);
    const section = sectionRefs.current[nextIndex];

    if (!section) {
      return;
    }

    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [videos.length]);

  function updateActiveFromScroll() {
    const scroller = scrollerRef.current;

    if (!scroller) {
      return;
    }

    const nextIndex = Math.min(
      Math.max(Math.round(scroller.scrollTop / scroller.clientHeight), 0),
      videos.length - 1,
    );

    setActiveIndex(nextIndex);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key !== "ArrowDown" &&
        event.key !== "ArrowRight" &&
        event.key !== "ArrowUp" &&
        event.key !== "ArrowLeft"
      ) {
        return;
      }

      event.preventDefault();

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        scrollToIndex(activeIndex + 1);
        return;
      }

      scrollToIndex(activeIndex - 1);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeIndex, scrollToIndex]);

  if (videos.length === 0) {
    return (
      <main className="min-h-screen bg-[#201f1b] text-[#f7f5ef]">
        <header className="border-b border-[#f7f5ef]/20 bg-[#201f1b]">
          <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
            <Link
              aria-label="Back to main page"
              className="inline-flex size-11 items-center justify-center border border-[#f7f5ef] hover:bg-[#f7f5ef] hover:text-[#201f1b]"
              href="/"
            >
              <ArrowLeftIcon />
            </Link>
            <h1 className="text-sm font-semibold uppercase">
              Bram&apos;s Reading Journal
            </h1>
          </div>
        </header>
        <section className="mx-auto max-w-4xl px-4 py-8">
          <p className="border border-[#f7f5ef]/20 p-4 text-sm leading-6">
            No journal videos are configured yet.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="h-[100dvh] overflow-hidden bg-[#201f1b] text-[#f7f5ef]">
      <header className="fixed inset-x-0 top-0 z-20 border-b border-[#f7f5ef]/20 bg-[#201f1b]">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link
            aria-label="Back to main page"
            className="inline-flex size-11 items-center justify-center border border-[#f7f5ef] hover:bg-[#f7f5ef] hover:text-[#201f1b]"
            href="/"
          >
            <ArrowLeftIcon />
          </Link>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase">
              Bram&apos;s Reading Journal
            </p>
            <h1 className="truncate text-sm font-semibold sm:text-base">
              {activeVideo.title}
            </h1>
          </div>
        </div>
      </header>

      <div
        aria-label="Reading journal videos"
        className="h-[100dvh] snap-y snap-mandatory overflow-y-auto overscroll-contain"
        onScroll={updateActiveFromScroll}
        ref={scrollerRef}
      >
        {videos.map((video, index) => {
          const active = activeIndex === index;

          return (
            <section
              aria-label={video.title}
              className="flex min-h-[100dvh] snap-start flex-col px-4 pb-5 pt-24"
              key={video.id}
              ref={(section) => {
                sectionRefs.current[index] = section;
              }}
            >
              <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 items-center justify-center">
                <div className="h-[calc(100dvh-8rem)] w-full overflow-hidden border border-[#f7f5ef]/20 bg-black sm:h-[calc(100dvh-9rem)]">
                  <iframe
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    className="h-full w-full"
                    loading={index <= 1 ? "eager" : "lazy"}
                    src={videoEmbedUrl(video.id, active)}
                    title={video.title}
                  />
                </div>
              </div>
              <div className="mx-auto mt-3 flex w-full max-w-5xl items-center justify-between gap-4 text-xs text-[#d8d1c1]">
                <p>
                  {index + 1} / {videos.length}
                </p>
                <a
                  className="underline decoration-[#d8d1c1] underline-offset-4"
                  href={video.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open on YouTube
                </a>
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
