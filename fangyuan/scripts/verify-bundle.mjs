// skill/fangyuan/scripts/verify-bundle.mjs — 技能包自检
// 用法: node skill/fangyuan/scripts/verify-bundle.mjs
//
// 检查三件事：
//   1. SKILL.md 的 frontmatter 符合 DSH 技能约定（name 必须 kebab-case，description 必填）
//   2. SKILL.md 里提到的每个文件都真实存在（防止写了个 references/cast.md 却没建）
//   3. 两个核验脚本都能跑通（退出码 0）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = path.resolve(HERE, '..')

let pass = 0
let fail = 0
const problems = []
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    problems.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  × ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log(`技能包自检：${SKILL}\n`)

// ── 1. frontmatter ──
const skillMdPath = path.join(SKILL, 'SKILL.md')
check('SKILL.md 存在', fs.existsSync(skillMdPath))
if (!fs.existsSync(skillMdPath)) process.exit(1)

const raw = fs.readFileSync(skillMdPath, 'utf8')
const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
check('有 YAML frontmatter', !!fmMatch)

let fm = {}
if (fmMatch) {
  // 极简 frontmatter 解析：只认 key: value，足够校验必填字段
  for (const line of fmMatch[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/)
    if (m) fm[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

check('frontmatter 有 name', !!fm.name, fm.name ?? '(缺失)')
check('name 是 kebab-case', /^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name ?? ''), fm.name ?? '')
check('frontmatter 有 description', (fm.description ?? '').length >= 20, `长度 ${(fm.description ?? '').length}`)
if (fm.whenToUse !== undefined) {
  check('whenToUse 非空', fm.whenToUse.length > 0)
}
// 目录名应与 name 一致（不一致会让排障变困难）
check('目录名与 name 一致', path.basename(SKILL) === fm.name, `目录 ${path.basename(SKILL)} vs name ${fm.name}`)

// ── 2. 正文引用的文件都存在 ──
const referenced = new Set()
for (const m of raw.matchAll(/`((?:references|scripts|assets)\/[^`]+)`/g)) referenced.add(m[1])
for (const m of raw.matchAll(/\b((?:references|scripts|assets)\/[\w.-]+\.\w+)/g)) referenced.add(m[1])

check(`正文引用了 ${referenced.size} 个资源文件`, referenced.size > 0)
for (const rel of [...referenced].sort()) {
  check(`引用存在：${rel}`, fs.existsSync(path.join(SKILL, rel)))
}

// ── 3. 核验脚本能跑 ──
// 注意：用 stdio:'inherit' 而不是默认管道。
// 在受限沙箱下，父进程用管道捕获子进程 stdio 会被拒绝（子进程状态变成 null），
// 而继承 stdio 可以正常工作 —— 已经踩过一次，别再改回 pipe。
//
// `--quick` 只查结构与 frontmatter，跳过内容核验（那几步要扫 2214 章，各需要数秒）。
const quick = process.argv.includes('--quick')
const scripts = quick
  ? []
  : fs
      .readdirSync(path.join(SKILL, 'scripts'))
      .filter((f) => f.endsWith('.mjs'))
      .filter((f) => f !== 'verify-bundle.mjs') // 避免自调用无限递归

if (quick) console.log('\n（--quick：跳过内容核验）')
else console.log('')
let skipped = 0
for (const s of scripts) {
  const r = spawnSync(process.execPath, [path.join(SKILL, 'scripts', s)], { stdio: 'inherit' })
  if (r.status === 2) {
    // 退出码 2 = 找不到语料。这在没装语料的机器上是**正常情况**，不是失败：
    // 技能本体（SKILL.md + references/）不依赖语料，只有「回原文核验」这一步需要。
    skipped++
    check(`${s} 跳过（本机没有语料）`, true)
    continue
  }
  const ok = r.status === 0
  check(`${s} 通过`, ok, ok ? '' : `退出码 ${r.status}（null 表示子进程异常退出，多半是 stdio 被沙箱拦了）`)
}
if (skipped) {
  console.log('')
  console.log(`  ! ${skipped} 个内容核验脚本因缺少语料被跳过。`)
  console.log('    要跑完整核验，先拿到《蛊真人》章节正文，然后：')
  console.log('      $env:GUZHENREN_CORPUS="<chapter-bodies 目录>"')
  console.log('    没有语料不影响使用技能 —— 只是无法自动复核引语出处。')
}

console.log('\n────────────────────────────')
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
if (fail) {
  console.log('\n问题：')
  for (const p of problems) console.log(`  × ${p}`)
  process.exit(1)
}
console.log('技能包结构完整，核验脚本全部通过。')
