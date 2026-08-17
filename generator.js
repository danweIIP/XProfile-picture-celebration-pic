(() => {
  const $ = (id) => document.getElementById(id);
  let currentBlob = null;

  document.addEventListener('DOMContentLoaded', () => {
    $('saveBtn').addEventListener('click', () => {
      if (currentBlob) downloadBlob(currentBlob);
    });
    $('againBtn').addEventListener('click', () => {
      run();
    });
    run();
  });

  async function run() {
    $('saveBtn').disabled = true;
    $('againBtn').disabled = true;
    $('preview').style.display = 'none';
    $('meta').textContent = '';
    setProgress(0);

    let stored;
    try {
      stored = await chrome.storage.local.get(['config', 'fansData', 'progress']);
    } catch (e) {
      setStatus('读取数据失败：' + ((e && e.message) || e));
      return;
    }

    const config = stored.config || {};
    const fansData = stored.fansData || { fans: [] };
    const fans = (fansData.fans || []).filter((f) => f && f.avatar);
    if (!fans.length) {
      setStatus('没有可用的头像数据，请先在扩展弹窗中开始制作。');
      return;
    }

    const sorted = sortFans(fans, config.sortMode);
    const size = clampInt(config.avatarSize, 40, 400, 160);
    const bgColor = config.bgColor || '#dbeafe';

    setStatus('正在加载头像…');
    const loaded = await loadAvatars(sorted, (done, total) => {
      setProgress(done / total);
      setStatus(`正在加载头像 ${done}/${total}…`);
    });

    const ok = loaded.filter((x) => x && x.blob);
    if (!ok.length) {
      setStatus('头像加载失败，请检查网络后重新打开此页面。');
      await chrome.storage.local.set({ config: { ...config, status: 'error', active: false } }).catch(() => {});
      return;
    }

    setStatus('正在绘制头像墙…');
    const blob = await drawWall(ok, size, bgColor);
    if (!blob) {
      setStatus('图片生成失败。');
      return;
    }

    currentBlob = blob;
    const previewUrl = URL.createObjectURL(blob);
    $('preview').src = previewUrl;
    $('preview').style.display = 'block';
    $('saveBtn').disabled = false;
    $('againBtn').disabled = false;
    $('meta').textContent = `${ok.length} 位关注者 · ${size}px · JPEG 95%`;
    setProgress(1);
    setStatus('生成完成');

    await chrome.storage.local.set({
      config: { ...config, status: 'done', active: false },
      progress: { current: ok.length, max: ok.length, message: '完成' }
    }).catch(() => {});

    autoDownload(blob);
  }

  function sortFans(fans, mode) {
    const arr = fans.slice();
    if (mode === 'old') {
      return arr.sort((a, b) => (b.index || 0) - (a.index || 0));
    }
    // 'default' 与 'new' 都保持 X 原始显示顺序
    return arr.sort((a, b) => (a.index || 0) - (b.index || 0));
  }

  async function loadAvatars(fans, onProgress) {
    const out = new Array(fans.length);
    let done = 0;
    let cursor = 0;
    const CONCURRENCY = 8;

    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < fans.length) {
        const idx = cursor++;
        const fan = fans[idx];
        let blob = null;
        try {
          blob = await AvatarCache.get(fan.avatar);
          if (!blob) {
            blob = await Downloader.fetchWithRetry(fan.avatar, 2);
            if (blob) {
              try {
                await AvatarCache.put(fan.avatar, blob);
              } catch (e) {
                /* 缓存失败不影响本次使用 */
              }
            }
          }
        } catch (e) {
          blob = null;
        }
        out[idx] = { fan, blob };
        done++;
        onProgress(done, fans.length);
      }
    });

    await Promise.all(workers);
    return out;
  }

  async function drawWall(items, size, bgColor) {
    const count = items.length;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const gap = Math.max(3, Math.round(size / 40));

    const pad = Math.round(size * 0.5);
    const headerH = Math.round(size * 0.72);
    const footerH = Math.round(size * 0.5);
    const gridW = cols * size + (cols - 1) * gap;
    const gridH = rows * size + (rows - 1) * gap;
    const W = Math.max(1, gridW + pad * 2);
    const H = Math.max(1, pad + headerH + gridH + footerH + pad);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);

    const textColor = contrastColor(bgColor);
    const titleFont = Math.max(24, Math.round(size * 0.28));
    const footFont = Math.max(14, Math.round(size * 0.16));

    ctx.fillStyle = '#2563eb';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${titleFont}px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif`;
    ctx.fillText(`恭喜我 ${count} fo`, W / 2, pad + headerH / 2);

    const bitmaps = [];
    for (const item of items) {
      try {
        bitmaps.push(await createImageBitmap(item.blob));
      } catch (e) {
        bitmaps.push(null);
      }
    }

    const radius = Math.max(0, Math.round(size * 0.18));
    items.forEach((item, idx) => {
      const bmp = bitmaps[idx];
      if (!bmp) return;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = pad + col * (size + gap);
      const y = pad + headerH + row * (size + gap);

      ctx.save();
      roundRect(ctx, x, y, size, size, radius);
      ctx.clip();
      const sw = bmp.width;
      const sh = bmp.height;
      const s = Math.min(sw, sh);
      const sx = (sw - s) / 2;
      const sy = (sh - s) / 2;
      ctx.drawImage(bmp, sx, sy, s, s, x, y, size, size);
      ctx.restore();

      if (typeof bmp.close === 'function') bmp.close();
    });

    ctx.fillStyle = textColor;
    ctx.font = `${footFont}px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif`;
    ctx.fillText('XAvatarWall · X@qiujiudev', W / 2, H - pad - footerH / 2);

    return new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.95);
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function contrastColor(hex) {
    const { r, g, b } = parseHex(hex);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 150 ? '#0f172a' : '#ffffff';
  }

  function parseHex(hex) {
    let h = (hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h || 'dbeafe', 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function downloadBlob(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'XAvatarWall.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  function autoDownload(blob) {
    try {
      downloadBlob(blob);
    } catch (e) {
      /* 若浏览器拦截无手势下载，用户可点击“保存 JPG” */
    }
  }

  function setStatus(text) {
    $('status').textContent = text;
  }

  function setProgress(frac) {
    $('fill').style.width = Math.min(100, Math.round(frac * 100)) + '%';
  }

  function clampInt(v, min, max, def) {
    const n = parseInt(v, 10);
    if (isNaN(n)) return def;
    return Math.min(max, Math.max(min, n));
  }
})();
