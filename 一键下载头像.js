// ==UserScript==
// @name         X头像助手 v0.7 自动采集
// @namespace    http://tampermonkey.net/
// @version      0.7
// @description  X粉丝头像自动采集工具（时间顺序版）
// @author       Qiujiu
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  if (window.XAvatar070) return;
  window.XAvatar070 = true;

  const VERSION = "v0.7";

  let running = false;

  let users = new Map();

  let scrollCount = 0;

  let startTime = 0;

  let noNew = 0;

  function sleep(t) {
    return new Promise((r) => setTimeout(r, t));
  }

  // 按钮

  const btn = document.createElement("button");

  btn.textContent = "📷";

  btn.style.cssText = `

position:fixed;
right:20px;
bottom:120px;

width:58px;
height:58px;

border-radius:50%;
border:0;

background:#1d9bf0;
color:white;

font-size:25px;

z-index:999999;

`;

  document.body.appendChild(btn);

  // 面板

  const panel = document.createElement("div");

  panel.style.cssText = `

position:fixed;

right:15px;
bottom:190px;

width:300px;

background:#111e;

color:white;

padding:15px;

border-radius:15px;

z-index:999998;

font-family:sans-serif;

display:none;

`;

  panel.innerHTML = `

<div id="drag"
style="font-size:18px;font-weight:bold;">
📷 X头像助手 ${VERSION}
</div>


<br>


状态：
<span id="status">
等待
</span>

<br><br>


用户：
<span id="count">
0
</span>


<br>


头像：
<span id="avatar">
0
</span>


<br>


滚动：
<span id="scroll">
0
</span>


<br>


时间：
<span id="time">
0
</span>


<br><br>


<button id="start"
style="width:100%;padding:10px;background:#1d9bf0;color:white;border:0;border-radius:20px;">
开始采集
</button>


<br><br>


<button id="stop"
style="width:100%;padding:10px;background:#e0245e;color:white;border:0;border-radius:20px;">
停止
</button>


<br><br>


<button id="export"
style="width:100%;padding:10px;background:#17bf63;color:white;border:0;border-radius:20px;">
导出JSON
</button>


`;

  document.body.appendChild(panel);

  btn.onclick = () => {
    panel.style.display = panel.style.display == "none" ? "block" : "none";
  };

  // 扫描

  function scan() {
    let before = users.size;

    document.querySelectorAll('[data-testid="UserCell"]').forEach((cell) => {
      let a = cell.querySelector('a[href^="/"]');

      if (!a) return;

      let username = a.getAttribute("href").replace("/", "").split("/")[0];

      if (!username) return;

      let img = cell.querySelector("img");

      let avatar = "";

      if (img) {
        avatar = img.src || "";
      }

      // 新用户

      if (!users.has(username)) {
        users.set(username, {
          username: username,

          avatar: avatar,

          time: Date.now(),

          // 核心：发现顺序

          order: users.size + 1,
        });
      }
    });

    let add = users.size - before;

    if (add == 0) noNew++;
    else noNew = 0;

    document.querySelector("#count").textContent = users.size;

    document.querySelector("#avatar").textContent = [...users.values()].filter(
      (x) => x.avatar,
    ).length;
  }

  // 时间

  setInterval(() => {
    if (startTime) {
      let s = Math.floor((Date.now() - startTime) / 1000);

      document.querySelector("#time").textContent = s + "秒";
    }
  }, 1000);

  async function run() {
    while (running) {
      document.querySelector("#status").textContent = "扫描中";

      scan();

      document.querySelector("#scroll").textContent = scrollCount;

      if (noNew >= 6) {
        document.querySelector("#status").textContent = "没有新增，自动停止";

        running = false;

        break;
      }

      document.querySelector("#status").textContent = "加载中";

      window.scrollBy(0, window.innerHeight * 0.8);

      scrollCount++;

      await sleep(1800 + Math.random() * 1200);
    }
  }

  document.querySelector("#start").onclick = () => {
    if (running) return;

    running = true;

    startTime = Date.now();

    scrollCount = 0;

    noNew = 0;

    run();
  };

  document.querySelector("#stop").onclick = () => {
    running = false;

    document.querySelector("#status").textContent = "已停止";
  };

  // 导出

  document.querySelector("#export").onclick = () => {
    let data = JSON.stringify([...users.values()], null, 2);

    let blob = new Blob([data], {
      type: "application/json",
    });

    let url = URL.createObjectURL(blob);

    let a = document.createElement("a");

    a.href = url;

    a.download = "X_avatar_v0.7_" + Date.now() + ".json";

    a.click();

    URL.revokeObjectURL(url);
  };

  // 拖动

  let drag = false;

  let dx = 0;

  let dy = 0;

  let title = document.querySelector("#drag");

  title.onmousedown = (e) => {
    drag = true;

    let r = panel.getBoundingClientRect();

    dx = e.clientX - r.left;

    dy = e.clientY - r.top;
  };

  document.onmousemove = (e) => {
    if (!drag) return;

    panel.style.left = e.clientX - dx + "px";

    panel.style.top = e.clientY - dy + "px";

    panel.style.right = "auto";

    panel.style.bottom = "auto";
  };

  document.onmouseup = () => {
    drag = false;
  };

  setTimeout(() => {
    scan();
  }, 2000);
})();
