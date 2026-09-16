// skill/fangyuan/scripts/verify-quotes.mjs — 核实 voice.md 里的每条台词
// 用法: node skill/fangyuan/scripts/verify-quotes.mjs
//
// 为什么需要它：voice.md 里的台词是我从 428 条候选里挑的，挑的过程本身会出错
// （实测就有 1 条挑错了，第 304 章那句其实不属于方源）。
// 只靠人工核对没法保证下次不犯，所以把「引用必须逐字存在」变成可执行的检查。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = path.resolve(HERE, '..')
const VOICE = path.join(SKILL, 'references', 'voice.md')

// 语料位置：优先环境变量，其次约定路径
const CORPUS = process.env.GUZHENREN_CORPUS
  ? path.resolve(process.env.GUZHENREN_CORPUS)
  : 'E:\\zhengliu\\build\\chapter-bodies'

if (!fs.existsSync(CORPUS)) {
  console.error(`找不到语料目录：${CORPUS}`)
  console.error('用环境变量指定：$env:GUZHENREN_CORPUS="<chapter-bodies 的路径>"')
  process.exit(2)
}
if (!fs.existsSync(VOICE)) {
  console.error(`找不到 ${VOICE}`)
  process.exit(2)
}

// ── 解析 voice.md 里的引用
// 约定（改 voice.md 时必须遵守，否则这里的解析会失效）：
//   1. 一条「真引用」写成一行：`> 「原文…」 —— 第 N 章，说明。`
//   2. 反面例句必须包在【反例】里，否则会被当成真引用去核（实测抓到过这个歧义）
const md = fs.readFileSync(VOICE, 'utf8')

// 先把【反例】段落整段剔除
const withoutCounterExamples = md.replace(/【反例】[\s\S]*?(?=\n#{2,3}\s|$)/g, '')

const CLAIM = /「([^」]{6,300})」[^\n]{0,40}?第\s*(\d{1,4})\s*章/g

const claims = []
for (const m of withoutCounterExamples.matchAll(CLAIM)) {
  // 去掉空白、Markdown 引用符 >、粗体 ** —— 引文里不该有这些排版符号
  const quote = m[1].replace(/[\s>]+/g, '').replace(/\*\*/g, '')
  claims.push({ quote, chapter: Number(m[2]) })
}

// ── 语料索引
const files = fs.readdirSync(CORPUS).sort()
const bodyOf = (n) => {
  const f = files.find((x) => x.startsWith(String(n).padStart(5, '0')))
  return f ? { file: f, text: fs.readFileSync(path.join(CORPUS, f), 'utf8').replace(/\s+/g, '') } : null
}

console.log('voice.md 台词核实\n')
console.log(`引用 ${claims.length} 条，语料 ${CORPUS}\n`)

if (claims.length === 0) {
  console.log('没有解析到「」（—— 第 N 章）形式的引用。检查 voice.md 的格式。')
  process.exit(1)
}

let ok = 0
const bad = []
for (const c of claims) {
  const b = bodyOf(c.chapter)
  if (!b) {
    bad.push({ ...c, why: `第 ${c.chapter} 章不存在` })
    continue
  }
  if (b.text.includes(c.quote)) {
    ok++
    console.log(`  ✓ 第 ${c.chapter} 章  ${c.quote.slice(0, 34)}…`)
  } else {
    // 退一步：按标点切段，看有多少片段能在该章找到（判断是「记错章」还是「编造」）
    const parts = c.quote.split(/[，。！？；：、]/).filter((s) => s.length >= 4)
    const found = parts.filter((p) => b.text.includes(p)).length
    bad.push({
      ...c,
      why: found === 0 ? '该章里完全没有这段文字' : `只有 ${found}/${parts.length} 个片段能在该章找到`,
    })
  }
}

console.log('')
if (bad.length === 0) {
  console.log(`✓ ${ok}/${claims.length} 条台词逐字属实`)
  process.exit(0)
}

console.log(`通过 ${ok} 条，${bad.length} 条对不上：`)
for (const b of bad) {
  console.log(`  × 第 ${b.chapter} 章：${b.why}`)
  console.log(`      「${b.quote.slice(0, 60)}…」`)
}
console.log('\n处理原则：改 voice.md 或删掉这条引用 —— 不要为了让检查通过而放宽判据。')
process.exit(1)
