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
    $('toggleSettings').addEventListener('click', () => {
      $('settingsPanel').hidden = !$('settingsPanel').hidden;
    });
    $('cfgBg').addEventListener('input', () => {
      $('cfgBgText').textContent = $('cfgBg').value;
    });
    $('cfgTitleColor').addEventListener('input', () => {
      $('cfgTitleColorText').textContent = $('cfgTitleColor').value;
    });
    $('cfgStyle').addEventListener('change', () => {
      toggleGradientColors();
    });
    $('saveSettings').addEventListener('click', async () => {
      const stored = await chrome.storage.local.get(['config']).catch(() => ({}));
      const cfg = Object.assign({}, stored.config || {}, {
        genTitle: $('cfgTitle').value.trim(),
        genExtraText: $('cfgExtraText').value.trim(),
        genStyle: $('cfgStyle').value,
        bgColor: $('cfgBg').value,
        genShape: $('cfgShape').value,
        genTitleColor: $('cfgTitleColor').value,
        genHighlight: document.querySelector('input[name="cfgHighlight"]:checked').value,
        genGap: $('cfgGap').value,
        genColorA: $('cfgColorA').value,
        genColorB: $('cfgColorB').value
      });
      await chrome.storage.local.set({ config: cfg }).catch(() => {});
      setStatus('设置已保存，正在重新生成…');
      run();
    });
    loadSettings();
    run();
  });

  async function loadSettings() {
    const stored = await chrome.storage.local.get(['config']).catch(() => ({}));
    const cfg = stored.config || {};
    if (cfg.genTitle !== undefined) $('cfgTitle').value = cfg.genTitle;
    if (cfg.genExtraText !== undefined) $('cfgExtraText').value = cfg.genExtraText;
    if (cfg.genStyle) $('cfgStyle').value = cfg.genStyle;
    if (cfg.bgColor) {
      $('cfgBg').value = cfg.bgColor;
      $('cfgBgText').textContent = cfg.bgColor;
    }
    if (cfg.genShape) $('cfgShape').value = cfg.genShape;
    if (cfg.genTitleColor) {
      $('cfgTitleColor').value = cfg.genTitleColor;
      $('cfgTitleColorText').textContent = cfg.genTitleColor;
    }
    if (cfg.genColorA) {
      $('cfgColorA').value = cfg.genColorA;
      $('cfgColorAText').textContent = cfg.genColorA;
    }
    if (cfg.genColorB) {
      $('cfgColorB').value = cfg.genColorB;
      $('cfgColorBText').textContent = cfg.genColorB;
    }
    if (cfg.genHighlight) {
      const radio = document.querySelector(`input[name="cfgHighlight"][value="${cfg.genHighlight}"]`);
      if (radio) radio.checked = true;
    }
    if (cfg.genGap) $('cfgGap').value = cfg.genGap;
    toggleGradientColors();
  }

  function toggleGradientColors() {
    const style = $('cfgStyle').value;
    $('genColorRow').hidden = !/^gradient/.test(style);
  }

  async function run() {
    $('saveBtn').disabled = true;
    $('againBtn').disabled = true;
    $('preview').style.display = 'none';
    $('meta').textContent = '';
    setProgress(0);

    let stored;
    try {
      stored = await chrome.storage.local.get(['config', 'fansData', 'progress', 'meProfile']);
    } catch (e) {
      setStatus('读取数据失败：' + ((e && e.message) || e));
      return;
    }

    const config = stored.config || {};
    const fansData = stored.fansData || { fans: [] };
    const meProfile = stored.meProfile || null;
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

    // 加载“我自己”的头像（用于左上角大图）。
    let meBitmap = null;
    if (meProfile && meProfile.avatar) {
      meBitmap = await loadOneAvatar(meProfile.avatar);
      if (meBitmap) {
        console.log('[XAvatarWall] 已加载自己的头像', meProfile.avatar.slice(0, 120));
      }
    }

    const ok = loaded.filter((x) => x && x.blob);
    if (!ok.length && !meBitmap) {
      setStatus('头像加载失败，请检查网络后重新打开此页面。');
      await chrome.storage.local.set({ config: { ...config, status: 'error', active: false } }).catch(() => {});
      return;
    }

    setStatus('正在绘制头像墙…');
    const blob = await drawWall(ok, meBitmap, meProfile, size, bgColor, config);
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

  async function loadOneAvatar(url) {
    try {
      let blob = await AvatarCache.get(url);
      if (!blob) {
        blob = await Downloader.fetchWithRetry(url, 2);
        if (blob) {
          try {
            await AvatarCache.put(url, blob);
          } catch (e) {
            /* 忽略 */
          }
        }
      }
      if (!blob) return null;
      return await createImageBitmap(blob);
    } catch (e) {
      return null;
    }
  }

  async function loadAvatars(fans, onProgress) {
    const out = new Array(fans.length);
    let done = 0;
    let cursor = 0;
    const CONCURRENCY = 8;

    // 直连兜底：缓存没有时，直接在生成页尝试下载（pbs.twimg.com 允许跨域）。
    async function fetchDirect(url) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(url, { credentials: 'include', signal: controller.signal });
        if (!res.ok) return null;
        const blob = await res.blob();
        if (!blob || blob.size === 0) return null;
        if (blob.type && !/^image\//i.test(blob.type)) return null;
        return blob;
      } catch (e) {
        console.warn('[XAvatarWall] 生成页直连下载失败', url.slice(0, 120), e && e.message ? e.message : String(e));
        return null;
      } finally {
        clearTimeout(timer);
      }
    }

    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < fans.length) {
        const idx = cursor++;
        const fan = fans[idx];
        let blob = null;
        try {
          blob = await AvatarCache.get(fan.avatar);
          if (!blob) {
            blob = await Downloader.fetchWithRetry(fan.avatar, 2);
            if (!blob) {
              blob = await fetchDirect(fan.avatar);
            }
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

  function drawBitmap(ctx, bmp, x, y, w, h, radius) {
    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    const sw = bmp.width;
    const sh = bmp.height;
    const s = Math.min(sw, sh);
    const sx = (sw - s) / 2;
    const sy = (sh - s) / 2;
    ctx.drawImage(bmp, sx, sy, s, s, x, y, w, h);
    ctx.restore();
  }

  async function drawWall(items, meBitmap, meProfile, size, bgColor, cfg) {
    const count = items.length;
    const gapMode = cfg.genGap || 'auto';
    const gap = gapMode === 'small' ? Math.max(2, Math.round(size / 70))
      : gapMode === 'wide' ? Math.max(6, Math.round(size / 18))
      : Math.max(3, Math.round(size / 40));

    const pad = Math.round(size * 0.5);
    const headerH = Math.round(size * 0.75);
    const footerH = Math.round(size * 0.5);

    const shape = cfg.genShape || 'round';
    const radius = shape === 'circle' ? size / 2 : shape === 'square' ? 0 : Math.max(0, Math.round(size * 0.18));

    const useHero = !!meBitmap && cfg.genHighlight === 'me';
    const heroH = useHero ? Math.round(size * 2.6) : 0;
    const headerTotal = useHero ? Math.max(headerH, heroH + Math.round(size * 0.35)) : headerH;

    // 计算网格行列。
    const gridCount = count;
    const cols = Math.ceil(Math.sqrt(gridCount));
    const rows = Math.ceil(gridCount / cols);
    const gridW = cols * size + (cols - 1) * gap;
    const gridH = rows * size + (rows - 1) * gap;
    const W = Math.max(1, gridW + pad * 2);
    const H = Math.max(1, pad + headerTotal + gridH + footerH + pad);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const style = cfg.genStyle || 'gradient-v';
    const colorA = cfg.genColorA || '#dbeafe';
    const colorB = cfg.genColorB || '#93c5fd';
    if (style === 'gradient-v') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, colorA);
      g.addColorStop(1, colorB);
      ctx.fillStyle = g;
    } else if (style === 'gradient-h') {
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, colorA);
      g.addColorStop(1, colorB);
      ctx.fillStyle = g;
    } else if (style === 'gradient-diag') {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, colorA);
      g.addColorStop(1, colorB);
      ctx.fillStyle = g;
    } else if (style === 'gradient-radial') {
      const g = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, colorA);
      g.addColorStop(1, colorB);
      ctx.fillStyle = g;
    } else if (style === 'dark') {
      ctx.fillStyle = '#0f172a';
    } else {
      ctx.fillStyle = bgColor;
    }
    ctx.fillRect(0, 0, W, H);

    const textColor = style === 'dark' ? '#e2e8f0' : contrastColor(bgColor);
    const titleFont = Math.max(24, Math.round(size * 0.28));
    const footFont = Math.max(14, Math.round(size * 0.16));
    const title = fillCount(cfg.genTitle || `XX fo谢谢大家，感谢大家！`, count);
    const meName = (meProfile && meProfile.name) || '';

    // ---- 顶部区域 ----
    if (useHero) {
      // 左上角：自己的大头像（带边框与光晕）
      const heroSize = Math.round(size * 2.4);
      const hx = pad;
      const hy = pad + Math.round(size * 0.15);
      ctx.save();
      ctx.shadowColor = 'rgba(37, 99, 235, 0.35)';
      ctx.shadowBlur = Math.round(size * 0.3);
      drawBitmap(ctx, meBitmap, hx, hy, heroSize, heroSize, Math.round(heroSize * 0.18));
      ctx.restore();
      // 头像右侧：感谢语 + 巨型数字
      const tx = hx + heroSize + Math.round(size * 0.5);
      const line1Font = Math.max(18, Math.round(size * 0.2));
      const line2Font = Math.max(48, Math.round(size * 0.9));
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = textColor;
      ctx.font = `500 ${line1Font}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      ctx.fillText('感谢一路相伴！', tx, pad + Math.round(size * 0.55));
      if (meName) {
        ctx.font = `500 ${Math.max(14, Math.round(size * 0.16))}px "Segoe UI", "Microsoft YaHei", sans-serif`;
        ctx.fillText('@' + (meProfile.username || '') + ' · ' + meName, tx, pad + Math.round(size * 1.05));
      }
      ctx.fillStyle = cfg.genTitleColor || '#2563eb';
      ctx.font = `700 ${line2Font}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      ctx.fillText(String(count) + ' followers！', tx, pad + Math.round(size * 1.7));

      // 顶部其他文字（如自定义标题）放在下方一行
      if (title && title !== `恭喜我 ${count} fo`) {
        ctx.fillStyle = textColor;
        ctx.font = `600 ${titleFont}px "Segoe UI", "Microsoft YaHei", sans-serif`;
        ctx.fillText(title, tx, pad + Math.round(size * 2.25));
      }
    } else {
      ctx.fillStyle = cfg.genTitleColor || '#2563eb';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${titleFont}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      ctx.fillText(title, W / 2, pad + headerH / 2);
    }

    // ---- 头像网格 ----
    const bitmaps = [];
    for (const item of items) {
      try {
        bitmaps.push(await createImageBitmap(item.blob));
      } catch (e) {
        bitmaps.push(null);
      }
    }

    const gridTop = pad + headerTotal + Math.round(size * 0.15);
    const centerMode = !!meBitmap && cfg.genHighlight === 'center';

    if (centerMode) {
      // 居中放大：自己的头像放到网格中央，盖在小网格之上。
      const centerSize = Math.round(size * 2.6);
      const cx = (W - centerSize) / 2;
      const cy = gridTop + Math.max(0, (gridH - centerSize) / 2);
      // 先画普通网格
      const gridLeft = pad + (W - pad * 2 - gridW) / 2;
      items.forEach((item, idx) => {
        const bmp = bitmaps[idx];
        if (!bmp) return;
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = gridLeft + col * (size + gap);
        const y = gridTop + row * (size + gap);
        drawBitmap(ctx, bmp, x, y, size, size, radius);
        if (typeof bmp.close === 'function') bmp.close();
      });
      // 再画居中的大图（带光晕）
      ctx.save();
      ctx.shadowColor = 'rgba(37, 99, 235, 0.4)';
      ctx.shadowBlur = Math.round(size * 0.4);
      drawBitmap(ctx, meBitmap, cx, cy, centerSize, centerSize, Math.round(centerSize * 0.2));
      ctx.restore();
    } else {
      const gridLeft = pad + (W - pad * 2 - gridW) / 2;
      items.forEach((item, idx) => {
        const bmp = bitmaps[idx];
        if (!bmp) return;
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = gridLeft + col * (size + gap);
        const y = gridTop + row * (size + gap);
        drawBitmap(ctx, bmp, x, y, size, size, radius);
        if (typeof bmp.close === 'function') bmp.close();
      });
    }

    // ---- 底部：图片下方文字 ----
    const extra = cfg.genExtraText || '';
    const footCenter = H - pad - footerH / 2;
    if (extra) {
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${footFont}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      ctx.fillText(extra, W / 2, footCenter);
    }

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

  function shade(hex, factor) {
    let h = String(hex || '#ffffff').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    if (isNaN(n)) return '#ffffff';
    let r = (n >> 16) & 255;
    let g = (n >> 8) & 255;
    let b = n & 255;
    r = Math.max(0, Math.min(255, Math.round(r + 255 * factor)));
    g = Math.max(0, Math.min(255, Math.round(g + 255 * factor)));
    b = Math.max(0, Math.min(255, Math.round(b + 255 * factor)));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  function fillCount(text, count) {
    return String(text || '')
      .replace(/\{count\}/gi, String(count))
      .replace(/XX/gi, String(count));
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
