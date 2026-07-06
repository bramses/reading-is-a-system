"use client";

/* eslint-disable @next/next/no-img-element -- Image URLs come from JSON and should not require Next config updates per host. */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { SiteData, Strategy } from "./site-types";

type StrategyExplorerProps = {
  site: SiteData;
};

type ChecklistField = "whereNow" | "goal";

type ChecklistEntry = Record<ChecklistField, string>;

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
const KINDLE_APP_DEEP_LINK = "kindle://";
const AUDIBLE_APP_DEEP_LINK = "audible://";
const KINDLE_WEB_READER_URL = "https://read.amazon.com/kindle-library";
const AUDIBLE_WEB_URL = "https://www.audible.com/library/titles";
const READING_TIMER_BLOCK_COUNT = 10;
const READING_TIMER_BLOCK_MINUTES = 5;
const READING_TIMER_BLOCK_MS = READING_TIMER_BLOCK_MINUTES * 60 * 1000;

const BLANK_CART_STATE: CartState = {
  strategyIds: [],
  checklistEntries: {},
};

const BLANK_READING_TIMER_STATE: ReadingTimerState = {
  completedCount: 0,
  selectedThroughIndex: null,
  activeTimer: null,
};

let cartStateCache: CartState | null = null;
const cartStateListeners = new Set<() => void>();
let readingTimerStateCache: ReadingTimerState | null = null;
const readingTimerStateListeners = new Set<() => void>();
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

function getServerCartSnapshot() {
  return BLANK_CART_STATE;
}

function getServerReadingTimerSnapshot() {
  return BLANK_READING_TIMER_STATE;
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
  const [, forceStrategyShuffleRender] = useState(0);
  const readingTimerState = useSyncExternalStore(
    subscribeToReadingTimerState,
    getClientReadingTimerSnapshot,
    getServerReadingTimerSnapshot,
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
    <main className="min-h-screen bg-[#f7f5ef] text-[#201f1b] print:bg-white">
      {lightboxImage ? (
        <div
          aria-label={lightboxImage.alt}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#201f1b]/90 p-4 print:hidden sm:p-8"
          onClick={() => setLightboxImage(null)}
          role="dialog"
        >
          <button
            aria-label="Close image"
            className="absolute right-4 top-4 inline-flex size-11 items-center justify-center border border-[#f7f5ef] bg-[#201f1b] text-[#f7f5ef] hover:bg-[#f7f5ef] hover:text-[#201f1b]"
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
          className="fixed inset-0 z-40 flex bg-[#201f1b]/90 p-3 print:hidden sm:p-6"
          onClick={closeStarterPack}
          role="dialog"
        >
          <button
            aria-label="Previous starter pack strategy"
            className="absolute left-3 top-1/2 hidden size-12 -translate-y-1/2 items-center justify-center border border-[#f7f5ef] bg-[#201f1b] text-xl font-semibold text-[#f7f5ef] hover:bg-[#f7f5ef] hover:text-[#201f1b] sm:inline-flex"
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
            className="absolute right-3 top-1/2 hidden size-12 -translate-y-1/2 items-center justify-center border border-[#f7f5ef] bg-[#201f1b] text-xl font-semibold text-[#f7f5ef] hover:bg-[#f7f5ef] hover:text-[#201f1b] sm:inline-flex"
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
            <div className="flex items-center justify-between gap-3 text-[#f7f5ef]">
              <p className="text-sm font-semibold uppercase">
                Starter pack {starterPackIndex + 1} /{" "}
                {starterPackStrategies.length}
              </p>
              <button
                aria-label="Close starter pack"
                className="inline-flex size-11 items-center justify-center border border-[#f7f5ef] bg-[#201f1b] text-[#f7f5ef] hover:bg-[#f7f5ef] hover:text-[#201f1b]"
                onClick={closeStarterPack}
                type="button"
              >
                <CloseIcon />
              </button>
            </div>

            <article className="min-h-0 flex-1 overflow-y-auto border border-[#201f1b] bg-[#fffdf8] p-4 sm:p-6">
              <div className="flex flex-wrap gap-2">
                {starterPackStrategy.tags.map((tag) => (
                  <span
                    className="border border-[#d8d1c1] px-2 py-1 text-xs text-[#5f5a4f]"
                    key={tag}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <h2 className="mt-4 text-3xl font-semibold leading-tight sm:text-5xl">
                {starterPackStrategy.title}
              </h2>
              <p className="mt-3 text-lg leading-8 text-[#5f5a4f]">
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
                  className="mt-5 block w-full cursor-zoom-in border border-[#d8d1c1] bg-[#f7f5ef]"
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
                className={`mt-6 inline-flex w-full items-center justify-center gap-2 border px-3 py-3 text-sm font-semibold sm:w-auto ${
                  starterPackInCart
                    ? "border-[#315d4c] bg-[#315d4c] text-[#fffdf8]"
                    : "border-[#315d4c] text-[#315d4c] hover:bg-[#315d4c] hover:text-[#fffdf8]"
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
                className="border border-[#f7f5ef] bg-[#201f1b] px-3 py-3 text-sm font-semibold text-[#f7f5ef] hover:bg-[#f7f5ef] hover:text-[#201f1b]"
                onClick={() => moveStarterPack(-1)}
                type="button"
              >
                Previous
              </button>
              <button
                className="border border-[#f7f5ef] bg-[#201f1b] px-3 py-3 text-sm font-semibold text-[#f7f5ef] hover:bg-[#f7f5ef] hover:text-[#201f1b]"
                onClick={() => moveStarterPack(1)}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={`mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-6 sm:gap-8 sm:px-8 sm:py-8 lg:px-10 print:max-w-none print:gap-0 print:px-0 print:py-0 ${
          cartStrategies.length > 0 ? "pb-36 sm:pb-8" : ""
        }`}
      >
        <header className="flex flex-col gap-6 border-b border-[#d8d1c1] pb-8 print:hidden">
          <nav className="flex flex-wrap gap-3 text-sm font-medium">
            <a
              className="inline-flex w-full items-center justify-center gap-2 border border-[#201f1b] px-3 py-2 hover:bg-[#201f1b] hover:text-[#f7f5ef] sm:w-auto"
              href={site.links.discord}
              target="_blank"
              rel="noreferrer"
            >
              <DiscordIcon />
              Join the community
            </a>
            <a
              className="inline-flex w-full items-center justify-center gap-2 border border-[#201f1b] px-3 py-2 hover:bg-[#201f1b] hover:text-[#f7f5ef] sm:w-auto"
              href={site.links.slides}
              target="_blank"
              rel="noreferrer"
            >
              <SlidesIcon />
              View the slides
            </a>
            <a
              className="inline-flex w-full items-center justify-center gap-2 border border-[#201f1b] px-3 py-2 hover:bg-[#201f1b] hover:text-[#f7f5ef] sm:w-auto"
              href={site.links.github}
              target="_blank"
              rel="noreferrer"
            >
              <GitHubIcon />
              Star on GitHub
            </a>
            <details className="group relative w-full sm:w-auto">
              <summary className="inline-flex w-full cursor-pointer list-none items-center justify-center gap-2 border border-[#201f1b] px-3 py-2 hover:bg-[#201f1b] hover:text-[#f7f5ef] sm:w-auto [&::-webkit-details-marker]:hidden">
                <CalendarIcon />
                Talk to Bram
                <ChevronDownIcon />
              </summary>
              <div className="mt-2 grid w-full border border-[#201f1b] bg-[#fffdf8] text-[#201f1b] shadow-sm sm:absolute sm:right-0 sm:top-full sm:z-20 sm:w-72">
                <a
                  className="px-3 py-3 hover:bg-[#201f1b] hover:text-[#f7f5ef]"
                  href={site.links.schedule}
                  target="_blank"
                  rel="noreferrer"
                >
                  1:1 meeting
                </a>
                <a
                  className="border-t border-[#d8d1c1] px-3 py-3 hover:bg-[#201f1b] hover:text-[#f7f5ef]"
                  href={site.links.bookClub}
                  target="_blank"
                  rel="noreferrer"
                >
                  1:n meeting (book club)
                </a>
              </div>
            </details>
            <a
              className="inline-flex w-full items-center justify-center gap-2 border border-[#201f1b] px-3 py-2 hover:bg-[#201f1b] hover:text-[#f7f5ef] sm:w-auto"
              href={site.links.kofi}
              target="_blank"
              rel="noreferrer"
            >
              <CoffeeIcon />
              Support the Project
            </a>
          </nav>

          <div className="max-w-4xl">
            <h1 className="text-3xl font-semibold leading-tight sm:text-6xl">
              {site.title}
            </h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-[#5f5a4f] sm:text-xl">
              {site.subtitle}
            </p>
          </div>
        </header>

        <section
          aria-labelledby="tag-filter-title"
          className="border-b border-[#d8d1c1] pb-8 print:hidden"
        >
          <div
            aria-labelledby="reading-timer-title"
            className="border border-[#d8d1c1] bg-[#fffdf8] p-4"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3
                  className="text-sm font-semibold uppercase"
                  id="reading-timer-title"
                >
                  It is most important of all to Start reading right now, then add the strategies below to improve.
                </h3>
                <p className="mt-1 text-sm leading-6 text-[#5f5a4f]">
                  Each square represents 5 minutes. Click a square to choose
                  how far to go.
                </p>
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
                      className="border border-[#201f1b] px-3 py-2 text-sm font-medium hover:bg-[#201f1b] hover:text-[#f7f5ef]"
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
                      className="border border-[#c8c0ae] px-3 py-2 text-sm font-medium hover:border-[#201f1b]"
                      onClick={cancelReadingTimer}
                      type="button"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="border border-[#201f1b] px-3 py-2 text-sm font-medium hover:bg-[#201f1b] hover:text-[#f7f5ef] disabled:cursor-not-allowed disabled:border-[#c8c0ae] disabled:text-[#8a826f] disabled:hover:bg-transparent disabled:hover:text-[#8a826f]"
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
                          ? "border-[#315d4c] bg-white text-[#fffdf8]"
                          : blockSelected
                            ? "border-[#201f1b] bg-[#ede5d4] text-[#201f1b]"
                            : "border-[#c8c0ae] bg-white text-[#5f5a4f] hover:border-[#201f1b]"
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
                          blockFillProgress > 0.65 ? "text-[#fffdf8]" : ""
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

          <div className="mt-4 grid gap-2">
            {starterPackStrategies.length > 0 ? (
              <button
                className="text-left text-sm font-medium underline decoration-[#8a826f] underline-offset-4 hover:text-[#315d4c]"
                onClick={openStarterPack}
                type="button"
              >
                Unsure of where to start? Here&apos;s a starter pack.
              </button>
            ) : null}
            <div className="grid justify-items-start gap-2">
              <button
                aria-controls="kindle-reader-menu"
                aria-expanded={kindleMenuOpen}
                className="text-left text-sm font-medium underline decoration-[#8a826f] underline-offset-4 hover:text-[#315d4c]"
                onClick={() => setKindleMenuOpen((open) => !open)}
                type="button"
              >
                Are you a Kindle user? Yes? Press this button to read right
                now. Go. Do it!!
              </button>
              {kindleMenuOpen ? (
                <div
                  className="flex flex-col gap-2 sm:flex-row"
                  id="kindle-reader-menu"
                >
                  <a
                    className="border border-[#201f1b] px-3 py-2 text-sm font-medium hover:bg-[#201f1b] hover:text-[#f7f5ef]"
                    href={KINDLE_APP_DEEP_LINK}
                  >
                    Open Kindle app
                  </a>
                  <a
                    className="border border-[#c8c0ae] px-3 py-2 text-sm font-medium hover:border-[#201f1b]"
                    href={KINDLE_WEB_READER_URL}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open Kindle in browser
                  </a>
                  <a
                    className="border border-[#c8c0ae] px-3 py-2 text-sm font-medium hover:border-[#201f1b]"
                    href={AUDIBLE_APP_DEEP_LINK}
                  >
                    Open Audible app
                  </a>
                  <a
                    className="border border-[#c8c0ae] px-3 py-2 text-sm font-medium hover:border-[#201f1b]"
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

          <div className="mt-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2
                id="tag-filter-title"
                className="text-sm font-semibold uppercase"
              >
                Tags
              </h2>
              {activeTags.length > 0 ? (
                <button
                  className="text-sm underline decoration-[#8a826f] underline-offset-4"
                  type="button"
                  onClick={() => setActiveTags([])}
                >
                  Clear
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <label
                  className="flex cursor-pointer items-center gap-2 border border-[#c8c0ae] bg-[#fffdf8] px-3 py-2 text-sm"
                  key={tag}
                >
                  <input
                    checked={activeTags.includes(tag)}
                    className="size-4 accent-[#315d4c]"
                    onChange={() => toggleTag(tag)}
                    type="checkbox"
                  />
                  {tag}
                </label>
              ))}
            </div>
          </div>
        </section>

        {cartStrategies.length > 0 ? (
          <section
            aria-labelledby="cart-title"
            className={`fixed inset-x-3 bottom-3 z-30 overflow-y-auto overscroll-contain border border-[#d8d1c1] bg-[#fffdf8] p-3 shadow-sm sm:bottom-auto sm:left-auto sm:right-4 sm:top-0 sm:max-h-screen sm:w-96 print:static print:z-auto print:max-h-none print:w-full print:overflow-visible print:border-0 print:bg-white print:p-0 print:shadow-none ${
              cartExpanded ? "max-h-96" : ""
            }`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 id="cart-title" className="text-sm font-semibold uppercase">
                  Cart
                </h2>
                <p className="text-sm text-[#5f5a4f]">
                  {cartStrategies.length} selected
                </p>
              </div>

              <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto print:hidden">
                <button
                  className="border border-[#c8c0ae] px-2 py-2 text-xs font-medium hover:border-[#201f1b] sm:px-3 sm:py-1.5 sm:text-sm"
                  onClick={() => setCartExpanded((expanded) => !expanded)}
                  type="button"
                >
                  {cartExpanded ? "Hide checklist" : "Edit checklist"}
                </button>
                <button
                  className="border border-[#201f1b] px-2 py-2 text-xs font-medium hover:bg-[#201f1b] hover:text-[#f7f5ef] sm:px-3 sm:py-1.5 sm:text-sm"
                  onClick={() => window.print()}
                  type="button"
                >
                  Print / PDF
                </button>
                <button
                  className="border border-[#c8c0ae] px-2 py-2 text-xs font-medium hover:border-[#201f1b] sm:px-3 sm:py-1.5 sm:text-sm"
                  onClick={clearCart}
                  type="button"
                >
                  Clear
                </button>
              </div>
            </div>

            <div
              className={`${
                cartExpanded ? "mt-4 grid gap-3 sm:gap-4" : "hidden"
              } print:mt-0 print:grid print:gap-0`}
            >
              {cartStrategies.map((strategy) => {
                const checklistEntry =
                  checklistEntries[strategy.id] ?? createBlankChecklistEntry();

                return (
                  <article
                    className="print-strategy break-inside-avoid border border-[#d8d1c1] p-3 sm:p-4 print:border-2 print:border-[#201f1b] print:p-8"
                    key={strategy.id}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <h3 className="text-xl font-semibold leading-tight sm:text-2xl print:text-4xl">
                          {strategy.title}
                        </h3>
                        <p className="mt-1 leading-7 text-[#5f5a4f] print:mt-3 print:text-xl print:leading-8 print:text-[#201f1b]">
                          {strategy.subtitle}
                        </p>
                      </div>
                      <button
                        className="w-full border border-[#c8c0ae] px-3 py-2 text-sm font-medium hover:border-[#201f1b] sm:w-auto print:hidden"
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
                            className="print-checklist-box mt-2 min-h-32 w-full resize-y border border-[#c8c0ae] bg-white p-3 leading-6 text-[#201f1b] outline-none focus:border-[#201f1b] print:mt-4 print:min-h-72 print:resize-none print:border-2 print:p-5 print:text-xl print:leading-8"
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
          </section>
        ) : null}

        <div className="flex justify-end print:hidden">
          <button
            className="w-full border border-[#201f1b] px-3 py-2 text-sm font-medium hover:bg-[#201f1b] hover:text-[#f7f5ef] sm:w-auto"
            onClick={shuffleVisibleStrategies}
            type="button"
          >
            Shuffle strategies
          </button>
        </div>

        <section className="grid gap-4 md:grid-cols-2 print:hidden">
          {filteredStrategies.map((strategy, index) => {
            const expanded = expandedId === strategy.id;
            const shouldPulseDetailsButton =
              index === 0 && !detailsButtonInteracted && !expanded;
            const inCart = cartStrategyIds.includes(strategy.id);
            const pairedStrategies = strategy.pairedWithIds
              .map((strategyId) => strategyById.get(strategyId))
              .filter((pairedStrategy): pairedStrategy is Strategy =>
                Boolean(pairedStrategy),
              );
            const linkGroups = strategyLinkGroups(strategy);

            return (
              <article
                className={`scroll-mt-6 border bg-[#fffdf8] ${
                  expanded
                    ? "border-[#201f1b] shadow-[0_0_0_2px_#201f1b]"
                    : "border-[#d8d1c1]"
                }`}
                id={`strategy-${strategy.id}`}
                key={strategy.id}
              >
                <div className="p-4 sm:p-5">
                  <div>
                    <span className="mb-3 flex flex-wrap gap-2">
                      {strategy.tags.map((tag) => (
                        <span
                          className="border border-[#d8d1c1] px-2 py-1 text-xs text-[#5f5a4f]"
                          key={tag}
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                    <h3 className="text-xl font-semibold leading-tight sm:text-2xl">
                      {strategy.title}
                    </h3>
                    <p className="mt-2 leading-7 text-[#5f5a4f]">
                      {strategy.subtitle}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      aria-expanded={expanded}
                      className={`border border-[#201f1b] px-3 py-2 text-sm font-medium hover:bg-[#201f1b] hover:text-[#fffdf8] ${
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
                      className={`inline-flex size-10 items-center justify-center border text-sm font-medium ${
                        inCart
                          ? "border-[#315d4c] bg-[#315d4c] text-[#fffdf8]"
                          : "border-[#315d4c] text-[#315d4c] hover:bg-[#315d4c] hover:text-[#fffdf8]"
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
                  <div className="border-t border-[#d8d1c1] px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
                    <p className="max-w-prose leading-7 text-[#333029]">
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
                                className="block w-full cursor-zoom-in border border-[#d8d1c1] bg-[#f7f5ef]"
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
          <p className="border border-[#d8d1c1] bg-[#fffdf8] p-5 text-[#5f5a4f]">
            No strategies match the active tags.
          </p>
        ) : null}
      </div>
    </main>
  );
}
