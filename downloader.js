// 头像下载器：抓取头像 Blob 并写入 IndexedDB 缓存，带重试与去重。

globalThis.Downloader = (() => {
  async function download(fans, onProgress, signal) {
    const list = fans || [];
    const results = new Array(list.length);
    const seenUrls = new Set();
    let done = 0;
    let failed = 0;
    let cursor = 0;
    const CONCURRENCY = 8;

    const worker = async () => {
      while (true) {
        if (signal && signal.aborted) break;
        const idx = cursor++;
        if (idx >= list.length) break;

        const fan = list[idx];
        if (!fan || !fan.avatar) {
          results[idx] = { ...(fan || {}), cached: false };
          failed++;
        } else {
          let blob = null;
          if (!seenUrls.has(fan.avatar)) {
            seenUrls.add(fan.avatar);
            blob = await AvatarCache.get(fan.avatar);
            if (!blob) {
              blob = await fetchWithRetry(fan.avatar, 3);
              if (blob) {
                try {
                  await AvatarCache.put(fan.avatar, blob);
                } catch (e) {
                  /* 缓存失败不影响本次使用 */
                }
              }
            }
          } else {
            blob = await AvatarCache.get(fan.avatar);
          }
          results[idx] = { ...fan, cached: !!blob };
          if (!blob) failed++;
        }

        done++;
        if (onProgress) {
          try {
            await onProgress({ done, total: list.length, failed });
          } catch (e) {
            /* 忽略进度回调异常 */
          }
        }
      }
    };

    const workerCount = Math.max(1, Math.min(CONCURRENCY, list.length));
    await Promise.all(Array.from({ length: workerCount }, worker));

    return { results, failed, ok: results.filter((r) => r && r.cached) };
  }

  async function fetchWithRetry(url, attempts) {
    for (let i = 0; i < attempts; i++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(url, { credentials: 'omit', signal: controller.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        if (!blob || blob.size === 0) throw new Error('空图片');
        return blob;
      } catch (e) {
        if (i === attempts - 1) return null;
        await sleep(500 * (i + 1));
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  return { download, fetchWithRetry };
})();
