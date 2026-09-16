// skill/build-standalone.mjs — 从技能源文件机械拼装单文件版提示词
// 用法: node skill/build-standalone.mjs
//
// 为什么不手写：standalone-prompt.md 里的准则与台词都是**逐字核实过**的。
// 手抄一遍就等于把「人工转录」这个新的错误来源引进来了（这个项目里已经因此踩过坑：
// 我手抄台词时漏过一个逗号、多写过两个字，都是校对脚本抓出来的）。
// 所以单文件版一律从源文件抽取，源改了重跑这个脚本即可。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = path.join(HERE, 'fangyuan')
const OUT = process.env.STANDALONE_OUT
  ? path.resolve(process.env.STANDALONE_OUT)
  : path.join(HERE, 'standalone-prompt.md')

const read = (rel) => fs.readFileSync(path.join(SKILL, rel), 'utf8')

/** 抽取 Markdown 里某个标题到下一个同级（或更高级）标题之间的内容；找不到返回 null */
function section(md, heading, level = 2) {
  const lines = md.split(/\r?\n/)
  const startRe = new RegExp(`^#{${level}}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i])) {
      start = i
      break
    }
  }
  if (start < 0) return null
  let end = lines.length
  const stopRe = new RegExp(`^#{1,${level}}\\s`)
  for (let i = start + 1; i < lines.length; i++) {
    if (stopRe.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n').trim()
}

/** 取多个候选标题中第一个存在的；都不存在就报错（避免静默产出残缺文件） */
function mustSection(md, headings, level, what) {
  for (const h of headings) {
    const s = section(md, h, level)
    if (s !== null) return s
  }
  throw new Error(`找不到小节（${what}）：试过 ${headings.map((h) => `「${h}」`).join('、')}`)
}

/**
 * 把一段 Markdown 里的所有标题降一级。
 * 为什么需要：外层的五个分区用 `## 一、`…`## 五、`，而 behavior.md 与 examples.md
 * 内部也用 `## 一、`…`## 十二、`。拼在一起就会出现两个「## 一、」、两个「## 五、」，
 * 误导任何按标题定位的工具（我第一次生成的版本就有这个毛病）。
 */
function demoteHeadings(md) {
  return md
    .split(/\r?\n/)
    .map((l) => (/^#{1,5}\s/.test(l) ? '#' + l : l))
    .join('\n')
}

const skillMd = read('SKILL.md')
const behavior = read('references/behavior.md')
const voice = read('references/voice.md')
const examples = read('references/examples.md')

/** 取正文：去掉文件的一级标题，可选降级内部标题 */
const bodyOf = (md, demote = false) => {
  const s = md.split(/\r?\n/).slice(1).join('\n').trim()
  return demote ? demoteHeadings(s) : s
}

// 从 SKILL.md 的 frontmatter 取 description 当开场
const descMatch = skillMd.match(/^description:\s*(.+)$/m)
const description = descMatch ? descMatch[1].trim() : ''

const parts = []

parts.push(`# 方源（《蛊真人》）· 单文件提示词

${description}

> 本文件由 \`skill/build-standalone.mjs\` 从技能源文件机械拼装，**不要手改**——
> 改了会在下次构建时被覆盖，而且会绕开逐字校对。要改内容请改 \`fangyuan/references/\` 下的源文件，然后重跑构建脚本。`)

parts.push(`## 一、基本信息与硬规矩

${mustSection(skillMd, ['三条硬规矩'], 2, 'SKILL.md 的硬规矩')}

${mustSection(skillMd, ['引用章号的口径'], 2, 'SKILL.md 的章号口径')}`)

parts.push(`## 二、行为内核（十二条准则，各有原著依据）

${bodyOf(behavior, true)}`)

parts.push(`## 三、怎么说话

${mustSection(voice, ['语气的基本设定'], 2, 'voice.md 的语气设定')}

${mustSection(voice, ['已核实的原话'], 2, 'voice.md 的原话')}

${mustSection(voice, ['反面清单：他**不**这么说', '反而清单：他**不**这么说'], 2, 'voice.md 的反面清单')}

${mustSection(voice, ['句式模板'], 2, 'voice.md 的句式模板')}

${mustSection(voice, ['一个容易忽略的点'], 2, 'voice.md 的补充说明')}`)

parts.push(`## 四、回答方式校准（示范）

${bodyOf(examples, true)}`)

parts.push(`## 五、已知边界

${mustSection(skillMd, ['已知边界'], 2, 'SKILL.md 的已知边界')}

---

**记住最重要的一条**：依据行是必需的。写不出原著依据的态度，就不要写。
这条规矩是这份提示词与「随便演个反派」的全部区别。`)

const out = parts.join('\n\n---\n\n') + '\n'
fs.writeFileSync(OUT, out, 'utf8')

const kb = (out.length / 1024).toFixed(1)
console.log(`已生成 ${path.relative(process.cwd(), OUT)}`)
console.log(`  ${out.length} 字符（约 ${kb} KB）`)
console.log(`  源文件：SKILL.md + behavior.md + voice.md + examples.md`)
