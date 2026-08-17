// XAvatarWall 粉丝采集内容脚本（运行于 x.com / twitter.com 的 followers 页面）。

(() => {
  if (window.__xavatarwall_collector__) return;
  window.__xavatarwall_collector__ = true;

  let running = false;
  let stopRequested = false;

  const RESERVED = new Set([
    'i', 'home', 'explore', 'notifications', 'messages', 'search',
    'settings', 'compose', 'login', 'signup', 'download', 'tos',
    'privacy', 'help', 'about', 'jobs', 'twitter', 'x'
  ]);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'COLLECT_START') {
      startCollection(msg.config).catch(() => {});
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === 'COLLECT_STOP') {
      stopRequested = true;
      sendResponse({ ok: true });
      return false;
    }
  });

  // 页面加载时尝试自动恢复任务（后台可能未能及时投递消息）
  setTimeout(autoStartIfNeeded, 600);
  setTimeout(autoStartIfNeeded, 2500);

  async function autoStartIfNeeded() {
    if (running) return;
    const stored = await chrome.storage.local.get(['config']).catch(() => ({}));
    const cfg = stored.config;
    if (!cfg || !cfg.active || cfg.status !== 'collecting') return;
    if (!isFollowersPage(cfg.targetUsername || cfg.username)) return;
    startCollection(cfg).catch(() => {});
  }

  function isFollowersPage(username) {
    if (!username) return false;
    const path = (location.pathname || '').toLowerCase();
    return path.includes('/' + username.toLowerCase() + '/followers');
  }

  async function startCollection(config) {
    if (running) return;
    running = true;
    stopRequested = false;

    const target = config.targetUsername || config.username;
    const maxCount = normalizeMax(config.maxCount);

    // 恢复已有采集数据（页面刷新后继续）
    const seen = new Map();
    const existing = await chrome.storage.local.get(['fansData']).catch(() => ({}));
    if (existing.fansData && existing.fansData.username === target) {
      (existing.fansData.fans || []).forEach((f) => {
        if (f && f.username) seen.set(f.username, f);
      });
    }

    await waitForCells(15000);

    let noNewStreak = 0;
    const MAX_NO_NEW = 6;

    while (running && !stopRequested) {
      const before = seen.size;
      scanPage(seen);
      const after = seen.size;

      await persist(target, seen, config);

      if (maxCount !== 'all' && seen.size >= maxCount) break;

      if (after === before) {
        noNewStreak++;
        if (noNewStreak >= MAX_NO_NEW) break;
      } else {
        noNewStreak = 0;
      }

      scrollToLoadMore();
      await sleep(1600 + Math.floor(Math.random() * 600));
    }

    running = false;

    if (stopRequested) {
      await chrome.storage.local.set({
        progress: { current: seen.size, max: config.maxCount, message: '已停止' }
      });
      return;
    }

    let fans = Array.from(seen.values()).sort((a, b) => a.index - b.index);
    if (maxCount !== 'all') fans = fans.slice(0, maxCount);

    const fansData = { username: target, fans, total: fans.length, collectedAt: Date.now() };
    await chrome.storage.local.set({
      fansData,
      progress: { current: fans.length, max: config.maxCount, message: fans.length ? '采集完成' : '未采集到粉丝' }
    });

    try {
      await chrome.runtime.sendMessage({ type: 'COLLECT_DONE', payload: { total: fans.length, username: target } });
    } catch (e) {
      // 后台会被消息唤醒；此处失败则依赖弹窗手动“打开生成页面”
    }
  }

  function scanPage(seen) {
    const cells = getCells();
    for (const cell of cells) {
      if (seen.size >= 100000) return;
      const username = extractUsername(cell);
      if (!username || seen.has(username)) continue;
      const avatar = extractAvatar(cell);
      if (!avatar) continue;
      seen.set(username, {
        username,
        avatar,
        index: seen.size + 1,
        time: Date.now()
      });
    }
  }

  function getCells() {
    const userCells = document.querySelectorAll('[data-testid="UserCell"]');
    if (userCells.length) return userCells;
    return document.querySelectorAll('[data-testid="cellInnerDiv"]');
  }

  function extractUsername(cell) {
    const anchors = cell.querySelectorAll('a[href^="/"]');
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/^\/([A-Za-z0-9_]{1,15})(?:\/|$)/);
      if (m && !RESERVED.has(m[1].toLowerCase())) return m[1];
    }
    return null;
  }

  function extractAvatar(cell) {
    const imgs = cell.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.getAttribute('src') || img.currentSrc || '';
      if (src && /twimg\.com/.test(src)) return normalizeAvatar(src);
    }
    return null;
  }

  function normalizeAvatar(url) {
    try {
      const u = new URL(url);
      u.pathname = u.pathname
        .replace(/_normal(\.[A-Za-z]+)$/, '_400x400$1')
        .replace(/_mini(\.[A-Za-z]+)$/, '_400x400$1')
        .replace(/_bigger(\.[A-Za-z]+)$/, '_400x400$1')
        .replace(/_200x200(\.[A-Za-z]+)$/, '_400x400$1');
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  function scrollToLoadMore() {
    const cells = getCells();
    if (cells.length) {
      const last = cells[cells.length - 1];
      try {
        last.scrollIntoView({ block: 'end', inline: 'nearest' });
      } catch (e) {
        /* 部分环境不支持 options 参数 */
      }
    }
    window.scrollBy(0, 1200);
  }

  async function waitForCells(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (stopRequested) return;
      if (getCells().length > 0) return;
      await sleep(500);
    }
  }

  async function persist(target, seen, config) {
    const fans = Array.from(seen.values()).sort((a, b) => a.index - b.index);
    await chrome.storage.local.set({
      fansData: { username: target, fans, total: fans.length, collectedAt: Date.now() },
      progress: { current: fans.length, max: config.maxCount, message: `采集中 ${fans.length} 位…` }
    });
  }

  function normalizeMax(maxCount) {
    if (maxCount === 'all' || maxCount == null) return 'all';
    const n = parseInt(maxCount, 10);
    return isNaN(n) || n < 1 ? 'all' : n;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
