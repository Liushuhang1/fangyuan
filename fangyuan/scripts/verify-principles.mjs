#!/usr/bin/env node
/**
 * verify-principles.mjs —— 方源技能包「行为准则原著依据」回原文校验
 * ============================================================================
 * 干什么：
 *   把 skill/fangyuan/references/behavior.md 里十二条行为准则各自 `> 依据：…`
 *   标注的原著出处，逐条回 2214 章正文里核对，确认「这条依据真的成立」。
 *
 * 怎么判（可复现的机械判据，不依赖任何自然语言理解）：
 *   1) 引号里的原话（「…」『…』“…”）直接在该章正文精确查找 —— 最强判据；
 *   2) 没有引号就从依据短语里抽「候选词块」，用**全库章频**筛出真的稀有词当探针，
 *      再看探针是否真的落在所标的章里；
 *   3) 三档判定：精确（命中所标章）/ 邻近（在 ±12 章内）/ 远离（都不在）。
 *      一条依据只要有命中即视为通过；全部落空才算失败。
 *   归一化：正文里的「第X节」是每一卷内部的局部编号，与全局章号无关，
 *   因此一律以文件名前 5 位作为全局章号（例如 00082-第八十四节… → 第 82 章）。
 *
 * 为什么这么设计 / 这里踩过的坑（改动前请先读）：
 *   [坑 1] 不要用 2–5 字滑窗抽探针词。
 *       滑窗会切出「河中的鬼」「相与」这类**跨词边界的碎片**：碎片天然只在个别章出现，
 *       章频极低，看起来像「稀有词」，于是大量伪阳性。本脚本只从**完整连续汉字段**
 *       （正则 [\u4E00-\u9FFF]{2,} 切出的整段）里取子块，且子块必须是该整段的连续片段，
 *       绝不跨越标点/数字拼接出一个原文里不存在的串。
 *   [坑 2] 不要用「前后是否还有汉字」判断一个候选是不是完整词。
 *       中文里名字后面直接接动词/「的」/副词是常态（「商燕飞盘坐」「舅父古月冻土的眉头」），
 *       这个判据会把全部真名字误判成碎片。本脚本改用**虚词边界**：候选的首字/尾字落在虚词上
 *       （的/了/是/在/和/就/被/把/之/最…），或内部夹着 的/了/着/过/吗/呢… ，才判为碎片丢弃。
 *       虚词只是**词内不可能出现**的黏着成分，用它划边界不会误伤专名。
 *   [坑 3] 不要因为某个词出现章数多就当「泛称」排除。
 *       真名字也会高频（本例语料：白凝冰 374 章、方源 2082 章）。所以章频只用来给证据**定强度**
 *       （稀有 ≤12 / 次常见 ≤150 / 常见 >150），不用来剥夺一条依据的命中资格；
 *       否则「第 366–367 章白凝冰背刺」这种只有人名可查的依据会被全判成失败。
 *   [坑 4] 全库章频很贵，但**先做单章命中筛选再算章频**与「先算章频再筛」等价：
 *       候选词若连所标的那一章里都没有，它本来就不可能成为精确探针。于是只需为
 *       「已经命中该章」的少数候选做全库扫描，22MB 语料下秒级完成（正文按章缓存复用）。
 *
 * 用法：
 *   node verify-principles.mjs            # 任意工作目录下均可
 *   node verify-principles.mjs --corpus D:\\other\\chapter-bodies
 *   ZHENGLIU_CORPUS=... node verify-principles.mjs
 * 退出码：远离条目占比 > 30% → 1；语料/文档缺失或不可读 → 2；否则 0。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 判据参数（集中放这里，便于复核时调整）
// ---------------------------------------------------------------------------
const RARE_MAX_DF = 12;      // 稀有词探针阈值：全库出现章数 ≤ 12 才算「稀有」
const MID_MAX_DF = 150;      // 次常见上限：≤150 记为「次常见」，>150 记为「常见（仅共现）」
const NEAR_WINDOW = 12;      // 邻近判定窗口：±12 章
const MAX_PROBES_PER_ITEM = 24;  // 单条依据最多为多少个命中候选算全库章频（按词长降序取，避免无谓扫描）
const MIN_QUOTE_LEN = 3;     // 引号原话至少要有 3 个汉字才算「原话」强证据（太短无意义）
const FAIL_RATIO = 0.30;     // 远离比例超过 30% 时以非零退出码结束

// 虚词（坑 2）：出现在候选的首/尾 → 该候选跨了词边界，丢弃
// （候选本身只由汉字组成，所以这里不必列标点）
const EDGE_FUNC = new Set('的了着过吗呢吧啊呀哦嘛是在和与也就都又而则把被为对从向其之很更最这那还只才再且但并或及等所'.split(''));
// 虚词（坑 2）：出现在候选**内部** → 几乎必然是跨词碎片（如「河中的鬼」），丢弃
const INNER_FUNC = /[的了着过吗呢吧啊呀哦嘛，。；：、!？!?,.;:、"“”‘’（）()]/;

// ---------------------------------------------------------------------------
// 路径定位：用 import.meta.url 推算，保证在任何工作目录下都能跑
// ---------------------------------------------------------------------------
const HERE = path.dirname(fileURLToPath(import.meta.url));          // …/skill/fangyuan/scripts
const SKILL_DIR = path.resolve(HERE, '..');                          // …/skill/fangyuan
const BEHAVIOR_MD = path.join(SKILL_DIR, 'references', 'behavior.md'); // 被校验的准则文档

function resolveCorpusDir() {
  const argEq = process.argv.find((a) => a.startsWith('--corpus='));
  const argIdx = process.argv.indexOf('--corpus');
  const fromArg = argEq ? argEq.slice('--corpus='.length)
    : (argIdx >= 0 ? process.argv[argIdx + 1] : null);
  const candidates = [
    fromArg,
    process.env.ZHENGLIU_CORPUS,
    path.resolve(SKILL_DIR, '..', '..', 'build', 'chapter-bodies'), // 技能包 → 仓库根 → build/
    'E:/zhengliu/build/chapter-bodies',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isDirectory()) return path.resolve(c);
    } catch { /* 继续找下一个候选 */ }
  }
  return null;
}

const CORPUS_DIR = resolveCorpusDir();
if (!CORPUS_DIR) {
  console.error('× 找不到章节语料目录。可用 --corpus <目录> 或环境变量 ZHENGLIU_CORPUS 指定。');
  process.exit(2);
}
if (!fs.existsSync(BEHAVIOR_MD)) {
  console.error(`× 找不到准则文档：${BEHAVIOR_MD}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 语料：文件名前 5 位 = 全局章号（正文里的「第X节」是卷内局部编号，不可用）
// ---------------------------------------------------------------------------
const chapterFiles = new Map(); // 全局章号 -> 文件绝对路径
for (const name of fs.readdirSync(CORPUS_DIR)) {
  if (!name.endsWith('.txt')) continue;
  const m = /^(\d{1,6})-/.exec(name);
  if (!m) continue;
  chapterFiles.set(Number(m[1]), path.join(CORPUS_DIR, name));
}
if (chapterFiles.size === 0) {
  console.error(`× 语料目录里没有形如 00082-….txt 的章节文件：${CORPUS_DIR}`);
  process.exit(2);
}

const textCache = new Map(); // 章号 -> 正文（整章缓存，避免重复读盘）
function chapterText(num) {
  if (textCache.has(num)) return textCache.get(num);
  const file = chapterFiles.get(num);
  const text = file ? fs.readFileSync(file, 'utf8') : '';
  textCache.set(num, text);
  return text;
}

// 全库章频（DF）：某个词在多少**章**里出现过。只对「已命中所标章」的候选调用。
const dfCache = new Map();
function chapterFrequency(probe) {
  if (dfCache.has(probe)) return dfCache.get(probe);
  let n = 0;
  for (const num of chapterFiles.keys()) if (chapterText(num).includes(probe)) n++;
  dfCache.set(probe, n);
  return n;
}

// ---------------------------------------------------------------------------
// 第一步：解析 behavior.md
//   1) 按 `## 一、…` 这类二级标题分出十二条准则；
//   2) 只认 `> 依据：…` 开头的引用行，并把紧随其后的 `>` 续行（同一条依据换行写）
//      合并进同一个依据块，块内按「第 N 章」切分成多条依据。
// ---------------------------------------------------------------------------
function parseBehaviorMd() {
  const lines = fs.readFileSync(BEHAVIOR_MD, 'utf8').split(/\r?\n/);
  const principles = [];
  let cur = null;
  let inCiteBlock = false; // 是否正处于某个 `> 依据：` 引用块内部（用于把换行的续行并回同一条依据）

  for (const line of lines) {
    const heading = /^##\s*([一二三四五六七八九十]+)\s*[、.．]\s*(.*)$/.exec(line);
    if (heading) {
      cur = { index: heading[1], title: heading[2].trim(), prose: [], citeBlocks: [] };
      principles.push(cur);
      inCiteBlock = false;
      continue;
    }
    if (/^##\s/.test(line)) { cur = null; inCiteBlock = false; continue; } // 「反面清单」「怎么自检」等非准则章节
    if (!cur) continue;

    if (/^\s*>\s*\**依据\**\s*[:：]/.test(line)) {
      const body = line.replace(/^\s*>\s*/, '').replace(/^\**依据\**\s*[:：]\s*/, '');
      cur.citeBlocks.push(body);
      inCiteBlock = true;
      continue;
    }
    if (inCiteBlock && /^\s*>/.test(line)) {
      // 续行：同一条依据换行继续写（如第 100–101、152–153、164–165 行的写法）
      cur.citeBlocks[cur.citeBlocks.length - 1] += '\n' + line.replace(/^\s*>\s*/, '');
      continue;
    }
    inCiteBlock = false;      // 引用块结束，回到正文
    cur.prose.push(line);     // 正文段落（供「原话」类依据做补充引语检索）
  }
  return principles;
}

// 「第 N 章」「第 A–B 章」；破折号可能是 – — ~ - 或「至」
const CHAPTER_RE = /第\s*(\d+)\s*(?:[–—~\-至]\s*(\d+)\s*)?章/g;

function splitCiteBlock(block, principle) {
  const items = [];
  const marks = [...block.matchAll(CHAPTER_RE)];
  marks.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : block.length;
    items.push({
      principle: principle.index,
      principleTitle: principle.title,
      mark: m[0].replace(/\s+/g, ' '),
      from: Number(m[1]),
      to: m[2] ? Number(m[2]) : Number(m[1]),
      desc: block.slice(start, end).replace(/\s+/g, ' ').trim(),
    });
  });
  return items;
}

// ---------------------------------------------------------------------------
// 第二步：候选证据抽取
// ---------------------------------------------------------------------------

/** 依据短语里引号中的原话（最强判据；原话不再做碎片过滤——它就是原文本身） */
function quotedPhrases(text) {
  const out = [];
  const re = /[「『“"]([^」』”"]{2,60})[」』”"]/g;
  for (const m of text.matchAll(re)) {
    const q = m[1].trim();
    const hanLen = (q.match(/[\u4E00-\u9FFF]/g) || []).length;
    if (hanLen >= MIN_QUOTE_LEN) out.push(q);
  }
  return out;
}

/** 去掉「第 N 章」这类标注后的依据短语 */
function stripChapterMark(text) {
  return text.replace(/第\s*\d+\s*(?:[–—~\-至]\s*\d+)?\s*章/g, ' ');
}

/**
 * 候选词块：先按 [\u4E00-\u9FFF]{2,} 切出**完整连续汉字段**（坑 1：不跨标点拼串），
 * 再枚举该整段的连续子块（长度 2–12），最后按虚词边界过滤碎片（坑 2）。
 */
function candidateWords(text) {
  const out = new Set();
  for (const run of stripChapterMark(text).matchAll(/[\u4E00-\u9FFF]{2,}/g)) {
    const r = run[0];
    for (let i = 0; i < r.length; i++) {
      for (let len = 2; len <= 12 && i + len <= r.length; len++) {
        const w = r.slice(i, i + len);
        if (EDGE_FUNC.has(w[0]) || EDGE_FUNC.has(w[w.length - 1])) continue; // 首尾落在虚词上 → 跨词碎片
        if (INNER_FUNC.test(w)) continue;                                    // 内部夹虚词 → 跨词碎片
        out.add(w);
      }
    }
  }
  return [...out];
}

/** 「原话」型依据（依据行只写「第 236 章原话」）的补充：从本准则正文里取与这些章号同段的引语 */
function proseQuotesFor(principle, item) {
  const out = new Set();
  const marks = new Set();
  for (let n = item.from; n <= item.to; n++) marks.add(`第 ${n} 章`, `第${n}章`);
  principle.prose.forEach((line, i) => {
    if (![...marks].some((mk) => line.includes(mk))) return;
    for (const l of [principle.prose[i - 1] || '', line, principle.prose[i + 1] || '']) {
      for (const q of quotedPhrases(l)) out.add(q);
    }
  });
  return [...out];
}

/** 取章内命中处的一小段上下文，方便人工复核 */
function snippet(text, word, rad = 14) {
  const i = text.indexOf(word);
  if (i < 0) return '';
  const s = Math.max(0, i - rad), e = Math.min(text.length, i + word.length + rad);
  return `${s > 0 ? '…' : ''}${text.slice(s, e).replace(/\s+/g, '')}${e < text.length ? '…' : ''}`;
}

// ---------------------------------------------------------------------------
// 第三步：逐条判定
// ---------------------------------------------------------------------------
function judgeItem(item, principle) {
  const result = {
    ...item,
    tier: '远离',
    strength: '无',
    hits: [],           // [{word, df, chapter, snippet, kind}]
    near: null,         // 邻近命中信息
    note: '',
  };

  const inChapters = [];
  for (let n = item.from; n <= item.to; n++) inChapters.push(n);
  // 语料缺章时**不能提前返回**：章号写偏、或语料本身有缺口，恰恰要靠下面的 ±12 邻近检索兜住。
  const missing = inChapters.filter((n) => !chapterFiles.has(n));
  if (missing.length) result.note = `语料里没有第 ${missing.join('、')} 章的文件`;

  const exactText = inChapters.map(chapterText).join('\n');
  const words = candidateWords(item.desc);
  const quotes = quotedPhrases(item.desc);

  const collect = (text, chapter) => {
    const found = [];
    for (const q of quotes) if (text.includes(q)) found.push({ word: q, kind: '引号原话', chapter });
    for (const w of words) if (text.includes(w)) found.push({ word: w, kind: '词块', chapter });
    return found;
  };

  // 1) 所标章能否直接命中？
  let found = collect(exactText, null);
  if (found.length === 0) {
    // 1b) 「原话」型依据：依据行本身没写内容，引语在本准则正文里
    const pq = proseQuotesFor(principle, item);
    const supplement = [];
    for (const q of pq) {
      for (const n of inChapters) if (chapterText(n).includes(q)) supplement.push({ word: q, kind: '正文引语', chapter: n });
    }
    if (supplement.length) { found = supplement; result.note = '依据行只写「原话」，引语取自本准则正文'; }
  }

  if (found.length > 0) {
    result.tier = '精确';
    result.hits = finishHits(found, () => exactText);
    result.strength = strengthOf(result.hits);
    return result;
  }

  // 2) 邻近：±12 章内找（章号写偏一两节是常见错误，值得单独提示）
  const nearWords = [...quotes, ...words];
  for (let d = 1; d <= NEAR_WINDOW; d++) {
    const around = [];
    for (const n of [item.from - d, item.to + d]) {
      if (!chapterFiles.has(n) || (n >= item.from && n <= item.to)) continue;
      const t = chapterText(n);
      for (const w of nearWords) if (t.includes(w)) around.push({ word: w, kind: '词块', chapter: n });
    }
    if (around.length) {
      result.tier = '邻近';
      result.hits = finishHits(around, (ch) => chapterText(ch));
      result.strength = strengthOf(result.hits);
      result.note = `${result.note ? result.note + '；' : ''}所标章之外，仅在 ±${d} 章（第 ${around[0].chapter} 章）找到命中`;
      return result;
    }
  }

  result.note = `${result.note ? result.note + '；' : ''}词块与引语都未在所标章及 ±12 章内出现`;
  return result;
}

/**
 * 给命中候选算全库章频并排序（坑 4：只对「已经命中所标章」的候选取章频，
 * 等价于「先筛章频再判命中」，但把全库扫描量压到几十个词）。
 * textFor(chapter) 返回该命中所在章的正文，用于截取上下文。
 */
function finishHits(found, textFor) {
  const uniq = [...new Map(found.map((f) => [f.word, f])).values()];
  // 只保留「极大命中」：一个命中若是另一个更长命中的子串，它没有额外信息量
  // （例如「凤金」「金煌」都包含在「凤金煌」里），去掉后留下的证据更好读，也少算几十次全库扫描。
  // 引号原话一律保留——它是最强判据，不能被别的词块「吃掉」。
  const maximal = uniq.filter((f) =>
    f.kind !== '词块' ||
    !uniq.some((o) => o.word !== f.word && o.word.length > f.word.length && o.word.includes(f.word)));
  const list = maximal.sort((a, b) => b.word.length - a.word.length).slice(0, MAX_PROBES_PER_ITEM);
  const scored = list.map((f) => ({ ...f, df: chapterFrequency(f.word) }));
  scored.sort((a, b) => (a.df - b.df) || (b.word.length - a.word.length));
  return scored.map((f) => ({ ...f, snippet: snippet(textFor(f.chapter), f.word) }));
}

/** 证据强度（坑 3：章频只定强度，不作排除依据） */
function strengthOf(hits) {
  if (!hits.length) return '无';
  if (hits.some((h) => h.kind === '引号原话' || h.kind === '正文引语')) return '强';
  const best = hits[0].df;
  if (best <= RARE_MAX_DF) return '强';
  if (best <= MID_MAX_DF) return '中';
  return '弱';
}

const STRENGTH_LABEL = { 强: '强', 中: '中（次常见词）', 弱: '弱（仅常见词共现）', 无: '—' };

// ---------------------------------------------------------------------------
// 第四步：跑起来 + 输出
// ---------------------------------------------------------------------------
function main() {
  const principles = parseBehaviorMd();
  const items = [];
  for (const p of principles) {
    for (const block of p.citeBlocks) items.push(...splitCiteBlock(block, p));
  }

  const results = items.map((it) => judgeItem(it, principles.find((p) => p.index === it.principle)));

  console.log('方源技能包 · 行为准则原著依据核对');
  console.log(`  准则文档：${BEHAVIOR_MD}`);
  console.log(`  章节语料：${CORPUS_DIR}（${chapterFiles.size} 章）`);
  console.log('  判据：引号原话精确匹配 > 词块探针（全库章频 ≤ 12 为稀有）> ±12 章邻近；全不中判远离');
  console.log('');

  let lastPrinciple = null;
  results.forEach((r, i) => {
    if (r.principle !== lastPrinciple) {
      lastPrinciple = r.principle;
      console.log(`准则${r.principle}、${r.principleTitle}`);
    }
    const tag = r.tier === '精确' ? '精确命中' : r.tier;
    const strength = r.hits.length ? ` · 证据强度：${STRENGTH_LABEL[r.strength]}` : '';
    console.log(`  [${i + 1}] ${r.mark} ${r.desc}`);
    console.log(`      判定：${tag}${strength}`);
    if (r.hits.length) {
      const top = r.hits.slice(0, 3);
      console.log(`      命中：${top.map((h) => `${h.word}（章频 ${h.df}${h.kind === '词块' ? '' : '，' + h.kind}）`).join('　')}`);
      if (top[0].snippet) console.log(`      原文：${top[0].snippet}`);
    }
    if (r.note) console.log(`      说明：${r.note}`);
  });

  const exact = results.filter((r) => r.tier === '精确');
  const near = results.filter((r) => r.tier === '邻近');
  const far = results.filter((r) => r.tier === '远离');
  const weak = exact.filter((r) => r.strength === '弱');
  const ratio = results.length ? far.length / results.length : 0;
  if (results.length === 0) {
    console.error('× 没能从准则文档里解析出任何「> 依据：…」条目，请检查文档格式是否被改动。');
    process.exit(2);
  }

  console.log('');
  console.log('='.repeat(72));
  console.log(`准则核对：${principles.length} 条准则 / ${results.length} 条依据`);
  console.log(`  精确命中 ${exact.length} 条` +
    `（强证据 ${exact.filter((r) => r.strength === '强').length}` +
    ` / 次常见 ${exact.filter((r) => r.strength === '中').length}` +
    ` / 仅常见词 ${exact.filter((r) => r.strength === '弱').length}）`);
  console.log(`  邻近     ${near.length} 条`);
  console.log(`  远离     ${far.length} 条  ← 这些依据不成立，需要改准则或改依据`);
  console.log(`通过率 ${(exact.length / results.length * 100).toFixed(1)}%（${exact.length}/${results.length} 精确命中）`);

  if (near.length) {
    console.log('\n邻近条目（章号可能写偏，建议人工确认）：');
    for (const r of near) console.log(`  · 准则${r.principle} ${r.mark} ${r.desc} → 实际命中第 ${r.hits[0].chapter} 章：${r.hits[0].word}（章频 ${r.hits[0].df}）`);
  }
  if (weak.length) {
    console.log('\n弱证据条目（只有高频常见词共现，机器无法确认语义，建议人工复核）：');
    for (const r of weak) console.log(`  · 准则${r.principle} ${r.mark} ${r.desc} → 最优命中 ${r.hits[0].word}（章频 ${r.hits[0].df}）`);
  }
  if (far.length) {
    console.log('\n远离条目明细：');
    for (const r of far) console.log(`  · 准则${r.principle} ${r.mark} ${r.desc} —— ${r.note || '无命中'}`);
  }

  if (ratio > FAIL_RATIO) {
    console.log(`\n× 远离占比 ${(ratio * 100).toFixed(1)}% 超过 ${FAIL_RATIO * 100}% 阈值，校验未通过。`);
    process.exitCode = 1;
  } else {
    console.log(`\n√ 远离占比 ${(ratio * 100).toFixed(1)}%，在 ${FAIL_RATIO * 100}% 阈值以内。`);
  }
}

main();
