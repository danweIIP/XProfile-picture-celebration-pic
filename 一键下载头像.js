// ==UserScript==
// @name         X头像助手
// @namespace    https://tampermonkey.net/
// @version      0.1.2
// @updateURL    https://raw.githubusercontent.com/moaeiou/XAvatarWall/refs/heads/main/%E4%B8%80%E9%94%AE%E4%B8%8B%E8%BD%BD%E5%A4%B4%E5%83%8F.js
// @downloadURL  https://raw.githubusercontent.com/moaeiou/XAvatarWall/refs/heads/main/%E4%B8%80%E9%94%AE%E4%B8%8B%E8%BD%BD%E5%A4%B4%E5%83%8F.js
// @description  X粉丝头像自动采集工具（时间顺序版）
// @author       MoAEIOU
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  if (window.XAvatar) return;
  window.XAvatar = true;

  const NO_NEW_STOP_THRESHOLD = 6;
  const SCROLL_DELAY_MIN = 1800;
  const SCROLL_DELAY_JITTER = 1200;

  let running = false;
  let users = new Map();
  let scrollCount = 0;
  let noNew = 0;

  function sleep(t) {
    return new Promise((r) => setTimeout(r, t));
  }

  const style = document.createElement("style");
  style.textContent = `
    .xa-toggle-btn {
      position: fixed;
      right: 16px;
      bottom: 160px;
      width: 56px;
      height: 56px;
      z-index: 999;
      font-size: 22px;
      border-radius: 50%;
      border: 0;
      background: linear-gradient(135deg, #1d9bf0, #7c3aed);
      box-shadow: 0 4px 14px rgba(29, 155, 240, 0.45);
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
    }

    .xa-toggle-btn:hover {
      transform: scale(1.08) rotate(-8deg);
      box-shadow: 0 6px 20px rgba(29, 155, 240, 0.6);
      filter: brightness(1.08);
    }

    .xa-toggle-btn:active {
      transform: scale(0.94);
    }

    .xa-panel {
      position: fixed;
      right: 15px;
      bottom: 190px;
      width: 300px;
      z-index: 998;
      display: none;
      padding: 15px;
      border-radius: 15px;
      background: #111e;
      color: #fff;
      font-family: sans-serif;
    }

    .xa-panel.xa-panel-open {
      display: block;
    }

    .xa-title {
      font-size: 18px;
      font-weight: bold;
      cursor: move;
      user-select: none;
    }

    .xa-row {
      margin-top: 8px;
    }

    .xa-btn {
      width: 100%;
      margin-top: 12px;
      padding: 10px;
      border: 0;
      border-radius: 20px;
      color: #fff;
      cursor: pointer;
      transition: filter 0.2s ease, transform 0.1s ease;
    }

    .xa-btn:hover {
      filter: brightness(1.12);
    }

    .xa-btn:active {
      transform: scale(0.98);
    }

    .xa-btn-start {
      background: #1d9bf0;
    }

    .xa-btn-stop {
      background: #e0245e;
    }

    .xa-btn-export {
      background: #17bf63;
    }
  `;
  document.head.appendChild(style);

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "xa-toggle-btn";
  toggleBtn.textContent = "🖼";
  document.body.appendChild(toggleBtn);

  const panel = document.createElement("div");
  panel.className = "xa-panel";
  panel.innerHTML = `
    <div class="xa-title" id="xa-drag">X头像助手</div>

    <div class="xa-row">状态：<span id="xa-status">还未开始</span></div>
    <div class="xa-row">用户：<span id="xa-count">0</span></div>
    <div class="xa-row">头像：<span id="xa-avatar">0</span></div>
    <div class="xa-row">滚动：<span id="xa-scroll">0</span></div>

    <button class="xa-btn xa-btn-start" id="xa-start">开始采集</button>
    <button class="xa-btn xa-btn-stop" id="xa-stop">停止</button>
    <button class="xa-btn xa-btn-export" id="xa-export">导出为TOML文件</button>
  `;
  document.body.appendChild(panel);

  toggleBtn.onclick = () => {
    panel.classList.toggle("xa-panel-open");
  };

  function scan() {
    const before = users.size;

    document.querySelectorAll('[data-testid="UserCell"]').forEach((cell) => {
      const a = cell.querySelector('a[href^="/"]');
      if (!a) return;

      const username = a.getAttribute("href").replace("/", "").split("/")[0];
      if (!username) return;

      const img = cell.querySelector("img");
      const avatar = img ? img.src || "" : "";

      if (!avatar) return;

      const existing = users.get(username);
      if (existing) {
        existing.avatar = avatar;
        return;
      }

      users.set(username, {
        username: username,
        avatar: avatar,
        time: Date.now(),
        order: users.size + 1,
      });
    });

    const added = users.size - before;
    noNew = added === 0 ? noNew + 1 : 0;

    document.querySelector("#xa-count").textContent = users.size;
    document.querySelector("#xa-avatar").textContent = [
      ...users.values(),
    ].filter((u) => u.avatar).length;
  }

  async function run() {
    while (running) {
      document.querySelector("#xa-status").textContent = "扫描中";
      scan();
      document.querySelector("#xa-scroll").textContent = scrollCount;

      if (noNew >= NO_NEW_STOP_THRESHOLD) {
        document.querySelector("#xa-status").textContent = "没有新增，自动停止";
        running = false;
        break;
      }

      document.querySelector("#xa-status").textContent = "加载中";
      window.scrollBy(0, window.innerHeight * 0.8);
      scrollCount++;

      await sleep(SCROLL_DELAY_MIN + Math.random() * SCROLL_DELAY_JITTER);
    }
  }

  document.querySelector("#xa-start").onclick = () => {
    if (running) return;
    running = true;
    scrollCount = 0;
    noNew = 0;
    run();
  };

  document.querySelector("#xa-stop").onclick = () => {
    running = false;
    document.querySelector("#xa-status").textContent = "已停止";
  };

  document.querySelector("#xa-export").onclick = () => {
    const list = [...users.values()].filter((u) => u.avatar);

    const tomlString = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    const lines = [];
    for (const u of list) {
      lines.push("[[avatar]]");
      lines.push('username = "' + tomlString(u.username) + '"');
      lines.push('avatar = "' + tomlString(u.avatar) + '"');
      lines.push("time = " + u.time);
      lines.push("order = " + u.order);
      lines.push("");
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "X_avatar_" + Date.now() + ".toml";
    a.click();

    URL.revokeObjectURL(url);
  };

  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  const dragHandle = document.querySelector("#xa-drag");

  dragHandle.onmousedown = (e) => {
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
  };

  document.onmousemove = (e) => {
    if (!dragging) return;
    panel.style.left = e.clientX - dragOffsetX + "px";
    panel.style.top = e.clientY - dragOffsetY + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  };

  document.onmouseup = () => {
    dragging = false;
  };

  setTimeout(scan, 2000);
})();
