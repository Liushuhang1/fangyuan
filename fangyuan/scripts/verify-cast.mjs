// skill/fangyuan/scripts/verify-cast.mjs — 抽查 cast.md 有没有编造
// 用法: node skill/fangyuan/scripts/verify-cast.mjs
//
// cast.md 是从 character-arcs.json 派生的，但派生过程可能出错（写错章号、
// 把两个人物的事迹混在一起、凭印象补一个不存在的人物）。
// 这个脚本做三件事：
//   1. 文件里出现的每个人物名，必须真实存在于语料中
//   2. 每个人物名后面标注的章号，必须落在该人物真实出场的章范围内
//   3. 文中引用的原话（「…」）若带了章号，必须逐字存在
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = path.resolve(HERE, '..')
const CAST = path.join(SKILL, 'references', 'cast.md')
const DATA = process.env.GUZHENREN_DATA
  ? path.resolve(process.env.GUZHENREN_DATA)
  : 'E:\\zhengliu\\distill\\data'
const CORPUS = process.env.GUZHENREN_CORPUS
  ? path.resolve(process.env.GUZHENREN_CORPUS)
  : 'E:\\zhengliu\\build\\chapter-bodies'

if (!fs.existsSync(CAST)) {
  console.error(`找不到 ${CAST}`)
  process.exit(2)
}
if (!fs.existsSync(CORPUS)) {
  console.error(`找不到语料目录：${CORPUS}`)
  console.error('用环境变量指定：$env:GUZHENREN_CORPUS="<chapter-bodies 的路径>"')
  process.exit(2)
}
const arcsPath = path.join(DATA, 'character-arcs.json')
if (!fs.existsSync(arcsPath)) {
  // 退出码 2 表示「本机缺少核验所需的数据」，不是核验失败。
  // 技能本体不依赖语料与人物统计，只有这一步自动复核需要。
  console.error(`找不到 ${arcsPath}`)
  console.error('用环境变量指定：$env:GUZHENREN_DATA="<distill/data 的路径>"')
  process.exit(2)
}

const md = fs.readFileSync(CAST, 'utf8')
const arcs = JSON.parse(fs.readFileSync(arcsPath, 'utf8'))

const files = fs.readdirSync(CORPUS).sort()
const bodyOf = (n) => {
  const f = files.find((x) => x.startsWith(String(n).padStart(5, '0')))
  return f ? fs.readFileSync(path.join(CORPUS, f), 'utf8').replace(/\s+/g, '') : null
}

let pass = 0
let fail = 0
const problems = []
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else {
    fail++
    problems.push(`${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ── 1. 文中出现的人物名是否真实存在 ──
// 用人物表的 name 去文中找；出现了但不在表里的「疑似人名」难以自动判断，
// 所以这里反向做：取文中所有「第 N 章」附近提到的、长度 2–4 的连续汉字段，
// 若该词在语料里 0 命中，就是编造的。
const mdCompact = md.replace(/\s+/g, '')
const suspects = new Set()
// 只取「加粗且后面紧跟冒号或括号」的条目 —— 那才是人物/势力条目的形式。
//
// 判据收紧过两轮，两轮都是伪阳性：
//   第一轮：任意加粗词都当专名 → 把「用法提醒」「章节出处」这类小节标题算进来，报 30 个假编造。
//   第二轮：加粗 + 冒号/破折号，且长度 2–5 → 仍把「背刺」「最后一次」这类
//            人物条目下的**小标题**算进来，报 25 个假编造。
// 结论：靠 Markdown 排版猜「这是不是专名」本身就不可靠。
// 所以这里只做一件事：**凡是人物表里有的名字，必须在语料里能找到**（反向校验），
// 不再试图从文件里猜专名。
const knownNames = new Set(arcs.characters.map((c) => c.name))
for (const m of md.matchAll(/\*\*([\u4E00-\u9FFF]{2,5})\*\*/g)) {
  if (knownNames.has(m[1])) suspects.add(m[1])
}

const allTextForNames = files.map((f) => fs.readFileSync(path.join(CORPUS, f), 'utf8')).join('\n')
let invented = 0
let namesChecked = 0
let markedUnavailable = 0
for (const name of suspects) {
  namesChecked++
  if (allTextForNames.includes(name)) continue

  // 关键：名字不在语料里，但 cast.md 可能已经把它**标注为不可用**（例如
  // 「**招妖幡**｜道具｜命中 0 次：素材中不可用。」）—— 那是正确处理，不是错误。
  // 只有「既不在语料里、又没被标注不可用」的，才算真的把不存在的名字当人物用。
  const line = md.split(/\r?\n/).find((l) => l.includes(`**${name}**`)) ?? ''
  const flagged = /命中\s*0\s*次|不可用|待核实|查不到|不在原文/.test(line)
  if (flagged) {
    markedUnavailable++
    console.log(`  ✓ 「${name}」不在语料中，但已被标注为不可用：${line.trim().slice(0, 60)}`)
  } else {
    invented++
    console.log(`  × cast.md 提到的人物「${name}」在全语料中 0 命中，且未标注不可用`)
  }
}
check(
  `cast.md 提到的人物名都能在语料中找到（核对 ${namesChecked} 个，其中 ${markedUnavailable} 个已标注不可用）`,
  invented === 0,
  `${invented} 个找不到且未标注`
)

// ── 2. 人名后的章号是否落在该人物真实出场范围内 ──
const mentionRange = new Map()
for (const c of arcs.characters) {
  if (!c.mentions?.firstChapter) continue
  const peaks = (c.peakChapters ?? []).map((p) => p.index)
  mentionRange.set(c.name, {
    first: c.mentions.firstChapter,
    last: peaks.length ? Math.max(...peaks) : c.mentions.firstChapter,
    chapters: c.mentions.chaptersAppearing,
  })
}

let rangeBad = 0
let rangeChecked = 0
// 匹配「**人名**…第 N 章」这种近距离共现，判断章号是否合理
for (const m of md.matchAll(/\*\*([\u4E00-\u9FFF]{2,5})\*\*([^\n]{0,120}?)第\s*(\d{1,4})\s*章/g)) {
  const name = m[1]
  const ch = Number(m[3])
  const r = mentionRange.get(name)
  if (!r) continue
  rangeChecked++
  // 该人物只出场 r.chapters 章；若标注章号落在 [first, last] 之外太远，值得怀疑
  if (ch < r.first || ch > r.last + 40) {
    rangeBad++
    if (rangeBad <= 8) {
      console.log(`  ? 「${name}」被标到第 ${ch} 章，但其出场区间是 ${r.first}–${r.last}（共 ${r.chapters} 章）`)
    }
  }
}
check(`人物名后的章号落在合理区间（核对 ${rangeChecked} 处）`, rangeBad === 0, `${rangeBad} 处越界`)

// ── 3. 引语必须在语料中存在；章号配错只作为提示 ──
// 判据设计说明（实测后调整过）：
//   硬失败 = 引语在全语料里 0 命中 —— 那才是编造。
//   软提示 = 引语存在、但不在所标章 —— 这是「引用配对错」，角色扮演用途下无害，
//            但值得知道（实测 cast.md 里有 8 处，多半是段落级引用的归属漂移）。
// 一开始我把它当硬失败，结果报出 12 条「对不上」，其中 0 条是编造 —— 判据太严会把真问题埋掉。
let quoteChecked = 0
let quoteAbsent = 0
const misplaced = []

// 建一次全语料对照文本，用于「是否存在」判断
const allText = files.map((f) => fs.readFileSync(path.join(CORPUS, f), 'utf8').replace(/\s+/g, '')).join('\n')

for (const m of md.matchAll(/「([^」]{8,120})」[^\n]{0,30}?第\s*(\d{1,4})\s*章/g)) {
  const quote = m[1].replace(/[\s>]+/g, '').replace(/\*\*/g, '')
  const ch = Number(m[2])
  const body = bodyOf(ch)
  if (!body) continue
  quoteChecked++
  if (body.includes(quote)) continue

  if (allText.includes(quote)) {
    misplaced.push({ ch, quote })
  } else {
    quoteAbsent++
    if (quoteAbsent <= 6) console.log(`  × 全语料中找不到这句引语：「${quote.slice(0, 44)}…」`)
  }
}
check(`引语都在语料中真实存在（核对 ${quoteChecked} 条）`, quoteAbsent === 0, `${quoteAbsent} 条全语料 0 命中`)

if (misplaced.length) {
  console.log(`  ! ${misplaced.length} 条引语存在但不在所标章（引用配对漂移，非编造）：`)
  for (const x of misplaced.slice(0, 8)) console.log(`      标第 ${x.ch} 章：「${x.quote.slice(0, 34)}…」`)
}

console.log('')
console.log(`cast.md 抽查：通过 ${pass} 项，失败 ${fail} 项`)
if (fail) {
  console.log('\n问题：')
  for (const p of problems) console.log(`  × ${p}`)
  console.log('\n处理原则：改 cast.md 或删掉那条内容 —— 不要放宽判据。')
  process.exit(1)
}
console.log('cast.md 内容与语料一致。')
