// TEST FIXTURE ONLY. Stands in for engine/dist/index.js so the REAL engine control API (scripts/api/server.js)
// can run a child process in tests without a browser or real accounts. It never ships and never touches the real
// account store (rule 18). It prints lines in the engine's own log format so the real log parser fills /points.
const mode = process.env.FAKE_BOT_MODE || 'run'
const email = process.env.ACCOUNT_1_EMAIL || 'missing@example.invalid'
const stamp = '[8/6/2026, 11:20:01 AM]'
const line = (title, message, level = 'INFO', platform = 'MAIN') => {
    process.stdout.write(`${stamp} [alpha] [${level}] ${platform} [${title}] ${message}\n`)
}
// Same wording as engine/src/index.ts line 540 (V4-china logs this line in Chinese; the API log parser matches it).
const accountStart = () => line('ACCOUNT-START', `开始处理账户: ${email} | geoLocale: US | locale: en-US`)

process.on('SIGTERM', () => process.exit(0))

if (mode === 'fail') {
    accountStart()
    line('LOGIN', 'Login failed: simulated test failure', 'ERROR')
    setTimeout(() => process.exit(3), 300)
} else if (mode === 'finish') {
    accountStart()
    line('SEARCH-BING', '开始必应搜索 | 当前余额=1000', 'INFO', 'DESKTOP')
    line('FLOW', `积分已收集 | 获得积分=3 | 现余额=1003 | 账户=${email}`)
    setTimeout(() => {
        line('ACCOUNT-END', `账户完成: ${email} | 获得积分=3 | 原余额=1000 | 现余额=1003 | 持续秒数=0.5`)
        line(
            'RUN-END',
            '全部账户完成 | 处理账户数=1 | 获得积分=3 | 原余额=1000 | 现余额=1003 | 运行分钟数=0.01'
        )
        process.exit(0)
    }, 400)
} else {
    accountStart()
    let balance = 1000
    // Same wording as engine/src/functions/activities/search/BrowserSearch.ts:33 and engine/src/index.ts:1123.
    line('SEARCH-BING', `开始必应搜索 | 当前余额=${String(balance)}`, 'INFO', 'DESKTOP')
    setInterval(() => {
        balance += 3
        line(
            'FLOW',
            `积分已收集 | 获得积分=${String(balance - 1000)} | 现余额=${String(balance)} | 账户=${email}`
        )
    }, 150)
}
