import type {
  AppData,
  Asset,
  AudioSegment,
  CoachRule,
  ExportReport,
  GateCard,
  KnowledgeCard,
  Topic,
  TopicReadiness,
  TrainingUnit,
  Variant,
} from "../types";

export const DATA_VERSION = "20260612-mobile-audio-lazy";

export function publicUrl(path: string): string {
  const cleanPath = path.replace(/^\/+/, "");
  const base = import.meta.env.BASE_URL || "/";
  if (base === "/") return `/${cleanPath}`;
  return `${base.replace(/\/$/, "")}/${cleanPath}`;
}

async function getJson<T>(path: string): Promise<T> {
  const target = publicUrl(path);
  const separator = target.includes("?") ? "&" : "?";
  const response = await fetch(`${target}${separator}v=${DATA_VERSION}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`无法读取 ${path}`);
  }
  return response.json() as Promise<T>;
}

export async function loadAppData(): Promise<AppData> {
  const [topics, assets, gateCards, trainingUnits, variants, coachRules, audioSegments, knowledgeCards, exportReport, topicReadiness] = await Promise.all([
    getJson<Topic[]>("/data/topics.json"),
    getJson<Asset[]>("/data/assets.json"),
    getJson<GateCard[]>("/data/gate_cards.json"),
    getJson<TrainingUnit[]>("/data/training_units.json"),
    getJson<Variant[]>("/data/variants.json"),
    getJson<CoachRule[]>("/data/coach_rules.json"),
    getJson<AudioSegment[]>("/data/audio_segments.json"),
    getJson<KnowledgeCard[]>("/data/knowledge_cards.json"),
    getJson<ExportReport>("/data/export_report.json"),
    getJson<TopicReadiness[]>("/data/topic_readiness_report.json"),
  ]);

  return {
    topics,
    assets,
    gateCards,
    trainingUnits,
    variants,
    coachRules,
    audioSegments,
    knowledgeCards,
    exportReport,
    topicReadiness,
  };
}

export function getTopicAssets(data: AppData, topicId: string) {
  return data.assets.filter((asset) => asset.topic_id === topicId);
}

export function getAsset(data: AppData, assetId: string) {
  return data.assets.find((asset) => asset.asset_id === assetId);
}
