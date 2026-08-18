importScripts('db.js', 'downloader.js');

const DEFAULT_CONFIG = {
  active: false,
  status: 'idle',
  username: '',
  targetUsername: '',
  maxCount: 'all',
  avatarSize: 160,
  sortMode: 'default',
  bgColor: '#dbeafe',
  genTitle: 'XX fo谢谢大家，感谢大家！',
  genExtraText: '',
  genStyle: 'gradient-v',
  genShape: 'round',
  genTitleColor: '#2563eb',
  genHighlight: 'me',
  genGap: 'auto',
  genColorA: '#dbeafe',
  genColorB: '#93c5fd'
};

// 版本检测地址：默认读取 GitHub 仓库里的 manifest.json。
// 如果你有阿里云服务器，可以改成：
//   const UPDATE_URL = 'https://你的域名/xavatarwall-version.json';
// 该文件内容只需要 {"version": "1.1.0"} 这样的 JSON。
const UPDATE_URL = 'https://raw.githubusercontent.com/qiujiu-dev/XAvatarWall/master/manifest.json';

function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

async function checkUpdate() {
  try {
    const res = await fetch(UPDATE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const latest = String(json.version || '').trim();
    const current = chrome.runtime.getManifest().version;
    if (!latest) return { ok: false, error: 'no version field' };
    return {
      ok: true,
      current,
      latest,
      hasUpdate: compareVersions(latest, current) > 0
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

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
    case 'CHECK_UPDATE':
      return checkUpdate();
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
    bgColor: payload.bgColor || DEFAULT_CONFIG.bgColor,
    genTitle: payload.genTitle !== undefined ? payload.genTitle : DEFAULT_CONFIG.genTitle,
    genExtraText: payload.genExtraText !== undefined ? payload.genExtraText : DEFAULT_CONFIG.genExtraText,
    genStyle: payload.genStyle || DEFAULT_CONFIG.genStyle,
    genShape: payload.genShape || DEFAULT_CONFIG.genShape,
    genTitleColor: payload.genTitleColor || DEFAULT_CONFIG.genTitleColor,
    genHighlight: payload.genHighlight || DEFAULT_CONFIG.genHighlight,
    genGap: payload.genGap || DEFAULT_CONFIG.genGap,
    genColorA: payload.genColorA || DEFAULT_CONFIG.genColorA,
    genColorB: payload.genColorB || DEFAULT_CONFIG.genColorB,
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

  // 分块下载：Service Worker 长时间运行可能被浏览器回收，分块更稳。
  const allFans = fansData.fans || [];
  const CHUNK = 60;
  const result = { results: [], failed: 0 };
  for (let i = 0; i < allFans.length; i += CHUNK) {
    const chunk = allFans.slice(i, i + CHUNK);
    const r = await Downloader.download(chunk, async (p) => {
      await setStorage('progress', {
        current: i + p.done,
        max: p.total + i,
        failed: p.failed,
        message: `正在下载头像 ${i + p.done}/${allFans.length}…`
      });
    });
    result.results = result.results.concat(r.results);
    result.failed += r.failed;
    await sleep(300);
  }
  result.total = allFans.length;
  result.ok = result.results.filter((f) => f && f.cached).length;

  const okCount = result.results.filter((f) => f && f.cached).length;
  await setStorage('fansData', { ...fansData, fans: result.results, total, cachedCount: okCount });
  await setStorage('config', { ...cfg, status: 'generating' });
  await setStorage('progress', { current: okCount, max: total, message: '正在打开生成页面…' });

  // 自动打开自己的主页，提取并保存自己的头像（用于生成页“我最大”）。
  await captureMyProfile(cfg.username).catch(() => {});

  await chrome.tabs.create({ url: chrome.runtime.getURL('generator.html'), active: true });
  return { ok: true, cached: okCount };
}

/**
 * 打开用户自己的主页，让内容脚本提取头像并保存到 storage.meProfile。
 */
async function captureMyProfile(username) {
  if (!username) return;
  let tab;
  try {
    tab = await chrome.tabs.create({ url: 'https://x.com/' + username, active: false });
    // 等待加载 + SPA 渲染，最多重试 4 次。
    let profile = null;
    for (let i = 0; i < 4; i++) {
      await sleep(2000);
      try {
        profile = await chrome.tabs.sendMessage(tab.id, { type: 'GET_MY_PROFILE' });
      } catch (e) {
        profile = null;
      }
      if (profile && profile.avatar) break;
    }
    if (profile && profile.avatar) {
      await setStorage('meProfile', {
        avatar: profile.avatar,
        name: profile.name || '',
        username: profile.username || username
      });
    }
  } finally {
    try {
      if (tab) await chrome.tabs.remove(tab.id);
    } catch (e) {
      /* 忽略 */
    }
  }
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
