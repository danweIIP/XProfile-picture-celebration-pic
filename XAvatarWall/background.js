importScripts('db.js', 'downloader.js');

const DEFAULT_CONFIG = {
  active: false,
  status: 'idle',
  username: '',
  targetUsername: '',
  maxCount: 'all',
  avatarSize: 160,
  sortMode: 'default',
  bgColor: '#dbeafe'
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  await resetIfActive();
});

chrome.runtime.onStartup.addListener(async () => {
  await resetIfActive();
});

async function resetIfActive() {
  const cfg = await getStorage('config');
  if (cfg && cfg.active && ['collecting', 'downloading', 'generating'].includes(cfg.status)) {
    await setStorage('config', { ...cfg, active: false, status: 'idle' });
    await setStorage('progress', { current: 0, max: cfg.maxCount, message: '任务已重置' });
  }
}

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'START':
      return startTask(msg.payload || {});
    case 'STOP':
      return stopTask();
    case 'GET_STATUS': {
      const config = await getStorage('config');
      const progress = await getStorage('progress');
      return { ok: true, config, progress };
    }
    case 'COLLECT_PROGRESS':
      await setStorage('progress', msg.payload);
      return { ok: true };
    case 'COLLECT_DONE':
      return onCollectDone(msg.payload || {});
    case 'GENERATE_DONE':
      return { ok: true };
    default:
      return { ok: false, error: '未知消息类型: ' + msg.type };
  }
}

async function startTask(payload) {
  const username = cleanUsername(payload.username);
  if (!isValidUsername(username)) {
    return { ok: false, error: '用户名无效：请输入 1-15 位字母、数字或下划线' };
  }

  const config = {
    active: true,
    status: 'collecting',
    username,
    targetUsername: username,
    maxCount: normalizeMaxCount(payload.maxCount),
    avatarSize: clampInt(payload.avatarSize, 40, 400, 160),
    sortMode: ['default', 'old', 'new'].includes(payload.sortMode) ? payload.sortMode : 'default',
    bgColor: payload.bgColor || '#dbeafe',
    startedAt: Date.now()
  };

  await setStorage('config', config);
  await setStorage('progress', { current: 0, max: config.maxCount, message: '正在打开粉丝页面…' });
  await setStorage('fansData', { username, fans: [], total: 0, collectedAt: null });

  const tab = await chrome.tabs.create({ url: 'https://x.com/' + username + '/followers', active: true });
  pingCollector(tab.id);
  return { ok: true };
}

async function pingCollector(tabId) {
  // 尽力在内容脚本就绪后触发一次；collector 自身也会通过 storage 自检兜底。
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    const cfg = await getStorage('config');
    if (!cfg || cfg.status !== 'collecting') return;
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'COLLECT_START', config: cfg });
      return;
    } catch (e) {
      // 内容脚本尚未注入，继续重试
    }
  }
}

async function stopTask() {
  const cfg = await getStorage('config');
  if (cfg) {
    await setStorage('config', { ...cfg, active: false, status: 'idle' });
  }
  const tabs = await chrome.tabs.query({ url: ['https://*.x.com/*', 'https://*.twitter.com/*'] });
  await Promise.all(tabs.map(async (t) => {
    try {
      await chrome.tabs.sendMessage(t.id, { type: 'COLLECT_STOP' });
    } catch (e) {
      /* 无内容脚本的标签页忽略 */
    }
  }));
  await setStorage('progress', { current: 0, max: cfg ? cfg.maxCount : 'all', message: '已停止' });
  return { ok: true };
}

async function onCollectDone(payload) {
  const cfg = await getStorage('config');
  const fansData = await getStorage('fansData');
  if (!cfg || !fansData) return { ok: false, error: '缺少任务数据' };

  const total = fansData.total || (fansData.fans || []).length;

  if (total === 0) {
    await setStorage('config', { ...cfg, active: false, status: 'error' });
    await setStorage('progress', { current: 0, max: cfg.maxCount, message: '未采集到粉丝，请确认已登录 X 且用户名正确' });
    return { ok: false, error: '未采集到粉丝' };
  }

  await setStorage('config', { ...cfg, status: 'downloading' });
  await setStorage('progress', { current: 0, max: total, message: '正在下载头像…' });

  const result = await Downloader.download(fansData.fans, async (p) => {
    await setStorage('progress', { current: p.done, max: p.total, failed: p.failed, message: `正在下载头像 ${p.done}/${p.total}…` });
  });

  const okCount = result.results.filter((f) => f && f.cached).length;
  await setStorage('fansData', { ...fansData, fans: result.results, total, cachedCount: okCount });
  await setStorage('config', { ...cfg, status: 'generating' });
  await setStorage('progress', { current: okCount, max: total, message: '正在打开生成页面…' });

  await chrome.tabs.create({ url: chrome.runtime.getURL('generator.html'), active: true });
  return { ok: true, cached: okCount };
}

function cleanUsername(name) {
  return String(name || '').trim().replace(/^@/, '').trim();
}

function isValidUsername(name) {
  return /^[A-Za-z0-9_]{1,15}$/.test(name);
}

function normalizeMaxCount(maxCount) {
  if (maxCount === 'all' || maxCount == null || maxCount === '') return 'all';
  const n = parseInt(maxCount, 10);
  return isNaN(n) || n < 1 ? 'all' : n;
}

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

async function getStorage(key) {
  const res = await chrome.storage.local.get(key);
  return res[key];
}

async function setStorage(key, value) {
  await chrome.storage.local.set({ [key]: value });
}
