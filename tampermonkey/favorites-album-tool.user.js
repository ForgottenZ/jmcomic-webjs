// ==UserScript==
// @name         Favorites Album Collector
// @namespace    jmcomic-webjs
// @version      0.1.0
// @description  Collect favorites_album IDs across pages with export/import and favorite tools.
// @match        https://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  "use strict";

  const STORAGE_KEY = "jm_favorites_album_tool_v1";
  const DEFAULT_FOLDER_ID = "default";
  const DEFAULT_FOLDER_NAME = "全部";
  const DEFAULT_SETTINGS = {
    favoriteIntervalMs: 3000,
    favoriteFid: 0,
  };

  const host = window.location.host;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const loadState = () => {
    const raw = GM_getValue(STORAGE_KEY, "");
    if (!raw) {
      return {
        approvedDomains: [],
        domains: {},
      };
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn("[FavoritesAlbumTool] Failed to parse state.", error);
      return { approvedDomains: [], domains: {} };
    }
  };

  const saveState = (state) => {
    GM_setValue(STORAGE_KEY, JSON.stringify(state));
  };

  const ensureDomainState = (state) => {
    if (!state.domains[host]) {
      state.domains[host] = {
        folders: {
          [DEFAULT_FOLDER_ID]: { name: DEFAULT_FOLDER_NAME, items: {} },
        },
        folderOrder: [DEFAULT_FOLDER_ID],
        currentFolderId: DEFAULT_FOLDER_ID,
        scan: {
          running: false,
          maxPages: null,
        },
        settings: { ...DEFAULT_SETTINGS },
      };
    }
    return state.domains[host];
  };

  const approveDomainIfNeeded = () => {
    const state = loadState();
    if (!state.approvedDomains.includes(host)) {
      GM_registerMenuCommand("认可此域名", () => {
        const refreshed = loadState();
        if (!refreshed.approvedDomains.includes(host)) {
          refreshed.approvedDomains.push(host);
          saveState(refreshed);
          alert(`已认可域名：${host}，请刷新页面使脚本生效。`);
        }
      });
      return false;
    }
    return true;
  };

  if (!approveDomainIfNeeded()) {
    return;
  }

  const state = loadState();
  const domainState = ensureDomainState(state);
  saveState(state);

  GM_registerMenuCommand("取消认可此域名", () => {
    const refreshed = loadState();
    refreshed.approvedDomains = refreshed.approvedDomains.filter(
      (item) => item !== host
    );
    saveState(refreshed);
    alert(`已取消认可域名：${host}`);
  });

  GM_addStyle(`
    .jm-fav-tool {
      position: fixed;
      top: 60px;
      right: 30px;
      z-index: 99999;
      width: 360px;
      background: #111827;
      color: #f9fafb;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .jm-fav-tool.hidden { display: none; }
    .jm-fav-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: #1f2937;
      border-radius: 12px 12px 0 0;
      cursor: move;
      user-select: none;
    }
    .jm-fav-header h3 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
    }
    .jm-fav-header button {
      background: transparent;
      border: none;
      color: #f9fafb;
      cursor: pointer;
      font-size: 14px;
    }
    .jm-fav-body {
      padding: 10px 12px 12px;
    }
    .jm-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }
    .jm-row label {
      min-width: 64px;
      font-weight: 600;
      color: #e5e7eb;
    }
    .jm-row select,
    .jm-row input,
    .jm-row textarea {
      flex: 1;
      background: #0f172a;
      border: 1px solid #334155;
      color: #e5e7eb;
      border-radius: 6px;
      padding: 4px 6px;
      font-size: 12px;
    }
    .jm-row textarea { height: 80px; }
    .jm-btn {
      background: #2563eb;
      border: none;
      color: #fff;
      padding: 4px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
    }
    .jm-btn.secondary { background: #374151; }
    .jm-btn.danger { background: #b91c1c; }
    .jm-preview {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: 10px;
      background: #0b1220;
      border-radius: 10px;
      padding: 8px;
      margin-bottom: 8px;
    }
    .jm-preview img {
      width: 100%;
      border-radius: 6px;
      background: #0f172a;
    }
    .jm-preview .jm-info {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .jm-preview .jm-id {
      font-weight: 600;
      color: #93c5fd;
      text-decoration: none;
    }
    .jm-list {
      max-height: 140px;
      overflow-y: auto;
      border: 1px solid #1f2937;
      border-radius: 8px;
      padding: 6px;
      margin-bottom: 8px;
      background: #0b1220;
    }
    .jm-list-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 6px;
      border-radius: 6px;
      cursor: pointer;
    }
    .jm-list-item.active { background: #1e293b; }
    .jm-list-item span { color: #e5e7eb; }
    .jm-subtitle {
      color: #9ca3af;
      font-size: 11px;
    }
    .jm-pill {
      background: #334155;
      color: #e2e8f0;
      border-radius: 999px;
      padding: 2px 6px;
      font-size: 10px;
    }
    .jm-section-title {
      margin: 8px 0 6px;
      font-weight: 600;
      color: #e5e7eb;
    }
    .jm-footer {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
  `);

  const ui = document.createElement("div");
  ui.className = "jm-fav-tool";
  ui.innerHTML = `
    <div class="jm-fav-header">
      <h3>收藏夹采集助手</h3>
      <button data-action="close" title="关闭">✕</button>
    </div>
    <div class="jm-fav-body">
      <div class="jm-row">
        <label>文件夹</label>
        <select data-role="folder-select"></select>
        <button class="jm-btn secondary" data-action="add-folder">新增</button>
        <button class="jm-btn danger" data-action="delete-folder">删除</button>
      </div>
      <div class="jm-preview">
        <img data-role="preview-image" alt="album" />
        <div class="jm-info">
          <a class="jm-id" data-role="preview-link" href="#" target="_blank">ID：--</a>
          <div class="jm-subtitle" data-role="preview-time">加入时间：--</div>
          <div class="jm-row">
            <button class="jm-btn secondary" data-action="copy-id">复制ID</button>
            <button class="jm-btn secondary" data-action="open-album">打开专辑</button>
          </div>
        </div>
      </div>
      <div class="jm-section-title">已收集ID</div>
      <div class="jm-list" data-role="id-list"></div>
      <div class="jm-row">
        <button class="jm-btn" data-action="start-scan">开始/继续扫描</button>
        <button class="jm-btn secondary" data-action="stop-scan">停止扫描</button>
      </div>
      <div class="jm-section-title">导出 / 导入</div>
      <div class="jm-row">
        <button class="jm-btn" data-action="export-current">导出当前</button>
        <button class="jm-btn secondary" data-action="export-all">导出全部</button>
      </div>
      <div class="jm-row">
        <button class="jm-btn secondary" data-action="import-current">导入到当前</button>
        <button class="jm-btn secondary" data-action="import-all">导入全部</button>
      </div>
      <div class="jm-section-title">一键收藏设置</div>
      <div class="jm-row">
        <label>fid</label>
        <input type="number" data-role="fav-fid" />
      </div>
      <div class="jm-row">
        <label>间隔(ms)</label>
        <input type="number" data-role="fav-interval" />
      </div>
      <div class="jm-row">
        <button class="jm-btn" data-action="start-favorite">一键收藏</button>
        <button class="jm-btn secondary" data-action="stop-favorite">停止收藏</button>
      </div>
      <div class="jm-footer">
        <span class="jm-pill" data-role="status">未开始扫描</span>
      </div>
    </div>
  `;
  document.body.appendChild(ui);

  const statusEl = ui.querySelector('[data-role="status"]');
  const folderSelect = ui.querySelector('[data-role="folder-select"]');
  const listEl = ui.querySelector('[data-role="id-list"]');
  const previewImage = ui.querySelector('[data-role="preview-image"]');
  const previewLink = ui.querySelector('[data-role="preview-link"]');
  const previewTime = ui.querySelector('[data-role="preview-time"]');
  const favFidInput = ui.querySelector('[data-role="fav-fid"]');
  const favIntervalInput = ui.querySelector('[data-role="fav-interval"]');

  let selectedId = null;
  let favoriteTask = { running: false };

  const formatTime = (timestamp) => {
    if (!timestamp) return "--";
    const date = new Date(timestamp);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  };

  const getFolder = () =>
    domainState.folders[domainState.currentFolderId];

  const setStatus = (text) => {
    statusEl.textContent = text;
  };

  const saveDomainState = () => {
    const fresh = loadState();
    const storedDomain = ensureDomainState(fresh);
    fresh.domains[host] = { ...storedDomain, ...domainState };
    saveState(fresh);
  };

  const updateFolderSelect = () => {
    folderSelect.innerHTML = "";
    domainState.folderOrder.forEach((id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = domainState.folders[id].name;
      if (id === domainState.currentFolderId) {
        option.selected = true;
      }
      folderSelect.appendChild(option);
    });
  };

  const renderList = () => {
    const folder = getFolder();
    const items = Object.values(folder.items).sort(
      (a, b) => b.addedAt - a.addedAt
    );
    listEl.innerHTML = "";
    if (!items.length) {
      listEl.innerHTML = `<div class="jm-subtitle">暂无数据</div>`;
      return;
    }
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = `jm-list-item${
        selectedId === item.id ? " active" : ""
      }`;
      row.innerHTML = `
        <span>${item.id}</span>
        <span class="jm-subtitle">${formatTime(item.addedAt)}</span>
      `;
      row.addEventListener("click", () => {
        selectedId = item.id;
        renderPreview();
        renderList();
      });
      listEl.appendChild(row);
    });
  };

  const renderPreview = () => {
    const folder = getFolder();
    const item = selectedId ? folder.items[selectedId] : null;
    if (!item) {
      previewImage.src = "";
      previewImage.alt = "album";
      previewLink.textContent = "ID：--";
      previewLink.href = "#";
      previewTime.textContent = "加入时间：--";
      return;
    }
    const imageUrl = `${window.location.protocol}//${host}/media/albums/${item.id}_3x4.jpg`;
    previewImage.src = imageUrl;
    previewImage.alt = `album-${item.id}`;
    previewLink.textContent = `ID：${item.id}`;
    previewLink.href = `${window.location.protocol}//${host}/album/${item.id}/`;
    previewTime.textContent = `加入时间：${formatTime(item.addedAt)}`;
  };

  const addIdsToFolder = (ids) => {
    const folder = getFolder();
    let added = 0;
    ids.forEach((id) => {
      if (!folder.items[id]) {
        folder.items[id] = { id, addedAt: Date.now() };
        added += 1;
      }
    });
    if (!selectedId && ids.length) {
      selectedId = ids[0];
    }
    if (added > 0) {
      saveDomainState();
      renderList();
      renderPreview();
    }
    return added;
  };

  const extractIdsFromPage = () => {
    const elements = document.querySelectorAll('[id^="favorites_album_"]');
    const ids = [];
    elements.forEach((el) => {
      const match = el.id.match(/favorites_album_(\d{1,8})/);
      if (match) {
        ids.push(match[1]);
      }
    });
    return Array.from(new Set(ids));
  };

  const parseMaxPages = () => {
    if (typeof window.max_pages === "number") {
      return window.max_pages;
    }
    if (typeof window.max_pages === "string") {
      const parsed = Number(window.max_pages);
      if (!Number.isNaN(parsed)) return parsed;
    }
    const links = Array.from(document.querySelectorAll(".pagination a"));
    const numbers = links
      .map((link) => {
        const match = link.href.match(/page=(\d+)/);
        return match ? Number(match[1]) : null;
      })
      .filter((value) => Number.isFinite(value));
    return numbers.length ? Math.max(...numbers) : 1;
  };

  const getCurrentPage = () => {
    const params = new URLSearchParams(window.location.search);
    const page = Number(params.get("page") || "1");
    return Number.isFinite(page) && page > 0 ? page : 1;
  };

  const navigateToPage = (page) => {
    const url = new URL(window.location.href);
    url.searchParams.set("page", String(page));
    window.location.href = url.toString();
  };

  const scanCurrentPage = async () => {
    const ids = extractIdsFromPage();
    const added = addIdsToFolder(ids);
    setStatus(`已扫描第 ${getCurrentPage()} 页，新增 ${added} 条`);
    saveDomainState();
  };

  const runScanFlow = async () => {
    if (!domainState.scan.running) return;
    const currentPage = getCurrentPage();
    if (!domainState.scan.maxPages) {
      domainState.scan.maxPages = parseMaxPages();
      saveDomainState();
    }
    await scanCurrentPage();
    if (currentPage < domainState.scan.maxPages) {
      setStatus(
        `准备跳转到第 ${currentPage + 1} 页 / 共 ${domainState.scan.maxPages} 页`
      );
      saveDomainState();
      navigateToPage(currentPage + 1);
    } else {
      domainState.scan.running = false;
      saveDomainState();
      setStatus("扫描完成 ✅");
    }
  };

  const exportCurrentFolder = () => {
    const folder = getFolder();
    const payload = {
      folder: folder.name,
      items: Object.values(folder.items),
    };
    return JSON.stringify(payload, null, 2);
  };

  const exportAllFolders = () => {
    const payload = {
      folders: domainState.folderOrder.map((id) => ({
        id,
        name: domainState.folders[id].name,
        items: Object.values(domainState.folders[id].items),
      })),
    };
    return JSON.stringify(payload, null, 2);
  };

  const importToCurrentFolder = (payload) => {
    const folder = getFolder();
    let items = [];
    if (payload.items) {
      items = payload.items;
    } else if (payload.folders) {
      payload.folders.forEach((folderData) => {
        items = items.concat(folderData.items || []);
      });
    }
    items.forEach((item) => {
      if (!folder.items[item.id]) {
        folder.items[item.id] = {
          id: item.id,
          addedAt: item.addedAt || Date.now(),
        };
      }
    });
    saveDomainState();
    renderList();
    renderPreview();
  };

  const importAllFolders = (payload) => {
    if (!payload.folders) {
      alert("导入内容不是多文件夹格式。");
      return;
    }
    payload.folders.forEach((folderData) => {
      const id = folderData.id || `folder_${Date.now()}`;
      if (!domainState.folders[id]) {
        domainState.folders[id] = {
          name: folderData.name || "未命名",
          items: {},
        };
        domainState.folderOrder.push(id);
      }
      const target = domainState.folders[id];
      (folderData.items || []).forEach((item) => {
        if (!target.items[item.id]) {
          target.items[item.id] = {
            id: item.id,
            addedAt: item.addedAt || Date.now(),
          };
        }
      });
    });
    saveDomainState();
    updateFolderSelect();
    renderList();
    renderPreview();
  };

  const openImportPrompt = (mode) => {
    const text = prompt("请粘贴导入内容（JSON）");
    if (!text) return;
    try {
      const payload = JSON.parse(text);
      if (mode === "current") {
        importToCurrentFolder(payload);
      } else {
        importAllFolders(payload);
      }
    } catch (error) {
      alert("导入失败：JSON 格式错误");
    }
  };

  const postFavorite = async (albumId, fid) => {
    const form = new FormData();
    form.append("album_id", albumId);
    form.append("fid", String(fid));
    const response = await fetch(
      `${window.location.protocol}//${host}/ajax/favorite_album`,
      {
        method: "POST",
        credentials: "include",
        body: form,
      }
    );
    return response.ok;
  };

  const startFavoriteFlow = async () => {
    if (favoriteTask.running) return;
    favoriteTask.running = true;
    const folder = getFolder();
    const ids = Object.keys(folder.items);
    if (!ids.length) {
      setStatus("当前文件夹没有可收藏的ID");
      favoriteTask.running = false;
      return;
    }
    setStatus(`开始收藏，目标 ${ids.length} 条`);
    const { favoriteIntervalMs, favoriteFid } = domainState.settings;
    for (const id of ids) {
      if (!favoriteTask.running) break;
      const ok = await postFavorite(id, favoriteFid);
      setStatus(
        `收藏 ${id}：${ok ? "成功" : "失败"}，间隔 ${
          favoriteIntervalMs / 1000
        } 秒`
      );
      await sleep(favoriteIntervalMs);
    }
    favoriteTask.running = false;
    setStatus("收藏流程结束");
  };

  const stopFavoriteFlow = () => {
    favoriteTask.running = false;
    setStatus("已停止收藏");
  };

  ui.querySelector('[data-action="close"]').addEventListener("click", () => {
    ui.classList.add("hidden");
  });

  ui.querySelector('[data-action="add-folder"]').addEventListener("click", () => {
    const name = prompt("输入新文件夹名称");
    if (!name) return;
    const id = `folder_${Date.now()}`;
    domainState.folders[id] = { name, items: {} };
    domainState.folderOrder.push(id);
    domainState.currentFolderId = id;
    saveDomainState();
    updateFolderSelect();
    renderList();
    renderPreview();
  });

  ui.querySelector('[data-action="delete-folder"]').addEventListener(
    "click",
    () => {
      if (domainState.currentFolderId === DEFAULT_FOLDER_ID) {
        alert("默认文件夹不能删除");
        return;
      }
      const currentId = domainState.currentFolderId;
      if (!confirm("确认删除当前文件夹？")) return;
      delete domainState.folders[currentId];
      domainState.folderOrder = domainState.folderOrder.filter(
        (id) => id !== currentId
      );
      domainState.currentFolderId = DEFAULT_FOLDER_ID;
      saveDomainState();
      updateFolderSelect();
      renderList();
      renderPreview();
    }
  );

  folderSelect.addEventListener("change", (event) => {
    domainState.currentFolderId = event.target.value;
    saveDomainState();
    renderList();
    renderPreview();
  });

  ui.querySelector('[data-action="copy-id"]').addEventListener("click", () => {
    if (!selectedId) return;
    navigator.clipboard.writeText(selectedId).then(() => {
      setStatus(`已复制 ID：${selectedId}`);
    });
  });

  ui.querySelector('[data-action="open-album"]').addEventListener("click", () => {
    if (!selectedId) return;
    window.open(
      `${window.location.protocol}//${host}/album/${selectedId}/`,
      "_blank"
    );
  });

  ui.querySelector('[data-action="start-scan"]').addEventListener("click", () => {
    domainState.scan.running = true;
    domainState.scan.maxPages = parseMaxPages();
    saveDomainState();
    runScanFlow();
  });

  ui.querySelector('[data-action="stop-scan"]').addEventListener("click", () => {
    domainState.scan.running = false;
    saveDomainState();
    setStatus("扫描已停止");
  });

  ui.querySelector('[data-action="export-current"]').addEventListener(
    "click",
    () => {
      const data = exportCurrentFolder();
      navigator.clipboard.writeText(data);
      setStatus("已复制当前文件夹数据到剪贴板");
    }
  );

  ui.querySelector('[data-action="export-all"]').addEventListener("click", () => {
    const data = exportAllFolders();
    navigator.clipboard.writeText(data);
    setStatus("已复制全部文件夹数据到剪贴板");
  });

  ui.querySelector('[data-action="import-current"]').addEventListener(
    "click",
    () => openImportPrompt("current")
  );

  ui.querySelector('[data-action="import-all"]').addEventListener("click", () =>
    openImportPrompt("all")
  );

  ui.querySelector('[data-action="start-favorite"]').addEventListener(
    "click",
    () => {
      domainState.settings.favoriteFid = Number(favFidInput.value || 0);
      domainState.settings.favoriteIntervalMs = Number(
        favIntervalInput.value || 3000
      );
      saveDomainState();
      startFavoriteFlow();
    }
  );

  ui.querySelector('[data-action="stop-favorite"]').addEventListener(
    "click",
    () => {
      stopFavoriteFlow();
    }
  );

  favFidInput.value = domainState.settings.favoriteFid;
  favIntervalInput.value = domainState.settings.favoriteIntervalMs;

  const initDrag = () => {
    const header = ui.querySelector(".jm-fav-header");
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    const onMouseMove = (event) => {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      ui.style.left = `${startLeft + dx}px`;
      ui.style.top = `${startTop + dy}px`;
      ui.style.right = "auto";
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    header.addEventListener("mousedown", (event) => {
      startX = event.clientX;
      startY = event.clientY;
      const rect = ui.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  };

  updateFolderSelect();
  renderList();
  renderPreview();
  initDrag();

  window.addEventListener("load", () => {
    if (domainState.scan.running) {
      runScanFlow();
    }
  });
})();
