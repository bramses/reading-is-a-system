"use client";

/* eslint-disable @next/next/no-img-element -- Image URLs come from JSON and should not require Next config updates per host. */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import Link from "next/link";

import type { SiteData, Strategy } from "./site-types";

type StrategyExplorerProps = {
  site: SiteData;
};

type ChecklistField = "whereNow" | "goal";

type ChecklistEntry = Record<ChecklistField, string>;

type PrintMode = "cart" | "strategyGame";

type StrategyGameEntry = {
  strategyId: string;
  response: string;
};

type StrategyGameState = {
  entries: StrategyGameEntry[];
  index: number;
};

type CartState = {
  strategyIds: string[];
  checklistEntries: Record<string, ChecklistEntry>;
};

type ReadingTimerState = {
  completedCount: number;
  selectedThroughIndex: number | null;
  activeTimer: {
    blocks: number;
    endsAt: number;
    pausedRemainingMs: number | null;
    startedAt: number;
  } | null;
};

const CART_STORAGE_KEY = "reading-is-a-system-cart";
const READING_TIMER_STORAGE_KEY = "reading-is-a-system-reading-timer";
const STRATEGY_GAME_STORAGE_KEY = "reading-is-a-system-strategy-game";
const STRATEGY_GAME_SEEN_STORAGE_KEY =
  "reading-is-a-system-strategy-game-seen";
const KINDLE_APP_DEEP_LINK = "kindle://";
const AUDIBLE_APP_DEEP_LINK = "audible://";
const KINDLE_WEB_READER_URL = "https://read.amazon.com/kindle-library";
const AUDIBLE_WEB_URL = "https://www.audible.com/library/titles";
const READING_TIMER_BLOCK_COUNT = 10;
const READING_TIMER_BLOCK_MINUTES = 5;
const READING_TIMER_BLOCK_MS = READING_TIMER_BLOCK_MINUTES * 60 * 1000;
const STRATEGY_GAME_ROUND_COUNT = 3;
const STRATEGY_GAME_CHARACTER_GOAL = 140;
const STRATEGY_GAME_CONFETTI_COLORS = [
  "#315d4c",
  "#b64f3a",
  "#d8b15f",
  "#2f5f87",
  "#22201b",
  "#8a826f",
];
const TAG_ACCENT_COLORS: Record<string, string> = {
  comprehension: "oklch(0.56 0.12 255)",
  throughput: "oklch(0.52 0.1 155)",
  store: "oklch(0.64 0.12 80)",
  search: "oklch(0.55 0.13 305)",
  synthesize: "oklch(0.57 0.1 200)",
  share: "oklch(0.6 0.15 350)",
  digilog: "oklch(0.64 0.13 50)",
  "bad-habits": "oklch(0.56 0.16 28)",
};

const BLANK_CART_STATE: CartState = {
  strategyIds: [],
  checklistEntries: {},
};

const BLANK_READING_TIMER_STATE: ReadingTimerState = {
  completedCount: 0,
  selectedThroughIndex: null,
  activeTimer: null,
};
const BLANK_STRATEGY_GAME_STATE: StrategyGameState = {
  entries: [],
  index: 0,
};
const BLANK_STRATEGY_GAME_SEEN_IDS: string[] = [];

let cartStateCache: CartState | null = null;
const cartStateListeners = new Set<() => void>();
let readingTimerStateCache: ReadingTimerState | null = null;
const readingTimerStateListeners = new Set<() => void>();
let strategyGameStateCache: StrategyGameState | null = null;
const strategyGameStateListeners = new Set<() => void>();
let strategyGameSeenIdsCache: string[] | null = null;
const strategyGameSeenIdsListeners = new Set<() => void>();
const shuffledStrategiesBySource = new WeakMap<readonly Strategy[], Strategy[]>();

const CHECKLIST_FIELDS: Array<{ id: ChecklistField; label: string }> = [
  { id: "whereNow", label: "Where are you now?" },
  { id: "goal", label: "Goal" },
];

type WakeLockSentinel = {
  release: () => Promise<void>;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinel>;
  };
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function createBlankChecklistEntry(): ChecklistEntry {
  return {
    whereNow: "",
    goal: "",
  };
}

function createBlankCartState(): CartState {
  return {
    strategyIds: [],
    checklistEntries: {},
  };
}

function createBlankReadingTimerState(): ReadingTimerState {
  return {
    completedCount: 0,
    selectedThroughIndex: null,
    activeTimer: null,
  };
}

function createBlankStrategyGameState(): StrategyGameState {
  return {
    entries: [],
    index: 0,
  };
}

function countCharacters(value: string) {
  return value.trim().length;
}

function formatExportTimestamp(date = new Date()) {
  const pad = (value: number) => value.toString().padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
}

function createExportTitle(kind: "cart" | "strategy-game") {
  return `reading-is-a-system-${kind}-${formatExportTimestamp()}`;
}

function tagAccentColor(tag: string) {
  return TAG_ACCENT_COLORS[tag] ?? "oklch(0.55 0.2 25)";
}

function strategyAccentColor(strategy: Strategy) {
  return tagAccentColor(strategy.tags[0] ?? "");
}

function strategyAccentStyle(
  strategy: Strategy,
): CSSProperties & Record<"--strategy-accent", string> {
  return {
    "--strategy-accent": strategyAccentColor(strategy),
  };
}

function tagStyle(
  tag: string,
  selected = true,
): CSSProperties & Record<"--tag-color" | "--tag-ink", string> {
  return {
    "--tag-color": selected ? tagAccentColor(tag) : "#f8f4ea",
    "--tag-ink": selected ? "#ffffff" : "#22201b",
  };
}

function splitHeroTitle(title: string) {
  const words = title.trim().split(/\s+/);
  const accent = words.pop() ?? title;
  const lead = words.join(" ");

  return { accent, lead };
}

function repeatedMarqueeItems(items: string[]) {
  return [...items, ...items];
}

function RisoMarquee({ items }: { items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="riso-marquee print:hidden">
      <div className="riso-marquee-track">
        {repeatedMarqueeItems(items).map((item, index) => (
          <span aria-hidden={index >= items.length} key={`${item}-${index}`}>
            {item}
            <span className="mx-4 text-[var(--accent)]">+</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function createStrategyGameEntries(
  strategies: readonly Strategy[],
  seenStrategyIds: readonly string[],
): StrategyGameEntry[] {
  const seenStrategyIdSet = new Set(seenStrategyIds);

  return shuffleStrategies(
    strategies.filter((strategy) => !seenStrategyIdSet.has(strategy.id)),
  )
    .slice(0, STRATEGY_GAME_ROUND_COUNT)
    .map((strategy) => ({
      strategyId: strategy.id,
      response: "",
    }));
}

function readStoredStrategyGameSeenIds(
  strategyById: Map<string, Strategy>,
): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const storedSeenIds = window.sessionStorage.getItem(
      STRATEGY_GAME_SEEN_STORAGE_KEY,
    );

    if (!storedSeenIds) {
      return [];
    }

    const parsedSeenIds = JSON.parse(storedSeenIds) as unknown;

    if (!Array.isArray(parsedSeenIds)) {
      return [];
    }

    const uniqueSeenIds = new Set<string>();

    parsedSeenIds.forEach((strategyId) => {
      if (typeof strategyId === "string" && strategyById.has(strategyId)) {
        uniqueSeenIds.add(strategyId);
      }
    });

    return [...uniqueSeenIds];
  } catch {
    return [];
  }
}

function writeStoredStrategyGameSeenIds(strategyIds: readonly string[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    STRATEGY_GAME_SEEN_STORAGE_KEY,
    JSON.stringify(strategyIds),
  );
}

function strategyGameConfettiStyle(
  index: number,
): CSSProperties & Record<"--confetti-shift", string> {
  return {
    "--confetti-shift": `${index % 2 === 0 ? "-" : ""}${18 + (index % 7) * 9}vw`,
    animationDelay: `${(index % 12) * 0.05}s`,
    backgroundColor:
      STRATEGY_GAME_CONFETTI_COLORS[
        index % STRATEGY_GAME_CONFETTI_COLORS.length
      ],
    left: `${(index * 29) % 100}%`,
  };
}

function getServerCartSnapshot() {
  return BLANK_CART_STATE;
}

function getServerReadingTimerSnapshot() {
  return BLANK_READING_TIMER_STATE;
}

function getServerStrategyGameSnapshot() {
  return BLANK_STRATEGY_GAME_STATE;
}

function getServerStrategyGameSeenIdsSnapshot() {
  return BLANK_STRATEGY_GAME_SEEN_IDS;
}

function normalizeReadingTimerState(
  timerState: Partial<ReadingTimerState>,
): ReadingTimerState {
  const completedCount = clampNumber(
    Math.floor(Number(timerState.completedCount) || 0),
    0,
    READING_TIMER_BLOCK_COUNT,
  );
  const selectedThroughIndex =
    completedCount < READING_TIMER_BLOCK_COUNT &&
    typeof timerState.selectedThroughIndex === "number"
      ? clampNumber(
          Math.floor(timerState.selectedThroughIndex),
          completedCount,
          READING_TIMER_BLOCK_COUNT - 1,
        )
      : null;
  const activeTimer = timerState.activeTimer;

  if (completedCount >= READING_TIMER_BLOCK_COUNT) {
    return {
      completedCount,
      selectedThroughIndex: null,
      activeTimer: null,
    };
  }

  if (
    activeTimer &&
    Number.isFinite(activeTimer.blocks) &&
    Number.isFinite(activeTimer.endsAt) &&
    Number.isFinite(activeTimer.startedAt)
  ) {
    const blocks = clampNumber(
      Math.floor(activeTimer.blocks),
      1,
      READING_TIMER_BLOCK_COUNT - completedCount,
    );

    const pausedRemainingMs =
      typeof activeTimer.pausedRemainingMs === "number"
        ? clampNumber(
            activeTimer.pausedRemainingMs,
            0,
            blocks * READING_TIMER_BLOCK_MS,
          )
        : null;

    if (pausedRemainingMs === null && Date.now() >= activeTimer.endsAt) {
      return {
        completedCount: clampNumber(
          completedCount + blocks,
          0,
          READING_TIMER_BLOCK_COUNT,
        ),
        selectedThroughIndex: null,
        activeTimer: null,
      };
    }

    return {
      completedCount,
      selectedThroughIndex: clampNumber(
        completedCount + blocks - 1,
        completedCount,
        READING_TIMER_BLOCK_COUNT - 1,
      ),
      activeTimer: {
        blocks,
        endsAt: activeTimer.endsAt,
        pausedRemainingMs,
        startedAt: activeTimer.startedAt,
      },
    };
  }

  return {
    completedCount,
    selectedThroughIndex,
    activeTimer: null,
  };
}

function readStoredCartState(strategyById: Map<string, Strategy>): CartState {
  if (typeof window === "undefined") {
    return createBlankCartState();
  }

  try {
    const storedCart = window.sessionStorage.getItem(CART_STORAGE_KEY);

    if (!storedCart) {
      return createBlankCartState();
    }

    const parsedCart = JSON.parse(storedCart) as Partial<CartState>;

    return {
      strategyIds: (parsedCart.strategyIds ?? []).filter((strategyId) =>
        strategyById.has(strategyId),
      ),
      checklistEntries: parsedCart.checklistEntries ?? {},
    };
  } catch {
    return createBlankCartState();
  }
}

function getClientCartSnapshot(strategyById: Map<string, Strategy>) {
  cartStateCache ??= readStoredCartState(strategyById);

  return cartStateCache;
}

function readStoredReadingTimerState(): ReadingTimerState {
  if (typeof window === "undefined") {
    return createBlankReadingTimerState();
  }

  try {
    const storedTimerState = window.sessionStorage.getItem(
      READING_TIMER_STORAGE_KEY,
    );

    if (!storedTimerState) {
      return createBlankReadingTimerState();
    }

    return normalizeReadingTimerState(
      JSON.parse(storedTimerState) as Partial<ReadingTimerState>,
    );
  } catch {
    return createBlankReadingTimerState();
  }
}

function getClientReadingTimerSnapshot() {
  readingTimerStateCache ??= readStoredReadingTimerState();

  return readingTimerStateCache;
}

function readStoredStrategyGameState(
  strategyById: Map<string, Strategy>,
): StrategyGameState {
  if (typeof window === "undefined") {
    return createBlankStrategyGameState();
  }

  try {
    const storedGame = window.sessionStorage.getItem(
      STRATEGY_GAME_STORAGE_KEY,
    );

    if (!storedGame) {
      return createBlankStrategyGameState();
    }

    const parsedGame = JSON.parse(storedGame) as Partial<StrategyGameState>;
    const entries = Array.isArray(parsedGame.entries)
      ? parsedGame.entries
          .map((entry) => ({
            response:
              typeof entry?.response === "string" ? entry.response : "",
            strategyId:
              typeof entry?.strategyId === "string" ? entry.strategyId : "",
          }))
          .filter((entry) => strategyById.has(entry.strategyId))
      : [];

    return {
      entries,
      index: clampNumber(
        Math.floor(Number(parsedGame.index) || 0),
        0,
        entries.length,
      ),
    };
  } catch {
    return createBlankStrategyGameState();
  }
}

function getClientStrategyGameSnapshot(strategyById: Map<string, Strategy>) {
  strategyGameStateCache ??= readStoredStrategyGameState(strategyById);

  return strategyGameStateCache;
}

function getClientStrategyGameSeenIdsSnapshot(
  strategyById: Map<string, Strategy>,
) {
  strategyGameSeenIdsCache ??= readStoredStrategyGameSeenIds(strategyById);

  return strategyGameSeenIdsCache;
}

function subscribeToCartState(listener: () => void) {
  cartStateListeners.add(listener);

  return () => {
    cartStateListeners.delete(listener);
  };
}

function subscribeToReadingTimerState(listener: () => void) {
  readingTimerStateListeners.add(listener);

  return () => {
    readingTimerStateListeners.delete(listener);
  };
}

function subscribeToStrategyGameState(listener: () => void) {
  strategyGameStateListeners.add(listener);

  return () => {
    strategyGameStateListeners.delete(listener);
  };
}

function subscribeToStrategyGameSeenIds(listener: () => void) {
  strategyGameSeenIdsListeners.add(listener);

  return () => {
    strategyGameSeenIdsListeners.delete(listener);
  };
}

function subscribeToStrategyOrder() {
  return () => {};
}

function writeCartState(cartState: CartState) {
  cartStateCache = cartState;

  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartState));
  }

  cartStateListeners.forEach((listener) => listener());
}

function writeReadingTimerState(timerState: ReadingTimerState) {
  readingTimerStateCache = normalizeReadingTimerState(timerState);

  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(
      READING_TIMER_STORAGE_KEY,
      JSON.stringify(readingTimerStateCache),
    );
  }

  readingTimerStateListeners.forEach((listener) => listener());
}

function writeStrategyGameState(gameState: StrategyGameState) {
  strategyGameStateCache = gameState;

  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(
      STRATEGY_GAME_STORAGE_KEY,
      JSON.stringify(gameState),
    );
  }

  strategyGameStateListeners.forEach((listener) => listener());
}

function writeStrategyGameSeenIds(strategyIds: string[]) {
  strategyGameSeenIdsCache = strategyIds;

  writeStoredStrategyGameSeenIds(strategyIds);

  strategyGameSeenIdsListeners.forEach((listener) => listener());
}

function completeActiveReadingTimer(timerState: ReadingTimerState) {
  if (!timerState.activeTimer) {
    return timerState;
  }

  return {
    completedCount: clampNumber(
      timerState.completedCount + timerState.activeTimer.blocks,
      0,
      READING_TIMER_BLOCK_COUNT,
    ),
    selectedThroughIndex: null,
    activeTimer: null,
  };
}

function formatReadingTimer(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function shuffleStrategies(strategies: readonly Strategy[]) {
  const shuffled = [...strategies];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [
      shuffled[randomIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

function shuffledStrategies(strategies: readonly Strategy[]) {
  const cachedStrategies = shuffledStrategiesBySource.get(strategies);

  if (cachedStrategies) {
    return cachedStrategies;
  }

  const shuffled = shuffleStrategies(strategies);

  shuffledStrategiesBySource.set(strategies, shuffled);

  return shuffled;
}

function reshuffleStrategies(strategies: readonly Strategy[]) {
  const shuffled = shuffleStrategies(strategies);

  shuffledStrategiesBySource.set(strategies, shuffled);

  return shuffled;
}

function linkLabel(url: string) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function urlsToLinks(urls: string[]) {
  return urls.map((url) => ({
    label: linkLabel(url),
    url,
  }));
}

function strategyLinkGroups(strategy: Strategy) {
  return [
    {
      title: "Assets",
      links: strategy.assets,
    },
    {
      title: "YouTube",
      links: strategy.youtubeLinks,
    },
    {
      title: "Audio",
      links: urlsToLinks(strategy.audioFileUrls),
    },
  ].filter((group) => group.links.length > 0);
}

function DiscordIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M20.3 4.4A16.9 16.9 0 0 0 16.1 3l-.2.3c-.2.4-.4.8-.5 1.2a15.8 15.8 0 0 0-6.8 0c-.1-.4-.3-.8-.6-1.2L7.9 3a17 17 0 0 0-4.2 1.4A17.7 17.7 0 0 0 1.5 18a17.1 17.1 0 0 0 5.2 2.6l.4-.5.8-1.4a10.7 10.7 0 0 1-1.3-.6l.3-.2a12.2 12.2 0 0 0 10.2 0l.3.2c-.4.2-.9.5-1.3.6.2.5.5 1 .8 1.4l.4.5a17 17 0 0 0 5.2-2.6 17.8 17.8 0 0 0-2.2-13.6ZM8.3 15.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7.4 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        clipRule="evenodd"
        d="M12 2C6.5 2 2 6.6 2 12.2c0 4.5 2.9 8.3 6.8 9.7.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 0 1.6 1.1 1.6 1.1.9 1.6 2.4 1.1 2.9.8.1-.7.4-1.1.7-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1.1-2.7-.1-.3-.5-1.3.1-2.7 0 0 .9-.3 2.8 1.1a9.4 9.4 0 0 1 5.1 0c2-1.4 2.8-1.1 2.8-1.1.6 1.4.2 2.4.1 2.7.7.7 1.1 1.6 1.1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.8v2.8c0 .3.2.6.7.5a10.1 10.1 0 0 0 6.8-9.7C22 6.6 17.5 2 12 2Z"
        fillRule="evenodd"
      />
    </svg>
  );
}

function SlidesIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M4 5h16v11H4z" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
      <path d="M8 9h8" />
      <path d="M8 12h5" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M4 7h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4z" />
      <path d="m17 10 4-2v8l-4-2" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M3 10h18" />
      <path d="M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CloseIcon() {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

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

function CoffeeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M10 2v2" />
      <path d="M14 2v2" />
      <path d="M16 8h2a3 3 0 0 1 0 6h-2" />
      <path d="M4 8h12v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z" />
      <path d="M6 22h8" />
    </svg>
  );
}

function CartIcon({ selected = false }: { selected?: boolean }) {
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
      <path d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 7H6" />
      <circle cx="10" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
      {selected ? <path d="m10 11 2 2 4-4" /> : null}
    </svg>
  );
}

export default function StrategyExplorer({ site }: StrategyExplorerProps) {
  const tags = site.tags;
  const marqueeItems = site.marqueeItems.length > 0 ? site.marqueeItems : tags;
  const heroTitleParts = splitHeroTitle(site.title);
  const strategyById = useMemo(
    () =>
      new Map(
        site.strategies.map((strategy) => [strategy.id, strategy] as const),
      ),
    [site.strategies],
  );
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsButtonInteracted, setDetailsButtonInteracted] =
    useState(false);
  const [lightboxImage, setLightboxImage] = useState<{
    alt: string;
    url: string;
  } | null>(null);
  const [starterPackIndex, setStarterPackIndex] = useState<number | null>(null);
  const [cartExpanded, setCartExpanded] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());
  const [kindleMenuOpen, setKindleMenuOpen] = useState(false);
  const [strategyGameOpen, setStrategyGameOpen] = useState(false);
  const [showStrategyGameCelebration, setShowStrategyGameCelebration] =
    useState(false);
  const [printMode, setPrintMode] = useState<PrintMode | null>(null);
  const [clipboardMessage, setClipboardMessage] = useState<string | null>(null);
  const printTitleRestoreRef = useRef<string | null>(null);
  const clipboardMessageTimeoutRef = useRef<number | null>(null);
  const [, forceStrategyShuffleRender] = useState(0);
  const readingTimerState = useSyncExternalStore(
    subscribeToReadingTimerState,
    getClientReadingTimerSnapshot,
    getServerReadingTimerSnapshot,
  );
  const strategyGameState = useSyncExternalStore(
    subscribeToStrategyGameState,
    () => getClientStrategyGameSnapshot(strategyById),
    getServerStrategyGameSnapshot,
  );
  const strategyGameSeenIds = useSyncExternalStore(
    subscribeToStrategyGameSeenIds,
    () => getClientStrategyGameSeenIdsSnapshot(strategyById),
    getServerStrategyGameSeenIdsSnapshot,
  );
  const shuffledStrategyOrder = useSyncExternalStore(
    subscribeToStrategyOrder,
    () => shuffledStrategies(site.strategies),
    () => site.strategies,
  );
  const cartState = useSyncExternalStore(
    subscribeToCartState,
    () => getClientCartSnapshot(strategyById),
    getServerCartSnapshot,
  );
  const cartStrategyIds = cartState.strategyIds;
  const checklistEntries = cartState.checklistEntries;
  const strategyGameEntries = strategyGameState.entries;
  const strategyGameIndex = strategyGameState.index;

  const cartStrategies = useMemo(
    () =>
      cartStrategyIds
        .map((strategyId) => strategyById.get(strategyId))
        .filter((strategy): strategy is Strategy => Boolean(strategy)),
    [cartStrategyIds, strategyById],
  );

  const starterPackStrategies = useMemo(
    () =>
      site.starterPackStrategyIds
        .map((strategyId) => strategyById.get(strategyId))
        .filter((strategy): strategy is Strategy => Boolean(strategy)),
    [site.starterPackStrategyIds, strategyById],
  );
  const starterPackStrategy =
    starterPackIndex === null ? null : starterPackStrategies[starterPackIndex];
  const starterPackLinkGroups = starterPackStrategy
    ? strategyLinkGroups(starterPackStrategy)
    : [];
  const starterPackInCart = starterPackStrategy
    ? cartStrategyIds.includes(starterPackStrategy.id)
    : false;
  const activeReadingTimer = readingTimerState.activeTimer;
  const readingTimerPaused =
    activeReadingTimer?.pausedRemainingMs !== null &&
    activeReadingTimer?.pausedRemainingMs !== undefined;
  const readingTimerSelectedThroughIndex =
    activeReadingTimer === null
      ? readingTimerState.selectedThroughIndex ??
        (readingTimerState.completedCount < READING_TIMER_BLOCK_COUNT
          ? readingTimerState.completedCount
          : null)
      : readingTimerState.completedCount + activeReadingTimer.blocks - 1;
  const readingTimerSelectedBlocks =
    readingTimerSelectedThroughIndex === null
      ? 0
      : Math.max(
          0,
          readingTimerSelectedThroughIndex - readingTimerState.completedCount + 1,
        );
  const readingTimerSelectedMinutes =
    readingTimerSelectedBlocks * READING_TIMER_BLOCK_MINUTES;
  const readingTimerRemainingMs = activeReadingTimer
    ? readingTimerPaused
      ? activeReadingTimer.pausedRemainingMs ?? 0
      : Math.max(0, activeReadingTimer.endsAt - currentTimeMs)
    : readingTimerSelectedBlocks * READING_TIMER_BLOCK_MS;
  const readingTimerElapsedMs = activeReadingTimer
    ? activeReadingTimer.blocks * READING_TIMER_BLOCK_MS -
      readingTimerRemainingMs
    : 0;
  const readingTimerDisplay = formatReadingTimer(readingTimerRemainingMs);
  const readingTimerCompletedMinutes =
    readingTimerState.completedCount * READING_TIMER_BLOCK_MINUTES;
  const readingTimerTotalMinutes =
    READING_TIMER_BLOCK_COUNT * READING_TIMER_BLOCK_MINUTES;
  const readingTimerComplete =
    readingTimerState.completedCount >= READING_TIMER_BLOCK_COUNT;
  const strategyGameSeenCount = strategyGameSeenIds.length;
  const strategyGameRemainingCount = Math.max(
    0,
    site.strategies.length - strategyGameSeenCount,
  );
  const strategyGameCanStart = strategyGameRemainingCount > 0;
  const strategyGameComplete =
    strategyGameEntries.length > 0 &&
    strategyGameIndex >= strategyGameEntries.length;
  const strategyGameInProgress =
    strategyGameEntries.length > 0 && !strategyGameComplete;
  const currentStrategyGameEntry = strategyGameComplete
    ? null
    : strategyGameEntries[strategyGameIndex];
  const currentStrategyGameStrategy = currentStrategyGameEntry
    ? strategyById.get(currentStrategyGameEntry.strategyId) ?? null
    : null;
  const currentStrategyGameCharacterCount = countCharacters(
    currentStrategyGameEntry?.response ?? "",
  );
  const strategyGameCanAdvance =
    currentStrategyGameCharacterCount >= STRATEGY_GAME_CHARACTER_GOAL;
  const strategyGameCanDownload =
    strategyGameComplete &&
    strategyGameEntries.length > 0 &&
    strategyGameEntries.every(
      (entry) => countCharacters(entry.response) >= STRATEGY_GAME_CHARACTER_GOAL,
    );
  const strategyGameResponses = useMemo(
    () =>
      strategyGameEntries
        .map((entry) => ({
          entry,
          strategy: strategyById.get(entry.strategyId),
        }))
        .filter(
          (
            item,
          ): item is { entry: StrategyGameEntry; strategy: Strategy } =>
            Boolean(item.strategy),
        ),
    [strategyGameEntries, strategyById],
  );

  useEffect(() => {
    if (!activeReadingTimer || readingTimerPaused) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeReadingTimer, readingTimerPaused]);

  useEffect(() => {
    if (!activeReadingTimer) {
      document.title = site.title;
      return;
    }

    document.title = readingTimerPaused
      ? `${readingTimerDisplay} paused · ${site.title}`
      : `${readingTimerDisplay} reading · ${site.title}`;

    return () => {
      document.title = site.title;
    };
  }, [activeReadingTimer, readingTimerDisplay, readingTimerPaused, site.title]);

  useEffect(() => {
    if (!activeReadingTimer || readingTimerPaused) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      writeReadingTimerState(
        completeActiveReadingTimer(getClientReadingTimerSnapshot()),
      );
    }, Math.max(0, activeReadingTimer.endsAt - Date.now()));

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeReadingTimer, readingTimerPaused]);

  useEffect(() => {
    if (
      !activeReadingTimer ||
      readingTimerPaused ||
      typeof navigator === "undefined"
    ) {
      return;
    }

    const navigatorWithWakeLock = navigator as NavigatorWithWakeLock;
    let wakeLockSentinel: WakeLockSentinel | null = null;
    let didCancelWakeLock = false;

    async function requestWakeLock() {
      try {
        wakeLockSentinel =
          (await navigatorWithWakeLock.wakeLock?.request("screen")) ?? null;

        if (didCancelWakeLock) {
          await wakeLockSentinel?.release();
        }
      } catch {
        wakeLockSentinel = null;
      }
    }

    void requestWakeLock();

    return () => {
      didCancelWakeLock = true;
      void wakeLockSentinel?.release();
    };
  }, [activeReadingTimer, readingTimerPaused]);

  useEffect(() => {
    if (!showStrategyGameCelebration) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowStrategyGameCelebration(false);
    }, 3200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [showStrategyGameCelebration]);

  useEffect(() => {
    if (printMode === null) {
      return;
    }

    function resetPrintMode() {
      if (printTitleRestoreRef.current) {
        document.title = printTitleRestoreRef.current;
        printTitleRestoreRef.current = null;
      }

      setPrintMode(null);
    }

    window.addEventListener("afterprint", resetPrintMode);

    return () => {
      window.removeEventListener("afterprint", resetPrintMode);
    };
  }, [printMode]);

  useEffect(
    () => () => {
      if (clipboardMessageTimeoutRef.current !== null) {
        window.clearTimeout(clipboardMessageTimeoutRef.current);
      }
    },
    [],
  );

  const filteredStrategies = useMemo(() => {
    if (activeTags.length === 0) {
      return shuffledStrategyOrder;
    }

    return shuffledStrategyOrder.filter((strategy) =>
      activeTags.some((tag) => strategy.tags.includes(tag)),
    );
  }, [activeTags, shuffledStrategyOrder]);

  function toggleTag(tag: string) {
    setActiveTags((currentTags) =>
      currentTags.includes(tag)
        ? currentTags.filter((currentTag) => currentTag !== tag)
        : [...currentTags, tag],
    );
  }

  function toggleStrategyDetails(strategyId: string) {
    setDetailsButtonInteracted(true);
    setExpandedId((currentExpandedId) =>
      currentExpandedId === strategyId ? null : strategyId,
    );
  }

  function shuffleVisibleStrategies() {
    reshuffleStrategies(site.strategies);
    forceStrategyShuffleRender((version) => version + 1);
  }

  function moveToStrategy(strategyId: string) {
    setActiveTags([]);
    setExpandedId(strategyId);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .getElementById(`strategy-${strategyId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function openStarterPack() {
    if (starterPackStrategies.length > 0) {
      setStarterPackIndex(0);
    }
  }

  function closeStarterPack() {
    setStarterPackIndex(null);
  }

  function moveStarterPack(direction: -1 | 1) {
    setStarterPackIndex((currentIndex) => {
      if (currentIndex === null || starterPackStrategies.length === 0) {
        return currentIndex;
      }

      return (
        (currentIndex + direction + starterPackStrategies.length) %
        starterPackStrategies.length
      );
    });
  }

  function selectReadingTimerBlock(blockIndex: number) {
    const currentTimerState = getClientReadingTimerSnapshot();

    if (
      currentTimerState.activeTimer ||
      blockIndex < currentTimerState.completedCount
    ) {
      return;
    }

    writeReadingTimerState({
      ...currentTimerState,
      selectedThroughIndex:
        currentTimerState.selectedThroughIndex === blockIndex
          ? null
          : blockIndex,
    });
  }

  function startReadingTimer() {
    const currentTimerState = getClientReadingTimerSnapshot();

    if (
      currentTimerState.activeTimer ||
      currentTimerState.completedCount >= READING_TIMER_BLOCK_COUNT
    ) {
      return;
    }

    const selectedThroughIndex =
      currentTimerState.selectedThroughIndex === null
        ? currentTimerState.completedCount
        : currentTimerState.selectedThroughIndex;
    const blocks = clampNumber(
      selectedThroughIndex - currentTimerState.completedCount + 1,
      1,
      READING_TIMER_BLOCK_COUNT - currentTimerState.completedCount,
    );
    const startedAt = Date.now();

    writeReadingTimerState({
      completedCount: currentTimerState.completedCount,
      selectedThroughIndex: currentTimerState.completedCount + blocks - 1,
      activeTimer: {
        blocks,
        endsAt: startedAt + blocks * READING_TIMER_BLOCK_MS,
        pausedRemainingMs: null,
        startedAt,
      },
    });
  }

  function pauseReadingTimer() {
    const currentTimerState = getClientReadingTimerSnapshot();

    if (
      !currentTimerState.activeTimer ||
      currentTimerState.activeTimer.pausedRemainingMs !== null
    ) {
      return;
    }

    const pausedRemainingMs = Math.max(
      0,
      currentTimerState.activeTimer.endsAt - Date.now(),
    );

    if (pausedRemainingMs === 0) {
      writeReadingTimerState(completeActiveReadingTimer(currentTimerState));
      return;
    }

    writeReadingTimerState({
      ...currentTimerState,
      activeTimer: {
        ...currentTimerState.activeTimer,
        pausedRemainingMs,
      },
    });
  }

  function resumeReadingTimer() {
    const currentTimerState = getClientReadingTimerSnapshot();
    const activeTimer = currentTimerState.activeTimer;

    if (!activeTimer || activeTimer.pausedRemainingMs === null) {
      return;
    }

    writeReadingTimerState({
      ...currentTimerState,
      activeTimer: {
        ...activeTimer,
        endsAt: Date.now() + activeTimer.pausedRemainingMs,
        pausedRemainingMs: null,
      },
    });
  }

  function cancelReadingTimer() {
    const currentTimerState = getClientReadingTimerSnapshot();

    if (!currentTimerState.activeTimer) {
      return;
    }

    writeReadingTimerState({
      completedCount: currentTimerState.completedCount,
      selectedThroughIndex: null,
      activeTimer: null,
    });
  }

  function resetReadingTimer() {
    writeReadingTimerState(createBlankReadingTimerState());
  }

  function addStrategyToCart(strategyId: string) {
    const currentState = getClientCartSnapshot(strategyById);

    writeCartState({
      strategyIds: currentState.strategyIds.includes(strategyId)
        ? currentState.strategyIds
        : [...currentState.strategyIds, strategyId],
      checklistEntries: {
        ...currentState.checklistEntries,
        [strategyId]:
          currentState.checklistEntries[strategyId] ??
          createBlankChecklistEntry(),
      },
    });
  }

  function removeStrategyFromCart(strategyId: string) {
    const currentState = getClientCartSnapshot(strategyById);

    writeCartState({
      ...currentState,
      strategyIds: currentState.strategyIds.filter(
        (currentId) => currentId !== strategyId,
      ),
    });
  }

  function updateChecklistEntry(
    strategyId: string,
    field: ChecklistField,
    value: string,
  ) {
    const currentState = getClientCartSnapshot(strategyById);

    writeCartState({
      ...currentState,
      checklistEntries: {
        ...currentState.checklistEntries,
        [strategyId]: {
          ...(currentState.checklistEntries[strategyId] ??
            createBlankChecklistEntry()),
          [field]: value,
        },
      },
    });
  }

  function startStrategyGame(openInModal = true) {
    if (!strategyGameCanStart) {
      return;
    }

    const nextEntries = createStrategyGameEntries(
      site.strategies,
      strategyGameSeenIds,
    );

    if (nextEntries.length === 0) {
      return;
    }

    writeStrategyGameState({
      entries: nextEntries,
      index: 0,
    });
    setStrategyGameOpen(openInModal);
    setShowStrategyGameCelebration(false);
  }

  function closeStrategyGame() {
    setStrategyGameOpen(false);
  }

  function updateStrategyGameResponse(value: string) {
    writeStrategyGameState({
      ...strategyGameState,
      entries: strategyGameEntries.map((entry, index) =>
        index === strategyGameIndex ? { ...entry, response: value } : entry,
      ),
    });
  }

  function markCompletedStrategyGameEntriesSeen() {
    const nextSeenIds = new Set(strategyGameSeenIds);

    strategyGameEntries.forEach((entry) => {
      nextSeenIds.add(entry.strategyId);
    });

    writeStrategyGameSeenIds([...nextSeenIds]);
  }

  function showClipboardStatus(message: string) {
    setClipboardMessage(message);

    if (clipboardMessageTimeoutRef.current !== null) {
      window.clearTimeout(clipboardMessageTimeoutRef.current);
    }

    clipboardMessageTimeoutRef.current = window.setTimeout(() => {
      setClipboardMessage(null);
      clipboardMessageTimeoutRef.current = null;
    }, 2600);
  }

  async function writeTextToClipboard(text: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");

    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.left = "0";
    textarea.style.opacity = "0";
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const didCopy = document.execCommand("copy");
    textarea.remove();

    if (!didCopy) {
      throw new Error("Clipboard copy failed.");
    }
  }

  function buildStrategyGameMarkdown() {
    return [
      "# Strategy Game",
      "",
      `Generated: ${new Date().toLocaleString()}`,
      "",
      ...strategyGameResponses.flatMap(({ entry, strategy }, index) => [
        `## ${index + 1}. ${strategy.title}`,
        "",
        strategy.subtitle,
        "",
        entry.response.trim(),
        "",
      ]),
    ].join("\n");
  }

  function buildCartMarkdown() {
    return [
      "# Reading Strategy Cart",
      "",
      `Generated: ${new Date().toLocaleString()}`,
      "",
      ...cartStrategies.flatMap((strategy, index) => {
        const checklistEntry =
          checklistEntries[strategy.id] ?? createBlankChecklistEntry();

        return [
          `## ${index + 1}. ${strategy.title}`,
          "",
          strategy.subtitle,
          "",
          "### Where are you now?",
          "",
          checklistEntry.whereNow.trim() || "_No response yet._",
          "",
          "### Goal",
          "",
          checklistEntry.goal.trim() || "_No response yet._",
          "",
        ];
      }),
    ].join("\n");
  }

  async function copyStrategyGameMarkdown() {
    if (!strategyGameCanDownload) {
      return;
    }

    try {
      await writeTextToClipboard(buildStrategyGameMarkdown());
      showClipboardStatus("Strategy Game answers copied as Markdown.");
    } catch {
      showClipboardStatus("Could not copy answers.");
    }
  }

  async function copyCartMarkdown() {
    if (cartStrategies.length === 0) {
      return;
    }

    try {
      await writeTextToClipboard(buildCartMarkdown());
      showClipboardStatus("Cart copied as Markdown.");
    } catch {
      showClipboardStatus("Could not copy cart.");
    }
  }

  function completeStrategyGameStep() {
    if (!currentStrategyGameEntry || !strategyGameCanAdvance) {
      return;
    }

    if (strategyGameIndex >= strategyGameEntries.length - 1) {
      markCompletedStrategyGameEntriesSeen();
      writeStrategyGameState({
        ...strategyGameState,
        index: strategyGameEntries.length,
      });
      setShowStrategyGameCelebration(true);
      return;
    }

    writeStrategyGameState({
      ...strategyGameState,
      index: Math.min(strategyGameIndex + 1, strategyGameEntries.length),
    });
  }

  function printWithMode(mode: PrintMode, exportTitle: string) {
    setPrintMode(mode);

    printTitleRestoreRef.current ??= document.title;
    document.title = exportTitle;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.print();
        window.setTimeout(() => {
          if (printTitleRestoreRef.current) {
            document.title = printTitleRestoreRef.current;
            printTitleRestoreRef.current = null;
          }

          setPrintMode(null);
        }, 1000);
      });
    });
  }

  function printCart() {
    printWithMode("cart", createExportTitle("cart"));
  }

  function printStrategyGameResponses() {
    if (!strategyGameCanDownload) {
      return;
    }

    printWithMode("strategyGame", createExportTitle("strategy-game"));
  }

  function clearCart() {
    const confirmed = window.confirm(
      "Clear all selected strategies and checklist notes?",
    );

    if (!confirmed) {
      return;
    }

    writeCartState(createBlankCartState());
    setCartExpanded(false);
  }

  return (
    <main className="riso-app min-h-screen bg-[#f2ede1] text-[#22201b] print:bg-white">
      {lightboxImage ? (
        <div
          aria-label={lightboxImage.alt}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#22201b]/90 p-4 print:hidden sm:p-8"
          onClick={() => setLightboxImage(null)}
          role="dialog"
        >
          <button
            aria-label="Close image"
            className="riso-button riso-button-dark absolute right-4 top-4 size-11 p-0"
            onClick={() => setLightboxImage(null)}
            type="button"
          >
            <CloseIcon />
          </button>
          <div
            className="flex max-h-full max-w-full items-center justify-center"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              alt={lightboxImage.alt}
              className="block max-h-[90vh] max-w-full object-contain"
              src={lightboxImage.url}
            />
          </div>
        </div>
      ) : null}

      {starterPackStrategy && starterPackIndex !== null ? (
        <div
          aria-label="Starter pack"
          aria-modal="true"
          className="fixed inset-0 z-40 flex bg-[#22201b]/90 p-3 print:hidden sm:p-6"
          onClick={closeStarterPack}
          role="dialog"
        >
          <button
            aria-label="Previous starter pack strategy"
            className="riso-button riso-button-dark absolute left-3 top-1/2 hidden size-12 -translate-y-1/2 p-0 text-xl font-semibold sm:inline-flex"
            onClick={(event) => {
              event.stopPropagation();
              moveStarterPack(-1);
            }}
            type="button"
          >
            {"<"}
          </button>
          <button
            aria-label="Next starter pack strategy"
            className="riso-button riso-button-dark absolute right-3 top-1/2 hidden size-12 -translate-y-1/2 p-0 text-xl font-semibold sm:inline-flex"
            onClick={(event) => {
              event.stopPropagation();
              moveStarterPack(1);
            }}
            type="button"
          >
            {">"}
          </button>

          <div
            className="mx-auto flex h-full w-full max-w-3xl flex-col gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 text-[#f2ede1]">
              <p className="riso-mono text-sm font-semibold uppercase">
                Starter pack {starterPackIndex + 1} /{" "}
                {starterPackStrategies.length}
              </p>
              <button
                aria-label="Close starter pack"
                className="riso-button riso-button-dark size-11 p-0"
                onClick={closeStarterPack}
                type="button"
              >
                <CloseIcon />
              </button>
            </div>

            <article
              className="riso-panel min-h-0 flex-1 overflow-y-auto p-4 sm:p-6"
              style={strategyAccentStyle(starterPackStrategy)}
            >
              <div className="-mx-4 -mt-4 mb-4 sm:-mx-6 sm:-mt-6">
                <div className="riso-card-strip" />
              </div>
              <div className="flex flex-wrap gap-2">
                {starterPackStrategy.tags.map((tag) => (
                  <span
                    className="riso-tag"
                    key={tag}
                    style={tagStyle(tag)}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <h2 className="mt-4 text-3xl font-semibold leading-tight sm:text-5xl">
                {starterPackStrategy.title}
              </h2>
              <p className="riso-body-copy mt-3 text-lg leading-8">
                {starterPackStrategy.subtitle}
              </p>
              {starterPackStrategy.body.trim() ? (
                <p className="mt-5 max-w-prose leading-7 text-[#333029]">
                  {starterPackStrategy.body}
                </p>
              ) : null}

              {starterPackStrategy.imageUrls[0] ? (
                <button
                  aria-label={`Open ${starterPackStrategy.title} image`}
                  className="mt-5 block w-full cursor-zoom-in border border-[#22201b] bg-[#f2ede1]"
                  onClick={() =>
                    setLightboxImage({
                      alt: `${starterPackStrategy.title} image`,
                      url: starterPackStrategy.imageUrls[0],
                    })
                  }
                  type="button"
                >
                  <img
                    alt={`${starterPackStrategy.title} image`}
                    className="block max-h-72 w-full object-cover"
                    src={starterPackStrategy.imageUrls[0]}
                  />
                </button>
              ) : null}

              {starterPackLinkGroups.length > 0 ? (
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  {starterPackLinkGroups.map((group) => (
                    <div key={group.title}>
                      <h3 className="text-sm font-semibold uppercase">
                        {group.title}
                      </h3>
                      <ul className="mt-3 space-y-2 text-sm">
                        {group.links.map((link) => (
                          <li key={link.url}>
                            <a
                              className="underline decoration-[#8a826f] underline-offset-4"
                              href={link.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {link.label}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}

              <button
                className={`riso-button mt-6 w-full gap-2 sm:w-auto ${
                  starterPackInCart ? "riso-button-active" : "text-[#315d4c]"
                }`}
                onClick={() =>
                  starterPackInCart
                    ? removeStrategyFromCart(starterPackStrategy.id)
                    : addStrategyToCart(starterPackStrategy.id)
                }
                type="button"
              >
                <CartIcon selected={starterPackInCart} />
                {starterPackInCart ? "Remove from cart" : "Add to cart"}
              </button>
            </article>

            <div className="grid grid-cols-2 gap-3 sm:hidden">
              <button
                className="riso-button riso-button-dark"
                onClick={() => moveStarterPack(-1)}
                type="button"
              >
                Previous
              </button>
              <button
                className="riso-button riso-button-dark"
                onClick={() => moveStarterPack(1)}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {strategyGameOpen ? (
        <div
          aria-label="Strategy Game"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#f2ede1] print:hidden sm:flex sm:items-center sm:justify-center sm:bg-[#22201b]/90 sm:p-6"
          onClick={closeStrategyGame}
          role="dialog"
        >
          <div
            className="riso-panel flex h-[100dvh] max-h-[100dvh] w-full flex-col sm:h-auto sm:max-h-full sm:max-w-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b-2 border-[#22201b] bg-[#f8f4ea] p-4 sm:static sm:p-5">
              <div>
                <p className="riso-mono text-sm font-semibold uppercase">
                  Strategy Game
                </p>
                <p className="mt-1 text-sm leading-6 text-[#4a463c]">
                  Write 140 characters for each selected strategy. The game
                  avoids strategies you&apos;ve already seen this session.
                </p>
              </div>
              <button
                aria-label="Close Strategy Game"
                className="riso-button size-11 p-0"
                onClick={closeStrategyGame}
                type="button"
              >
                <CloseIcon />
              </button>
            </div>

            {strategyGameComplete ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-28 sm:p-5">
                <h2 className="text-3xl font-semibold leading-tight">
                  Good job!
                </h2>
                <p className="mt-2 leading-7 text-[#4a463c]">
                  You completed {strategyGameEntries.length} strategy
                  responses.
                </p>

                <div className="mt-5 grid gap-3">
                  {strategyGameResponses.map(({ entry, strategy }, index) => (
                    <article
                      className="riso-panel p-3"
                      key={`${entry.strategyId}-${index}`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-semibold leading-tight">
                          {strategy.title}
                        </h3>
                        <p className="text-sm text-[#4a463c]">
                          {countCharacters(entry.response)} characters
                        </p>
                      </div>
                      <p className="mt-2 line-clamp-3 text-sm leading-6 text-[#4a463c]">
                        {entry.response}
                      </p>
                    </article>
                  ))}
                </div>

                <div className="sticky bottom-0 -mx-4 mt-6 flex flex-col gap-2 border-t-2 border-[#22201b] bg-[#f8f4ea] p-4 sm:static sm:mx-0 sm:flex-row sm:border-0 sm:p-0">
                  <button
                    className="riso-button sm:hidden"
                    disabled={!strategyGameCanDownload}
                    onClick={() => void copyStrategyGameMarkdown()}
                    type="button"
                  >
                    Copy Markdown
                  </button>
                  <button
                    className="riso-button hidden sm:inline-flex"
                    disabled={!strategyGameCanDownload}
                    onClick={printStrategyGameResponses}
                    type="button"
                  >
                    Download PDF
                  </button>
                  <button
                    className="riso-button"
                    disabled={!strategyGameCanStart}
                    onClick={() => startStrategyGame()}
                    type="button"
                  >
                    Play again
                  </button>
                  <button
                    className="riso-button"
                    onClick={closeStrategyGame}
                    type="button"
                  >
                    Done
                  </button>
                </div>
                {!strategyGameCanStart ? (
                  <p className="mt-4 text-sm leading-6 text-[#4a463c]">
                    No unseen strategies remain in this browser session.
                  </p>
                ) : null}
              </div>
            ) : currentStrategyGameStrategy && currentStrategyGameEntry ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-28 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold uppercase">
                    Prompt {strategyGameIndex + 1} /{" "}
                    {strategyGameEntries.length}
                  </p>
                  <p
                    aria-live="polite"
                    className={`text-sm font-semibold ${
                      strategyGameCanAdvance
                        ? "text-[#315d4c]"
                        : "text-[#4a463c]"
                    }`}
                    id="strategy-game-character-count"
                  >
                    {currentStrategyGameCharacterCount} /{" "}
                    {STRATEGY_GAME_CHARACTER_GOAL} characters
                  </p>
                </div>

                <article
                  className="riso-panel mt-4 p-4"
                  style={strategyAccentStyle(currentStrategyGameStrategy)}
                >
                  <div className="riso-card-strip -mx-4 -mt-4 mb-4" />
                  <div className="flex flex-wrap gap-2">
                    {currentStrategyGameStrategy.tags.map((tag) => (
                      <span
                        className="riso-tag"
                        key={tag}
                        style={tagStyle(tag)}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <h2 className="mt-4 text-xl font-semibold leading-tight sm:text-3xl">
                    {currentStrategyGameStrategy.title}
                  </h2>
                  <p className="riso-body-copy mt-2 text-sm leading-6 sm:text-base sm:leading-7">
                    {currentStrategyGameStrategy.subtitle}
                  </p>
                  {currentStrategyGameStrategy.body.trim() ? (
                    <p className="mt-4 max-h-28 overflow-y-auto border-t border-[#22201b] pt-4 text-sm leading-6 text-[#333029] sm:max-h-40">
                      {currentStrategyGameStrategy.body}
                    </p>
                  ) : null}
                </article>

                <label className="mt-5 block">
                  <span className="text-sm font-semibold uppercase">
                    Your plan or thoughts
                  </span>
                  <textarea
                    aria-describedby="strategy-game-character-count"
                    className="riso-input mt-2 min-h-36 w-full resize-y p-3 leading-6 sm:min-h-52"
                    onChange={(event) =>
                      updateStrategyGameResponse(event.target.value)
                    }
                    placeholder="Write how you will implement this strategy, or what you think about it."
                    value={currentStrategyGameEntry.response}
                  />
                </label>

                <div className="sticky bottom-0 -mx-4 mt-4 flex flex-col gap-3 border-t-2 border-[#22201b] bg-[#f8f4ea] p-4 sm:static sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:border-0 sm:p-0">
                  <p className="text-sm leading-6 text-[#4a463c]">
                    The next prompt unlocks at 140 characters.
                  </p>
                  <button
                    className="riso-button"
                    disabled={!strategyGameCanAdvance}
                    onClick={completeStrategyGameStep}
                    type="button"
                  >
                    {strategyGameIndex >= strategyGameEntries.length - 1
                      ? "Finish game"
                      : "Next strategy"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 sm:p-5">
                <p className="leading-7 text-[#4a463c]">
                  No strategies are available for this game.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {showStrategyGameCelebration ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[60] overflow-hidden print:hidden"
        >
          {Array.from({ length: 44 }).map((_, index) => (
            <span
              className="absolute top-[-1rem] h-3 w-1.5 animate-[strategy-game-confetti_1.8s_ease-out_forwards]"
              key={index}
              style={strategyGameConfettiStyle(index)}
            />
          ))}
        </div>
      ) : null}

      {clipboardMessage ? (
        <p
          aria-live="polite"
          className="riso-panel fixed inset-x-4 bottom-4 z-[70] px-3 py-2 text-sm font-medium print:hidden sm:left-auto sm:right-4 sm:max-w-sm"
        >
          {clipboardMessage}
        </p>
      ) : null}

      {strategyGameResponses.length > 0 ? (
        <section
          aria-label="Strategy Game responses"
          className={`hidden ${
            printMode === "strategyGame" ? "print:block" : "print:hidden"
          }`}
        >
          <div className="print-strategy-game">
            <h1>Strategy Game</h1>
            <p>
              Three 140-character responses about randomly selected reading
              strategies.
            </p>

            {strategyGameResponses.map(({ entry, strategy }, index) => (
              <article
                className="print-strategy-game-entry"
                key={`${entry.strategyId}-${index}`}
              >
                <p className="print-strategy-game-kicker">
                  Response {index + 1}
                </p>
                <h2>{strategy.title}</h2>
                <p className="print-strategy-game-subtitle">
                  {strategy.subtitle}
                </p>
                <p className="print-strategy-game-response">
                  {entry.response}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-6 sm:gap-8 sm:px-8 sm:py-8 lg:px-10 print:max-w-none print:gap-0 print:px-0 print:py-0">
        <header className="sticky top-0 z-[80] -mx-4 -mt-6 border-b-2 border-[#22201b] bg-[#f2ede1] print:hidden sm:-mx-8 sm:-mt-8 lg:-mx-10">
          <nav className="riso-topscroll mx-auto flex max-w-6xl items-center gap-2 overflow-x-auto px-4 py-3 sm:px-8 lg:px-10">
            <a
              className="riso-nav-link"
              href={site.links.discord}
              target="_blank"
              rel="noreferrer"
            >
              <DiscordIcon />
              Community
            </a>
            <Link
              className="riso-nav-link"
              href="/reading-journal"
            >
              <VideoIcon />
              Reading Journal
            </Link>
            <details className="group relative flex-none">
              <summary className="riso-nav-link cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <CalendarIcon />
                Talk to Bram
                <ChevronDownIcon />
              </summary>
              <div className="fixed right-4 top-16 z-[90] grid w-72 border-2 border-[#22201b] bg-[#f8f4ea] text-[#22201b] shadow-[4px_4px_0_#22201b] sm:right-8 lg:right-10">
                <a
                  className="px-3 py-3 hover:bg-[#22201b] hover:text-[#f2ede1]"
                  href={site.links.schedule}
                  target="_blank"
                  rel="noreferrer"
                >
                  1:1 meeting
                </a>
                <a
                  className="border-t border-[#22201b] px-3 py-3 hover:bg-[#22201b] hover:text-[#f2ede1]"
                  href={site.links.bookClub}
                  target="_blank"
                  rel="noreferrer"
                >
                  1:n meeting (book club)
                </a>
              </div>
            </details>
            <a
              className="riso-nav-link"
              href={site.links.kofi}
              target="_blank"
              rel="noreferrer"
            >
              <CoffeeIcon />
              Support
            </a>
            <a
              className="riso-nav-link"
              href={site.links.slides}
              target="_blank"
              rel="noreferrer"
            >
              <SlidesIcon />
              Slides
            </a>
            <a
              className="riso-nav-link"
              href={site.links.github}
              target="_blank"
              rel="noreferrer"
            >
              <GitHubIcon />
              Star on GitHub
            </a>
            <Link
              aria-label={`Open checklist cart with ${cartStrategies.length} selected strategies`}
              className="riso-nav-chip ml-auto sm:hidden"
              href="/checklist"
            >
              <CartIcon selected={cartStrategies.length > 0} />
              Cart
              <span className="inline-flex min-w-6 items-center justify-center bg-[var(--accent)] px-1.5 py-0.5 text-white">
                {cartStrategies.length}
              </span>
            </Link>
            <button
              aria-controls="cart-panel"
              aria-expanded={cartExpanded}
              aria-label={`Toggle cart with ${cartStrategies.length} selected strategies`}
              className="riso-nav-chip ml-auto hidden sm:inline-flex"
              onClick={() => setCartExpanded((expanded) => !expanded)}
              type="button"
            >
              <CartIcon selected={cartStrategies.length > 0} />
              Cart
              <span className="inline-flex min-w-6 items-center justify-center bg-[var(--accent)] px-1.5 py-0.5 text-white">
                {cartStrategies.length}
              </span>
            </button>
          </nav>
        </header>

        <section className="py-8 print:hidden sm:py-12">
          <p className="riso-hero-kicker mb-4">Issue 01 / Strategy library</p>
          <div className="max-w-4xl">
            <h1 className="riso-hero-title">
              {heroTitleParts.lead}{" "}
              <span className="riso-hero-accent">
                <span>{heroTitleParts.accent}</span>
              </span>
            </h1>
            <p className="riso-body-copy mt-5 max-w-3xl text-lg leading-8 sm:text-xl">
              {site.subtitle}
            </p>
          </div>
        </section>

        <div className="-mx-4 print:hidden sm:-mx-8 lg:-mx-10">
          <RisoMarquee items={marqueeItems} />
        </div>

        <section
          aria-labelledby="tag-filter-title"
          className="-mx-4 border-y-2 border-[#22201b] bg-[#f4e3dc] px-4 py-7 print:hidden sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10"
        >
          <div
            aria-labelledby="reading-timer-title"
            className="riso-panel p-4 sm:p-5"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3
                  className="riso-section-kicker"
                  id="reading-timer-title"
                >
                  Start Reading Right Now
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <p
                  aria-live="polite"
                  className="min-w-20 text-sm font-semibold tabular-nums"
                >
                  {activeReadingTimer
                    ? readingTimerPaused
                      ? `${readingTimerDisplay} paused`
                      : `${readingTimerDisplay} left`
                    : readingTimerComplete
                      ? `${readingTimerTotalMinutes} min logged`
                      : `${readingTimerSelectedMinutes} min selected`}
                </p>
                {activeReadingTimer ? (
                  <>
                    <button
                      className="riso-button"
                      onClick={
                        readingTimerPaused
                          ? resumeReadingTimer
                          : pauseReadingTimer
                      }
                      type="button"
                    >
                      {readingTimerPaused ? "Resume" : "Pause"}
                    </button>
                    <button
                      className="riso-button"
                      onClick={cancelReadingTimer}
                      type="button"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="riso-button riso-button-primary"
                    disabled={readingTimerComplete}
                    onClick={startReadingTimer}
                    type="button"
                  >
                    Start
                  </button>
                )}
                {readingTimerState.completedCount > 0 && !activeReadingTimer ? (
                  <button
                    className="text-sm underline decoration-[#8a826f] underline-offset-4 hover:text-[#315d4c]"
                    onClick={resetReadingTimer}
                    type="button"
                  >
                    Reset
                  </button>
                ) : null}
              </div>
            </div>

            <div
              aria-label={`${readingTimerCompletedMinutes} of ${readingTimerTotalMinutes} reading minutes logged`}
              className="mt-4 grid grid-cols-10 gap-1 sm:gap-2"
            >
              {Array.from({ length: READING_TIMER_BLOCK_COUNT }).map(
                (_, blockIndex) => {
                  const blockEndMinutes =
                    (blockIndex + 1) * READING_TIMER_BLOCK_MINUTES;
                  const blockCompleted =
                    blockIndex < readingTimerState.completedCount;
                  const blockSelected =
                    !blockCompleted &&
                    readingTimerSelectedThroughIndex !== null &&
                    blockIndex <= readingTimerSelectedThroughIndex;
                  const blockDisabled =
                    Boolean(activeReadingTimer) || blockCompleted;
                  const activeBlockProgress =
                    activeReadingTimer && blockSelected
                      ? clampNumber(
                          (readingTimerElapsedMs -
                            (blockIndex - readingTimerState.completedCount) *
                              READING_TIMER_BLOCK_MS) /
                            READING_TIMER_BLOCK_MS,
                          0,
                          1,
                        )
                      : 0;
                  const blockFillProgress = blockCompleted
                    ? 1
                    : activeBlockProgress;

                  return (
                    <button
                      aria-label={`${blockEndMinutes - READING_TIMER_BLOCK_MINUTES} to ${blockEndMinutes} minutes`}
                      aria-pressed={blockCompleted || blockSelected}
                      className={`relative aspect-square overflow-hidden border text-[0.65rem] font-semibold tabular-nums transition-colors ${
                        blockCompleted
                          ? "border-[#315d4c] bg-white text-[#f8f4ea]"
                          : blockSelected
                            ? "border-[#22201b] bg-[#efe6d7] text-[#22201b]"
                            : "border-[#c8c0ae] bg-white text-[#4a463c] hover:border-[#22201b]"
                      } disabled:cursor-default`}
                      disabled={blockDisabled}
                      key={blockIndex}
                      onClick={() => selectReadingTimerBlock(blockIndex)}
                      type="button"
                    >
                      {blockFillProgress > 0 ? (
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-0 bottom-0 bg-[#315d4c] transition-[height] duration-500 ease-linear"
                          style={{ height: `${blockFillProgress * 100}%` }}
                        />
                      ) : null}
                      <span
                        className={`relative z-10 ${
                          blockFillProgress > 0.65 ? "text-[#f8f4ea]" : ""
                        }`}
                      >
                        {blockEndMinutes}
                      </span>
                    </button>
                  );
                },
              )}
            </div>
          </div>

          <div className="riso-mono mt-5 grid gap-2 text-sm">
            {starterPackStrategies.length > 0 ? (
              <button
                className="text-left underline decoration-[#8a826f] underline-offset-4 hover:text-[#315d4c]"
                onClick={openStarterPack}
                type="button"
              >
                + Unsure of where to start? Here&apos;s a starter pack.
              </button>
            ) : null}
            <div className="grid justify-items-start gap-2">
              <button
                aria-controls="kindle-reader-menu"
                aria-expanded={kindleMenuOpen}
                className="text-left underline decoration-[#8a826f] underline-offset-4 hover:text-[#315d4c]"
                onClick={() => setKindleMenuOpen((open) => !open)}
                type="button"
              >
                + Are you a Kindle user? Yes? Press this button to read right
                now. Go. Do it!!
              </button>
              {kindleMenuOpen ? (
                <div
                  className="flex flex-col gap-2 sm:flex-row"
                  id="kindle-reader-menu"
                >
                  <a
                    className="riso-button"
                    href={KINDLE_APP_DEEP_LINK}
                  >
                    Open Kindle app
                  </a>
                  <a
                    className="riso-button"
                    href={KINDLE_WEB_READER_URL}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open Kindle in browser
                  </a>
                  <a
                    className="riso-button"
                    href={AUDIBLE_APP_DEEP_LINK}
                  >
                    Open Audible app
                  </a>
                  <a
                    className="riso-button"
                    href={AUDIBLE_WEB_URL}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open Audible in browser
                  </a>
                </div>
              ) : null}
            </div>
          </div>

          <div
            aria-labelledby="strategy-game-title"
            className="riso-panel mt-6 p-5"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="riso-mono mb-1 text-xs font-semibold uppercase text-[var(--accent)]">
                  Mini game
                </p>
                <h2
                  className="text-2xl font-bold leading-tight"
                  id="strategy-game-title"
                >
                  Tweet{" "}
                  <span className="riso-italic font-normal">@</span> Your Books
                </h2>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {strategyGameCanStart || strategyGameInProgress ? (
                  <Link
                    className="riso-button text-center sm:hidden"
                    href="/strategy-game"
                    onClick={() => {
                      if (!strategyGameInProgress) {
                        startStrategyGame(false);
                      }
                    }}
                  >
                    {strategyGameInProgress ? "Open Game" : "Start Game"}
                  </Link>
                ) : (
                  <button
                    className="riso-button sm:hidden"
                    disabled
                    type="button"
                  >
                    Start Game
                  </button>
                )}
                <button
                  className="riso-button hidden sm:inline-flex"
                  disabled={!strategyGameCanStart && !strategyGameInProgress}
                  onClick={() => {
                    if (strategyGameInProgress) {
                      setStrategyGameOpen(true);
                      return;
                    }

                    startStrategyGame();
                  }}
                  type="button"
                >
                  {strategyGameInProgress ? "Open Game" : "Start Game"}
                </button>
                {strategyGameCanDownload ? (
                  <>
                    <button
                      className="riso-button border-[#315d4c] text-[#315d4c] sm:hidden"
                      onClick={() => void copyStrategyGameMarkdown()}
                      type="button"
                    >
                      Copy Markdown
                    </button>
                    <button
                      className="riso-button hidden border-[#315d4c] text-[#315d4c] sm:inline-flex"
                      onClick={printStrategyGameResponses}
                      type="button"
                    >
                      Download PDF
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            {strategyGameCanDownload ? (
              <p className="mt-3 text-sm text-[#315d4c]">
                Last game complete: {strategyGameEntries.length} responses
                ready.
              </p>
            ) : null}
          </div>

          <div className="mt-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2
                id="tag-filter-title"
                className="riso-section-kicker"
              >
                Filter by tag
              </h2>
              {activeTags.length > 0 ? (
                <button
                  className="riso-mono text-sm underline decoration-[#8a826f] underline-offset-4"
                  type="button"
                  onClick={() => setActiveTags([])}
                >
                  Clear
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const selected = activeTags.includes(tag);

                return (
                <label
                  className="riso-tag flex cursor-pointer items-center gap-2 transition-transform hover:rotate-[-2deg]"
                  key={tag}
                  style={tagStyle(tag, selected)}
                >
                  <input
                    checked={selected}
                    className="size-4 accent-[#315d4c]"
                    onChange={() => toggleTag(tag)}
                    type="checkbox"
                  />
                  {tag}
                </label>
                );
              })}
            </div>
          </div>
        </section>

        {cartExpanded || (printMode === "cart" && cartStrategies.length > 0) ? (
          <section
            aria-labelledby="cart-title"
            className={`riso-panel fixed right-4 top-20 z-[70] hidden max-h-[calc(100dvh-6rem)] w-96 overflow-y-auto overscroll-contain p-3 sm:block ${
              printMode === "strategyGame" || cartStrategies.length === 0
                ? "print:hidden"
                : "print:static print:z-auto print:max-h-none print:w-full print:overflow-visible print:border-0 print:bg-white print:p-0 print:shadow-none"
            }`}
            id="cart-panel"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 id="cart-title" className="text-sm font-semibold uppercase">
                  Cart
                </h2>
                <p className="text-sm text-[#4a463c]">
                  {cartStrategies.length} selected
                </p>
              </div>

              <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto print:hidden">
                {cartStrategies.length > 0 ? (
                  <>
                    <button
                      className="riso-button px-2 py-2 text-xs sm:px-3 sm:py-1.5 sm:text-sm"
                      onClick={printCart}
                      type="button"
                    >
                      Print / PDF
                    </button>
                    <button
                      className="riso-button px-2 py-2 text-xs sm:px-3 sm:py-1.5 sm:text-sm"
                      onClick={() => void copyCartMarkdown()}
                      type="button"
                    >
                      Copy
                    </button>
                    <button
                      className="riso-button px-2 py-2 text-xs sm:px-3 sm:py-1.5 sm:text-sm"
                      onClick={clearCart}
                      type="button"
                    >
                      Clear
                    </button>
                  </>
                ) : null}
                <button
                  className="riso-button px-2 py-2 text-xs sm:px-3 sm:py-1.5 sm:text-sm"
                  onClick={() => setCartExpanded(false)}
                  type="button"
                >
                  Close
                </button>
              </div>
            </div>

            {cartStrategies.length === 0 ? (
              <p className="mt-4 text-sm leading-6 text-[#4a463c] print:hidden">
                Add strategies from the cards below, then open this cart again
                to fill in the checklist.
              </p>
            ) : (
            <div className="mt-4 grid gap-3 sm:gap-4 print:mt-0 print:grid print:gap-0">
              {cartStrategies.map((strategy) => {
                const checklistEntry =
                  checklistEntries[strategy.id] ?? createBlankChecklistEntry();

                return (
                  <article
                    className="print-strategy break-inside-avoid border-2 border-[#22201b] p-3 sm:p-4 print:border-2 print:border-[#22201b] print:p-8"
                    key={strategy.id}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <h3 className="text-xl font-semibold leading-tight sm:text-2xl print:text-4xl">
                          {strategy.title}
                        </h3>
                        <p className="mt-1 leading-7 text-[#4a463c] print:mt-3 print:text-xl print:leading-8 print:text-[#22201b]">
                          {strategy.subtitle}
                        </p>
                      </div>
                      <button
                        className="riso-button w-full sm:w-auto print:hidden"
                        onClick={() => removeStrategyFromCart(strategy.id)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="print-checklist-fields mt-4 grid gap-4 sm:grid-cols-2 print:mt-10 print:grid-cols-1 print:gap-10">
                      {CHECKLIST_FIELDS.map((field) => (
                        <label
                          className="print-checklist-field block"
                          key={field.id}
                        >
                          <span className="text-sm font-semibold uppercase print:text-xl">
                            {field.label}
                          </span>
                          <textarea
                            className="riso-input print-checklist-box mt-2 min-h-32 w-full resize-y p-3 leading-6 print:mt-4 print:min-h-72 print:resize-none print:border-2 print:p-5 print:text-xl print:leading-8"
                            onChange={(event) =>
                              updateChecklistEntry(
                                strategy.id,
                                field.id,
                                event.target.value,
                              )
                            }
                            value={checklistEntry[field.id]}
                          />
                        </label>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
            )}
          </section>
        ) : null}

        <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-baseline gap-3">
            <h2 className="text-3xl font-extrabold leading-tight">
              All <span className="riso-italic font-normal">strategies</span>
            </h2>
            <span className="riso-mono text-sm text-[#a49c8a]">
              {filteredStrategies.length}
              {activeTags.length > 0 ? ` of ${site.strategies.length}` : ""}{" "}
              strategies
            </span>
          </div>
          <button
            className="riso-button w-full sm:w-auto"
            onClick={shuffleVisibleStrategies}
            type="button"
          >
            Shuffle
          </button>
        </div>

        <section className="grid gap-5 md:grid-cols-2 print:hidden">
          {filteredStrategies.map((strategy, index) => {
            const expanded = expandedId === strategy.id;
            const shouldPulseDetailsButton =
              index === 0 && !detailsButtonInteracted && !expanded;
            const inCart = cartStrategyIds.includes(strategy.id);
            const strategyNumber = String(index + 1).padStart(2, "0");
            const pairedStrategies = strategy.pairedWithIds
              .map((strategyId) => strategyById.get(strategyId))
              .filter((pairedStrategy): pairedStrategy is Strategy =>
                Boolean(pairedStrategy),
              );
            const linkGroups = strategyLinkGroups(strategy);

            return (
              <article
                className={`riso-card scroll-mt-24 overflow-hidden ${
                  index % 5 === 0 ? "md:col-span-2" : ""
                }`}
                id={`strategy-${strategy.id}`}
                key={strategy.id}
                style={strategyAccentStyle(strategy)}
              >
                {strategy.imageUrls[0] ? (
                  <button
                    aria-label={`Open ${strategy.title} image 1`}
                    className="relative block h-48 w-full cursor-zoom-in overflow-hidden border-b-2 border-[#22201b] bg-[#f2ede1] text-left sm:h-56"
                    onClick={() =>
                      setLightboxImage({
                        alt: `${strategy.title} image 1`,
                        url: strategy.imageUrls[0],
                      })
                    }
                    type="button"
                  >
                    <img
                      alt={`${strategy.title} image 1`}
                      className="block h-full w-full object-cover"
                      loading="lazy"
                      src={strategy.imageUrls[0]}
                    />
                    <span className="riso-mono absolute bottom-3 left-3 bg-[#f8f4ea] px-2 py-1 text-[10px] uppercase text-[#7a7466]">
                      Strategy image
                    </span>
                    <span className="riso-italic absolute right-3 top-2 text-6xl text-[#22201b]">
                      {strategyNumber}
                    </span>
                  </button>
                ) : (
                  <div className="riso-card-strip" />
                )}
                <div className="p-4 sm:p-5">
                  <div>
                    <span className="mb-3 flex flex-wrap gap-2">
                      {strategy.tags.map((tag) => (
                        <span
                          className="riso-tag"
                          key={tag}
                          style={tagStyle(tag)}
                        >
                          {tag}
                        </span>
                      ))}
                      {strategy.tags.length === 0 ? (
                        <span className="riso-card-number">
                          {strategyNumber}
                        </span>
                      ) : null}
                    </span>
                    <h3 className="text-2xl font-bold leading-tight">
                      {strategy.title}
                    </h3>
                    <p className="riso-body-copy mt-2 leading-7">
                      {strategy.subtitle}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      aria-expanded={expanded}
                      className={`riso-button ${
                        shouldPulseDetailsButton
                          ? "motion-safe:animate-pulse shadow-[0_0_0_2px_#315d4c]"
                          : ""
                      }`}
                      onClick={() => toggleStrategyDetails(strategy.id)}
                      type="button"
                    >
                      {expanded ? "Hide details" : "View details"}
                    </button>
                    <button
                      aria-label={
                        inCart
                          ? `Remove ${strategy.title} from cart`
                          : `Add ${strategy.title} to cart`
                      }
                      aria-pressed={inCart}
                      className={`riso-button size-10 p-0 ${
                        inCart
                          ? "riso-button-active"
                          : "border-[#315d4c] text-[#315d4c]"
                      }`}
                      onClick={() =>
                        inCart
                          ? removeStrategyFromCart(strategy.id)
                          : addStrategyToCart(strategy.id)
                      }
                      title={inCart ? "Remove from cart" : "Add to cart"}
                      type="button"
                    >
                      <CartIcon selected={inCart} />
                    </button>
                  </div>
                </div>

                {expanded ? (
                  <div className="border-t-2 border-dashed border-[#22201b]/30 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
                    <p className="riso-body-copy max-w-prose leading-7 text-[#333029]">
                      {strategy.body}
                    </p>

                    {strategy.imageUrls.length > 0 ? (
                      <div className="mt-5">
                        <h3 className="text-sm font-semibold uppercase">
                          Images
                        </h3>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {strategy.imageUrls.map((url, index) => {
                            const imageAlt = `${strategy.title} image ${
                              index + 1
                            }`;

                            return (
                              <button
                                aria-label={`Open ${imageAlt}`}
                                className="block w-full cursor-zoom-in border border-[#22201b] bg-[#f2ede1]"
                                key={url}
                                onClick={() =>
                                  setLightboxImage({ alt: imageAlt, url })
                                }
                                type="button"
                              >
                                <img
                                  alt={imageAlt}
                                  className="block aspect-[4/3] w-full object-cover"
                                  loading="lazy"
                                  src={url}
                                />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                      {linkGroups.slice(0, 1).map((group) => (
                        <div key={group.title}>
                          <h3 className="text-sm font-semibold uppercase">
                            {group.title}
                          </h3>
                          <ul className="mt-3 space-y-2 text-sm">
                            {group.links.map((link) => (
                              <li key={link.url}>
                                <a
                                  className="underline decoration-[#8a826f] underline-offset-4"
                                  href={link.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {link.label}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                      {pairedStrategies.length > 0 ? (
                        <div>
                          <h3 className="text-sm font-semibold uppercase">
                            Paired with
                          </h3>
                          <ul className="mt-3 space-y-2 text-sm">
                            {pairedStrategies.map((pairedStrategy) => (
                              <li key={pairedStrategy.id}>
                                <button
                                  className="text-left underline decoration-[#8a826f] underline-offset-4"
                                  onClick={() =>
                                    moveToStrategy(pairedStrategy.id)
                                  }
                                  type="button"
                                >
                                  {pairedStrategy.title}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {linkGroups.slice(1).map((group) => (
                        <div key={group.title}>
                          <h3 className="text-sm font-semibold uppercase">
                            {group.title}
                          </h3>
                          <ul className="mt-3 space-y-2 text-sm">
                            {group.links.map((link) => (
                              <li key={link.url}>
                                <a
                                  className="underline decoration-[#8a826f] underline-offset-4"
                                  href={link.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {link.label}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>

        {filteredStrategies.length === 0 ? (
          <p className="border border-[#22201b] bg-[#f8f4ea] p-5 text-[#4a463c]">
            No strategies match the active tags.
          </p>
        ) : null}
      </div>
    </main>
  );
}

export function StrategyGamePage({ site }: StrategyExplorerProps) {
  const strategyById = useMemo(
    () =>
      new Map(
        site.strategies.map((strategy) => [strategy.id, strategy] as const),
      ),
    [site.strategies],
  );
  const strategyGameState = useSyncExternalStore(
    subscribeToStrategyGameState,
    () => getClientStrategyGameSnapshot(strategyById),
    getServerStrategyGameSnapshot,
  );
  const strategyGameSeenIds = useSyncExternalStore(
    subscribeToStrategyGameSeenIds,
    () => getClientStrategyGameSeenIdsSnapshot(strategyById),
    getServerStrategyGameSeenIdsSnapshot,
  );
  const [showCelebration, setShowCelebration] = useState(false);
  const [clipboardMessage, setClipboardMessage] = useState<string | null>(null);
  const clipboardMessageTimeoutRef = useRef<number | null>(null);
  const strategyGameEntries = strategyGameState.entries;
  const strategyGameIndex = strategyGameState.index;
  const strategyGameSeenCount = strategyGameSeenIds.length;
  const strategyGameRemainingCount = Math.max(
    0,
    site.strategies.length - strategyGameSeenCount,
  );
  const strategyGameCanStart = strategyGameRemainingCount > 0;
  const strategyGameComplete =
    strategyGameEntries.length > 0 &&
    strategyGameIndex >= strategyGameEntries.length;
  const currentStrategyGameEntry = strategyGameComplete
    ? null
    : strategyGameEntries[strategyGameIndex];
  const currentStrategyGameStrategy = currentStrategyGameEntry
    ? strategyById.get(currentStrategyGameEntry.strategyId) ?? null
    : null;
  const currentStrategyGameCharacterCount = countCharacters(
    currentStrategyGameEntry?.response ?? "",
  );
  const strategyGameCanAdvance =
    currentStrategyGameCharacterCount >= STRATEGY_GAME_CHARACTER_GOAL;
  const strategyGameCanCopy =
    strategyGameComplete &&
    strategyGameEntries.length > 0 &&
    strategyGameEntries.every(
      (entry) => countCharacters(entry.response) >= STRATEGY_GAME_CHARACTER_GOAL,
    );
  const strategyGameResponses = useMemo(
    () =>
      strategyGameEntries
        .map((entry) => ({
          entry,
          strategy: strategyById.get(entry.strategyId),
        }))
        .filter(
          (
            item,
          ): item is { entry: StrategyGameEntry; strategy: Strategy } =>
            Boolean(item.strategy),
        ),
    [strategyGameEntries, strategyById],
  );

  useEffect(() => {
    if (!showCelebration) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowCelebration(false);
    }, 3200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [showCelebration]);

  useEffect(
    () => () => {
      if (clipboardMessageTimeoutRef.current !== null) {
        window.clearTimeout(clipboardMessageTimeoutRef.current);
      }
    },
    [],
  );

  function showClipboardStatus(message: string) {
    setClipboardMessage(message);

    if (clipboardMessageTimeoutRef.current !== null) {
      window.clearTimeout(clipboardMessageTimeoutRef.current);
    }

    clipboardMessageTimeoutRef.current = window.setTimeout(() => {
      setClipboardMessage(null);
      clipboardMessageTimeoutRef.current = null;
    }, 2600);
  }

  async function writeTextToClipboard(text: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");

    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.left = "0";
    textarea.style.opacity = "0";
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const didCopy = document.execCommand("copy");
    textarea.remove();

    if (!didCopy) {
      throw new Error("Clipboard copy failed.");
    }
  }

  function buildStrategyGameMarkdown() {
    return [
      "# Strategy Game",
      "",
      `Generated: ${new Date().toLocaleString()}`,
      "",
      ...strategyGameResponses.flatMap(({ entry, strategy }, index) => [
        `## ${index + 1}. ${strategy.title}`,
        "",
        strategy.subtitle,
        "",
        entry.response.trim(),
        "",
      ]),
    ].join("\n");
  }

  async function copyStrategyGameMarkdown() {
    if (!strategyGameCanCopy) {
      return;
    }

    try {
      await writeTextToClipboard(buildStrategyGameMarkdown());
      showClipboardStatus("Strategy Game answers copied as Markdown.");
    } catch {
      showClipboardStatus("Could not copy answers.");
    }
  }

  function startStrategyGame() {
    if (!strategyGameCanStart) {
      return;
    }

    const nextEntries = createStrategyGameEntries(
      site.strategies,
      strategyGameSeenIds,
    );

    if (nextEntries.length === 0) {
      return;
    }

    writeStrategyGameState({
      entries: nextEntries,
      index: 0,
    });
    setShowCelebration(false);
  }

  function updateStrategyGameResponse(value: string) {
    writeStrategyGameState({
      ...strategyGameState,
      entries: strategyGameEntries.map((entry, index) =>
        index === strategyGameIndex ? { ...entry, response: value } : entry,
      ),
    });
  }

  function markCompletedStrategyGameEntriesSeen() {
    const nextSeenIds = new Set(strategyGameSeenIds);

    strategyGameEntries.forEach((entry) => {
      nextSeenIds.add(entry.strategyId);
    });

    writeStrategyGameSeenIds([...nextSeenIds]);
  }

  function completeStrategyGameStep() {
    if (!currentStrategyGameEntry || !strategyGameCanAdvance) {
      return;
    }

    if (strategyGameIndex >= strategyGameEntries.length - 1) {
      markCompletedStrategyGameEntriesSeen();
      writeStrategyGameState({
        ...strategyGameState,
        index: strategyGameEntries.length,
      });
      setShowCelebration(true);
      return;
    }

    writeStrategyGameState({
      ...strategyGameState,
      index: Math.min(strategyGameIndex + 1, strategyGameEntries.length),
    });
  }

  return (
    <main className="riso-app min-h-screen bg-[#f2ede1] text-[#22201b]">
      <header className="sticky top-0 z-20 border-b-2 border-[#22201b] bg-[#f2ede1]">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            aria-label="Back to main page"
            className="riso-button size-11 p-0"
            href="/"
          >
            <ArrowLeftIcon />
          </Link>
          <div>
            <h1 className="riso-mono text-sm font-semibold uppercase">
              Strategy Game
            </h1>
            <p className="text-sm text-[#4a463c]">
              {strategyGameRemainingCount} of {site.strategies.length}{" "}
              strategies left this session.
            </p>
          </div>
        </div>
      </header>

      {showCelebration ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-30 overflow-hidden"
        >
          {Array.from({ length: 44 }).map((_, index) => (
            <span
              className="absolute top-[-1rem] h-3 w-1.5 animate-[strategy-game-confetti_1.8s_ease-out_forwards]"
              key={index}
              style={strategyGameConfettiStyle(index)}
            />
          ))}
        </div>
      ) : null}

      {clipboardMessage ? (
        <p
          aria-live="polite"
          className="riso-panel fixed inset-x-4 bottom-4 z-40 px-3 py-2 text-sm font-medium"
        >
          {clipboardMessage}
        </p>
      ) : null}

      <div className="mx-auto max-w-3xl px-4 py-5">
        {strategyGameComplete ? (
          <section>
            <h2 className="text-4xl font-semibold leading-tight">Good job!</h2>
            <p className="mt-2 leading-7 text-[#4a463c]">
              You completed {strategyGameEntries.length} strategy responses.
            </p>

            <div className="mt-5 grid gap-3">
              {strategyGameResponses.map(({ entry, strategy }, index) => (
                <article
                  className="riso-panel p-3"
                  key={`${entry.strategyId}-${index}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold leading-tight">
                      {strategy.title}
                    </h3>
                    <p className="text-sm text-[#4a463c]">
                      {countCharacters(entry.response)} characters
                    </p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#4a463c]">
                    {entry.response}
                  </p>
                </article>
              ))}
            </div>

            <div className="sticky bottom-0 -mx-4 mt-6 grid gap-2 border-t-2 border-[#22201b] bg-[#f8f4ea] p-4">
              <button
                className="riso-button"
                disabled={!strategyGameCanCopy}
                onClick={() => void copyStrategyGameMarkdown()}
                type="button"
              >
                Copy Markdown
              </button>
              <button
                className="riso-button"
                disabled={!strategyGameCanStart}
                onClick={startStrategyGame}
                type="button"
              >
                Play again
              </button>
            </div>
          </section>
        ) : currentStrategyGameStrategy && currentStrategyGameEntry ? (
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold uppercase">
                Prompt {strategyGameIndex + 1} / {strategyGameEntries.length}
              </p>
              <p
                aria-live="polite"
                className={`text-sm font-semibold ${
                  strategyGameCanAdvance ? "text-[#315d4c]" : "text-[#4a463c]"
                }`}
                id="strategy-game-page-character-count"
              >
                {currentStrategyGameCharacterCount} /{" "}
                {STRATEGY_GAME_CHARACTER_GOAL} characters
              </p>
            </div>

            <article
              className="riso-panel mt-4 p-4"
              style={strategyAccentStyle(currentStrategyGameStrategy)}
            >
              <div className="riso-card-strip -mx-4 -mt-4 mb-4" />
              <div className="flex flex-wrap gap-2">
                {currentStrategyGameStrategy.tags.map((tag) => (
                  <span
                    className="riso-tag"
                    key={tag}
                    style={tagStyle(tag)}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <h2 className="mt-4 text-2xl font-semibold leading-tight">
                {currentStrategyGameStrategy.title}
              </h2>
              <p className="riso-body-copy mt-2 text-sm leading-6">
                {currentStrategyGameStrategy.subtitle}
              </p>
              {currentStrategyGameStrategy.body.trim() ? (
                <p className="mt-4 border-t border-[#22201b] pt-4 text-sm leading-6 text-[#333029]">
                  {currentStrategyGameStrategy.body}
                </p>
              ) : null}
            </article>

            <label className="mt-5 block">
              <span className="text-sm font-semibold uppercase">
                Your plan or thoughts
              </span>
              <textarea
                aria-describedby="strategy-game-page-character-count"
                className="riso-input mt-2 min-h-44 w-full resize-y p-3 leading-6"
                onChange={(event) =>
                  updateStrategyGameResponse(event.target.value)
                }
                placeholder="Write how you will implement this strategy, or what you think about it."
                value={currentStrategyGameEntry.response}
              />
            </label>

            <div className="sticky bottom-0 -mx-4 mt-4 flex flex-col gap-3 border-t-2 border-[#22201b] bg-[#f8f4ea] p-4">
              <p className="text-sm leading-6 text-[#4a463c]">
                The next prompt unlocks at 140 characters.
              </p>
              <button
                className="riso-button"
                disabled={!strategyGameCanAdvance}
                onClick={completeStrategyGameStep}
                type="button"
              >
                {strategyGameIndex >= strategyGameEntries.length - 1
                  ? "Finish game"
                  : "Next strategy"}
              </button>
            </div>
          </section>
        ) : (
          <section className="riso-panel p-4">
            <h2 className="text-2xl font-semibold leading-tight">
              Strategy Game
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#4a463c]">
              Get up to three random strategies you haven&apos;t seen this
              session and write 140 characters about each one.
            </p>
            <button
              className="riso-button mt-5 w-full"
              disabled={!strategyGameCanStart}
              onClick={startStrategyGame}
              type="button"
            >
              Start Game
            </button>
            {!strategyGameCanStart ? (
              <p className="mt-4 text-sm leading-6 text-[#4a463c]">
                No unseen strategies remain in this browser session.
              </p>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}

export function ChecklistPage({ site }: StrategyExplorerProps) {
  const strategyById = useMemo(
    () =>
      new Map(
        site.strategies.map((strategy) => [strategy.id, strategy] as const),
      ),
    [site.strategies],
  );
  const cartState = useSyncExternalStore(
    subscribeToCartState,
    () => getClientCartSnapshot(strategyById),
    getServerCartSnapshot,
  );
  const [clipboardMessage, setClipboardMessage] = useState<string | null>(null);
  const clipboardMessageTimeoutRef = useRef<number | null>(null);
  const cartStrategies = useMemo(
    () =>
      cartState.strategyIds
        .map((strategyId) => strategyById.get(strategyId))
        .filter((strategy): strategy is Strategy => Boolean(strategy)),
    [cartState.strategyIds, strategyById],
  );

  useEffect(
    () => () => {
      if (clipboardMessageTimeoutRef.current !== null) {
        window.clearTimeout(clipboardMessageTimeoutRef.current);
      }
    },
    [],
  );

  function showClipboardStatus(message: string) {
    setClipboardMessage(message);

    if (clipboardMessageTimeoutRef.current !== null) {
      window.clearTimeout(clipboardMessageTimeoutRef.current);
    }

    clipboardMessageTimeoutRef.current = window.setTimeout(() => {
      setClipboardMessage(null);
      clipboardMessageTimeoutRef.current = null;
    }, 2600);
  }

  async function writeTextToClipboard(text: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");

    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.left = "0";
    textarea.style.opacity = "0";
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const didCopy = document.execCommand("copy");
    textarea.remove();

    if (!didCopy) {
      throw new Error("Clipboard copy failed.");
    }
  }

  function buildCartMarkdown() {
    return [
      "# Reading Strategy Cart",
      "",
      `Generated: ${new Date().toLocaleString()}`,
      "",
      ...cartStrategies.flatMap((strategy, index) => {
        const checklistEntry =
          cartState.checklistEntries[strategy.id] ?? createBlankChecklistEntry();

        return [
          `## ${index + 1}. ${strategy.title}`,
          "",
          strategy.subtitle,
          "",
          "### Where are you now?",
          "",
          checklistEntry.whereNow.trim() || "_No response yet._",
          "",
          "### Goal",
          "",
          checklistEntry.goal.trim() || "_No response yet._",
          "",
        ];
      }),
    ].join("\n");
  }

  async function copyCartMarkdown() {
    if (cartStrategies.length === 0) {
      return;
    }

    try {
      await writeTextToClipboard(buildCartMarkdown());
      showClipboardStatus("Cart copied as Markdown.");
    } catch {
      showClipboardStatus("Could not copy cart.");
    }
  }

  function updateChecklistEntry(
    strategyId: string,
    field: ChecklistField,
    value: string,
  ) {
    writeCartState({
      ...cartState,
      checklistEntries: {
        ...cartState.checklistEntries,
        [strategyId]: {
          ...(cartState.checklistEntries[strategyId] ??
            createBlankChecklistEntry()),
          [field]: value,
        },
      },
    });
  }

  function removeStrategyFromCart(strategyId: string) {
    writeCartState({
      ...cartState,
      strategyIds: cartState.strategyIds.filter(
        (currentId) => currentId !== strategyId,
      ),
    });
  }

  return (
    <main className="riso-app min-h-screen bg-[#f2ede1] text-[#22201b]">
      <header className="sticky top-0 z-20 border-b-2 border-[#22201b] bg-[#f2ede1]">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            aria-label="Back to main page"
            className="riso-button size-11 p-0"
            href="/"
          >
            <ArrowLeftIcon />
          </Link>
          <div>
            <h1 className="riso-mono text-sm font-semibold uppercase">
              Checklist
            </h1>
            <p className="text-sm text-[#4a463c]">
              {cartStrategies.length} selected
            </p>
          </div>
        </div>
      </header>

      {clipboardMessage ? (
        <p
          aria-live="polite"
          className="riso-panel fixed inset-x-4 bottom-4 z-40 px-3 py-2 text-sm font-medium"
        >
          {clipboardMessage}
        </p>
      ) : null}

      <div className="mx-auto max-w-3xl px-4 py-5">
        {cartStrategies.length === 0 ? (
          <section className="riso-panel p-4">
            <h2 className="text-2xl font-semibold leading-tight">
              No strategies selected
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#4a463c]">
              Add strategies from the main page, then come back here to fill in
              your checklist.
            </p>
          </section>
        ) : (
          <section className="grid gap-4 pb-28">
            {cartStrategies.map((strategy) => {
              const checklistEntry =
                cartState.checklistEntries[strategy.id] ??
                createBlankChecklistEntry();

              return (
                <article
                  className="riso-panel p-4"
                  key={strategy.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-xl font-semibold leading-tight">
                        {strategy.title}
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-[#4a463c]">
                        {strategy.subtitle}
                      </p>
                    </div>
                    <button
                      className="riso-button shrink-0"
                      onClick={() => removeStrategyFromCart(strategy.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-4 grid gap-4">
                    {CHECKLIST_FIELDS.map((field) => (
                      <label className="block" key={field.id}>
                        <span className="text-sm font-semibold uppercase">
                          {field.label}
                        </span>
                        <textarea
                          className="riso-input mt-2 min-h-36 w-full resize-y p-3 leading-6"
                          onChange={(event) =>
                            updateChecklistEntry(
                              strategy.id,
                              field.id,
                              event.target.value,
                            )
                          }
                          value={checklistEntry[field.id]}
                        />
                      </label>
                    ))}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>

      {cartStrategies.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 border-t-2 border-[#22201b] bg-[#f8f4ea] p-4">
          <button
            className="riso-button w-full"
            onClick={() => void copyCartMarkdown()}
            type="button"
          >
            Copy Markdown
          </button>
        </div>
      ) : null}
    </main>
  );
}
