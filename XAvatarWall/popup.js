const $ = (id) => document.getElementById(id);
const BUSY = ['collecting', 'downloading', 'generating'];

let config = {
  active: false,
  status: 'idle',
  username: '',
  maxCount: 'all',
  avatarSize: 160,
  sortMode: 'default',
  bgColor: '#dbeafe'
};
let progress = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  $('bgColor').addEventListener('input', () => {
    $('bgColorText').textContent = $('bgColor').value;
  });
  $('startBtn').addEventListener('click', onStart);
  $('stopBtn').addEventListener('click', onStop);
  $('openGenBtn').addEventListener('click', openGenerator);

  const stored = await chrome.storage.local.get(['config', 'progress']).catch(() => ({}));
  if (stored.config) config = { ...config, ...stored.config };
  progress = stored.progress || null;
  applyConfigToUI();
  render();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.config) {
      config = { ...config, ...(changes.config.newValue || {}) };
      applyConfigToUI();
    }
    if (changes.progress) progress = changes.progress.newValue || null;
    render();
  });
}

function applyConfigToUI() {
  if (!$('username').matches(':focus')) $('username').value = config.username || '';
  if (!$('maxCount').matches(':focus')) $('maxCount').value = config.maxCount === 'all' ? '' : config.maxCount;
  $('avatarSize').value = String(config.avatarSize || 160);
  const radio = document.querySelector(`input[name="sort"][value="${config.sortMode || 'default'}"]`);
  if (radio) radio.checked = true;
  if (config.bgColor) {
    $('bgColor').value = config.bgColor;
    $('bgColorText').textContent = config.bgColor;
  }
}

async function onStart() {
  const input = readInput();
  if (!isValidUsername(input.username)) {
    setMessage('请输入有效的 X 用户名（1-15 位字母、数字或下划线）');
    return;
  }
  try {
    const res = await chrome.runtime.sendMessage({ type: 'START', payload: input });
    if (res && res.ok === false) setMessage(res.error || '启动失败');
  } catch (e) {
    setMessage('启动失败：' + ((e && e.message) || e));
  }
}

async function onStop() {
  try {
    await chrome.runtime.sendMessage({ type: 'STOP' });
  } catch (e) {
    /* 忽略：后台可能已休眠 */
  }
}

function openGenerator() {
  chrome.tabs.create({ url: chrome.runtime.getURL('generator.html') });
}

function readInput() {
  const username = ($('username').value || '').trim().replace(/^@/, '').trim();
  const maxRaw = ($('maxCount').value || '').trim();
  const maxCount = maxRaw === '' || isNaN(parseInt(maxRaw, 10)) ? 'all' : Math.max(1, parseInt(maxRaw, 10));
  return {
    username,
    maxCount,
    avatarSize: parseInt($('avatarSize').value, 10) || 160,
    sortMode: (document.querySelector('input[name="sort"]:checked') || {}).value || 'default',
    bgColor: $('bgColor').value || '#dbeafe'
  };
}

function render() {
  const status = config.status || 'idle';
  const busy = BUSY.includes(status);
  $('startBtn').disabled = busy;
  $('startBtn').textContent = busy ? '制作中…' : '开始制作';
  $('stopBtn').hidden = !['collecting', 'downloading'].includes(status);
  $('statusSection').hidden = status === 'idle';

  const total = progress && progress.max && progress.max !== 'all' ? progress.max : null;
  const current = progress ? (progress.current || 0) : 0;
  const message = (progress && progress.message) || statusLabel(status);
  $('statusText').textContent = message;

  if (total) {
    $('statusCount').textContent = current + ' / ' + total;
    $('progressBar').style.width = Math.min(100, Math.round((current / total) * 100)) + '%';
  } else {
    $('statusCount').textContent = current ? String(current) : '';
    $('progressBar').style.width = status === 'done' ? '100%' : '0%';
  }
}

function setMessage(text) {
  $('statusSection').hidden = false;
  $('statusText').textContent = text;
  $('statusCount').textContent = '';
}

function statusLabel(status) {
  const map = {
    collecting: '采集中…',
    downloading: '下载头像中…',
    generating: '生成图片中…',
    done: '完成',
    error: '出错了'
  };
  return map[status] || '';
}

function isValidUsername(name) {
  return /^[A-Za-z0-9_]{1,15}$/.test(name);
}
