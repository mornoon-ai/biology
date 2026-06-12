export type Topic = {
  topic_id: string;
  title: string;
  module_id: string;
  module_title: string;
  summary: string;
  trigger_signals: string[];
  core_mechanism: string[];
  exam_focus: string[];
  common_errors: string[];
  asset_ids: string[];
  gate_ids: string[];
  training_unit_ids: string[];
  coach_rule_ids: string[];
  status: "ready" | "needs_review" | "missing";
};

export type Asset = {
  asset_id: string;
  topic_id?: string;
  related_topic_ids?: string[];
  type: "memory_card" | "diagram" | "lecture_audio" | "lecture_script" | "html_prototype" | "teacher_note";
  title: string;
  source_path: string;
  public_path: string;
  format: string;
  status: "ready" | "needs_review" | "missing";
  notes?: string;
};

export type GateCard = {
  gate_id: string;
  topic_ids: string[];
  title: string;
  prerequisite: string;
  check_items: string[];
  quiz_items: Array<{
    quiz_id: string;
    type: string;
    prompt: string;
    answer: string;
  }>;
  remediation: string[];
};

export type TrainingUnit = {
  unit_id: string;
  topic_id: string;
  type: "structure" | "trigger_signal" | "mechanism_chain" | "scoring_expression" | "error_correction";
  title: string;
  prompt: string;
  expected_answer: string[];
  options?: string[];
  answer: string;
  explanation: string;
  error_tags: string[];
};

export type Variant = {
  variant_id: string;
  topic_id: string;
  level: "L1" | "L2" | "L3" | "L4" | "L5";
  title: string;
  stem: string;
  choices?: string[];
  answer: string;
  explanation: string;
  transfer_point: string;
  source_ref?: string;
};

export type CoachRule = {
  coach_rule_id: string;
  topic_id: string;
  title: string;
  diagnostic_prompts: string[];
  fixed_feedback: {
    stuck: string;
    hint: string;
    next: string;
  };
};

export type AudioSegment = {
  segment_id: string;
  topic_id: string;
  asset_id: string;
  title: string;
  start_seconds: number;
  end_seconds: number | null;
  tags: string[];
};

export type KnowledgeCard = {
  card_id: string;
  topic_id: string;
  chapter: string;
  type: "signal" | "rule" | "trap" | "representative" | "mnemonic" | "recall";
  front: string;
  short_back?: string;
  back: string;
  detail_back?: string;
  maintenance_status?: "ready" | "needs_review" | "refined";
  maintenance_issues?: string[];
  override_source?: "auto" | "manual";
  review_prompt: string;
  source: string;
};

export type ExportReport = {
  topics_count: number;
  memory_cards_count: number;
  diagrams_count: number;
  audio_count: number;
  scripts_count: number;
  gate_cards_count: number;
  coach_cards_count: number;
  html_prototypes_count: number;
  training_units_count?: number;
  variants_count?: number;
  coach_rules_count?: number;
  knowledge_cards_count?: number;
  long_knowledge_cards_count?: number;
  knowledge_card_overrides_count?: number;
  knowledge_cards_refined_count?: number;
  knowledge_cards_maintenance_needs_review_count?: number;
  unmatched_count: number;
  needs_review_count: number;
  learning_needs_review_count?: number;
  chapter_mapping_needs_review_count?: number;
  knowledge_card_quality_needs_review_count?: number;
};

export type TopicReadiness = {
  topic_id: string;
  title: string;
  status: "ready" | "needs_review";
  asset_counts: {
    memory_card: number;
    diagram: number;
    lecture_audio: number;
    lecture_script: number;
    html_prototype: number;
    gate_card: number;
  };
  gate_ids: string[];
  issues: string[];
};

export type AppData = {
  topics: Topic[];
  assets: Asset[];
  gateCards: GateCard[];
  trainingUnits: TrainingUnit[];
  variants: Variant[];
  coachRules: CoachRule[];
  audioSegments: AudioSegment[];
  knowledgeCards: KnowledgeCard[];
  exportReport: ExportReport;
  topicReadiness: TopicReadiness[];
};
