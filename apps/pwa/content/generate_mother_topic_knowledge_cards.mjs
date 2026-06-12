import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(appRoot, "../..");
const dataDir = path.join(appRoot, "public/data");
const topicDir = path.join(projectRoot, "📂 20_学习专题/母题综合卡");
const highScoreDir = path.join(projectRoot, "📂 生物考前高分包");

const topics = JSON.parse(fs.readFileSync(path.join(dataDir, "topics.json"), "utf8"));
const existingCards = JSON.parse(fs.readFileSync(path.join(dataDir, "knowledge_cards.json"), "utf8"));
const preservedManualTopicIds = new Set(["T03_M1"]);

function clean(value = "") {
  return value.replace(/\[\[|\]\]/g, "").replace(/\s+/g, " ").trim();
}

function sentence(value = "", fallback = "") {
  const text = clean(value || fallback);
  return text.length > 0 ? text : fallback;
}

function getBlock(text, start, endMarkers) {
  const startIndex = text.indexOf(start);
  if (startIndex < 0) return "";
  const rest = text.slice(startIndex + start.length);
  const endIndexes = endMarkers.map((marker) => rest.indexOf(marker)).filter((index) => index >= 0);
  const endIndex = endIndexes.length ? Math.min(...endIndexes) : rest.length;
  return rest.slice(0, endIndex).trim();
}

function listItems(block) {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => clean(line.replace(/^- /, "").replace(/^".*"$/, (match) => match.slice(1, -1))))
    .filter(Boolean);
}

function tableRows(block) {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !line.includes("---"))
    .slice(1)
    .map((line) => line.split("|").map((cell) => clean(cell)).filter(Boolean))
    .filter((cells) => cells.length >= 2);
}

function parseStructuredList(block) {
  const items = [];
  let current = null;
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    const idMatch = line.match(/^-\s+(\w+_id|variant_id):\s*(.+)$/);
    if (idMatch) {
      if (current) items.push(current);
      current = { [idMatch[1]]: clean(idMatch[2]) };
      continue;
    }
    if (!current) continue;
    const fieldMatch = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (fieldMatch) {
      current[fieldMatch[1]] = clean(fieldMatch[2].replace(/^['"]|['"]$/g, ""));
    }
  }
  if (current) items.push(current);
  return items;
}

function parseTopicDoc(topic) {
  const file = fs.readdirSync(topicDir).find((name) => name.startsWith(`${topic.topic_id}_`) && name.endsWith(".md"));
  if (!file) throw new Error(`Missing mother topic doc for ${topic.topic_id}`);
  const source = path.join("📂 20_学习专题/母题综合卡", file);
  const text = fs.readFileSync(path.join(topicDir, file), "utf8");

  const triggerBlock = getBlock(text, "trigger_signals:", ["mother_questions:", "variants:", "common_errors:", "---\n#"]);
  const motherBlock = getBlock(text, "mother_questions:", ["variants:", "common_errors:", "self_check:", "---\n#"]);
  const variantBlock = getBlock(text, "variants:", ["common_errors:", "self_check:", "related_topics:", "---\n#"]);
  const errorBlock = getBlock(text, "common_errors:", ["self_check:", "related_topics:", "---\n#"]);
  const selfCheckBlock = getBlock(text, "self_check:", ["related_topics:", "status:", "---\n#"]);
  const mechanismBlock = getBlock(text, "## §2 核心机制", ["## §3", "## §4", "## §5"]);
  const strategyBlock = getBlock(text, "## §7 综合大题应对策略", ["## §8", "## §9"]);

  const triggerItems = listItems(triggerBlock);
  const motherQuestions = parseStructuredList(motherBlock);
  const variants = parseStructuredList(variantBlock);
  const errors = parseStructuredList(errorBlock);
  const selfChecks = listItems(selfCheckBlock);
  const mechanismRows = tableRows(mechanismBlock);

  return {
    source,
    triggerItems,
    motherQuestions,
    variants,
    errors,
    selfChecks,
    mechanismText: clean(mechanismBlock.replace(/```text|```|[#>|-]/g, " ")),
    mechanismRows,
    strategyText: clean(strategyBlock.replace(/[#>|-]/g, " ")),
  };
}

function highScoreSource(topicId, folder, suffix) {
  const dir = path.join(highScoreDir, folder);
  if (!fs.existsSync(dir)) return null;
  const file = fs.readdirSync(dir).find((name) => name.startsWith(`${topicId}_`) && name.endsWith(suffix));
  return file ? path.join("📂 生物考前高分包", folder, file) : null;
}

function sourceFor(topicId, kind, fallback) {
  const mapping = {
    trigger: ["01_审题触发卡", "_触发卡.md"],
    mechanism: ["02_核心机制链卡", "_机制链.md"],
    procedure: ["03_解题程序卡", "_程序卡.md"],
    scoring: ["04_得分表达卡", "_得分句.md"],
    training: ["06_母题子训练", "_母题子训练.md"],
    variant: ["07_限时变式题", "_限时变式.md"],
  };
  const [folder, suffix] = mapping[kind] ?? [];
  return folder ? highScoreSource(topicId, folder, suffix) ?? fallback : fallback;
}

function card(topic, doc, suffix, chapter, type, front, shortBack, back, detailBack, sourceKind) {
  return {
    card_id: `${topic.topic_id}_${suffix}`,
    topic_id: topic.topic_id,
    chapter,
    type,
    front,
    short_back: shortBack,
    back,
    detail_back: detailBack,
    maintenance_status: "refined",
    maintenance_issues: [],
    override_source: "mother_topic_sample",
    review_prompt: `不看讲稿，回答“${topic.title}”中这张${chapter}卡的核心动作。`,
    source: sourceFor(topic.topic_id, sourceKind, doc.source),
  };
}

function makeCards(topic) {
  const doc = parseTopicDoc(topic);
  const mq1 = doc.motherQuestions[0] ?? {};
  const mq2 = doc.motherQuestions[1] ?? mq1;
  const mq3 = doc.motherQuestions[2] ?? mq2;
  const err1 = doc.errors[0] ?? {};
  const err2 = doc.errors[1] ?? err1;
  const v1 = doc.variants[0] ?? {};
  const v2 = doc.variants[1] ?? v1;
  const signals = doc.triggerItems.slice(0, 8).join("、");
  const selfCheck = doc.selfChecks.slice(0, 3).join("；");
  const mechanism = doc.mechanismText || `${topic.title} 的核心是把题面信号转成母题动作，再用证据链推出结论。`;
  const strategy = doc.strategyText || `启动：识别题面信号 -> 对应母题框架 -> 写出关键证据 -> 输出得分结论。`;

  return [
    card(
      topic,
      doc,
      "钩子_01",
      "钩子",
      "recall",
      `钩子：${topic.title} 这类母题最先抓什么，不能先做什么？`,
      `先抓题面信号和任务问法，再启动母题框架；不能先背零散知识或直接猜结论。`,
      `${topic.title} 的第一动作是把题面中的信号、材料、图表或问法圈出来，判断它进入哪个母题流程。先定位母题，再调用规则；如果先套概念，容易把题目做散。`,
      `执行口令：看到题面 -> 圈关键词/图表/问法 -> 对应 ${topic.topic_id} ${topic.title} -> 再按程序答题。`,
      "procedure",
    ),
    card(
      topic,
      doc,
      "信号_01",
      "信号",
      "signal",
      `信号：看到哪些题面信号，立刻进入 ${topic.topic_id} ${topic.title}？`,
      signals || `看到题干围绕“${topic.title}”设问，就进入本母题。`,
      `入口信号包括：${signals || `题干出现 ${topic.title} 的关键词、图表或任务问法`}。这些信号的作用是提醒学生不要泛泛作答，而要启动本母题的固定流程。`,
      `动作指令：先圈信号，再圈最后问法。只要信号和问法同时指向 ${topic.title}，就按本母题处理。`,
      "trigger",
    ),
    card(
      topic,
      doc,
      "信号_02",
      "信号",
      "signal",
      `信号：本母题最容易和哪类信息混在一起？如何保持入口不跑偏？`,
      `先看任务关键词，再看材料细节；材料会变，母题动作不变。`,
      `本母题的题面可能更换疾病、实验、图表或生态背景，但入口仍由任务关键词决定。看见变化材料时，先问“它让我判断什么/解释什么/计算什么”，再进入 ${topic.title}。`,
      `纠偏动作：如果读完材料只记住背景，没有圈出任务问法，说明还没有真正进题。`,
      "trigger",
    ),
    card(
      topic,
      doc,
      "判断_01",
      "判断",
      "rule",
      `规则：${topic.title} 的完整解题程序是什么？`,
      strategy.slice(0, 90),
      `完整程序：${strategy}`,
      `得分动作：每一步都要有证据词，不能只写结论。先写“根据什么”，再写“推出什么”。`,
      "procedure",
    ),
    card(
      topic,
      doc,
      "判断_02",
      "判断",
      "rule",
      `规则：做 ${topic.title} 时，如何从母题材料中提取关键证据？`,
      `抓住母题中的决定性信号：${sentence(mq1.select_reason, mq1.short_name || topic.title)}。`,
      `关键证据来自母题：${sentence(mq1.short_name, topic.title)}。它的价值在于：${sentence(mq1.select_reason, "提供最干净的判定信号")}。做新题时，先寻找同类证据，再迁移同一推理动作。`,
      `训练动作：把题面证据改写成“因为……所以……”的一句话，这句话就是后续作答的主干。`,
      "mechanism",
    ),
    card(
      topic,
      doc,
      "框架_01",
      "框架",
      "rule",
      `规则：${topic.title} 的母题框架如何统一不同题面？`,
      `统一框架是：题面信号 -> 母题动作 -> 证据链 -> 得分表达。`,
      `母题框架不是记住某一道题，而是把不同题面放进同一条路径：先识别信号，再选择动作，再组织证据链，最后写出得分表达。${mechanism}`,
      `框架应用：换材料时不换动作，换问法时先定位问法属于信号、机制、计算、评价还是表达。`,
      "mechanism",
    ),
    card(
      topic,
      doc,
      "拆题_01",
      "拆题",
      "representative",
      `代表题：${sentence(mq1.short_name, topic.title)} 训练的母题动作是什么？`,
      `训练动作：先找题面证据，再判断它对应 ${sentence(mq1.inheritance_mode, "核心类型")}，最后迁移母题证据链作答。`,
      `母题对应：${sentence(mq1.short_name, topic.title)}。题源：${sentence(mq1.ec_card, "母题综合卡")} ${sentence(mq1.sub_questions, "")}。训练点是 ${sentence(mq1.inheritance_mode, "把题面证据转成母题动作")}。解题动作：先找题面证据，再判断它对应的母题分支，最后把证据写成得分表达。选择理由是 ${sentence(mq1.select_reason, "它提供清晰的原型信号")}。`,
      `迁移点：新题不一定同名，但只要出现同类证据，就先判断分支，再迁移这张母题的动作。`,
      "training",
    ),
    card(
      topic,
      doc,
      "拆题_02",
      "拆题",
      "representative",
      `代表题：${sentence(mq2.short_name, topic.title)} 和第一道母题相比，训练重点有什么变化？`,
      `先比较两道母题的题面信号，再判断从 ${sentence(mq1.inheritance_mode, "原型动作")} 迁移到 ${sentence(mq2.inheritance_mode, "第二类动作")}。`,
      `第二道母题是 ${sentence(mq2.short_name, topic.title)}，题源：${sentence(mq2.ec_card, "母题综合卡")} ${sentence(mq2.sub_questions, "")}。它训练 ${sentence(mq2.inheritance_mode, "另一类同框架动作")}。解题动作：先比较它与第一道母题的题面信号，再判断当前题目属于哪个分支，最后借用对应证据链作答。`,
      `迁移点：先判断当前题面更像哪一道母题，再借用对应分支的证据链；不要只记题源名称。`,
      "training",
    ),
    card(
      topic,
      doc,
      "陷阱_01",
      "陷阱",
      "trap",
      `陷阱：${sentence(err1.title, `做 ${topic.title} 时最常见的错误是什么？`)}`,
      sentence(err1.check_action, "先回到母题框架，检查证据链是否完整。"),
      `错因：${sentence(err1.title, "把题面信号和母题动作混淆")}。纠偏动作：${sentence(err1.check_action, "先回到母题框架，补足证据链，再写结论")}。`,
      `检查动作：答案中如果只有结论，没有对应证据或纠偏动作，就仍然算没有掌握。`,
      "mechanism",
    ),
    card(
      topic,
      doc,
      "陷阱_02",
      "陷阱",
      "trap",
      `陷阱：${sentence(err2.title, `做 ${topic.title} 时第二个高频错误是什么？`)}`,
      `${sentence(err2.check_action, "先区分题目问的是信号、机制、计算还是表达。")} 纠偏时必须回到母题框架，补足证据链。`,
      `错因：${sentence(err2.title, "把相近概念或步骤混在一起")}。纠偏动作：${sentence(err2.check_action, "把题目拆成信号、判断、表达三步处理")}。`,
      `纠偏指令：每次错题只归入一个主错因，先修主动作，不发散复盘。`,
      "mechanism",
    ),
    card(
      topic,
      doc,
      "收束_01",
      "收束",
      "recall",
      `收束：做完 ${topic.title} 后，如何检查自己是否真的掌握？`,
      selfCheck || `能说清本母题的入口信号、核心流程和高频错因。`,
      `自检清单：${selfCheck || `我能识别 ${topic.title} 的入口信号；我能按母题流程作答；我能说出最常见错因并纠偏。`}`,
      `如果自检说不出“入口信号 + 操作流程 + 错因纠偏”，说明还不能进入变式题。`,
      "training",
    ),
    card(
      topic,
      doc,
      "收束_02",
      "收束",
      "recall",
      `收束：${topic.title} 如何迁移到综合题或跨母题题？`,
      `先完成本母题主流程，再处理叠加条件；顺序不能反。`,
      `迁移时先清主场：确定当前题目中属于 ${topic.title} 的核心任务，再看是否叠加其他母题。若出现新图表、新材料或计算条件，先不要换框架，而是判断它是补充证据还是另一个母题。`,
      `应用指令：先做本母题动作，再接其他模型；先主线，后叠加。`,
      "variant",
    ),
    card(
      topic,
      doc,
      "变式_L1_01",
      "拆题",
      "variant",
      `变式 L1：${sentence(v1.ec_card, `${topic.title} 的基础变式`)} 换了什么，不变的母题动作是什么？`,
      `先判断变式换了什么：${sentence(v1.diff_from_mq, "材料、情境或问法变化")}；再迁移原母题不变的动作。`,
      `L1 变式不是增加新知识，而是验证同一动作能否换题面使用。对应母题：${sentence(v1.maps_to_mq, mq1.mq_id || topic.topic_id)}；差异是 ${sentence(v1.diff_from_mq, "材料、情境或问法变化")}。解题动作：先判断变式题面换了什么，再迁移原母题中不变的证据链和作答步骤。`,
      `迁移方向：先说“换了什么”，再说“不变的母题动作是什么”，最后用同一动作作答。`,
      "variant",
    ),
    card(
      topic,
      doc,
      "变式_L2_01",
      "拆题",
      "variant",
      `变式 L2：${sentence(v2.ec_card, `${topic.title} 的进阶变式`)} 相比 L1 升级在哪里？`,
      `升级点是 ${sentence(v2.diff_from_mq, "在原母题动作上叠加新证据或新条件")}；先跑主流程，再处理新增条件。`,
      `L2 变式要求先保持 ${topic.title} 的主流程，再处理新增干扰。对应母题：${sentence(v2.maps_to_mq, mq2.mq_id || topic.topic_id)}；变化是 ${sentence(v2.diff_from_mq, "材料更复杂或证据更多")}。解题动作：先跑完本母题主流程，再判断新增条件属于补充证据、计算条件还是跨母题叠加。`,
      `纠偏动作：如果新增条件让你忘了主流程，先退回 L1，把本母题动作跑完，再进入 L2 条件。`,
      "variant",
    ),
    card(
      topic,
      doc,
      "阶梯_01",
      "收束",
      "ladder",
      `阶梯：${topic.title} 从 L1 到 L3 的训练路线分别升级什么？`,
      `L1 练单一母题动作；L2 叠加条件或证据；L3 处理综合题和跨母题迁移。`,
      `${topic.title} 的阶梯路线：L1 先练最小动作，确保能识别入口并完成主流程；L2 加入变式材料、图表、条件或表达要求；L3 进入综合题，要求在多个母题之间切换但不丢主线。`,
      `方向性判断：L1 不稳不进 L2；L2 顺序乱就回到程序卡；L3 混乱就拆成多个 L1 再合并。`,
      "variant",
    ),
  ];
}

const generated = topics.filter((topic) => !preservedManualTopicIds.has(topic.topic_id)).flatMap((topic) => makeCards(topic));
const generatedTopicIds = new Set(topics.map((topic) => topic.topic_id));
const preserved = existingCards.filter((card) => !generatedTopicIds.has(card.topic_id) || preservedManualTopicIds.has(card.topic_id));

fs.writeFileSync(path.join(dataDir, "knowledge_cards.json"), `${JSON.stringify([...preserved, ...generated], null, 2)}\n`);
console.log(JSON.stringify({ topics: topics.length, cards: generated.length, total: preserved.length + generated.length }, null, 2));
