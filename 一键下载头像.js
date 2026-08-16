// ==UserScript==
// @name         X头像助手
// @namespace    http://tampermonkey.net/
// @version      0.1.0
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

  // ---------- 常量 ----------
  const NO_NEW_STOP_THRESHOLD = 6; // 连续多少次滚动没有新用户就自动停止
  const SCROLL_DELAY_MIN = 1800; // 每次滚动之间的最小间隔（毫秒）
  const SCROLL_DELAY_JITTER = 1200; // 随机抖动区间，避免固定节奏过于像脚本

  // ---------- 状态 ----------
  let running = false;
  let users = new Map();
  let scrollCount = 0;
  let startTime = 0;
  let noNew = 0;

  function sleep(t) {
    return new Promise((r) => setTimeout(r, t));
  }

  // ---------- 样式：集中定义在一个 <style> 块里，不再逐个元素写 inline style ----------
  const style = document.createElement("style");
  style.textContent = `
    .xa-toggle-btn {
      position: fixed;
      right: 12px;
      bottom: 160px;
      width: 55px;
      height: 55px;
      z-index: 999;
      font-size: 20px;
      border-radius: 10%;
      border: 0;
      background: #ffffffd9;
      outline: 1px solid #000;
      cursor: pointer;
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

  // ---------- 悬浮按钮 ----------
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "xa-toggle-btn";
  toggleBtn.textContent = "🖼";
  document.body.appendChild(toggleBtn);

  // ---------- 面板 ----------
  const panel = document.createElement("div");
  panel.className = "xa-panel";
  panel.innerHTML = `
    <div class="xa-title" id="xa-drag">X头像助手</div>

    <div class="xa-row">状态：<span id="xa-status">还未开始</span></div>
    <div class="xa-row">用户：<span id="xa-count">0</span></div>
    <div class="xa-row">头像：<span id="xa-avatar">0</span></div>
    <div class="xa-row">滚动：<span id="xa-scroll">0</span></div>
    <div class="xa-row">耗时：<span id="xa-time">0</span></div>

    <button class="xa-btn xa-btn-start" id="xa-start">开始采集</button>
    <button class="xa-btn xa-btn-stop" id="xa-stop">停止</button>
    <button class="xa-btn xa-btn-export" id="xa-export">导出为JSON文件</button>
  `;
  document.body.appendChild(panel);

  toggleBtn.onclick = () => {
    panel.classList.toggle("xa-panel-open");
  };

  // ---------- 扫描粉丝卡片 ----------
  function scan() {
    const before = users.size;

    document.querySelectorAll('[data-testid="UserCell"]').forEach((cell) => {
      const a = cell.querySelector('a[href^="/"]');
      if (!a) return;

      const username = a.getAttribute("href").replace("/", "").split("/")[0];
      if (!username) return;

      const img = cell.querySelector("img");
      const avatar = img ? img.src || "" : "";

      if (!users.has(username)) {
        users.set(username, {
          username: username,
          avatar: avatar,
          time: Date.now(),
          order: users.size + 1, // 发现顺序
        });
      }
    });

    const added = users.size - before;
    noNew = added === 0 ? noNew + 1 : 0;

    document.querySelector("#xa-count").textContent = users.size;
    document.querySelector("#xa-avatar").textContent = [...users.values()].filter(
      (u) => u.avatar,
    ).length;
  }

  // ---------- 计时显示 ----------
  setInterval(() => {
    if (!startTime) return;
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    document.querySelector("#xa-time").textContent = seconds + "秒";
  }, 1000);

  // ---------- 主循环：滚动 + 扫描 ----------
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
    startTime = Date.now();
    scrollCount = 0;
    noNew = 0;
    run();
  };

  document.querySelector("#xa-stop").onclick = () => {
    running = false;
    document.querySelector("#xa-status").textContent = "已停止";
  };

  // ---------- 导出 JSON ----------
  document.querySelector("#xa-export").onclick = () => {
    const data = JSON.stringify([...users.values()], null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "X_avatar_" + Date.now() + ".json";
    a.click();

    URL.revokeObjectURL(url);
  };

  // ---------- 面板拖动 ----------
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

  // ---------- 初始扫描一次，方便打开面板就能看到当前已加载的粉丝数 ----------
  setTimeout(scan, 2000);
})();
