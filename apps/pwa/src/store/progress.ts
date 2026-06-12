import { create } from "zustand";

type ErrorRecord = {
  id: string;
  topicId: string;
  unitId: string;
  tag: string;
  createdAt: string;
  dueAt: string;
  sourceType: "gate" | "training" | "variant" | "coach";
  reviewCount: number;
  resolved: boolean;
};

type TopicProgress = {
  completedUnits: string[];
  gatePassed: string[];
  audioPosition: number;
  lastVisited: string;
  chapterStatus: Record<
    string,
    {
      read?: boolean;
      listened?: boolean;
      practiced?: boolean;
    }
  >;
  attempts: Record<
    string,
    {
      answer: string;
      correct: boolean;
      submittedAt: string;
    }
  >;
};

type ProgressState = {
  topics: Record<string, TopicProgress>;
  errors: ErrorRecord[];
  touchTopic: (topicId: string) => void;
  completeUnit: (topicId: string, unitId: string) => void;
  passGate: (topicId: string, gateId: string) => void;
  setAudioPosition: (topicId: string, seconds: number) => void;
  markChapterStatus: (topicId: string, chapterId: string, status: { read?: boolean; listened?: boolean; practiced?: boolean }) => void;
  submitAttempt: (topicId: string, unitId: string, answer: string, correct: boolean) => void;
  addError: (topicId: string, unitId: string, tag: string, sourceType?: ErrorRecord["sourceType"]) => void;
  resolveError: (id: string) => void;
  reviewError: (id: string) => void;
  exportProgress: () => Pick<ProgressState, "topics" | "errors">;
  importProgress: (payload: unknown) => boolean;
};

const STORAGE_KEY = "mother-topic-player-progress";

function emptyProgress(): TopicProgress {
  return {
    completedUnits: [],
    gatePassed: [],
    audioPosition: 0,
    lastVisited: new Date().toISOString(),
    chapterStatus: {},
    attempts: {},
  };
}

function normalizeStoredProgress(payload: unknown): Pick<ProgressState, "topics" | "errors"> {
  if (!payload || typeof payload !== "object") return { topics: {}, errors: [] };
  const parsed = payload as Partial<Pick<ProgressState, "topics" | "errors">>;
  const topics = Object.fromEntries(
    Object.entries(parsed.topics ?? {}).map(([topicId, progress]) => [
      topicId,
      {
        ...emptyProgress(),
        ...progress,
        chapterStatus: progress.chapterStatus ?? {},
        attempts: progress.attempts ?? {},
      },
    ]),
  );
  const errors = (parsed.errors ?? []).map((error) => ({
    ...error,
    dueAt: error.dueAt ?? error.createdAt,
    sourceType: error.sourceType ?? "training",
    reviewCount: error.reviewCount ?? 0,
    resolved: Boolean(error.resolved),
  }));
  return { topics, errors };
}

function loadInitial(): Pick<ProgressState, "topics" | "errors"> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { topics: {}, errors: [] };
  try {
    return normalizeStoredProgress(JSON.parse(raw));
  } catch {
    return { topics: {}, errors: [] };
  }
}

const REVIEW_INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];

function dueDateForReview(reviewCount: number) {
  const interval = REVIEW_INTERVAL_DAYS[Math.min(reviewCount, REVIEW_INTERVAL_DAYS.length - 1)];
  const due = new Date();
  due.setDate(due.getDate() + interval);
  return due.toISOString();
}

function persist(topics: Record<string, TopicProgress>, errors: ErrorRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ topics, errors }));
}

const initial = loadInitial();

export const useProgressStore = create<ProgressState>((set, get) => ({
  topics: initial.topics,
  errors: initial.errors,
  touchTopic: (topicId) =>
    set((state) => {
      const topics = {
        ...state.topics,
        [topicId]: {
          ...(state.topics[topicId] ?? emptyProgress()),
          lastVisited: new Date().toISOString(),
        },
      };
      persist(topics, state.errors);
      return { topics };
    }),
  completeUnit: (topicId, unitId) =>
    set((state) => {
      const current = state.topics[topicId] ?? emptyProgress();
      const topics = {
        ...state.topics,
        [topicId]: {
          ...current,
          completedUnits: Array.from(new Set([...current.completedUnits, unitId])),
          lastVisited: new Date().toISOString(),
        },
      };
      persist(topics, state.errors);
      return { topics };
    }),
  passGate: (topicId, gateId) =>
    set((state) => {
      const current = state.topics[topicId] ?? emptyProgress();
      const topics = {
        ...state.topics,
        [topicId]: {
          ...current,
          gatePassed: Array.from(new Set([...current.gatePassed, gateId])),
          lastVisited: new Date().toISOString(),
        },
      };
      persist(topics, state.errors);
      return { topics };
    }),
  setAudioPosition: (topicId, seconds) =>
    set((state) => {
      const current = state.topics[topicId] ?? emptyProgress();
      const topics = {
        ...state.topics,
        [topicId]: {
          ...current,
          audioPosition: seconds,
          lastVisited: new Date().toISOString(),
        },
      };
      persist(topics, state.errors);
      return { topics };
    }),
  markChapterStatus: (topicId, chapterId, status) =>
    set((state) => {
      const current = state.topics[topicId] ?? emptyProgress();
      const previous = current.chapterStatus[chapterId] ?? {};
      const nextStatus = { ...previous, ...status };
      if (
        previous.read === nextStatus.read &&
        previous.listened === nextStatus.listened &&
        previous.practiced === nextStatus.practiced
      ) {
        return {};
      }
      const topics = {
        ...state.topics,
        [topicId]: {
          ...current,
          chapterStatus: {
            ...current.chapterStatus,
            [chapterId]: nextStatus,
          },
          lastVisited: new Date().toISOString(),
        },
      };
      persist(topics, state.errors);
      return { topics };
    }),
  submitAttempt: (topicId, unitId, answer, correct) =>
    set((state) => {
      const current = state.topics[topicId] ?? emptyProgress();
      const topics = {
        ...state.topics,
        [topicId]: {
          ...current,
          attempts: {
            ...current.attempts,
            [unitId]: {
              answer,
              correct,
              submittedAt: new Date().toISOString(),
            },
          },
          completedUnits: correct ? Array.from(new Set([...current.completedUnits, unitId])) : current.completedUnits,
          lastVisited: new Date().toISOString(),
        },
      };
      persist(topics, state.errors);
      return { topics };
    }),
  addError: (topicId, unitId, tag, sourceType = "training") =>
    set((state) => {
      const exists = state.errors.some((error) => error.topicId === topicId && error.unitId === unitId && !error.resolved);
      if (exists) return {};
      const errors = [
        {
          id: `${topicId}_${unitId}_${Date.now()}`,
          topicId,
          unitId,
          tag,
          createdAt: new Date().toISOString(),
          dueAt: dueDateForReview(0),
          sourceType,
          reviewCount: 0,
          resolved: false,
        },
        ...state.errors,
      ];
      persist(state.topics, errors);
      return { errors };
    }),
  resolveError: (id) =>
    set((state) => {
      const errors = state.errors.map((error) => (error.id === id ? { ...error, resolved: true } : error));
      persist(state.topics, errors);
      return { errors };
    }),
  reviewError: (id) =>
    set((state) => {
      const errors = state.errors.map((error) => {
        if (error.id !== id) return error;
        const nextReviewCount = error.reviewCount + 1;
        return {
          ...error,
          dueAt: dueDateForReview(nextReviewCount),
          reviewCount: nextReviewCount,
        };
      });
      persist(state.topics, errors);
      return { errors };
    }),
  exportProgress: () => {
    const state = get();
    return { topics: state.topics, errors: state.errors };
  },
  importProgress: (payload) => {
    try {
      const { topics, errors } = normalizeStoredProgress(payload);
      persist(topics, errors);
      set({ topics, errors });
      return true;
    } catch {
      return false;
    }
  },
}));
