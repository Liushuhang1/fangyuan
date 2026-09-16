// skill/fangyuan/scripts/verify-examples.mjs — 核实 examples.md 里引用的原话与章号
// 用法: node skill/fangyuan/scripts/verify-examples.mjs
//
// 判据与 verify-quotes.mjs 一致：
//   - 带章号的「」引语必须逐字存在于该章
//   - 引语存在但不在所标章 → 提示（配对漂移），不算失败
//   - 引语全语料 0 命中 → 失败（那是编造）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = path.resolve(HERE, '..')
const DOC = path.join(SKILL, 'references', 'examples.md')

const CORPUS = process.env.GUZHENREN_CORPUS
  ? path.resolve(process.env.GUZHENREN_CORPUS)
  : 'E:\\zhengliu\\build\\chapter-bodies'

if (!fs.existsSync(DOC)) {
  console.error(`找不到 ${DOC}`)
  process.exit(2)
}
if (!fs.existsSync(CORPUS)) {
  console.error(`找不到语料目录：${CORPUS}`)
  process.exit(2)
}

const md = fs.readFileSync(DOC, 'utf8')
const files = fs.readdirSync(CORPUS).sort()
const compact = files.map((f) => fs.readFileSync(path.join(CORPUS, f), 'utf8').replace(/\s+/g, ''))
const allText = compact.join('\n')
const bodyOf = (n) => {
  const i = files.findIndex((x) => x.startsWith(String(n).padStart(5, '0')))
  return i >= 0 ? compact[i] : null
}

// 抽出每一条「原话」——只用「」（全角直角引号）。
// 约定：examples.md 里的「」严格表示逐字引用；行内比喻不加引号。
const TRAILING = /[。！？；：、，…]+$/

const quotes = []
for (const m of md.matchAll(/「([^」]{8,300})」/g)) {
  quotes.push(m[1].replace(/[\s>*]+/g, ''))
}
const unique = [...new Set(quotes)]

/** 判断一条引语是否存在于全语料：容忍尾部标点差异与省略号截断 */
function locate(q) {
  if (allText.includes(q)) return 'exact'
  // 去掉尾部标点再试（作者引用时常省略句末标点，或多写一个）
  const noTail = q.replace(TRAILING, '')
  if (noTail.length >= 8 && allText.includes(noTail)) return 'trailing-punct'
  // 省略号截断：去掉省略号后取前缀
  const noEllipsis = q.replace(/…+/g, '')
  if (noEllipsis.length >= 8 && allText.includes(noEllipsis)) return 'truncated'
  return 'absent'
}

console.log('examples.md 引语核实\n')
console.log(`提取到 ${unique.length} 条引语（去重后）\n`)

const tally = { exact: 0, 'trailing-punct': 0, truncated: 0, absent: 0 }
for (const q of unique) {
  const how = locate(q)
  tally[how]++
  if (how === 'absent') {
    const parts = q.replace(TRAILING, '').split(/[，。！？；：、]/).filter((s) => s.length >= 5)
    const hit = parts.filter((p) => allText.includes(p)).length
    console.log(`  × 全语料中查不到：「${q.slice(0, 48)}…」`)
    if (parts.length) console.log(`      片段命中 ${hit}/${parts.length}`)
  } else if (how !== 'exact') {
    console.log(`  ~ ${how === 'truncated' ? '省略号截断' : '尾部标点差异'}：「${q.slice(0, 40)}…」`)
  }
}
console.log('')
console.log(`逐字一致 ${tally.exact} 条 / 尾部标点差异 ${tally['trailing-punct']} 条 / 截断 ${tally.truncated} 条`)

// 抽出「第 N 章」引用，检查章号是否存在
const refs = [...new Set([...md.matchAll(/第\s*(\d{1,4})\s*章/g)].map((m) => Number(m[1])))]
const outOfRange = refs.filter((n) => !bodyOf(n))
console.log(`引用章号 ${refs.length} 个（去重）`)
if (outOfRange.length) {
  console.log(`  × 越界/不存在：第 ${outOfRange.join('、')} 章`)
} else {
  console.log(`  ✓ 全部存在（范围 ${Math.min(...refs)}–${Math.max(...refs)}）`)
}

console.log('\n────────────────────────────')
if (tally.absent === 0 && outOfRange.length === 0) {
  console.log(`✓ ${unique.length} 条引语在语料中存在，章号全部有效`)
  process.exit(0)
}
console.log(`查不到 ${tally.absent} 条 / 越界章号 ${outOfRange.length} 个`)
console.log('处理原则：改 examples.md，或删掉查不到的引语 —— 不要放宽判据。')
process.exit(1)
