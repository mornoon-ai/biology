import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cardsPath = path.join(root, "public/data/knowledge_cards.json");
const topicsPath = path.join(root, "public/data/topics.json");

const cards = JSON.parse(fs.readFileSync(cardsPath, "utf8"));
const topics = JSON.parse(fs.readFileSync(topicsPath, "utf8"));
const topicMap = new Map(topics.map((topic) => [topic.topic_id, topic]));

const typeLabels = {
  signal: "信号",
  rule: "规则",
  trap: "陷阱",
  representative: "代表",
  mnemonic: "口诀",
  recall: "回忆",
};

const expectedTypesByChapter = {
  钩子: ["recall"],
  信号: ["signal", "recall"],
  判断: ["rule", "trap", "recall"],
  框架: ["rule", "mnemonic", "recall"],
  拆题: ["representative", "rule", "recall"],
  陷阱: ["trap", "recall"],
  收束: ["recall", "mnemonic"],
};

function compact(value = "") {
  return value.replace(/[\s，。；：、,.?:;！!"“”‘’——-]/g, "");
}

function prefixSimilarity(left = "", right = "") {
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) return 0;
  const min = Math.min(a.length, b.length);
  const max = Math.max(a.length, b.length);
  let same = 0;
  for (let index = 0; index < min; index += 1) {
    if (a[index] === b[index]) same += 1;
  }
  return same / max;
}

function answerCore(card) {
  return `${card.short_back ?? ""}\n${card.back ?? ""}\n${card.detail_back ?? ""}`;
}

function hasFrameworkLanguage(text) {
  return /信号|判断|框架|步骤|先|再|最后|推理链|模型|母题|迁移|题干|问法|排除|一票否决|条件|结论|得分|关键词|流程|路径|公式|比例|变量|对照/.test(text);
}

function hasActionInstruction(text) {
  return /看到|判断|先|再|圈|找|排除|写出|比较|代入|计算|验证|注意|不要|不能|必须|问|答|推出|锁定|识别/.test(text);
}

function tooVague(text = "") {
  const trimmed = text.trim();
  return trimmed.length < 18 || /^(第一道母题|第二道母题|判断属于哪一类|在题目里，你怎么知道|同学们|考题：?)$/.test(trimmed);
}

function auditCard(card) {
  const issues = [];
  const full = `${card.front}\n${answerCore(card)}`;
  const answer = card.back ?? "";
  const frontWithoutLabel = card.front.replace(/^.*?：/, "");
  const expectedTypes = expectedTypesByChapter[card.chapter] ?? [];
  const typeLabel = typeLabels[card.type];

  if (expectedTypes.length && !expectedTypes.includes(card.type)) issues.push("类型与章节功能不匹配");
  if (typeLabel && card.type !== "recall" && !card.front.includes(typeLabel)) issues.push("卡片名称/类型标签不显性");
  if (prefixSimilarity(frontWithoutLabel, answer) > 0.72 || prefixSimilarity(card.short_back ?? "", answer) > 0.92) issues.push("正反面重复或答案未加工");
  if (tooVague(answer) || tooVague(card.short_back ?? answer)) issues.push("答案过短/过泛，不能独立训练");
  if (!hasFrameworkLanguage(full)) issues.push("缺少母题框架语言");
  if (!hasActionInstruction(full)) issues.push("缺少解题动作指令");
  if (card.type === "signal" && !/题|信号|看到|出现|问法|关键词|格式|条件|材料/.test(full)) issues.push("信号卡未说明识别线索");
  if (card.type === "rule" && !/规则|步骤|先|再|判断|推出|公式|比例|路径|模型|链/.test(full)) issues.push("规则卡未形成判断规则");
  if (card.type === "trap" && !/错|陷阱|不要|不能|混|误|漏|跳|反|只看|以为/.test(full)) issues.push("陷阱卡未指出易错点");
  if (card.type === "representative" && !/迁移|母题|考题|例题|材料|应用|对应|变式|问/.test(full)) issues.push("代表题卡未体现迁移应用");

  return {
    card_id: card.card_id,
    topic_id: card.topic_id,
    topic_title: topicMap.get(card.topic_id)?.title ?? card.topic_id,
    chapter: card.chapter,
    type: card.type,
    maintenance_status: card.maintenance_status ?? "ready",
    issue_count: issues.length,
    issues,
    front: card.front,
    back: card.back,
  };
}

const audited = cards.map(auditCard);
const issueCards = audited.filter((card) => card.issue_count > 0);

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key];
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

const summary = {
  total_cards: cards.length,
  issue_cards: issueCards.length,
  clean_cards: cards.length - issueCards.length,
  by_type: countBy(cards, "type"),
  issue_by_type: countBy(issueCards, "type"),
  issue_by_chapter: countBy(issueCards, "chapter"),
  top_issues: issueCards
    .sort((left, right) => right.issue_count - left.issue_count || left.card_id.localeCompare(right.card_id))
    .slice(0, 30),
};

console.log(JSON.stringify({ summary, issue_cards: issueCards }, null, 2));
