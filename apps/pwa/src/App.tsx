import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useParams } from "react-router-dom";
import {
  Activity,
  BadgeCheck,
  BookOpen,
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  Dumbbell,
  FileText,
  Headphones,
  Home,
  Images,
  Library,
  ListChecks,
  MessageCircle,
  PlayCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DATA_VERSION, getAsset, getTopicAssets, loadAppData, publicUrl } from "./app/data";
import { useProgressStore } from "./store/progress";
import type { AppData, Asset, AudioSegment, GateCard, KnowledgeCard, Topic, TrainingUnit } from "./types";

const SAMPLE_TOPIC_ID = "T03_M1";
const LECTURE_CHAPTER_BOOKMARKS = [
  { title: "钩子", ratio: 0 },
  { title: "信号", ratio: 0.1 },
  { title: "判断", ratio: 0.22 },
  { title: "框架", ratio: 0.34 },
  { title: "拆题", ratio: 0.46 },
  { title: "陷阱", ratio: 0.78 },
  { title: "收束", ratio: 0.9 },
];
const EXPECTED_LECTURE_CHAPTERS = LECTURE_CHAPTER_BOOKMARKS.map((bookmark) => bookmark.title);
const LONG_KNOWLEDGE_CARD_LIMIT = 100;

type LectureBookmark = {
  title: string;
  seconds: number;
  endSeconds: number | null;
  estimated: boolean;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type ChapterJump = {
  section: string;
  source: "audio" | "script";
  token: number;
};

function normalizeAnswer(value: string) {
  return value.replace(/\s+/g, "").replace(/[，。；：、,.?:;]/g, "").toLowerCase();
}

function isAnswerCorrect(expected: string, submitted: string) {
  const answer = normalizeAnswer(expected);
  const guess = normalizeAnswer(submitted);
  if (!guess) return false;
  return guess === answer || guess.includes(answer) || answer.includes(guess);
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function activeBookmarkTitle(bookmarks: Array<{ title: string; seconds: number }>, currentTime: number, duration: number) {
  if (!bookmarks.length || !duration) return bookmarks[0]?.title ?? "";
  let active = bookmarks[0].title;
  for (const bookmark of bookmarks) {
    if (currentTime >= bookmark.seconds) active = bookmark.title;
  }
  return active;
}

function sourceLabel(sourceType: string) {
  const labels: Record<string, string> = {
    gate: "门禁",
    training: "训练",
    variant: "变式",
    coach: "教练",
  };
  return labels[sourceType] ?? "错因";
}

type ErrorLike = {
  topicId: string;
  unitId: string;
  tag: string;
  sourceType: "gate" | "training" | "variant" | "coach";
};

type ProgressTopics = ReturnType<typeof useProgressStore.getState>["topics"];
type ProgressErrors = ReturnType<typeof useProgressStore.getState>["errors"];
type DailyPlanItem = {
  key: string;
  priority: string;
  title: string;
  meta: string;
  to: string;
};
type DailyFocusTopic = {
  topic: Topic;
  topicOpenErrors: ProgressErrors;
  topicDueErrors: ProgressErrors;
  practiceDone: number;
  practiceTotal: number;
  score: number;
};

function nextActionForError(data: AppData, error: ErrorLike) {
  const topic = data.topics.find((item) => item.topic_id === error.topicId);
  const fallback = {
    label: "去复测",
    title: error.tag,
    meta: topic?.title ?? error.topicId,
    to: `/player/${error.topicId}#review`,
  };

  if (error.sourceType === "training") {
    const unit = data.trainingUnits.find((item) => item.unit_id === error.unitId);
    return {
      label: "重练结构",
      title: unit?.title ?? error.tag,
      meta: topic?.title ?? error.topicId,
      to: `/player/${error.topicId}#${practiceAnchorId(error.unitId)}`,
    };
  }

  if (error.sourceType === "variant") {
    const variant = data.variants.find((item) => item.variant_id === error.unitId);
    return {
      label: "重做变式",
      title: variant?.title ?? error.tag,
      meta: topic?.title ?? error.topicId,
      to: `/player/${error.topicId}#${practiceAnchorId(error.unitId)}`,
    };
  }

  if (error.sourceType === "coach") {
    const card = data.knowledgeCards.find((item) => item.card_id === error.unitId);
    return {
      label: "复测卡片",
      title: card?.front ?? error.tag,
      meta: card ? `${topic?.title ?? error.topicId} · ${card.chapter}` : topic?.title ?? error.topicId,
      to: "/cards",
    };
  }

  if (error.sourceType === "gate") {
    return {
      label: "补门禁",
      title: error.tag,
      meta: topic?.title ?? error.topicId,
      to: `/player/${error.topicId}#gate`,
    };
  }

  return fallback;
}

function buildDailyPlan(data: AppData, topicsProgress: ProgressTopics, errors: ProgressErrors) {
  const now = Date.now();
  const openErrors = errors.filter((error) => !error.resolved);
  const dueErrors = openErrors.filter((error) => new Date(error.dueAt).getTime() <= now);
  const masteredIds = new Set(
    Object.values(topicsProgress).flatMap((progress) =>
      Object.entries(progress.attempts ?? {})
        .filter(([, attempt]) => attempt.correct)
        .map(([id]) => id),
    ),
  );
  const cardErrorIds = new Set(openErrors.filter((error) => error.sourceType === "coach").map((error) => error.unitId));
  const dueCardIds = new Set(dueErrors.filter((error) => error.sourceType === "coach").map((error) => error.unitId));
  const topicPlanStats = data.topics.map((topic) => {
    const progress = topicsProgress[topic.topic_id];
    const trainingUnits = data.trainingUnits.filter((unit) => unit.topic_id === topic.topic_id);
    const variants = data.variants.filter((variant) => variant.topic_id === topic.topic_id);
    const completed = progress?.completedUnits ?? [];
    const nextUnit = trainingUnits.find((unit) => !completed.includes(unit.unit_id));
    const nextVariant = variants.find((variant) => !completed.includes(variant.variant_id));
    const topicOpenErrors = openErrors.filter((error) => error.topicId === topic.topic_id);
    const topicDueErrors = dueErrors.filter((error) => error.topicId === topic.topic_id);
    const gates = data.gateCards.filter((gate) => gate.topic_ids.includes(topic.topic_id));
    const practiceTotal = trainingUnits.length + variants.length;
    const practiceDone = [...trainingUnits.map((unit) => unit.unit_id), ...variants.map((variant) => variant.variant_id)].filter((id) => completed.includes(id)).length;
    const gateDone = progress?.gatePassed.length ?? 0;
    const score = Math.round(((practiceTotal ? practiceDone / practiceTotal : 0) * 0.7 + (gates.length ? gateDone / gates.length : 0) * 0.3) * 100);
    return { topic, nextUnit, nextVariant, topicOpenErrors, topicDueErrors, practiceDone, practiceTotal, score };
  });
  const focusTopics = [...topicPlanStats]
    .sort((a, b) => b.topicDueErrors.length - a.topicDueErrors.length || b.topicOpenErrors.length - a.topicOpenErrors.length || a.score - b.score)
    .slice(0, 3);
  const refinedCards = data.knowledgeCards.filter((card) => card.maintenance_status === "refined");
  const dueCardTasks = refinedCards.filter((card) => dueCardIds.has(card.card_id)).slice(0, 3);
  const reviewCardTasks = refinedCards.filter((card) => !masteredIds.has(card.card_id) && !cardErrorIds.has(card.card_id)).slice(0, 3);
  const planItems: DailyPlanItem[] = [
    ...dueErrors.slice(0, 4).map((error) => {
      const nextAction = nextActionForError(data, error);
      return {
        key: error.id,
        priority: "到期",
        title: nextAction.title,
        meta: `${sourceLabel(error.sourceType)} · ${nextAction.meta}`,
        to: nextAction.to,
      };
    }),
    ...dueCardTasks.map((card) => {
      const topic = data.topics.find((item) => item.topic_id === card.topic_id);
      return {
        key: `due_${card.card_id}`,
        priority: "卡片",
        title: card.front,
        meta: `${topic?.title ?? card.topic_id} · 今日复测`,
        to: "/cards",
      };
    }),
    ...focusTopics.flatMap((item) => [
      ...(item.nextUnit
        ? [
            {
              key: item.nextUnit.unit_id,
              priority: "结构",
              title: item.nextUnit.title,
              meta: `${item.topic.title} · 练习 ${item.practiceDone}/${item.practiceTotal}`,
              to: `/player/${item.topic.topic_id}#training`,
            },
          ]
        : []),
      ...(item.nextVariant
        ? [
            {
              key: item.nextVariant.variant_id,
              priority: "变式",
              title: item.nextVariant.title,
              meta: `${item.topic.title} · 迁移训练`,
              to: `/player/${item.topic.topic_id}#variants`,
            },
          ]
        : []),
    ]),
    ...reviewCardTasks.map((card) => {
      const topic = data.topics.find((item) => item.topic_id === card.topic_id);
      return {
        key: `refined_${card.card_id}`,
        priority: "精修",
        title: card.front,
        meta: `${topic?.title ?? card.topic_id} · 短答案复测`,
        to: "/cards",
      };
    }),
  ].filter((item, index, array) => array.findIndex((candidate) => candidate.key === item.key) === index).slice(0, 10);

  return {
    dueErrors,
    focusTopics: focusTopics as DailyFocusTopic[],
    reviewCardTasks,
    planItems,
    estimatedMinutes: Math.max(8, planItems.length * 3),
  };
}

function knowledgeTypeLabel(type: KnowledgeCard["type"]) {
  const labels: Record<KnowledgeCard["type"], string> = {
    signal: "信号卡",
    rule: "规则卡",
    trap: "陷阱卡",
    representative: "代表题",
    mnemonic: "口诀卡",
    recall: "回忆卡",
  };
  return labels[type];
}

function stableCardRank(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1000003;
  }
  return hash;
}

type ScriptBlock =
  | { type: "h1" | "h2" | "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "li"; text: string }
  | { type: "quote"; text: string }
  | { type: "hr"; text: string };

function inlineMarkup(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}_${index}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${part}_${index}`}>{part}</span>;
  });
}

function parseScriptMarkdown(text: string): ScriptBlock[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (/^---+$/.test(line)) return { type: "hr", text: "" };
      if (line.startsWith("### ")) return { type: "h3", text: line.slice(4).trim() };
      if (line.startsWith("## ")) return { type: "h2", text: line.slice(3).trim() };
      if (line.startsWith("# ")) return { type: "h1", text: line.slice(2).trim() };
      if (line.startsWith("- ")) return { type: "li", text: line.slice(2).trim() };
      if (line.startsWith("> ")) return { type: "quote", text: line.slice(2).trim() };
      return { type: "p", text: line };
    });
}

function scriptHeadingId(text: string) {
  return `script_${normalizeAnswer(text) || "section"}`;
}

function chapterStatusId(text: string) {
  return normalizeAnswer(text) || "section";
}

function practiceAnchorId(id: string) {
  return `practice_${normalizeAnswer(id) || "item"}`;
}

function chapterPracticeTarget(section: string, units: TrainingUnit[], variants: AppData["variants"]) {
  const triggerUnit = units.find((unit) => unit.type === "trigger_signal") ?? units[0];
  const structureUnit = units.find((unit) => unit.type === "structure") ?? units[0];
  const scoringUnit = units.find((unit) => unit.type === "scoring_expression") ?? structureUnit;
  const errorUnit = units.find((unit) => unit.type === "error_correction") ?? units[0];
  const variant = variants[0];
  const advancedVariant = variants.find((item) => item.level === "L2") ?? variant;

  if (["钩子", "信号"].includes(section) && triggerUnit) {
    return {
      href: `#${practiceAnchorId(triggerUnit.unit_id)}`,
      itemId: triggerUnit.unit_id,
      label: "练触发信号",
      title: triggerUnit.title,
      meta: "先把题面入口抓准",
    };
  }

  if (section === "判断" && structureUnit) {
    return {
      href: `#${practiceAnchorId(structureUnit.unit_id)}`,
      itemId: structureUnit.unit_id,
      label: "练判定链条",
      title: structureUnit.title,
      meta: "防止显隐和位置跳步",
    };
  }

  if (section === "框架" && scoringUnit) {
    return {
      href: `#${practiceAnchorId(scoringUnit.unit_id)}`,
      itemId: scoringUnit.unit_id,
      label: "练得分表达",
      title: scoringUnit.title,
      meta: "把框架写成阅卷语言",
    };
  }

  if (section === "拆题" && advancedVariant) {
    return {
      href: `#${practiceAnchorId(advancedVariant.variant_id)}`,
      itemId: advancedVariant.variant_id,
      label: "做代表变式",
      title: advancedVariant.title,
      meta: "把母题迁移到新材料",
    };
  }

  if (section === "陷阱" && errorUnit) {
    return {
      href: `#${practiceAnchorId(errorUnit.unit_id)}`,
      itemId: errorUnit.unit_id,
      label: "练错因纠偏",
      title: errorUnit.title,
      meta: "把典型错法当场修掉",
    };
  }

  if (section === "收束") {
    return {
      href: "#coach",
      itemId: "coach",
      label: "让教练追问",
      title: "AI 教练",
      meta: "用追问完成最后复盘",
    };
  }

  return null;
}

function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    loadAppData().then(setData).catch((err) => setError(err instanceof Error ? err.message : "数据加载失败"));
  }, [DATA_VERSION]);

  if (error) {
    return <Shell message={error} />;
  }

  if (!data) {
    return <Shell message="正在加载母题播放器..." />;
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        <Routes>
          <Route path="/" element={<TodayPage data={data} />} />
          <Route path="/plan" element={<PlanPage data={data} />} />
          <Route path="/player" element={<PlayerPage data={data} />} />
          <Route path="/player/:topicId" element={<PlayerPage data={data} />} />
          <Route path="/library" element={<LibraryPage data={data} />} />
          <Route path="/dashboard" element={<DashboardPage data={data} />} />
          <Route path="/errors" element={<ErrorsPage data={data} />} />
          <Route path="/cards" element={<KnowledgeCardsPage data={data} />} />
          <Route path="/coach" element={<CoachPage data={data} />} />
          <Route path="/coach/:topicId" element={<CoachPage data={data} />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}

function Shell({ message }: { message: string }) {
  return (
    <div className="center-shell">
      <div className="pulse-dot" />
      <p>{message}</p>
    </div>
  );
}

function BottomNav() {
  const items = [
    { to: "/", label: "调度", icon: Home },
    { to: `/player/${SAMPLE_TOPIC_ID}`, label: "播放器", icon: PlayCircle },
    { to: "/library", label: "母题库", icon: Library },
    { to: "/dashboard", label: "看板", icon: Activity },
    { to: "/errors", label: "错因", icon: RotateCcw },
    { to: "/cards", label: "卡片", icon: BookOpen },
  ];

  return (
    <nav className="bottom-nav" aria-label="底部导航">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => `bottom-tab ${isActive ? "active" : ""}`}>
            <Icon size={20} aria-hidden />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

function TodayPage({ data }: { data: AppData }) {
  const topicsProgress = useProgressStore((state) => state.topics);
  const errors = useProgressStore((state) => state.errors);
  const openErrors = errors.filter((item) => !item.resolved);
  const dueErrors = openErrors.filter((item) => new Date(item.dueAt).getTime() <= Date.now());
  const dailyPlan = buildDailyPlan(data, topicsProgress, errors);
  const sessionItems = dailyPlan.planItems.slice(0, 3);
  const lastVisitedTopicId =
    Object.entries(topicsProgress).sort((a, b) => new Date(b[1].lastVisited).getTime() - new Date(a[1].lastVisited).getTime())[0]?.[0] ??
    SAMPLE_TOPIC_ID;
  const topic = data.topics.find((item) => item.topic_id === lastVisitedTopicId) ?? data.topics[0];
  const progress = topicsProgress[topic.topic_id];
  const doneCount = progress?.completedUnits.length ?? 0;
  const gateCount = progress?.gatePassed.length ?? 0;
  const attemptedCount = Object.values(topicsProgress).reduce((sum, item) => sum + Object.keys(item.attempts ?? {}).length, 0);
  const completedCount = Object.values(topicsProgress).reduce((sum, item) => sum + item.completedUnits.length, 0);
  const totalPractice = data.trainingUnits.length + data.variants.length;
  const completionRate = totalPractice ? Math.round((completedCount / totalPractice) * 100) : 0;

  return (
    <Page>
      <Header eyebrow="今日速练" title="每日学习调度" action={<ReportBadge data={data} />} />
      <section className="hero-panel">
        <div>
          <p className="module-label">{topic.module_title}</p>
          <h2>{topic.title}</h2>
          <p>{topic.summary || "已接入完整讲稿、专题音频、记忆卡与训练入口。"}</p>
        </div>
        <Link className="primary-action" to="/plan">
          <ListChecks size={18} />
          任务单
        </Link>
      </section>

      <InstallPromptCard />
      <PwaStatusCard />

      <section className="quick-grid" aria-label="今日学习入口">
        <QuickLink to={`/player/${topic.topic_id}#memory`} icon={Images} label="图片记忆卡" value="1 张" />
        <QuickLink to={`/player/${topic.topic_id}#lecture`} icon={Headphones} label="专题讲座" value="完整 mp3" />
        <QuickLink to={`/player/${topic.topic_id}#gate`} icon={ShieldCheck} label="门禁快测" value={`${gateCount} 关`} />
        <QuickLink to={`/player/${topic.topic_id}#training`} icon={Dumbbell} label="结构训练" value={`${doneCount}/4`} />
        <QuickLink to="/cards" icon={BookOpen} label="知识卡" value={`${data.knowledgeCards.length} 张`} />
        <QuickLink to="/plan" icon={ListChecks} label="今日计划" value={`${dailyPlan.planItems.length} 项`} />
      </section>

      <section className="section-block">
        <SectionTitle icon={PlayCircle} title="10分钟速练" />
        {sessionItems.length ? (
          <div className="session-list">
            {sessionItems.map((item, index) => (
              <Link to={item.to} key={item.key}>
                <span>{index + 1}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.priority} · {item.meta}</p>
                </div>
                <ChevronRight size={18} />
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState text="暂无今日任务，先进入母题库选择一个新母题" />
        )}
      </section>

      <section className="section-block">
        <SectionTitle icon={Sparkles} title="学习闭环" />
        <div className="metric-grid">
          <div>
            <span>{attemptedCount}</span>
            <p>已提交</p>
          </div>
          <div>
            <span>{completedCount}</span>
            <p>已掌握</p>
          </div>
          <div>
            <span>{completionRate}%</span>
            <p>训练进度</p>
          </div>
          <div>
            <span>{openErrors.length}</span>
            <p>待复测</p>
          </div>
        </div>
      </section>

      <section className="section-block">
        <SectionTitle icon={CircleAlert} title="今日复测" />
        {dueErrors.length ? (
          <div className="error-stack">
            {dueErrors.slice(0, 3).map((item) => (
              <Link to={`/player/${item.topicId}#review`} key={item.id}>
                {item.tag}
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState text={openErrors.length ? "暂无今日到期错因" : "暂无待复测错因"} />
        )}
      </section>
    </Page>
  );
}

function PlanPage({ data }: { data: AppData }) {
  const topicsProgress = useProgressStore((state) => state.topics);
  const errors = useProgressStore((state) => state.errors);
  const { dueErrors, focusTopics, reviewCardTasks, planItems, estimatedMinutes } = buildDailyPlan(data, topicsProgress, errors);

  return (
    <Page>
      <Header eyebrow="今日计划" title="复测任务单" action={<span className="count-badge">{planItems.length} 项</span>} />
      <section className="hero-panel compact">
        <div>
          <p className="module-label">自动编排</p>
          <h2>{estimatedMinutes} 分钟</h2>
          <p>先清到期错因，再补低进度母题，最后用精修卡做短答案复测。</p>
        </div>
        <Link className="primary-action" to={planItems[0]?.to ?? `/player/${SAMPLE_TOPIC_ID}`}>
          <PlayCircle size={18} />
          开始
        </Link>
      </section>

      <section className="section-block">
        <SectionTitle icon={Sparkles} title="计划概览" />
        <div className="metric-grid">
          <div>
            <span>{dueErrors.length}</span>
            <p>到期错因</p>
          </div>
          <div>
            <span>{focusTopics.length}</span>
            <p>重点母题</p>
          </div>
          <div>
            <span>{reviewCardTasks.length}</span>
            <p>精修卡</p>
          </div>
          <div>
            <span>{estimatedMinutes}</span>
            <p>预计分钟</p>
          </div>
        </div>
      </section>

      <section className="section-block">
        <SectionTitle icon={ListChecks} title="执行清单" />
        {planItems.length ? (
          <div className="daily-plan">
            {planItems.map((item, index) => (
              <Link className="plan-item" to={item.to} key={item.key}>
                <span>{index + 1}</span>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.meta}</small>
                </div>
                <em>{item.priority}</em>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState text="暂无计划任务，先进入母题库选择一个新母题" />
        )}
      </section>

      <section className="section-block">
        <SectionTitle icon={Library} title="重点母题" />
        <div className="dashboard-topic-list">
          {focusTopics.map((item) => (
            <Link to={`/player/${item.topic.topic_id}`} key={item.topic.topic_id}>
              <div>
                <strong>{item.topic.title}</strong>
                <span>
                  {item.topic.topic_id} · {item.topicDueErrors.length} 到期 · 推进 {item.score}%
                </span>
              </div>
              <ChevronRight size={18} />
            </Link>
          ))}
        </div>
      </section>
    </Page>
  );
}

function PlayerPage({ data }: { data: AppData }) {
  const params = useParams();
  const topicId = params.topicId ?? SAMPLE_TOPIC_ID;
  const topic = data.topics.find((item) => item.topic_id === topicId) ?? data.topics[0];
  const assets = getTopicAssets(data, topic.topic_id);
  const memoryCard = assets.find((asset) => asset.type === "memory_card");
  const audio = assets.find((asset) => asset.type === "lecture_audio");
  const script = assets.find((asset) => asset.type === "lecture_script");
  const diagrams = topic.asset_ids
    .map((assetId) => getAsset(data, assetId))
    .filter((asset): asset is Asset => asset?.type === "diagram");
  const gates = data.gateCards.filter((gate) => gate.topic_ids.includes(topic.topic_id));
  const trainingUnits = data.trainingUnits.filter((unit) => unit.topic_id === topic.topic_id);
  const variants = data.variants.filter((variant) => variant.topic_id === topic.topic_id);
  const audioSegments = data.audioSegments.filter((segment) => segment.topic_id === topic.topic_id);
  const knowledgeCards = data.knowledgeCards.filter((card) => card.topic_id === topic.topic_id);
  const readiness = data.topicReadiness.find((item) => item.topic_id === topic.topic_id);
  const touchTopic = useProgressStore((state) => state.touchTopic);
  const [chapterJump, setChapterJump] = useState<ChapterJump | null>(null);

  useEffect(() => {
    touchTopic(topic.topic_id);
  }, [topic.topic_id, touchTopic]);

  return (
    <Page>
      <Header eyebrow={topic.module_title} title={topic.title} action={<TopicPill topic={topic} />} />
      <section className="anchor-tabs">
        <a href="#memory">图片</a>
        <a href="#lecture">讲座</a>
        <a href="#gate">门禁</a>
        <a href="#training">结构</a>
        <a href="#variants">变式</a>
        <a href="#review">错因</a>
        <a href="#coach">教练</a>
      </section>

      <StudyRail topicId={topic.topic_id} gates={gates} trainingUnits={trainingUnits} variants={variants} />

      {readiness ? <ReadinessPanel readiness={readiness} /> : null}

      <section className="section-block" id="memory">
        <SectionTitle icon={Images} title="图片记忆卡" />
        {memoryCard ? <ImageCard asset={memoryCard} /> : <EmptyState text="未找到图片记忆卡" />}
        {diagrams.length ? <DiagramStrip diagrams={diagrams} /> : null}
      </section>

      <section className="section-block" id="lecture">
        <SectionTitle icon={Headphones} title="专题讲座" />
        {audio ? (
          <AudioPlayer
            topicId={topic.topic_id}
            asset={audio}
            segments={audioSegments}
            chapterJump={chapterJump}
            onChapterJump={(section) => setChapterJump({ section, source: "audio", token: Date.now() })}
          />
        ) : (
          <EmptyState text="音频暂不可用" />
        )}
        {script ? (
          <ScriptViewer
            topicId={topic.topic_id}
            asset={script}
            trainingUnits={trainingUnits}
            variants={variants}
            knowledgeCards={knowledgeCards}
            chapterJump={chapterJump}
            onChapterJump={(section) => setChapterJump({ section, source: "script", token: Date.now() })}
          />
        ) : null}
      </section>

      <section className="section-block" id="gate">
        <SectionTitle icon={ShieldCheck} title="门禁快测" />
        <GatePractice topicId={topic.topic_id} gates={gates} />
      </section>

      <section className="section-block" id="training">
        <SectionTitle icon={Dumbbell} title="母题结构训练" />
        <TrainingPractice topicId={topic.topic_id} units={trainingUnits} />
      </section>

      <section className="section-block" id="variants">
        <SectionTitle icon={ListChecks} title="变式阶梯" />
        <VariantPractice topicId={topic.topic_id} variants={variants} />
      </section>

      <section className="section-block" id="review">
        <SectionTitle icon={RotateCcw} title="错因复测" />
        <InlineErrorReview data={data} topicId={topic.topic_id} />
      </section>

      <section className="section-block" id="coach">
        <SectionTitle icon={Brain} title="AI 教练" />
        <CoachPanel data={data} topicId={topic.topic_id} compact />
      </section>
    </Page>
  );
}

function LibraryPage({ data }: { data: AppData }) {
  const [query, setQuery] = useState("");
  const filtered = data.topics.filter((topic) => `${topic.topic_id} ${topic.title} ${topic.module_title}`.includes(query.trim()));

  return (
    <Page>
      <Header eyebrow="母题地图" title="29 个母题" action={<ReportBadge data={data} />} />
      <label className="search-box">
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索母题、模块或编号" />
      </label>
      <div className="topic-list">
        {filtered.map((topic) => (
          <TopicRow key={topic.topic_id} data={data} topic={topic} />
        ))}
      </div>
    </Page>
  );
}

function DashboardPage({ data }: { data: AppData }) {
  const topicsProgress = useProgressStore((state) => state.topics);
  const errors = useProgressStore((state) => state.errors);
  const exportProgress = useProgressStore((state) => state.exportProgress);
  const importProgress = useProgressStore((state) => state.importProgress);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [backupMessage, setBackupMessage] = useState("");
  const now = Date.now();
  const openErrors = errors.filter((error) => !error.resolved);
  const dueErrors = openErrors.filter((error) => new Date(error.dueAt).getTime() <= now);
  const resolvedErrors = errors.filter((error) => error.resolved);
  const allAttempts = Object.values(topicsProgress).flatMap((progress) => Object.values(progress.attempts ?? {}));
  const correctAttempts = allAttempts.filter((attempt) => attempt.correct);
  const refinedCards = data.knowledgeCards.filter((card) => card.maintenance_status === "refined");
  const longCards = data.knowledgeCards.filter((card) => card.back.length > LONG_KNOWLEDGE_CARD_LIMIT);
  const activeTopicIds = new Set([...Object.keys(topicsProgress), ...errors.map((error) => error.topicId)]);

  const topicStats = data.topics.map((topic) => {
    const progress = topicsProgress[topic.topic_id];
    const topicErrors = openErrors.filter((error) => error.topicId === topic.topic_id);
    const dueTopicErrors = topicErrors.filter((error) => new Date(error.dueAt).getTime() <= now);
    const topicTrainingIds = new Set([
      ...data.trainingUnits.filter((unit) => unit.topic_id === topic.topic_id).map((unit) => unit.unit_id),
      ...data.variants.filter((variant) => variant.topic_id === topic.topic_id).map((variant) => variant.variant_id),
    ]);
    const topicCards = data.knowledgeCards.filter((card) => card.topic_id === topic.topic_id);
    const topicKnowledgeIds = new Set(topicCards.map((card) => card.card_id));
    const attempts = Object.entries(progress?.attempts ?? {});
    const trainingMastered = attempts.filter(([id, attempt]) => topicTrainingIds.has(id) && attempt.correct).length;
    const cardMastered = attempts.filter(([id, attempt]) => topicKnowledgeIds.has(id) && attempt.correct).length;
    const gates = data.gateCards.filter((gate) => gate.topic_ids.includes(topic.topic_id));
    const gatePassed = progress?.gatePassed.length ?? 0;
    const chapterItems = Object.values(progress?.chapterStatus ?? {});
    const chapterDone = chapterItems.reduce((sum, item) => sum + Number(Boolean(item.read)) + Number(Boolean(item.listened)) + Number(Boolean(item.practiced)), 0);
    const chapterTotal = EXPECTED_LECTURE_CHAPTERS.length * 3;
    const practiceTotal = topicTrainingIds.size + topicKnowledgeIds.size;
    const practiceDone = trainingMastered + cardMastered;
    const gateScore = gates.length ? gatePassed / gates.length : 0;
    const practiceScore = practiceTotal ? practiceDone / practiceTotal : 0;
    const chapterScore = chapterTotal ? chapterDone / chapterTotal : 0;
    const score = Math.round(((practiceScore * 0.5 + gateScore * 0.25 + chapterScore * 0.25) || 0) * 100);

    return {
      topic,
      score,
      topicErrors,
      dueTopicErrors,
      practiceDone,
      practiceTotal,
      gatePassed,
      gateTotal: gates.length,
      chapterDone,
      chapterTotal,
      refinedCards: topicCards.filter((card) => card.maintenance_status === "refined").length,
      cardsTotal: topicCards.length,
      lastVisited: progress?.lastVisited,
    };
  });

  const moduleStats = data.topics.map((topic) => topic.module_id).filter((value, index, array) => array.indexOf(value) === index).map((moduleId) => {
    const moduleTopics = topicStats.filter((item) => item.topic.module_id === moduleId);
    const moduleTitle = moduleTopics[0]?.topic.module_title ?? moduleId;
    const avgScore = moduleTopics.length ? Math.round(moduleTopics.reduce((sum, item) => sum + item.score, 0) / moduleTopics.length) : 0;
    return {
      moduleId,
      moduleTitle,
      avgScore,
      dueCount: moduleTopics.reduce((sum, item) => sum + item.dueTopicErrors.length, 0),
      openCount: moduleTopics.reduce((sum, item) => sum + item.topicErrors.length, 0),
      topicsCount: moduleTopics.length,
    };
  });

  const pressureTopics = [...topicStats]
    .filter((item) => item.topicErrors.length || item.score > 0 || item.lastVisited)
    .sort((a, b) => b.dueTopicErrors.length - a.dueTopicErrors.length || b.topicErrors.length - a.topicErrors.length || a.score - b.score)
    .slice(0, 6);
  const nextTopics = [...topicStats]
    .filter((item) => item.score < 100)
    .sort((a, b) => b.dueTopicErrors.length - a.dueTopicErrors.length || a.score - b.score || a.topic.topic_id.localeCompare(b.topic.topic_id))
    .slice(0, 4);

  function exportBackup() {
    const payload = {
      schema_version: 1,
      app: "mother-topic-player-pwa",
      data_version: DATA_VERSION,
      exported_at: new Date().toISOString(),
      progress: exportProgress(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mother-topic-progress-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setBackupMessage("已导出");
  }

  async function importBackup(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { progress?: unknown };
      const ok = importProgress(parsed.progress ?? parsed);
      setBackupMessage(ok ? "已导入" : "导入失败");
    } catch {
      setBackupMessage("导入失败");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  return (
    <Page>
      <Header eyebrow="学习数据" title="全局看板" action={<span className="count-badge">{activeTopicIds.size}/{data.topics.length}</span>} />

      <section className="section-block">
        <SectionTitle icon={Activity} title="总览" />
        <div className="metric-grid">
          <div>
            <span>{allAttempts.length}</span>
            <p>提交记录</p>
          </div>
          <div>
            <span>{correctAttempts.length}</span>
            <p>已掌握</p>
          </div>
          <div>
            <span>{dueErrors.length}/{openErrors.length}</span>
            <p>到期/待复测</p>
          </div>
          <div>
            <span>{refinedCards.length}</span>
            <p>已精修卡</p>
          </div>
        </div>
      </section>

      <section className="section-block">
        <SectionTitle icon={Sparkles} title="质量闭环" />
        <div className="dashboard-quality">
          <div>
            <strong>{data.exportReport.knowledge_card_quality_needs_review_count ?? 0}</strong>
            <span>质量审计待处理</span>
          </div>
          <div>
            <strong>{data.exportReport.knowledge_cards_maintenance_needs_review_count ?? 0}</strong>
            <span>短答案待精修</span>
          </div>
          <div>
            <strong>{longCards.length}</strong>
            <span>长卡已纳入精修池</span>
          </div>
          <div>
            <strong>{resolvedErrors.length}</strong>
            <span>已清错因</span>
          </div>
        </div>
      </section>

      <section className="section-block">
        <SectionTitle icon={Library} title="模块热区" />
        <div className="module-dashboard">
          {moduleStats.map((module) => (
            <article key={module.moduleId}>
              <div>
                <strong>{module.moduleTitle}</strong>
                <span>{module.topicsCount} 个母题 · {module.dueCount} 个到期</span>
              </div>
              <i>
                <b style={{ width: `${module.avgScore}%` }} />
              </i>
              <small>{module.avgScore}%</small>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block">
        <SectionTitle icon={CircleAlert} title="复测压力" />
        {pressureTopics.length ? (
          <div className="dashboard-topic-list">
            {pressureTopics.map((item) => (
              <Link to={item.dueTopicErrors.length ? `/player/${item.topic.topic_id}#review` : `/player/${item.topic.topic_id}`} key={item.topic.topic_id}>
                <div>
                  <strong>{item.topic.title}</strong>
                  <span>
                    {item.topic.topic_id} · {item.dueTopicErrors.length} 到期 · {item.topicErrors.length} 待复测
                  </span>
                </div>
                <em>{item.score}%</em>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState text="暂无复测压力，先从一个母题开始速练" />
        )}
      </section>

      <section className="section-block">
        <SectionTitle icon={ListChecks} title="下一组推进" />
        <div className="dashboard-topic-list">
          {nextTopics.map((item) => (
            <Link to={`/player/${item.topic.topic_id}`} key={item.topic.topic_id}>
              <div>
                <strong>{item.topic.title}</strong>
                <span>
                  练习 {item.practiceDone}/{item.practiceTotal} · 门禁 {item.gatePassed}/{item.gateTotal} · 章节 {item.chapterDone}/{item.chapterTotal}
                </span>
              </div>
              <ChevronRight size={18} />
            </Link>
          ))}
        </div>
      </section>

      <section className="section-block">
        <SectionTitle icon={FileText} title="数据备份" />
        <div className="backup-panel">
          <button className="secondary-action" onClick={exportBackup}>
            <Download size={17} />
            导出进度
          </button>
          <button className="secondary-action" onClick={() => importInputRef.current?.click()}>
            <Upload size={17} />
            导入进度
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={(event) => importBackup(event.target.files?.[0])}
          />
          <span>{backupMessage || `${activeTopicIds.size} 个活跃母题`}</span>
        </div>
      </section>
    </Page>
  );
}

function ErrorsPage({ data }: { data: AppData }) {
  const errors = useProgressStore((state) => state.errors);
  const resolveError = useProgressStore((state) => state.resolveError);
  const reviewError = useProgressStore((state) => state.reviewError);
  const open = errors.filter((item) => !item.resolved);
  const resolved = errors.filter((item) => item.resolved);
  const due = open.filter((item) => new Date(item.dueAt).getTime() <= Date.now());

  return (
    <Page>
      <Header eyebrow="错因复测" title="复测队列" action={<span className="count-badge">{due.length}/{open.length}</span>} />
      {open.length ? (
        <div className="error-list">
          {open.map((item) => {
            const topic = data.topics.find((candidate) => candidate.topic_id === item.topicId);
            const isDue = new Date(item.dueAt).getTime() <= Date.now();
            const nextAction = nextActionForError(data, item);
            return (
              <article className="error-item" key={item.id}>
                <div>
                  <p className="module-label">
                    {sourceLabel(item.sourceType)} · {topic?.title ?? item.topicId}
                  </p>
                  <h3>{item.tag}</h3>
                  <span>
                    {isDue ? "今日到期" : `下次 ${formatShortDate(item.dueAt)}`} · 已复测 {item.reviewCount} 次
                  </span>
                  <Link className="error-next-action" to={nextAction.to}>
                    <b>{nextAction.label}</b>
                    <small>{nextAction.title}</small>
                  </Link>
                </div>
                <div className="error-actions">
                  <Link className="icon-button" to={`/player/${item.topicId}#review`} aria-label="去复测">
                    <ChevronRight size={18} />
                  </Link>
                  <button className="icon-button" onClick={() => reviewError(item.id)} aria-label="稍后复测">
                    <RotateCcw size={18} />
                  </button>
                  <button className="icon-button" onClick={() => resolveError(item.id)} aria-label="标记掌握">
                    <Check size={18} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState text="暂无待复测错因" />
      )}
      {resolved.length ? <p className="muted-line">已完成复测 {resolved.length} 条</p> : null}
    </Page>
  );
}

function KnowledgeCardsPage({ data }: { data: AppData }) {
  const [topicFilter, setTopicFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<KnowledgeCard["type"] | "all">("all");
  const [chapterFilter, setChapterFilter] = useState("all");
  const [queueFilter, setQueueFilter] = useState<"all" | "due" | "unmastered" | "queued" | "long" | "needs_review" | "refined">("all");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [randomMode, setRandomMode] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [detailRevealed, setDetailRevealed] = useState<Record<string, boolean>>({});
  const topicsProgress = useProgressStore((state) => state.topics);
  const errors = useProgressStore((state) => state.errors);
  const addError = useProgressStore((state) => state.addError);
  const submitAttempt = useProgressStore((state) => state.submitAttempt);
  const resolveError = useProgressStore((state) => state.resolveError);
  const openErrors = errors.filter((error) => !error.resolved);
  const cardTypes: Array<KnowledgeCard["type"]> = ["signal", "rule", "trap", "representative", "mnemonic", "recall"];
  const chapters = EXPECTED_LECTURE_CHAPTERS;
  const masteredIds = new Set(
    Object.values(topicsProgress).flatMap((progress) =>
      Object.entries(progress.attempts ?? {})
        .filter(([, attempt]) => attempt.correct)
        .map(([id]) => id),
    ),
  );
  const dueCardIds = new Set(
    openErrors
      .filter((error) => error.sourceType === "coach" && new Date(error.dueAt).getTime() <= Date.now())
      .map((error) => error.unitId),
  );
  const queuedCardIds = new Set(openErrors.filter((error) => error.sourceType === "coach").map((error) => error.unitId));
  const filteredCards = data.knowledgeCards.filter((card) => {
    if (topicFilter !== "all" && card.topic_id !== topicFilter) return false;
    if (typeFilter !== "all" && card.type !== typeFilter) return false;
    if (chapterFilter !== "all" && card.chapter !== chapterFilter) return false;
    if (queueFilter === "due" && !dueCardIds.has(card.card_id)) return false;
    if (queueFilter === "unmastered" && masteredIds.has(card.card_id)) return false;
    if (queueFilter === "queued" && !queuedCardIds.has(card.card_id)) return false;
    if (queueFilter === "long" && card.back.length <= LONG_KNOWLEDGE_CARD_LIMIT) return false;
    if (queueFilter === "needs_review" && card.maintenance_status !== "needs_review") return false;
    if (queueFilter === "refined" && card.maintenance_status !== "refined") return false;
    return true;
  });
  const reviewCards = useMemo(() => {
    if (!randomMode) return filteredCards;
    return [...filteredCards].sort((a, b) => stableCardRank(a.card_id) - stableCardRank(b.card_id));
  }, [filteredCards, randomMode]);
  const activeCard = reviewCards.length ? reviewCards[Math.min(reviewIndex, reviewCards.length - 1)] : null;
  const visibleMastered = filteredCards.filter((card) => masteredIds.has(card.card_id)).length;
  const visibleDue = filteredCards.filter((card) => dueCardIds.has(card.card_id)).length;

  function markMastered(card: KnowledgeCard) {
    submitAttempt(card.topic_id, card.card_id, "熟练", true);
    openErrors.filter((error) => error.unitId === card.card_id).forEach((error) => resolveError(error.id));
  }

  function rateCard(card: KnowledgeCard, rating: "生疏" | "犹豫" | "熟练") {
    if (rating === "熟练") {
      markMastered(card);
    } else {
      submitAttempt(card.topic_id, card.card_id, rating, false);
      addError(card.topic_id, card.card_id, card.review_prompt, "coach");
    }
    setRevealed({ ...revealed, [card.card_id]: false });
    if (reviewCards.length > 1) {
      setReviewIndex((value) => Math.min(value + 1, reviewCards.length - 1));
    }
  }

  useEffect(() => {
    setReviewIndex(0);
  }, [topicFilter, typeFilter, chapterFilter, queueFilter, randomMode]);

  return (
    <Page>
      <Header eyebrow="知识卡复测" title="卡片工作台" action={<span className="count-badge">{visibleMastered}/{filteredCards.length}</span>} />

      <section className="section-block">
        <SectionTitle icon={BookOpen} title="筛选" />
        <div className="filter-grid">
          <label>
            <span>母题</span>
            <select value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}>
              <option value="all">全部母题</option>
              {data.topics.map((topic) => (
                <option value={topic.topic_id} key={topic.topic_id}>
                  {topic.topic_id} {topic.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>章节</span>
            <select value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)}>
              <option value="all">全部章节</option>
              {chapters.map((chapter) => (
                <option value={chapter} key={chapter}>
                  {chapter}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="type-filter" aria-label="知识卡类型">
          <button className={typeFilter === "all" ? "active" : ""} onClick={() => setTypeFilter("all")}>
            全部
          </button>
          {cardTypes.map((type) => (
            <button className={typeFilter === type ? "active" : ""} key={type} onClick={() => setTypeFilter(type)}>
              {knowledgeTypeLabel(type)}
            </button>
          ))}
        </div>
        <div className="queue-filter" aria-label="复测范围">
          {[
            ["all", "全部"],
            ["due", "今日到期"],
            ["unmastered", "未掌握"],
            ["queued", "已入队"],
            ["long", "长卡片"],
            ["needs_review", "待精修"],
            ["refined", "已精修"],
          ].map(([key, label]) => (
            <button
              className={queueFilter === key ? "active" : ""}
              key={key}
              onClick={() => setQueueFilter(key as "all" | "due" | "unmastered" | "queued" | "long" | "needs_review" | "refined")}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="section-block">
        <SectionTitle icon={ListChecks} title="复测概览" />
        <div className="metric-grid">
          <div>
            <span>{filteredCards.length}</span>
            <p>当前卡片</p>
          </div>
          <div>
            <span>{visibleMastered}</span>
            <p>已掌握</p>
          </div>
          <div>
            <span>{visibleDue}</span>
            <p>今日到期</p>
          </div>
          <div>
            <span>{filteredCards.filter((card) => queuedCardIds.has(card.card_id)).length}</span>
            <p>队列中</p>
          </div>
        </div>
      </section>

      <section className="section-block">
        <SectionTitle icon={Sparkles} title="单卡速练" />
        {activeCard ? (
          <article className={`focus-card type-${activeCard.type}`}>
            <div className="focus-card-head">
              <div>
                <span>{reviewIndex + 1}/{reviewCards.length}</span>
                <strong>{activeCard.front}</strong>
                <small>
                  {knowledgeTypeLabel(activeCard.type)} · {activeCard.chapter}
                  {activeCard.back.length > LONG_KNOWLEDGE_CARD_LIMIT ? " · 长卡" : ""}
                  {activeCard.maintenance_status === "needs_review" ? " · 待精修" : ""}
                  {activeCard.maintenance_status === "refined" ? " · 已精修" : ""}
                </small>
              </div>
              <button className={randomMode ? "icon-button active" : "icon-button"} onClick={() => setRandomMode((value) => !value)} aria-label="随机顺序">
                <RotateCcw size={18} />
              </button>
            </div>
            {revealed[activeCard.card_id] ? (
              <div className="answer-layers">
                <p>{activeCard.short_back ?? activeCard.back}</p>
                {activeCard.detail_back && activeCard.detail_back !== (activeCard.short_back ?? activeCard.back) ? (
                  <>
                    {detailRevealed[activeCard.card_id] ? <p className="detail-answer">{activeCard.detail_back}</p> : null}
                    <button
                      className="text-button light"
                      onClick={() => setDetailRevealed({ ...detailRevealed, [activeCard.card_id]: !detailRevealed[activeCard.card_id] })}
                    >
                      {detailRevealed[activeCard.card_id] ? "收起详细" : "详细解释"}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="focus-card-controls">
              <button className="secondary-action" onClick={() => setRevealed({ ...revealed, [activeCard.card_id]: !revealed[activeCard.card_id] })}>
                <BookOpen size={17} />
                {revealed[activeCard.card_id] ? "收起答案" : "看答案"}
              </button>
              <div className="step-controls">
                <button className="icon-button" disabled={reviewIndex === 0} onClick={() => setReviewIndex((value) => Math.max(0, value - 1))} aria-label="上一张">
                  <ChevronRight className="flip-icon" size={18} />
                </button>
                <button
                  className="icon-button"
                  disabled={reviewIndex >= reviewCards.length - 1}
                  onClick={() => setReviewIndex((value) => Math.min(reviewCards.length - 1, value + 1))}
                  aria-label="下一张"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
            <div className="rating-row" aria-label="掌握反馈">
              <button onClick={() => rateCard(activeCard, "生疏")}>生疏</button>
              <button onClick={() => rateCard(activeCard, "犹豫")}>犹豫</button>
              <button onClick={() => rateCard(activeCard, "熟练")}>熟练</button>
            </div>
          </article>
        ) : (
          <EmptyState text="当前筛选下暂无可复测卡片" />
        )}
      </section>

      <section className="section-block">
        <SectionTitle icon={RotateCcw} title="连续复测" />
        {reviewCards.length ? (
          <div className="knowledge-workbench">
            {reviewCards.slice(0, 30).map((card) => {
              const topic = data.topics.find((item) => item.topic_id === card.topic_id);
              const isMastered = masteredIds.has(card.card_id);
              const isQueued = queuedCardIds.has(card.card_id);
              const isDue = dueCardIds.has(card.card_id);
              return (
                <article className={`knowledge-review-card type-${card.type}`} key={card.card_id}>
                  <div className="knowledge-review-head">
                    <div>
                      <span>{knowledgeTypeLabel(card.type)} · {card.chapter}</span>
                      <strong>{card.front}</strong>
                      <small>
                        {topic?.title ?? card.topic_id}
                        {card.back.length > LONG_KNOWLEDGE_CARD_LIMIT ? " · 长卡" : ""}
                        {card.maintenance_status === "needs_review" ? " · 待精修" : ""}
                        {card.maintenance_status === "refined" ? " · 已精修" : ""}
                      </small>
                    </div>
                    <Link className="icon-button" to={`/player/${card.topic_id}#lecture`} aria-label="回到讲稿">
                      <BookOpen size={18} />
                    </Link>
                  </div>
                  {revealed[card.card_id] ? (
                    <div className="answer-layers">
                      <p>{card.short_back ?? card.back}</p>
                      {card.detail_back && card.detail_back !== (card.short_back ?? card.back) ? (
                        <>
                          {detailRevealed[card.card_id] ? <p className="detail-answer">{card.detail_back}</p> : null}
                          <button
                            className="text-button"
                            onClick={() => setDetailRevealed({ ...detailRevealed, [card.card_id]: !detailRevealed[card.card_id] })}
                          >
                            {detailRevealed[card.card_id] ? "收起详细" : "详细解释"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="knowledge-actions">
                    <button className="text-button" onClick={() => setRevealed({ ...revealed, [card.card_id]: !revealed[card.card_id] })}>
                      {revealed[card.card_id] ? "收起答案" : "看答案"}
                    </button>
                    <button className="text-button" onClick={() => addError(card.topic_id, card.card_id, card.review_prompt, "coach")}>
                      {isQueued ? (isDue ? "今日复测中" : "已入队") : "加入复测"}
                    </button>
                    <button className="text-button" onClick={() => markMastered(card)}>
                      {isMastered ? "已掌握" : "标记掌握"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState text="当前筛选下暂无知识卡" />
        )}
      </section>
    </Page>
  );
}

function CoachPage({ data }: { data: AppData }) {
  const params = useParams();
  const topicId = params.topicId ?? SAMPLE_TOPIC_ID;
  const topic = data.topics.find((item) => item.topic_id === topicId) ?? data.topics[0];

  return (
    <Page>
      <Header eyebrow="AI 教练" title={topic.title} action={<TopicPill topic={topic} />} />
      <CoachPanel data={data} topicId={topic.topic_id} />
    </Page>
  );
}

function ReportBadge({ data }: { data: AppData }) {
  return (
    <span className="report-badge">
      <BadgeCheck size={16} />
      {data.exportReport.topics_count} 题
    </span>
  );
}

function ReadinessPanel({ readiness }: { readiness: NonNullable<AppData["topicReadiness"][number]> }) {
  const counts = readiness.asset_counts;
  const items = [
    ["记忆卡", counts.memory_card],
    ["插图", counts.diagram],
    ["音频", counts.lecture_audio],
    ["讲稿", counts.lecture_script],
    ["门禁", counts.gate_card],
  ];

  return (
    <section className="readiness-panel" aria-label="资产状态">
      <div>
        <strong>{readiness.status === "ready" ? "基础页 ready" : "待复核"}</strong>
        <span>{readiness.issues.length ? readiness.issues.join(" / ") : "资产完整，可进入播放器学习"}</span>
      </div>
      <div className="readiness-chips">
        {items.map(([label, value]) => (
          <span key={label}>
            {label} {value}
          </span>
        ))}
      </div>
    </section>
  );
}

function StudyRail({
  topicId,
  gates,
  trainingUnits,
  variants,
}: {
  topicId: string;
  gates: GateCard[];
  trainingUnits: TrainingUnit[];
  variants: AppData["variants"];
}) {
  const progress = useProgressStore((state) => state.topics[topicId]);
  const errors = useProgressStore((state) => state.errors);
  const completedUnits = progress?.completedUnits ?? [];
  const gatePassed = progress?.gatePassed ?? [];
  const variantIds = variants.map((variant) => variant.variant_id);
  const variantDone = completedUnits.filter((unitId) => variantIds.includes(unitId)).length;
  const openErrors = errors.filter((error) => error.topicId === topicId && !error.resolved);
  const dueErrors = openErrors.filter((error) => new Date(error.dueAt).getTime() <= Date.now());
  const audioStarted = (progress?.audioPosition ?? 0) > 15;
  const steps = [
    { href: "#memory", label: "图片", done: true, meta: "记忆" },
    { href: "#lecture", label: "讲座", done: audioStarted, meta: audioStarted ? "已听" : "未听" },
    { href: "#gate", label: "门禁", done: gates.length > 0 && gatePassed.length >= gates.length, meta: `${gatePassed.length}/${gates.length}` },
    {
      href: "#training",
      label: "结构",
      done: trainingUnits.length > 0 && trainingUnits.every((unit) => completedUnits.includes(unit.unit_id)),
      meta: `${trainingUnits.filter((unit) => completedUnits.includes(unit.unit_id)).length}/${trainingUnits.length}`,
    },
    { href: "#variants", label: "变式", done: variants.length > 0 && variantDone >= variants.length, meta: `${variantDone}/${variants.length}` },
    { href: "#review", label: "错因", done: dueErrors.length === 0, meta: dueErrors.length ? `${dueErrors.length} 到期` : `${openErrors.length} 个` },
    { href: "#coach", label: "教练", done: false, meta: "追问" },
  ];
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <section className="study-rail" aria-label="本轮速练">
      <div className="study-rail-head">
        <div>
          <strong>本轮速练</strong>
          <span>{doneCount}/7</span>
        </div>
        <i>
          <b style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }} />
        </i>
      </div>
      <div className="study-step-row">
        {steps.map((step) => (
          <a className={step.done ? "study-step done" : "study-step"} href={step.href} key={step.href}>
            <span>{step.label}</span>
            <small>{step.meta}</small>
          </a>
        ))}
      </div>
    </section>
  );
}

function TopicPill({ topic }: { topic: Topic }) {
  return <span className="topic-pill">{topic.topic_id}</span>;
}

function Header({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <p>{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {action}
    </header>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="page">{children}</div>;
}

function SectionTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="section-title">
      <Icon size={18} />
      <h2>{title}</h2>
    </div>
  );
}

function QuickLink({ to, icon: Icon, label, value }: { to: string; icon: LucideIcon; label: string; value: string }) {
  return (
    <Link className="quick-link" to={to}>
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </Link>
  );
}

function InstallPromptCard() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  return (
    <section className="install-card">
      <div>
        <strong>{installed ? "已安装到设备" : "PWA 原型已支持安装"}</strong>
        <p>适合放到手机桌面，用离线缓存快速打开记忆卡、音频和训练页。</p>
      </div>
      {installEvent ? (
        <button
          className="secondary-action"
          onClick={() => {
            installEvent.prompt();
            setInstallEvent(null);
          }}
        >
          <Sparkles size={17} />
          安装
        </button>
      ) : (
        <span>离线就绪</span>
      )}
    </section>
  );
}

function ImageCard({ asset }: { asset: Asset }) {
  const [open, setOpen] = useState(false);
  const imageUrl = publicUrl(asset.public_path);
  return (
    <>
      <button className="memory-card-button" onClick={() => setOpen(true)}>
        <img src={imageUrl} alt={asset.title} />
      </button>
      {open ? (
        <div className="image-modal" role="dialog" aria-modal="true">
          <button className="modal-close" onClick={() => setOpen(false)} aria-label="关闭">
            <X size={22} />
          </button>
          <img src={imageUrl} alt={asset.title} />
        </div>
      ) : null}
    </>
  );
}

function DiagramStrip({ diagrams }: { diagrams: Asset[] }) {
  const [openAsset, setOpenAsset] = useState<Asset | null>(null);

  return (
    <>
      <div className="diagram-strip">
        {diagrams.map((asset) => (
          <button className="diagram-card" key={asset.asset_id} onClick={() => setOpenAsset(asset)}>
            <img src={publicUrl(asset.public_path)} alt={asset.title} />
            <span>{asset.title}</span>
          </button>
        ))}
      </div>
      {openAsset ? (
        <div className="image-modal diagram-modal" role="dialog" aria-modal="true">
          <button className="modal-close" onClick={() => setOpenAsset(null)} aria-label="关闭">
            <X size={22} />
          </button>
          <figure>
            <img src={publicUrl(openAsset.public_path)} alt={openAsset.title} />
            <figcaption>{openAsset.title}</figcaption>
          </figure>
        </div>
      ) : null}
    </>
  );
}

function AudioPlayer({
  topicId,
  asset,
  segments,
  chapterJump,
  onChapterJump,
}: {
  topicId: string;
  asset: Asset;
  segments: AudioSegment[];
  chapterJump: ChapterJump | null;
  onChapterJump: (section: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const restoredRef = useRef(false);
  const lastSavedRef = useRef(0);
  const chapterPlaybackRef = useRef<{ title: string; endSeconds: number | null } | null>(null);
  const chapterStopTimerRef = useRef<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [chapterPlayback, setChapterPlayback] = useState<{ title: string; endSeconds: number | null } | null>(null);
  const setAudioPosition = useProgressStore((state) => state.setAudioPosition);
  const markChapterStatus = useProgressStore((state) => state.markChapterStatus);
  const chapterSegments = segments.filter((segment) => segment.end_seconds !== null || segment.title !== "完整专题讲座");
  const bookmarks: LectureBookmark[] =
    chapterSegments.length > 1
      ? chapterSegments.map((segment, index) => ({
          title: segment.title,
          seconds: segment.start_seconds,
          endSeconds: segment.end_seconds ?? chapterSegments[index + 1]?.start_seconds ?? null,
          estimated: false,
        }))
      : LECTURE_CHAPTER_BOOKMARKS.map((bookmark, index) => {
          const next = LECTURE_CHAPTER_BOOKMARKS[index + 1];
          return {
            title: bookmark.title,
            seconds: duration ? Math.floor(duration * bookmark.ratio) : 0,
            endSeconds: duration ? (next ? Math.floor(duration * next.ratio) : Math.floor(duration)) : null,
            estimated: true,
          };
        });
  const activeBookmark = activeBookmarkTitle(bookmarks, currentTime, duration);
  const alignmentMode = bookmarks.some((bookmark) => bookmark.estimated) ? "估算对齐" : "精确时间码";

  useEffect(() => {
    if (!activeBookmark || currentTime < 5) return;
    markChapterStatus(topicId, chapterStatusId(activeBookmark), { listened: true });
  }, [activeBookmark, currentTime, markChapterStatus, topicId]);

  function seekTo(seconds: number) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    setCurrentTime(seconds);
    setAudioPosition(topicId, seconds);
  }

  function clearChapterStopTimer() {
    if (!chapterStopTimerRef.current) return;
    window.clearTimeout(chapterStopTimerRef.current);
    chapterStopTimerRef.current = null;
  }

  function scheduleChapterStopTimer() {
    const audio = audioRef.current;
    const playback = chapterPlaybackRef.current;
    if (!audio || !playback?.endSeconds || audio.paused) return;
    clearChapterStopTimer();
    const remainingSeconds = Math.max(0, playback.endSeconds - audio.currentTime);
    chapterStopTimerRef.current = window.setTimeout(() => {
      const activeAudio = audioRef.current;
      const active = chapterPlaybackRef.current;
      if (!activeAudio || !active?.endSeconds) return;
      activeAudio.pause();
      activeAudio.currentTime = active.endSeconds;
      setCurrentTime(active.endSeconds);
      setAudioPosition(topicId, active.endSeconds);
      markChapterStatus(topicId, chapterStatusId(active.title), { listened: true });
      chapterPlaybackRef.current = null;
      clearChapterStopTimer();
      setChapterPlayback(null);
    }, Math.max(300, remainingSeconds * 1000));
  }

  function playChapter(bookmark: LectureBookmark) {
    if (!audioRef.current) return;
    clearChapterStopTimer();
    audioRef.current.currentTime = bookmark.seconds;
    setCurrentTime(bookmark.seconds);
    setAudioPosition(topicId, bookmark.seconds);
    const playback = { title: bookmark.title, endSeconds: bookmark.endSeconds };
    chapterPlaybackRef.current = playback;
    setChapterPlayback(playback);
    void audioRef.current.play().then(scheduleChapterStopTimer).catch(() => {
      // 浏览器可能拦截程序触发播放；保留章节结束点，用户手动播放时仍会自动暂停。
    });
  }

  useEffect(() => {
    if (!chapterJump || chapterJump.source !== "script") return;
    const target = bookmarks.find((bookmark) => bookmark.title === chapterJump.section);
    if (target) playChapter(target);
  }, [chapterJump?.token]);

  return (
    <div className="audio-box">
      <div>
        <p className="module-label">完整母题课</p>
        <h3>{asset.title}</h3>
      </div>
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        src={publicUrl(asset.public_path)}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
          if (restoredRef.current) return;
          const saved = useProgressStore.getState().topics[topicId]?.audioPosition ?? 0;
          if (saved > 0 && saved < event.currentTarget.duration - 3) {
            event.currentTarget.currentTime = saved;
            setCurrentTime(saved);
          }
          restoredRef.current = true;
          lastSavedRef.current = Math.floor(saved);
        }}
        onTimeUpdate={(event) => {
          const exactSeconds = event.currentTarget.currentTime;
          const seconds = Math.floor(exactSeconds);
          const playback = chapterPlaybackRef.current;
          if (playback?.endSeconds !== null && playback?.endSeconds !== undefined && exactSeconds >= playback.endSeconds - 0.2) {
            event.currentTarget.pause();
            event.currentTarget.currentTime = playback.endSeconds;
            setCurrentTime(playback.endSeconds);
            setAudioPosition(topicId, playback.endSeconds);
            markChapterStatus(topicId, chapterStatusId(playback.title), { listened: true });
            chapterPlaybackRef.current = null;
            clearChapterStopTimer();
            setChapterPlayback(null);
            return;
          }
          setCurrentTime(seconds);
          if (seconds > 0 && Math.abs(seconds - lastSavedRef.current) >= 10) {
            lastSavedRef.current = seconds;
            setAudioPosition(topicId, seconds);
          }
        }}
        onPause={(event) => {
          const seconds = Math.floor(event.currentTarget.currentTime);
          lastSavedRef.current = seconds;
          setAudioPosition(topicId, seconds);
          const playback = chapterPlaybackRef.current;
          if (!playback?.endSeconds || seconds < playback.endSeconds - 1) {
            chapterPlaybackRef.current = null;
            clearChapterStopTimer();
            setChapterPlayback(null);
          }
        }}
        onPlay={scheduleChapterStopTimer}
      />
      <div className="lecture-bookmarks" aria-label="讲座章节书签">
        <div>
          <strong>章节书签</strong>
          <span>{alignmentMode}</span>
        </div>
        <p className="alignment-note">
          {alignmentMode === "精确时间码"
            ? "音频按分段时间码与讲稿章节对齐，点击章节会在本章结束处暂停。"
            : "当前未提供精确章节时间码，按讲稿七段结构估算起止点；点击章节会在下一章起点暂停。"}
        </p>
        <div className="bookmark-row">
          {bookmarks.map((bookmark) => (
            <button
              className={activeBookmark === bookmark.title ? "active" : ""}
              key={bookmark.title}
              onClick={() => {
                playChapter(bookmark);
                onChapterJump(bookmark.title);
              }}
            >
              <span>{bookmark.title}</span>
              <small>
                {formatTime(bookmark.seconds)}
                {bookmark.endSeconds ? `-${formatTime(bookmark.endSeconds)}` : ""}
              </small>
            </button>
          ))}
        </div>
        {chapterPlayback ? <p className="chapter-playback-note">已选择“{chapterPlayback.title}”，播放到章节结束自动暂停。</p> : null}
      </div>
    </div>
  );
}

function ScriptViewer({
  topicId,
  asset,
  trainingUnits,
  variants,
  knowledgeCards,
  chapterJump,
  onChapterJump,
}: {
  topicId: string;
  asset: Asset;
  trainingUnits: TrainingUnit[];
  variants: AppData["variants"];
  knowledgeCards: KnowledgeCard[];
  chapterJump: ChapterJump | null;
  onChapterJump: (section: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"skim" | "full">("skim");
  const progress = useProgressStore((state) => state.topics[topicId]);
  const errors = useProgressStore((state) => state.errors);
  const markChapterStatus = useProgressStore((state) => state.markChapterStatus);
  const addError = useProgressStore((state) => state.addError);
  const [revealedCards, setRevealedCards] = useState<Record<string, boolean>>({});
  const [revealedDetails, setRevealedDetails] = useState<Record<string, boolean>>({});
  const scriptUrl = publicUrl(asset.public_path);

  useEffect(() => {
    if (!open || text) return;
    fetch(scriptUrl)
      .then((response) => response.text())
      .then(setText)
      .catch(() => setText("讲稿读取失败"));
  }, [open, scriptUrl, text]);

  const blocks = useMemo(() => parseScriptMarkdown(text), [text]);
  const visibleBlocks = blocks;
  const headings = blocks.filter((block) => block.type === "h2").map((block) => block.text);

  function statusForChapter(section: string, target: ReturnType<typeof chapterPracticeTarget>) {
    const stored = progress?.chapterStatus?.[chapterStatusId(section)] ?? {};
    const completed = progress?.completedUnits ?? [];
    const practiced = Boolean(stored.practiced || (target?.itemId && target.itemId !== "coach" && completed.includes(target.itemId)));
    const hasOpenError = target?.itemId
      ? errors.some((error) => error.topicId === topicId && !error.resolved && (target.itemId === "coach" ? error.sourceType === "coach" : error.unitId === target.itemId))
      : false;
    return {
      read: Boolean(stored.read),
      listened: Boolean(stored.listened),
      practiced,
      cleared: practiced && !hasOpenError,
    };
  }

  function scrollToSection(section: string) {
    const target = document.getElementById(scriptHeadingId(section));
    if (!target) return;
    markChapterStatus(topicId, chapterStatusId(section), { read: true });
    const container = target.closest(".script-content");
    if (container instanceof HTMLElement) {
      container.scrollTo({ top: Math.max(0, target.offsetTop - container.offsetTop - 8), behavior: "smooth" });
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function jumpToPractice(href: string) {
    const id = href.startsWith("#") ? href.slice(1) : href;
    const target = document.getElementById(id);
    if (!target) return;
    window.history.replaceState(null, "", `#${id}`);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    if (!chapterJump || chapterJump.source !== "audio") return;
    setOpen(true);
    window.setTimeout(() => scrollToSection(chapterJump.section), 80);
  }, [chapterJump?.token]);

  useEffect(() => {
    if (!chapterJump || chapterJump.source !== "audio" || !open || !text) return;
    window.setTimeout(() => scrollToSection(chapterJump.section), 80);
  }, [chapterJump?.token, open, text]);

  return (
    <div className="script-viewer">
      <button className="secondary-action" onClick={() => setOpen((value) => !value)}>
        <FileText size={17} />
        {open ? "收起讲稿" : "阅读讲稿"}
      </button>
      {open ? (
        <div className="script-reader">
          <div className="script-reader-head">
            <div>
              <span>教师专题讲稿</span>
              <strong>{asset.title}</strong>
            </div>
            <div className="script-mode-toggle" aria-label="讲稿阅读模式">
              <button className={mode === "skim" ? "active" : ""} onClick={() => setMode("skim")}>
                速读
              </button>
              <button className={mode === "full" ? "active" : ""} onClick={() => setMode("full")}>
                精读
              </button>
            </div>
          </div>

          {headings.length ? (
            <div className="script-toc" aria-label="讲稿目录">
              {headings.map((heading) => {
                const target = chapterPracticeTarget(heading, trainingUnits, variants);
                const status = statusForChapter(heading, target);
                return (
                  <button
                    className={status.read || status.listened || status.practiced ? "has-progress" : ""}
                    key={heading}
                    onClick={() => {
                      scrollToSection(heading);
                      onChapterJump(heading);
                    }}
                  >
                    <span>{heading}</span>
                    <small>{[status.listened ? "听" : "", status.read ? "读" : "", status.practiced ? "练" : ""].filter(Boolean).join(" / ") || "未开始"}</small>
                  </button>
                );
              })}
            </div>
          ) : null}

          <article className={`script-content ${mode}`}>
            {visibleBlocks.map((block, index) => {
              const key = `${block.type}_${index}_${block.text.slice(0, 16)}`;
              if (block.type === "h1") return <h3 key={key}>{block.text}</h3>;
              if (block.type === "h2") {
                const target = chapterPracticeTarget(block.text, trainingUnits, variants);
                const status = statusForChapter(block.text, target);
                const chapterCards = knowledgeCards.filter((card) => card.chapter === block.text);
                return (
                  <Fragment key={key}>
                    <h4 id={scriptHeadingId(block.text)}>{block.text}</h4>
                    <div className="chapter-status-row" aria-label={`${block.text} 章节状态`}>
                      <span className={status.listened ? "done" : ""}>已听</span>
                      <span className={status.read ? "done" : ""}>已读</span>
                      <span className={status.practiced ? "done" : ""}>已练</span>
                      <span className={status.cleared ? "done" : ""}>错因已清</span>
                    </div>
                    {target ? (
                      <a
                        className="chapter-practice-link"
                        href={target.href}
                        onClick={(event) => {
                          event.preventDefault();
                          if (target.itemId === "coach") {
                            markChapterStatus(topicId, chapterStatusId(block.text), { practiced: true });
                          }
                          jumpToPractice(target.href);
                        }}
                      >
                        <span>{target.label}</span>
                        <strong>{target.title}</strong>
                        <small>{target.meta}</small>
                      </a>
                    ) : null}
                    {chapterCards.length ? (
                      <div className="knowledge-card-strip" aria-label={`${block.text} 知识卡`}>
                        {chapterCards.slice(0, 3).map((card) => (
                          <article className={`knowledge-card type-${card.type}`} key={card.card_id}>
                            <div>
                              <span>{knowledgeTypeLabel(card.type)}</span>
                              <strong>{card.front}</strong>
                            </div>
                            {revealedCards[card.card_id] ? (
                              <div className="answer-layers">
                                <p>{card.short_back ?? card.back}</p>
                                {card.detail_back && card.detail_back !== (card.short_back ?? card.back) ? (
                                  <>
                                    {revealedDetails[card.card_id] ? <p className="detail-answer">{card.detail_back}</p> : null}
                                    <button
                                      className="text-button"
                                      onClick={() => setRevealedDetails({ ...revealedDetails, [card.card_id]: !revealedDetails[card.card_id] })}
                                    >
                                      {revealedDetails[card.card_id] ? "收起详细" : "详细解释"}
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            ) : null}
                            <div className="knowledge-actions">
                              <button
                                className="text-button"
                                onClick={() => setRevealedCards({ ...revealedCards, [card.card_id]: !revealedCards[card.card_id] })}
                              >
                                {revealedCards[card.card_id] ? "收起" : "看答案"}
                              </button>
                              <button
                                className="text-button"
                                onClick={() => addError(topicId, card.card_id, card.review_prompt, "coach")}
                              >
                                加入复测
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </Fragment>
                );
              }
              if (block.type === "h3") return <h5 key={key}>{block.text}</h5>;
              if (block.type === "li") return <p className="script-list" key={key}>{inlineMarkup(block.text)}</p>;
              if (block.type === "quote") return <blockquote key={key}>{inlineMarkup(block.text)}</blockquote>;
              if (block.type === "hr") return <hr key={key} />;
              return <p key={key}>{inlineMarkup(block.text)}</p>;
            })}
          </article>
        </div>
      ) : null}
    </div>
  );
}

function GatePractice({ topicId, gates }: { topicId: string; gates: GateCard[] }) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const passGate = useProgressStore((state) => state.passGate);
  const progress = useProgressStore((state) => state.topics[topicId]);
  const passed = progress?.gatePassed ?? [];

  if (!gates.length) return <EmptyState text="该母题门禁题待抽取" />;

  return (
    <div className="practice-stack">
      {gates.map((gate) => (
        <article className="practice-item" key={gate.gate_id}>
          <div className="practice-head">
            <span>{gate.gate_id}</span>
            <h3>{gate.title}</h3>
            {passed.includes(gate.gate_id) ? <Check size={18} /> : null}
          </div>
          {gate.quiz_items.slice(0, 2).map((quiz) => (
            <div className="quiz-row" key={quiz.quiz_id}>
              <p>{quiz.prompt}</p>
              {revealed[quiz.quiz_id] ? <strong>{quiz.answer}</strong> : null}
              <button className="text-button" onClick={() => setRevealed({ ...revealed, [quiz.quiz_id]: !revealed[quiz.quiz_id] })}>
                {revealed[quiz.quiz_id] ? "隐藏" : "看标准"}
              </button>
            </div>
          ))}
          <button className="secondary-action" onClick={() => passGate(topicId, gate.gate_id)}>
            <ShieldCheck size={17} />
            通过本关
          </button>
        </article>
      ))}
    </div>
  );
}

function TrainingPractice({ topicId, units }: { topicId: string; units: TrainingUnit[] }) {
  const progress = useProgressStore((state) => state.topics[topicId]);
  const completed = progress?.completedUnits ?? [];
  const attempts = progress?.attempts ?? {};
  const submitAttempt = useProgressStore((state) => state.submitAttempt);
  const addError = useProgressStore((state) => state.addError);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  if (!units.length) return <EmptyState text="该母题结构训练待抽取" />;

  return (
    <div className="practice-stack">
      {units.map((unit) => {
        const answer = answers[unit.unit_id];
        const attempt = attempts[unit.unit_id];
        const expectedAnswers = [unit.answer, ...(unit.expected_answer ?? [])].filter(Boolean);
        const isCorrect = expectedAnswers.some((expected) => isAnswerCorrect(expected, answer ?? ""));
        return (
          <article className="practice-item" id={practiceAnchorId(unit.unit_id)} key={unit.unit_id}>
            <div className="practice-head">
              <span>{unit.type}</span>
              <h3>{unit.title}</h3>
              {completed.includes(unit.unit_id) ? <Check size={18} /> : null}
            </div>
            <p>{unit.prompt}</p>
            {unit.options?.length ? (
              <div className="option-grid">
                {unit.options.map((option) => (
                  <button
                    className={answer === option ? "option selected" : "option"}
                    key={option}
                    onClick={() => setAnswers({ ...answers, [unit.unit_id]: option })}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : (
              <textarea
                value={answer ?? ""}
                onChange={(event) => setAnswers({ ...answers, [unit.unit_id]: event.target.value })}
                placeholder="写一句得分表达"
              />
            )}
            <div className="action-row">
              <button
                className="secondary-action"
                disabled={!answer?.trim()}
                onClick={() => {
                  submitAttempt(topicId, unit.unit_id, answer ?? "", isCorrect);
                  setRevealed({ ...revealed, [unit.unit_id]: true });
                  if (!isCorrect && unit.error_tags[0]) addError(topicId, unit.unit_id, unit.error_tags[0], "training");
                }}
              >
                <Check size={17} />
                提交判断
              </button>
              <button className="text-button" onClick={() => setRevealed({ ...revealed, [unit.unit_id]: !revealed[unit.unit_id] })}>
                {revealed[unit.unit_id] ? "收起解析" : "看解析"}
              </button>
            </div>
            {attempt ? (
              <div className={attempt.correct ? "feedback-box correct" : "feedback-box wrong"}>
                <strong>{attempt.correct ? "判断正确，已计入掌握" : "需要复测，已加入错因队列"}</strong>
                <p>你的答案：{attempt.answer}</p>
              </div>
            ) : null}
            {revealed[unit.unit_id] ? (
              <div className="answer-box">
                <strong>{unit.answer}</strong>
                <p>{unit.explanation}</p>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function VariantPractice({ topicId, variants }: { topicId: string; variants: Array<{ variant_id: string; level: string; title: string; stem: string; answer: string; explanation: string; transfer_point: string; source_ref?: string }> }) {
  const addError = useProgressStore((state) => state.addError);
  const submitAttempt = useProgressStore((state) => state.submitAttempt);
  const progress = useProgressStore((state) => state.topics[topicId]);
  const attempts = progress?.attempts ?? {};
  const [openId, setOpenId] = useState<string | null>(variants[0]?.variant_id ?? null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  if (!variants.length) return <EmptyState text="该母题变式阶梯待抽取" />;

  return (
    <div className="variant-list">
      {variants.map((variant) => (
        <article className="variant-item" id={practiceAnchorId(variant.variant_id)} key={variant.variant_id}>
          <button className="variant-title" onClick={() => setOpenId(openId === variant.variant_id ? null : variant.variant_id)}>
            <span>{variant.level}</span>
            <strong>{variant.title}</strong>
            <ChevronRight size={18} />
          </button>
          {openId === variant.variant_id ? (
            <div className="variant-body">
              <p>{variant.stem}</p>
              <textarea
                value={answers[variant.variant_id] ?? ""}
                onChange={(event) => setAnswers({ ...answers, [variant.variant_id]: event.target.value })}
                placeholder="先写出判定、推理链或关键词，再对照答案"
              />
              <div className="action-row">
                <button
                  className="secondary-action"
                  onClick={() => submitAttempt(topicId, variant.variant_id, answers[variant.variant_id] ?? "自评掌握", true)}
                >
                  <Check size={17} />
                  已掌握
                </button>
                <button className="secondary-action danger" onClick={() => addError(topicId, variant.variant_id, variant.transfer_point, "variant")}>
                  <CircleAlert size={17} />
                  加入错因
                </button>
              </div>
              {attempts[variant.variant_id] ? (
                <div className="feedback-box correct">
                  <strong>已记录为掌握</strong>
                  <p>{attempts[variant.variant_id].answer}</p>
                </div>
              ) : null}
              <div className="answer-box">
                <strong>{variant.answer}</strong>
                <p>{variant.explanation}</p>
                <em>{variant.transfer_point}</em>
              </div>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function InlineErrorReview({ data, topicId }: { data: AppData; topicId: string }) {
  const allErrors = useProgressStore((state) => state.errors);
  const errors = allErrors.filter((item) => item.topicId === topicId && !item.resolved);
  const resolveError = useProgressStore((state) => state.resolveError);
  const reviewError = useProgressStore((state) => state.reviewError);
  if (!errors.length) return <EmptyState text="本母题暂无待复测错因" />;
  return (
    <div className="error-stack">
      {errors.map((error) => {
        const nextAction = nextActionForError(data, error);
        return (
          <div className="inline-error" key={error.id}>
            <div>
              <strong>{error.tag}</strong>
              <span>
                {sourceLabel(error.sourceType)} · {new Date(error.dueAt).getTime() <= Date.now() ? "今日到期" : `下次 ${formatShortDate(error.dueAt)}`}
              </span>
              <Link className="error-next-action" to={nextAction.to}>
                <b>{nextAction.label}</b>
                <small>{nextAction.title}</small>
              </Link>
            </div>
            <div className="error-actions">
              <button className="icon-button" onClick={() => reviewError(error.id)} aria-label="延后复测">
                <RotateCcw size={18} />
              </button>
              <button className="icon-button" onClick={() => resolveError(error.id)} aria-label="完成复测">
                <Check size={18} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CoachPanel({ data, topicId, compact = false }: { data: AppData; topicId: string; compact?: boolean }) {
  const rule = data.coachRules.find((item) => item.topic_id === topicId);
  const training = data.trainingUnits.filter((item) => item.topic_id === topicId);
  const [mode, setMode] = useState<"stuck" | "hint" | "next">("hint");
  const [activePrompt, setActivePrompt] = useState("");
  const [coachAnswer, setCoachAnswer] = useState("");
  const addError = useProgressStore((state) => state.addError);

  if (!rule) return <EmptyState text="该母题 AI 教练规则待抽取" />;

  return (
    <div className="coach-panel">
      <div className="segmented">
        {[
          ["hint", "提示"],
          ["stuck", "卡住"],
          ["next", "下一步"],
        ].map(([key, label]) => (
          <button key={key} className={mode === key ? "active" : ""} onClick={() => setMode(key as "stuck" | "hint" | "next")}>
            {label}
          </button>
        ))}
      </div>
      <div className="coach-bubble">
        <Brain size={20} />
        <p>{activePrompt || rule.fixed_feedback[mode]}</p>
      </div>
      <div className="prompt-list">
        {rule.diagnostic_prompts.map((prompt) => (
          <button key={prompt} className={activePrompt === prompt ? "active" : ""} onClick={() => setActivePrompt(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
      {activePrompt ? (
        <div className="coach-answer-box">
          <textarea value={coachAnswer} onChange={(event) => setCoachAnswer(event.target.value)} placeholder="把学生的回答或卡点记在这里" />
          <div className="action-row">
            <button
              className="secondary-action"
              onClick={() => {
                setMode("hint");
                setActivePrompt("");
                setCoachAnswer("");
              }}
            >
              <Sparkles size={17} />
              给提示
            </button>
            <button
              className="secondary-action danger"
              onClick={() => addError(topicId, `coach_${normalizeAnswer(activePrompt).slice(0, 20)}`, activePrompt, "coach")}
            >
              <CircleAlert size={17} />
              记录薄弱点
            </button>
          </div>
        </div>
      ) : null}
      {!compact ? (
        <section className="section-block flat">
          <SectionTitle icon={BookOpen} title="可调用训练" />
          {training.map((unit) => (
            <p className="coach-ref" key={unit.unit_id}>{unit.title}</p>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function PwaStatusCard() {
  const [online, setOnline] = useState(navigator.onLine);
  const [workerState, setWorkerState] = useState(import.meta.env.DEV ? "开发模式" : "检测中");

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    if ("serviceWorker" in navigator && !import.meta.env.DEV) {
      navigator.serviceWorker.ready
        .then((registration) => {
          setWorkerState(registration.active ? "已启用" : "待刷新");
        })
        .catch(() => setWorkerState("不可用"));
    }
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  return (
    <section className="pwa-status-card">
      <div>
        <strong>离线缓存</strong>
        <p>{workerState}</p>
      </div>
      <span>{online ? "在线" : "离线"}</span>
    </section>
  );
}

function TopicRow({ data, topic }: { data: AppData; topic: Topic }) {
  const assets = useMemo(() => getTopicAssets(data, topic.topic_id), [data, topic.topic_id]);
  const hasAudio = assets.some((asset) => asset.type === "lecture_audio");
  const hasMemory = assets.some((asset) => asset.type === "memory_card");
  const readiness = data.topicReadiness.find((item) => item.topic_id === topic.topic_id);
  const progress = useProgressStore((state) => state.topics[topic.topic_id]);
  const percent = Math.min(100, ((progress?.completedUnits.length ?? 0) / 4) * 100);

  return (
    <Link className="topic-row" to={`/player/${topic.topic_id}`}>
      <div>
        <span>{topic.topic_id}</span>
        <h3>{topic.title}</h3>
        <p>{topic.module_title}</p>
      </div>
      <div className="topic-row-meta">
        {hasMemory ? <Images size={16} /> : null}
        {hasAudio ? <Headphones size={16} /> : null}
        <span className={readiness?.status === "ready" ? "mini-status ready" : "mini-status review"}>
          {readiness?.status === "ready" ? "ready" : "review"}
        </span>
        <i style={{ width: `${percent}%` }} />
      </div>
    </Link>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <CircleAlert size={18} />
      <p>{text}</p>
    </div>
  );
}

export default App;
