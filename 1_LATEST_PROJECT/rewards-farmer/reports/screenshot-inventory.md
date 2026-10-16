# Screenshot Inventory (Phase 1)

Source: `photo_6222272787515117959_y.zip`, 7 JPG, all opened and viewed. Names below are the ZIP file suffixes.
Window title: "Microsoft Rewards Farmer". Dark theme (near-black bg, slate-blue primary buttons, lavender toggles). Windows 11, taskbar visible in shots 3-7 (screens dated 10/11/2026).

| # | File suffix | Size | Page |
|---|-------------|------|------|
| 1 | ...959 | 1280x679 | Home (Farmer) |
| 2 | ...968 | 1280x680 | Accounts (empty) |
| 3 | ...969 | 1280x719 | Settings, scroll top |
| 4 | ...970 | 1280x720 | Settings, scrolled (toggles, gift card URL, task toggles) |
| 5 | ...971 | 1280x719 | Settings, scrolled (parallel, timezone, geolocation, point target) |
| 6 | ...972 | 1280x719 | Settings, scrolled (visual search, OpenRouter key, cooldown) |
| 7 | ...973 | 1280x719 | Settings, scrolled bottom (search settings, typo slider) |

Pages in sidebar but NOT shown in any screenshot: Parallel farming, Telegram, Discord, About. (No visual evidence; cannot be built to match.)

## Shell (all shots)
- Title bar, min/max/close. App bar: hamburger, title "Microsoft Rewards Farmer", right icons: sun (theme), palette, loading spinner (shot 1) or badge icon (shots 2-7), kebab menu.
- Sidebar (7 items): Home, Accounts, Parallel farming, Telegram, Discord, Settings, About. Active item = pill highlight. Thin vertical divider right of sidebar.

## Shot 1 — Home
- Card "Farmer": field "Accounts Path" + Open btn; field "Alternate proxies" + Open btn; "Start at: 00:00" field + "Timer" toggle (off).
- Card "Current account: None" — rows: Current point 0, Section -, Detail -, Proxy -.
- Card "Accounts informations" — rows: All 0, Finished || Failed 0 || 0, Locked 0, Suspended 0.
- Bottom: Stop and Start buttons, both greyed (disabled).

## Shot 2 — Accounts
- Title, text "No accounts file added yet, open an accounts file from Home". Floating "+ Add account" button bottom-right.
- Shows only empty state. Populated list, add form, edit/remove: unknown.

## Shots 3-7 — Settings
Card 1 (top): PC User Agent (Chrome/154 Win), Mobile User Agent (Chrome/154 Android 10), each with clear (x). "Reset to defaults", "Save".
Card 2 "App & browser settings":
- Device name + check btn; Log level (Info); Browser (Google Chrome).
- Toggles: Headless, Session, Refresh proxy (on), Use proxy, Shutdown, Disable images, Randomization, Check Bing (on), Logs in excel, Share data, Check restriction (on).
- Gift card URL (`https://rewards.bing.com/redeem/checkout?productId=000400000296`, e.g. hint).
- Parallel mode settings toggle (off).
- Timezone (Eastern Standard Time), Latitude, Longitude (range hints), Reset Geolocation, Save Geolocation.
- Point target 13000 ("Target points to display in green color in excel").
Card 3 "Task settings":
- Speed, Search method, Tasks method (all Normal); toggles Check status of accounts, Collect cookies.
- Dropdowns: Daily set completion mode, More activities completion mode, Read to earn completion mode (all "All").
- Toggles: Daily quests, Punch cards, More activities, Explore on Bing, PC search, Mobile search (on); Read to earn, Visual Search (off).
- Visual search: Images path, Open directory, Clear directory.
- Open router API key: API key field ("Used to access get special search results for more activities").
- Cooldown & delay: Cooldown mode None; Delay after search 25; Delay after task 2.
- Search settings: "Search words setting" btn; Search count method (Max search); Open search results toggle; Probability of typo in searches slider (30%).

## Unclear / not provable from images
- Dropdown option lists, validation rules, units for delays (s? ms?), what Session/Share data/Collect cookies/Refresh proxy/Check restriction do.
- Dialogs behind kebab menu, palette, spinner, badge icon, "Search words setting".
- Accounts file format, proxies file format.
- Light theme, hover/focus/error states, window resize behavior.
- Right column of settings partly clipped at bottom (shot 7 ends at slider; anything below unseen).

## Screenshot-to-upstream first look (candidate only, from `src/interface/Config.ts` grep; NOT verified in code paths)
Plausible match: Headless, Daily set, More promotions, Punch cards, Desktop/Mobile search, Read to earn, Visual search, Telegram + Discord webhooks, Proxy, Log level / filters, Search delay, API key (upstream has `chinaApi.appkey`, different thing).
No obvious upstream counterpart seen: Parallel farming page, Device name, Gift card URL, Logs in excel, Point target, Share data, Collect cookies, Refresh proxy, Randomization, Check Bing, Timer/Start at, Open router API key, Typo probability, Timezone/geolocation UI, UA editing, Open search results, Locked/Suspended counters.
The screenshots look like a different app/engine than this upstream. Phase 2 must resolve each control.

## Evasion-adjacent controls (rule 9 review)
User-agent override, Randomization, Typo probability, Geolocation spoof, Cooldown/delay tuning, Refresh/Use proxy, Alternate proxies, Collect cookies. Some may be benign config (delays, proxy). Typo/randomization/UA/geolocation exist to look human. Need your decision per control.
