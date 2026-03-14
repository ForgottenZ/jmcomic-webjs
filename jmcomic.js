// ==UserScript==
// @name         JMComic 收藏夹管理器
// @namespace    https://example.com/
// @version      0.3.1
// @description  收藏夹 ID 采集、分页浏览、导入导出与一键收藏
// @match        https://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEYS = {
    approvedDomains: 'approvedDomains',
    folders: 'folders',
    activeFolderId: 'activeFolderId',
    captureState: 'captureState',
    settings: 'settings',
    dailySignRecord: 'dailySignRecord',
  };

  const DEFAULT_SETTINGS = {
    headerTitle: '收藏夹可视化管理器',
    favoriteIntervalMs: 3000,
    favoriteFid: '0',
    thumbWidth: 170,
    thumbHeight: 227,
    autoSyncFavoriteAdd: true,
    autoSyncFavoriteDelete: true,
    dailySignAddress: '',
    dailySignDailyId: '',
    dailySignOldStep: '',
    autoDailySignEnabled: true,
    dailySignDebug: false,
  };

  const state = {
    uiPage: 1,
    uiPerPage: 20,
    searchQuery: '',
    sortField: 'addedAt',
    sortAsc: true,
    favoriteTimer: null,
    favoriteQueue: [],
    windowedBounds: null,
    isFullscreen: false,
  };

  const ENCRYPTED_EXPORT_MARKER = 'VGhpcyBqYXZhc2NyaXB0IGlzIG1hZGUgYnkgTHVvYm8gd2l0aCBBSS4gVGtzIGZvciB1c2luZyBteSB3b3JrIQ==';

  const domain = window.location.origin;

  function getApprovedDomains() {
    return GM_getValue(STORAGE_KEYS.approvedDomains, []);
  }

  function setApprovedDomains(domains) {
    GM_setValue(STORAGE_KEYS.approvedDomains, domains);
  }

  function isDomainApproved() {
    return getApprovedDomains().includes(domain);
  }

  function addApprovedDomainByInput(rawInput) {
    const origin = normalizeSignOrigin(rawInput);
    if (!origin) {
      return { ok: false, reason: 'invalid' };
    }
    const domains = getApprovedDomains();
    if (domains.includes(origin)) {
      return { ok: false, reason: 'exists', origin };
    }
    setApprovedDomains([...domains, origin]);
    return { ok: true, origin };
  }

  function removeApprovedDomain(targetOrigin) {
    const next = getApprovedDomains().filter((item) => item !== targetOrigin);
    setApprovedDomains(next);
  }

  function getSettings() {
    return { ...DEFAULT_SETTINGS, ...GM_getValue(STORAGE_KEYS.settings, {}) };
  }

  function setSettings(partial) {
    const current = getSettings();
    GM_setValue(STORAGE_KEYS.settings, { ...current, ...partial });
  }

  function getFolders() {
    return GM_getValue(STORAGE_KEYS.folders, []);
  }

  function setFolders(folders) {
    GM_setValue(STORAGE_KEYS.folders, folders);
  }

  function getActiveFolderId() {
    return GM_getValue(STORAGE_KEYS.activeFolderId, null);
  }

  function setActiveFolderId(id) {
    GM_setValue(STORAGE_KEYS.activeFolderId, id);
  }

  function getActiveFolder() {
    const folders = getFolders();
    const activeId = getActiveFolderId();
    return folders.find((folder) => folder.id === activeId) || null;
  }

  function updateFolder(updatedFolder) {
    const folders = getFolders();
    const next = folders.map((folder) => (folder.id === updatedFolder.id ? updatedFolder : folder));
    setFolders(next);
  }

  function notify(message, options = {}) {
    const { position = 'bottom-right', duration = 2600 } = options;
    const toast = document.createElement('div');
    toast.className = 'jm-notify-toast';
    if (position === 'top-right') {
      toast.classList.add('top-right');
    }
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function getDailySignRecord() {
    return GM_getValue(STORAGE_KEYS.dailySignRecord, {
      lastAttemptDate: '',
      lastSuccessDate: '',
      lastStatus: 'idle',
    });
  }

  function setDailySignRecord(partial) {
    const current = getDailySignRecord();
    GM_setValue(STORAGE_KEYS.dailySignRecord, {
      ...current,
      ...partial,
      updatedAt: Date.now(),
    });
  }

  function getTodayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function normalizeSignOrigin(rawAddress) {
    const raw = String(rawAddress || '').trim();
    if (!raw) {
      return '';
    }
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(withProtocol);
      return parsed.origin;
    } catch (error) {
      return '';
    }
  }

  function buildDailySignPayload(config) {
    return `daily_id=${encodeURIComponent(config.dailySignDailyId)}&oldStep=${encodeURIComponent(
      config.dailySignOldStep
    )}`;
  }

  function ensureDailySignConfig(settings, manual) {
    const signOrigin = normalizeSignOrigin(settings.dailySignAddress);
    if (!signOrigin) {
      if (manual) {
        notify('签到地址未设置或格式错误。');
      }
      return null;
    }

    const dailyId = String(settings.dailySignDailyId || '').trim();
    const oldStep = String(settings.dailySignOldStep || '').trim();
    if (!dailyId || !oldStep) {
      if (manual) {
        notify('请先设置签到参数 daily_id 和 oldStep。');
      }
      return null;
    }

    return {
      signOrigin,
      dailySignDailyId: dailyId,
      dailySignOldStep: oldStep,
    };
  }

  function triggerDailySign(options = {}) {
    const { manual = false } = options;
    if (window.top !== window.self) {
      return;
    }

    const settings = getSettings();
    const debugEnabled = Boolean(settings.dailySignDebug);
    if (!manual && !settings.autoDailySignEnabled) {
      if (debugEnabled) {
        console.log('[JM签到调试] 已跳过自动签到：开关关闭', {
          page: window.location.href,
        });
      }
      return;
    }

    const config = ensureDailySignConfig(settings, manual);
    if (!config) {
      if (debugEnabled) {
        console.log('[JM签到调试] 已跳过签到：配置不完整', {
          dailySignAddress: settings.dailySignAddress || '',
          dailySignDailyId: settings.dailySignDailyId || '',
          dailySignOldStep: settings.dailySignOldStep || '',
        });
      }
      return;
    }

    const today = getTodayKey();
    const record = getDailySignRecord();
    if (!manual && record.lastAttemptDate === today) {
      if (debugEnabled) {
        console.log('[JM签到调试] 已跳过自动签到：今日已触发', {
          today,
          lastAttemptDate: record.lastAttemptDate,
          lastStatus: record.lastStatus,
        });
      }
      return;
    }

    if (!manual) {
      setDailySignRecord({
        lastAttemptDate: today,
        lastStatus: 'pending',
      });
    }

    const url = `${config.signOrigin}/ajax/user_daily_sign`;
    const payload = buildDailySignPayload(config);
    if (debugEnabled) {
      console.log('[JM签到调试] 发送签到请求', {
        page: window.location.href,
        manual,
        url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        data: payload,
        today,
      });
    }
    notify(`已触发今日签到请求：${config.signOrigin}`, { position: 'top-right' });

    GM_xmlhttpRequest({
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      data: payload,
      timeout: 15000,
      onload: (response) => {
        const success = response.status >= 200 && response.status < 300;
        setDailySignRecord({
          lastAttemptDate: today,
          lastSuccessDate: success ? today : record.lastSuccessDate || '',
          lastStatus: success ? 'success' : `http_${response.status}`,
        });
        if (debugEnabled) {
          console.log('[JM签到调试] 签到响应', {
            success,
            status: response.status,
            responseText: response.responseText,
            finalUrl: url,
            requestData: payload,
          });
        }
        if (manual) {
          notify(success ? '签到请求已发送。' : `签到失败（HTTP ${response.status}）。`, { position: 'top-right' });
        }
      },
      onerror: (error) => {
        setDailySignRecord({
          lastAttemptDate: today,
          lastStatus: 'network_error',
        });
        if (debugEnabled) {
          console.log('[JM签到调试] 签到请求网络错误', {
            error,
            finalUrl: url,
            requestData: payload,
          });
        }
        if (manual) {
          notify('签到请求失败（网络错误）。', { position: 'top-right' });
        }
      },
      ontimeout: () => {
        setDailySignRecord({
          lastAttemptDate: today,
          lastStatus: 'timeout',
        });
        if (debugEnabled) {
          console.log('[JM签到调试] 签到请求超时', {
            finalUrl: url,
            requestData: payload,
          });
        }
        if (manual) {
          notify('签到请求超时。', { position: 'top-right' });
        }
      },
    });
  }

  function showDailySignStatus() {
    const settings = getSettings();
    const record = getDailySignRecord();
    const signOrigin = normalizeSignOrigin(settings.dailySignAddress) || '未设置';
    const autoText = settings.autoDailySignEnabled ? '开启' : '关闭';
    const lastDate = record.lastAttemptDate || '无';
    const status = record.lastStatus || 'idle';
    const debugText = settings.dailySignDebug ? '开启' : '关闭';
    notify(`自动签到:${autoText} 调试:${debugText} 地址:${signOrigin} 最近:${lastDate} 状态:${status}`, {
      position: 'top-right',
      duration: 4200,
    });
  }

  function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  }

  function ensureFolderExists() {
    if (getFolders().length === 0) {
      notify('请先创建文件夹后再开始获取 ID。');
      return false;
    }
    if (!getActiveFolderId()) {
      notify('请先选择一个文件夹作为当前目标。');
      return false;
    }
    return true;
  }

  function getMaxPages() {
    const links = Array.from(document.querySelectorAll('.pagination a[href*="page="]'));
    const numbers = links
      .map((link) => {
        const url = new URL(link.href);
        return Number(url.searchParams.get('page'));
      })
      .filter((value) => !Number.isNaN(value));
    if (numbers.length === 0) {
      return 1;
    }
    return Math.max(...numbers);
  }

  function getCurrentPage() {
    const url = new URL(window.location.href);
    const page = Number(url.searchParams.get('page'));
    return Number.isNaN(page) || page < 1 ? 1 : page;
  }

  function navigateToPage(page) {
    const url = new URL(window.location.href);
    if (page <= 1) {
      url.searchParams.delete('page');
    } else {
      url.searchParams.set('page', String(page));
    }
    window.location.href = url.toString();
  }

  function hasPrevnextButton() {
    return Boolean(document.querySelector('.prevnext'));
  }

  function captureCurrentPage() {
    const items = Array.from(document.querySelectorAll('[id^="favorites_album_"]'));
    if (items.length === 0) {
      return [];
    }

    return items
      .map((item) => {
        const match = item.id.match(/favorites_album_(\d+)/);
        if (!match) {
          return null;
        }
        const titleEl = item.querySelector('.video-title.title-truncate');
        const title = titleEl ? titleEl.textContent.trim() : '';
        return { id: match[1], title };
      })
      .filter(Boolean);
  }

  function addItemsToFolder(folder, items) {
    const existing = new Set(folder.order);
    const nextItems = { ...folder.items };
    const nextOrder = [...folder.order];
    items.forEach((item) => {
      if (!existing.has(item.id)) {
        existing.add(item.id);
        nextItems[item.id] = {
          id: item.id,
          title: item.title,
          addedAt: Date.now(),
        };
        nextOrder.push(item.id);
      } else if (item.title && nextItems[item.id]) {
        nextItems[item.id].title = item.title;
      }
    });
    return { ...folder, items: nextItems, order: nextOrder };
  }

  function removeItemFromFolder(folder, id) {
    if (!folder.items[id]) {
      return folder;
    }
    const nextItems = { ...folder.items };
    delete nextItems[id];
    const nextOrder = folder.order.filter((itemId) => itemId !== id);
    return { ...folder, items: nextItems, order: nextOrder };
  }

  function getCaptureState() {
    return GM_getValue(STORAGE_KEYS.captureState, {
      running: false,
      baseUrl: '',
      page: 1,
      maxPages: 1,
      folderId: null,
    });
  }

  function setCaptureState(next) {
    GM_setValue(STORAGE_KEYS.captureState, next);
  }

  function clearCaptureState() {
    GM_setValue(STORAGE_KEYS.captureState, {
      running: false,
      baseUrl: '',
      page: 1,
      maxPages: 1,
      folderId: null,
    });
  }

  function startCapture() {
    if (!ensureFolderExists()) {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.delete('page');
    const maxPages = getMaxPages();
    setCaptureState({
      running: true,
      baseUrl: url.toString(),
      page: 1,
      maxPages,
      folderId: getActiveFolderId(),
    });
    navigateToPage(1);
  }

  function pauseCapture() {
    const captureState = getCaptureState();
    setCaptureState({ ...captureState, running: false });
    notify('已暂停获取，可重新开始（将从第 1 页开始）。');
  }

  function processCaptureState() {
    const captureState = getCaptureState();
    if (!captureState.running) {
      return;
    }

    const currentPage = getCurrentPage();
    const maxPages = captureState.maxPages || getMaxPages();
    const items = captureCurrentPage();
    const folders = getFolders();
    const targetFolder = folders.find((folder) => folder.id === captureState.folderId);
    if (!targetFolder) {
      notify('目标文件夹不存在，已停止获取。');
      clearCaptureState();
      return;
    }

    const updatedFolder = addItemsToFolder(targetFolder, items);
    updateFolder(updatedFolder);

    if (currentPage >= maxPages) {
      if (hasPrevnextButton()) {
        setCaptureState({
          ...captureState,
          page: currentPage + 1,
          maxPages: currentPage + 1,
        });
        navigateToPage(currentPage + 1);
        return;
      }
      notify(`获取完成，共 ${updatedFolder.order.length} 条。`);
      clearCaptureState();
      refreshGrid();
      return;
    }

    setCaptureState({
      ...captureState,
      page: currentPage + 1,
      maxPages,
    });
    navigateToPage(currentPage + 1);
  }

  function ensureDefaultFolder() {
    if (getFolders().length === 0) {
      const id = generateId('folder');
      const folder = {
        id,
        name: '默认文件夹',
        createdAt: Date.now(),
        items: {},
        order: [],
      };
      setFolders([folder]);
      setActiveFolderId(id);
    }
  }

  function createFolder(name) {
    const folders = getFolders();
    const id = generateId('folder');
    const folder = {
      id,
      name,
      createdAt: Date.now(),
      items: {},
      order: [],
    };
    setFolders([...folders, folder]);
    setActiveFolderId(id);
    refreshFolderList();
    refreshGrid();
  }

  function deleteFolder(id) {
    const folders = getFolders().filter((folder) => folder.id !== id);
    setFolders(folders);
    if (getActiveFolderId() === id) {
      setActiveFolderId(folders[0]?.id || null);
    }
    refreshFolderList();
    refreshGrid();
  }

  function switchFolder(id) {
    setActiveFolderId(id);
    refreshFolderList();
    refreshGrid();
  }

  function buildHeader(container) {
    const settings = getSettings();
    const header = document.createElement('div');
    header.className = 'jm-header';
    const title = document.createElement('div');
    title.className = 'jm-title';
    title.textContent = settings.headerTitle;
    const actions = document.createElement('div');
    actions.className = 'jm-header-actions';
    const maximize = document.createElement('button');
    maximize.type = 'button';
    maximize.textContent = '⬜';
    maximize.title = '切换全屏';
    maximize.addEventListener('click', () => toggleFullscreen(container));
    const minimize = document.createElement('button');
    minimize.type = 'button';
    minimize.textContent = '—';
    minimize.addEventListener('click', () => {
      container.classList.toggle('minimized');
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.addEventListener('click', () => {
      container.remove();
    });
    actions.append(maximize, minimize, close);
    header.append(title, actions);
    container.appendChild(header);
    makeDraggable(container, header);
  }

  function buildTabs(container) {
    const tabs = document.createElement('div');
    tabs.className = 'jm-tabs';
    const tabButtons = [
      { id: 'albums', label: '画廊列表' },
      { id: 'folders', label: '文件夹管理' },
      { id: 'trusted-domains', label: '信任域名管理' },
      { id: 'export', label: '导入/导出' },
      { id: 'settings', label: '设置' },
    ];
    const content = document.createElement('div');
    content.className = 'jm-tab-content';

    tabButtons.forEach((tab, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = tab.label;
      button.dataset.tab = tab.id;
      if (index === 0) {
        button.classList.add('active');
      }
      button.addEventListener('click', () => {
        tabs.querySelectorAll('button').forEach((btn) => btn.classList.remove('active'));
        button.classList.add('active');
        content.querySelectorAll('.jm-panel').forEach((panel) => {
          panel.classList.toggle('active', panel.dataset.panel === tab.id);
        });
      });
      tabs.appendChild(button);
    });

    container.append(tabs, content);
    buildAlbumsPanel(content);
    buildFolderPanel(content);
    buildTrustedDomainPanel(content);
    buildExportPanel(content);
    buildSettingsPanel(content);
  }

  function buildAlbumsPanel(content) {
    const panel = document.createElement('div');
    panel.className = 'jm-panel active';
    panel.dataset.panel = 'albums';

    const actions = document.createElement('div');
    actions.className = 'jm-actions';

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.textContent = '开始获取 ID';
    startBtn.addEventListener('click', startCapture);

    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.textContent = '暂停获取';
    pauseBtn.addEventListener('click', pauseCapture);

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.textContent = '快速导出明文';
    exportBtn.addEventListener('click', () => {
      handleExport({
        mode: 'plain',
        scope: 'current',
      });
    });

    const favoriteBtn = document.createElement('button');
    favoriteBtn.type = 'button';
    favoriteBtn.textContent = '一键收藏(当前文件夹)';
    favoriteBtn.addEventListener('click', () => startFavoriteQueue('current'));

    const stopFavoriteBtn = document.createElement('button');
    stopFavoriteBtn.type = 'button';
    stopFavoriteBtn.textContent = '停止收藏队列';
    stopFavoriteBtn.addEventListener('click', stopFavoriteQueue);

    actions.append(startBtn, pauseBtn, exportBtn, favoriteBtn, stopFavoriteBtn);

    const tools = document.createElement('div');
    tools.className = 'jm-form-row jm-album-tools';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '按 ID 或名字模糊搜索';
    searchInput.addEventListener('input', () => {
      state.searchQuery = searchInput.value.trim();
      state.uiPage = 1;
      refreshGrid();
    });

    const sortSelect = document.createElement('select');
    sortSelect.innerHTML = `
      <option value="addedAt">按照添加时间顺序排序</option>
      <option value="id">按照 ID 大小排序</option>
    `;
    sortSelect.addEventListener('change', () => {
      state.sortField = sortSelect.value;
      state.uiPage = 1;
      refreshGrid();
    });

    const sortOrderBtn = document.createElement('button');
    sortOrderBtn.type = 'button';
    const refreshSortText = () => {
      sortOrderBtn.textContent = state.sortAsc ? '从小到大' : '从大到小';
    };
    refreshSortText();
    sortOrderBtn.addEventListener('click', () => {
      state.sortAsc = !state.sortAsc;
      refreshSortText();
      refreshGrid();
    });

    tools.append(searchInput, sortSelect, sortOrderBtn);

    const grid = document.createElement('div');
    grid.className = 'jm-grid';

    const pager = document.createElement('div');
    pager.className = 'jm-pager';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.textContent = '上一页';
    prevBtn.addEventListener('click', () => {
      const totalPages = getGridTotalPages();
      state.uiPage = state.uiPage <= 1 ? totalPages : state.uiPage - 1;
      refreshGrid();
    });
    const pageInfo = document.createElement('span');
    pageInfo.className = 'jm-page-info';
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.textContent = '下一页';
    nextBtn.addEventListener('click', () => {
      const totalPages = getGridTotalPages();
      state.uiPage = state.uiPage >= totalPages ? 1 : state.uiPage + 1;
      refreshGrid();
    });
    const jumpWrap = document.createElement('div');
    jumpWrap.className = 'jm-jump-wrap';
    jumpWrap.innerHTML = `跳转至 <input type="number" min="1" class="jm-jump-input"> 页`;
    const jumpInput = jumpWrap.querySelector('input');
    const jumpBtn = document.createElement('button');
    jumpBtn.type = 'button';
    jumpBtn.textContent = '跳转';
    jumpBtn.addEventListener('click', () => {
      const totalPages = getGridTotalPages();
      const target = Number(jumpInput.value);
      if (!target || target < 1 || target > totalPages) {
        notify(`请输入 1-${totalPages} 之间的页码。`);
        return;
      }
      state.uiPage = target;
      refreshGrid();
    });
    jumpWrap.appendChild(jumpBtn);
    pager.append(prevBtn, pageInfo, nextBtn, jumpWrap);

    panel.append(actions, tools, grid, pager);
    content.appendChild(panel);
  }

  function buildFolderPanel(content) {
    const panel = document.createElement('div');
    panel.className = 'jm-panel';
    panel.dataset.panel = 'folders';

    const list = document.createElement('div');
    list.className = 'jm-folder-list';
    list.dataset.role = 'folder-list';

    const creator = document.createElement('div');
    creator.className = 'jm-folder-create';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '新文件夹名称';
    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.textContent = '创建文件夹';
    createBtn.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) {
        notify('请输入文件夹名称。');
        return;
      }
      createFolder(name);
      input.value = '';
    });
    creator.append(input, createBtn);

    panel.append(list, creator);
    content.appendChild(panel);
  }

  function buildTrustedDomainPanel(content) {
    const panel = document.createElement('div');
    panel.className = 'jm-panel';
    panel.dataset.panel = 'trusted-domains';

    const list = document.createElement('div');
    list.className = 'jm-folder-list';
    list.dataset.role = 'trusted-domain-list';

    const creator = document.createElement('div');
    creator.className = 'jm-folder-create';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '输入域名或完整 URL（如 example.com）';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '添加信任域名';
    addBtn.addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) {
        notify('请输入要添加的域名。');
        return;
      }
      const result = addApprovedDomainByInput(value);
      if (!result.ok) {
        if (result.reason === 'exists') {
          notify('该域名已在信任列表中。');
        } else {
          notify('域名格式无效，请检查后重试。');
        }
        return;
      }
      input.value = '';
      refreshTrustedDomainList();
      notify(`已添加信任域名：${result.origin}`);
    });
    creator.append(input, addBtn);

    panel.append(list, creator);
    content.appendChild(panel);
  }

  function buildExportPanel(content) {
    const panel = document.createElement('div');
    panel.className = 'jm-panel';
    panel.dataset.panel = 'export';

    const exportSection = document.createElement('div');
    exportSection.className = 'jm-section';
    exportSection.innerHTML = '<h4>导出设置</h4>';

    const modeRow = document.createElement('div');
    modeRow.className = 'jm-form-row';
    modeRow.innerHTML = `
      <label><input type="radio" name="export-mode" value="plain" checked> 明文导出</label>
      <label><input type="radio" name="export-mode" value="encrypted"> 加密导出</label>
    `;

    const scopeRow = document.createElement('div');
    scopeRow.className = 'jm-form-row';
    scopeRow.innerHTML = `
      <label><input type="radio" name="export-scope" value="current" checked> 当前文件夹</label>
      <label><input type="radio" name="export-scope" value="all"> 全部文件夹</label>
    `;

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.textContent = '执行导出';
    exportBtn.addEventListener('click', () => {
      const mode = modeRow.querySelector('input[name="export-mode"]:checked').value;
      const scope = scopeRow.querySelector('input[name="export-scope"]:checked').value;
      handleExport({ mode, scope });
    });

    exportSection.append(modeRow, scopeRow, exportBtn);

    const importSection = document.createElement('div');
    importSection.className = 'jm-section';
    importSection.innerHTML = '<h4>导入</h4>';

    const importInput = document.createElement('input');
    importInput.type = 'file';
    const importScopeRow = document.createElement('div');
    importScopeRow.className = 'jm-form-row';
    const importScopeSelect = document.createElement('select');
    importScopeSelect.innerHTML = `
      <option value="current">导入到当前文件夹</option>
      <option value="merge-folders">按文件夹名称合并/创建</option>
    `;
    importScopeRow.append(importScopeSelect);
    const importHint = document.createElement('div');
    importHint.className = 'jm-hint';
    importHint.textContent = '支持明文导入和加密导入（自动识别）。';
    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.textContent = '执行导入';
    importBtn.addEventListener('click', () => {
      if (!ensureFolderExists()) {
        return;
      }
      const file = importInput.files?.[0];
      if (!file) {
        notify('请选择要导入的文件。');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const content = String(reader.result || '').trim();
        importContent(content, importScopeSelect.value);
      };
      reader.readAsText(file);
    });

    importSection.append(importInput, importScopeRow, importHint, importBtn);

    panel.append(exportSection, importSection);
    content.appendChild(panel);
  }

  function buildSettingsPanel(content) {
    const panel = document.createElement('div');
    panel.className = 'jm-panel';
    panel.dataset.panel = 'settings';

    const settings = getSettings();

    const headerRow = document.createElement('div');
    headerRow.className = 'jm-form-row';
    const headerLabel = document.createElement('label');
    headerLabel.textContent = '标题文字：';
    const headerInput = document.createElement('input');
    headerInput.type = 'text';
    headerInput.value = settings.headerTitle;
    headerRow.append(headerLabel, headerInput);

    const favoriteRow = document.createElement('div');
    favoriteRow.className = 'jm-form-row';
    const intervalLabel = document.createElement('label');
    intervalLabel.textContent = '一键收藏间隔（ms）';
    const intervalInput = document.createElement('input');
    intervalInput.type = 'number';
    intervalInput.min = '500';
    intervalInput.value = String(settings.favoriteIntervalMs);
    intervalInput.dataset.field = 'favorite-interval';
    intervalLabel.appendChild(intervalInput);
    const fidLabel = document.createElement('label');
    fidLabel.textContent = 'fid';
    const fidInput = document.createElement('input');
    fidInput.type = 'text';
    fidInput.value = settings.favoriteFid;
    fidInput.dataset.field = 'favorite-fid';
    fidLabel.appendChild(fidInput);
    favoriteRow.append(intervalLabel, fidLabel);

    const syncRow = document.createElement('div');
    syncRow.className = 'jm-form-row';
    syncRow.innerHTML = `
      <label><input type="checkbox" data-sync-add ${settings.autoSyncFavoriteAdd ? 'checked' : ''}> 自动同步收藏新增</label>
      <label><input type="checkbox" data-sync-delete ${settings.autoSyncFavoriteDelete ? 'checked' : ''}> 自动同步收藏删除</label>
    `;

    const signAddressRow = document.createElement('div');
    signAddressRow.className = 'jm-form-row';
    const signAddressLabel = document.createElement('label');
    signAddressLabel.textContent = '签到地址 ';
    const signAddressInput = document.createElement('input');
    signAddressInput.type = 'text';
    signAddressInput.dataset.signAddress = '1';
    signAddressInput.value = settings.dailySignAddress || '';
    signAddressInput.placeholder = 'example.com 或 https://example.com';
    signAddressLabel.appendChild(signAddressInput);
    signAddressRow.appendChild(signAddressLabel);

    const signParamsRow = document.createElement('div');
    signParamsRow.className = 'jm-form-row';
    const signDailyIdLabel = document.createElement('label');
    signDailyIdLabel.textContent = 'daily_id ';
    const signDailyIdInput = document.createElement('input');
    signDailyIdInput.type = 'text';
    signDailyIdInput.dataset.signDailyId = '1';
    signDailyIdInput.value = settings.dailySignDailyId || '';
    signDailyIdLabel.appendChild(signDailyIdInput);
    const signOldStepLabel = document.createElement('label');
    signOldStepLabel.textContent = 'oldStep ';
    const signOldStepInput = document.createElement('input');
    signOldStepInput.type = 'text';
    signOldStepInput.dataset.signOldStep = '1';
    signOldStepInput.value = settings.dailySignOldStep || '';
    signOldStepLabel.appendChild(signOldStepInput);
    signParamsRow.append(signDailyIdLabel, signOldStepLabel);

    const signOptionsRow = document.createElement('div');
    signOptionsRow.className = 'jm-form-row';
    signOptionsRow.innerHTML = `
      <label><input type="checkbox" data-auto-daily-sign ${settings.autoDailySignEnabled ? 'checked' : ''}> 启用自动签到（每天仅一次）</label>
      <label><input type="checkbox" data-daily-sign-debug ${settings.dailySignDebug ? 'checked' : ''}> 启用签到调试日志（控制台）</label>
    `;

    const signDebugRow = document.createElement('div');
    signDebugRow.className = 'jm-form-row';
    const signDebugBtn = document.createElement('button');
    signDebugBtn.type = 'button';
    signDebugBtn.textContent = '签到调试（立即触发）';
    signDebugBtn.title = '会先保存当前设置，再立即发起一次签到请求';
    signDebugRow.appendChild(signDebugBtn);

    const collectAndSaveSettings = () => {
      const normalizedSignOrigin = normalizeSignOrigin(signAddressInput.value);
      setSettings({
        headerTitle: headerInput.value.trim() || DEFAULT_SETTINGS.headerTitle,
        favoriteIntervalMs: Math.max(500, Number(intervalInput.value) || DEFAULT_SETTINGS.favoriteIntervalMs),
        favoriteFid: fidInput.value.trim() || DEFAULT_SETTINGS.favoriteFid,
        autoSyncFavoriteAdd: syncRow.querySelector('input[data-sync-add]').checked,
        autoSyncFavoriteDelete: syncRow.querySelector('input[data-sync-delete]').checked,
        dailySignAddress: normalizedSignOrigin,
        dailySignDailyId: String(signDailyIdInput.value || '').trim(),
        dailySignOldStep: String(signOldStepInput.value || '').trim(),
        autoDailySignEnabled: signOptionsRow.querySelector('input[data-auto-daily-sign]').checked,
        dailySignDebug: signOptionsRow.querySelector('input[data-daily-sign-debug]').checked,
      });
      return normalizedSignOrigin;
    };

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = '保存设置';
    saveBtn.addEventListener('click', () => {
      const normalizedSignOrigin = collectAndSaveSettings();
      const rawSignAddress = signAddressInput.value.trim();
      if (rawSignAddress && !normalizedSignOrigin) {
        notify('签到地址格式无效，已清空签到地址。');
      }
      notify('设置已保存。');
      const header = document.querySelector('.jm-title');
      if (header) {
        header.textContent = getSettings().headerTitle;
      }
    });

    signDebugBtn.addEventListener('click', () => {
      collectAndSaveSettings();
      triggerDailySign({ manual: true });
    });

    panel.append(
      headerRow,
      favoriteRow,
      syncRow,
      signAddressRow,
      signParamsRow,
      signOptionsRow,
      signDebugRow,
      saveBtn
    );
    content.appendChild(panel);
  }

  function refreshFolderList() {
    const list = document.querySelector('[data-role="folder-list"]');
    if (!list) {
      return;
    }
    list.innerHTML = '';
    const folders = getFolders();
    const activeId = getActiveFolderId();

    folders.forEach((folder) => {
      const card = document.createElement('div');
      card.className = 'jm-folder-card';
      if (folder.id === activeId) {
        card.classList.add('active');
      }
      const info = document.createElement('div');
      info.className = 'jm-folder-info';
      info.innerHTML = `<strong>${folder.name}</strong><span>${folder.order.length} 条</span>`;

      const actions = document.createElement('div');
      actions.className = 'jm-folder-actions';
      const switchBtn = document.createElement('button');
      switchBtn.type = 'button';
      switchBtn.textContent = '切换';
      switchBtn.addEventListener('click', () => switchFolder(folder.id));
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = '删除';
      deleteBtn.addEventListener('click', () => {
        if (window.confirm(`确认删除文件夹「${folder.name}」？`)) {
          deleteFolder(folder.id);
        }
      });
      actions.append(switchBtn, deleteBtn);

      card.append(info, actions);
      list.appendChild(card);
    });
  }

  function refreshTrustedDomainList() {
    const list = document.querySelector('[data-role="trusted-domain-list"]');
    if (!list) {
      return;
    }
    list.innerHTML = '';
    const domains = [...getApprovedDomains()].sort((left, right) => left.localeCompare(right));
    if (!domains.length) {
      list.innerHTML = '<div class="jm-empty">当前没有信任域名。</div>';
      return;
    }

    domains.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'jm-folder-card';
      if (item === domain) {
        card.classList.add('active');
      }

      const info = document.createElement('div');
      info.className = 'jm-folder-info';
      info.innerHTML = `<strong>${item}</strong><span>${item === domain ? '当前站点' : '已信任域名'}</span>`;

      const actions = document.createElement('div');
      actions.className = 'jm-folder-actions';
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = '删除';
      deleteBtn.addEventListener('click', () => {
        const isCurrent = item === domain;
        const confirmText = isCurrent
          ? `确认删除当前域名「${item}」？删除后请刷新页面，脚本将停止。`
          : `确认删除信任域名「${item}」？`;
        if (!window.confirm(confirmText)) {
          return;
        }
        removeApprovedDomain(item);
        refreshTrustedDomainList();
        notify(`已删除信任域名：${item}`);
      });
      actions.append(deleteBtn);

      card.append(info, actions);
      list.appendChild(card);
    });
  }

  function getFilteredSortedIds(folder) {
    const keyword = state.searchQuery.toLowerCase();
    const ids = folder.order.filter((id) => {
      const item = folder.items[id];
      if (!keyword) {
        return true;
      }
      return id.toLowerCase().includes(keyword) || (item?.title || '').toLowerCase().includes(keyword);
    });

    return ids.sort((left, right) => {
      const leftItem = folder.items[left] || {};
      const rightItem = folder.items[right] || {};
      const direction = state.sortAsc ? 1 : -1;
      if (state.sortField === 'id') {
        return (Number(left) - Number(right)) * direction;
      }
      const leftTime = Number(leftItem.addedAt) || 0;
      const rightTime = Number(rightItem.addedAt) || 0;
      if (leftTime === rightTime) {
        return (Number(left) - Number(right)) * direction;
      }
      return (leftTime - rightTime) * direction;
    });
  }

  function getGridTotalPages() {
    const folder = getActiveFolder();
    if (!folder) {
      return 1;
    }
    const ids = getFilteredSortedIds(folder);
    return Math.max(1, Math.ceil(ids.length / state.uiPerPage));
  }

  function refreshGrid() {
    const grid = document.querySelector('.jm-grid');
    const pageInfo = document.querySelector('.jm-page-info');
    if (!grid || !pageInfo) {
      return;
    }
    const folder = getActiveFolder();
    if (!folder) {
      grid.innerHTML = '<div class="jm-empty">暂无数据，请先创建并选择文件夹。</div>';
      pageInfo.textContent = '';
      return;
    }

    const ids = getFilteredSortedIds(folder);
    const totalPages = Math.max(1, Math.ceil(ids.length / state.uiPerPage));
    if (state.uiPage > totalPages) {
      state.uiPage = totalPages;
    }
    const startIndex = (state.uiPage - 1) * state.uiPerPage;
    const pageIds = ids.slice(startIndex, startIndex + state.uiPerPage);

    grid.innerHTML = '';
    if (pageIds.length === 0) {
      grid.innerHTML = '<div class="jm-empty">当前筛选条件下暂无收藏。</div>';
    }

    pageIds.forEach((id) => {
      const item = folder.items[id];
      const card = document.createElement('div');
      card.className = 'jm-card';
      const link = document.createElement('a');
      link.href = `${domain}/album/${id}/`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const img = document.createElement('img');
      img.alt = item?.title || '';
      img.src = `${domain}/media/albums/${id}_3x4.jpg`;
      link.appendChild(img);
      const title = document.createElement('div');
      title.className = 'jm-card-title';
      title.textContent = item?.title || '未命名';
      const bottom = document.createElement('div');
      bottom.className = 'jm-card-bottom';
      const meta = document.createElement('div');
      meta.className = 'jm-card-meta';
      meta.textContent = `ID: ${id}`;
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'jm-delete-btn';
      deleteBtn.textContent = '删除';
      deleteBtn.addEventListener('click', () => {
        if (!window.confirm(`确认删除 ID: ${id} 吗？`)) {
          return;
        }
        if (!window.confirm('请再次确认：删除后不可恢复。')) {
          return;
        }
        const nextFolder = removeItemFromFolder(folder, id);
        updateFolder(nextFolder);
        refreshGrid();
        refreshFolderList();
        notify(`已删除 ID: ${id}`);
      });
      bottom.append(meta, deleteBtn);
      card.append(link, title, bottom);
      grid.appendChild(card);
    });

    pageInfo.textContent = `第 ${state.uiPage} / ${totalPages} 页，共 ${ids.length} 条`;
  }

  function exportFolderData(scope) {
    const folders = getFolders();
    if (scope === 'all') {
      return { folders, settings: getSettings() };
    }
    const current = getActiveFolder();
    if (!current) {
      return { folders: [], settings: getSettings() };
    }
    return {
      folders: [current],
      settings: getSettings(),
    };
  }

  function formatPlainExport(data) {
    const lines = [];
    data.folders.forEach((folder) => {
      lines.push(`# ${folder.name}`);
      folder.order.forEach((id) => {
        const item = folder.items[id];
        lines.push(`${id}	${item?.title || ''}`);
      });
    });
    lines.push('# SETTINGS_JSON');
    lines.push(JSON.stringify(data.settings || getSettings()));
    return lines.join('\n');
  }

  function encodeBase64Text(content) {
    return btoa(unescape(encodeURIComponent(content)));
  }

  function decodeBase64Text(content) {
    return decodeURIComponent(escape(atob(content)));
  }

  function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/plain' });
    if (typeof GM_download === 'function') {
      const url = URL.createObjectURL(blob);
      GM_download({ url, name: filename, saveAs: true, onload: () => URL.revokeObjectURL(url) });
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
  }

  function handleExport({ mode, scope }) {
    const data = exportFolderData(scope);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const plain = formatPlainExport(data);
    if (mode === 'encrypted') {
      downloadFile(`${ENCRYPTED_EXPORT_MARKER}${encodeBase64Text(plain)}`, `jmcomic-export-${timestamp}.b64.txt`);
      notify('加密导出完成。');
      return;
    }
    downloadFile(plain, `jmcomic-export-${timestamp}.txt`);
    notify('明文导出完成。');
  }

  function parsePlainImport(content) {
    const lines = content.split(/\r?\n/);
    const folders = [];
    let currentFolder = null;
    let settingsJson = null;
    let inSettings = false;

    lines.forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) {
        return;
      }
      if (line === '# SETTINGS_JSON') {
        inSettings = true;
        return;
      }
      if (inSettings) {
        settingsJson = settingsJson ? `${settingsJson}${line}` : line;
        return;
      }
      if (line.startsWith('#')) {
        const name = line.replace(/^#\s*/, '').trim() || `导入文件夹-${Date.now()}`;
        currentFolder = { name, items: {}, order: [] };
        folders.push(currentFolder);
        return;
      }
      if (!currentFolder) {
        return;
      }
      const [id, ...titleParts] = line.split(/\s+/);
      if (!/^\d+$/.test(id || '')) {
        return;
      }
      const title = titleParts.join(' ').trim();
      if (!currentFolder.items[id]) {
        currentFolder.items[id] = {
          id,
          title,
          addedAt: Date.now(),
        };
        currentFolder.order.push(id);
      }
    });

    let settings = null;
    if (settingsJson) {
      try {
        settings = JSON.parse(settingsJson);
      } catch (error) {
        settings = null;
      }
    }
    return { folders, settings };
  }

  function importContent(content, scope) {
    let plainText = content;
    if (content.startsWith(ENCRYPTED_EXPORT_MARKER)) {
      const encoded = content.slice(ENCRYPTED_EXPORT_MARKER.length).trim();
      try {
        plainText = decodeBase64Text(encoded);
      } catch (error) {
        notify('加密导入失败，无法解密。');
        return;
      }
    }

    const parsed = parsePlainImport(plainText);
    if (!parsed.folders.length) {
      notify('导入内容为空或格式错误。');
      return;
    }

    if (parsed.settings && typeof parsed.settings === 'object') {
      setSettings(parsed.settings);
    }

    if (scope === 'merge-folders') {
      const folders = getFolders();
      const mergedFolders = [...folders];
      parsed.folders.forEach((incoming) => {
        let target = mergedFolders.find((folder) => folder.name === incoming.name);
        if (!target) {
          target = {
            id: generateId('folder'),
            name: incoming.name || `导入-${Date.now()}`,
            createdAt: Date.now(),
            items: {},
            order: [],
          };
          mergedFolders.push(target);
        }
        const items = incoming.order.map((id) => ({
          id,
          title: incoming.items?.[id]?.title || '',
        }));
        const updated = addItemsToFolder(target, items);
        Object.assign(target, updated);
      });
      setFolders(mergedFolders);
      refreshFolderList();
      refreshGrid();
      notify('已按文件夹合并导入。');
      return;
    }

    const folder = getActiveFolder();
    if (!folder) {
      return;
    }
    const merged = parsed.folders.reduce((acc, incoming) => {
      const items = incoming.order.map((id) => ({
        id,
        title: incoming.items?.[id]?.title || '',
      }));
      return addItemsToFolder(acc, items);
    }, folder);

    updateFolder(merged);
    refreshGrid();
    notify('导入完成。');
  }

  function startFavoriteQueue(scope) {
    const settings = getSettings();
    if (state.favoriteTimer) {
      notify('收藏队列已在运行。');
      return;
    }
    const data = exportFolderData(scope);
    const ids = data.folders.flatMap((folder) => folder.order);
    if (ids.length === 0) {
      notify('当前没有可收藏的 ID。');
      return;
    }
    state.favoriteQueue = [...ids];
    const endpoint = `${domain}/ajax/favorite_album`;
    state.favoriteTimer = setInterval(() => {
      const nextId = state.favoriteQueue.shift();
      if (!nextId) {
        stopFavoriteQueue();
        notify('收藏队列已完成。');
        return;
      }
      GM_xmlhttpRequest({
        method: 'POST',
        url: endpoint,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        data: `album_id=${encodeURIComponent(nextId)}&fid=${encodeURIComponent(settings.favoriteFid)}`,
        onload: () => {
          notify(`已收藏 ID: ${nextId}`);
        },
        onerror: () => {
          notify(`收藏失败 ID: ${nextId}`);
        },
      });
    }, settings.favoriteIntervalMs);
    notify('已启动收藏队列。');
  }

  function stopFavoriteQueue() {
    if (state.favoriteTimer) {
      clearInterval(state.favoriteTimer);
      state.favoriteTimer = null;
      state.favoriteQueue = [];
      notify('收藏队列已停止。');
    }
  }

  function parseAlbumIdFromBody(body) {
    if (!body) {
      return null;
    }
    if (body instanceof URLSearchParams) {
      return body.get('album_id');
    }
    if (body instanceof FormData) {
      return body.get('album_id');
    }
    if (typeof body !== 'string') {
      return null;
    }
    const params = new URLSearchParams(body);
    return params.get('album_id');
  }

  function getSyncAddedTitle() {
    const selectors = ['.book-name.mb-0#book-name', '.pull-left'];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = el?.textContent?.trim();
      if (text) {
        return text;
      }
    }
    return '未定义';
  }

  function syncFavoriteChange(action, albumId) {
    if (!albumId) {
      return;
    }
    const settings = getSettings();
    if (action === 'add' && !settings.autoSyncFavoriteAdd) {
      return;
    }
    if (action === 'delete' && !settings.autoSyncFavoriteDelete) {
      return;
    }
    const folder = getActiveFolder();
    if (!folder) {
      return;
    }
    if (action === 'add') {
      const fallbackTitle = folder.items[albumId]?.title || getSyncAddedTitle();
      const updated = addItemsToFolder(folder, [{ id: albumId, title: fallbackTitle }]);
      updateFolder(updated);
      refreshGrid();
      return;
    }
    const updated = removeItemFromFolder(folder, albumId);
    updateFolder(updated);
    refreshGrid();
  }

  function interceptAjax() {
    const originalFetch = window.fetch;
    if (originalFetch) {
      window.fetch = function (...args) {
        const [input, init] = args;
        const url = typeof input === 'string' ? input : input?.url || '';
        const body = init?.body;
        if (typeof url === 'string') {
          if (url.includes('/ajax/favorite_album')) {
            syncFavoriteChange('add', parseAlbumIdFromBody(body));
          } else if (url.includes('/ajax/delete_favorite_album')) {
            syncFavoriteChange('delete', parseAlbumIdFromBody(body));
          }
        }
        return originalFetch.apply(this, args);
      };
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._jmUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (body) {
      const url = this._jmUrl || '';
      if (typeof url === 'string') {
        if (url.includes('/ajax/favorite_album')) {
          syncFavoriteChange('add', parseAlbumIdFromBody(body));
        } else if (url.includes('/ajax/delete_favorite_album')) {
          syncFavoriteChange('delete', parseAlbumIdFromBody(body));
        }
      }
      return originalSend.call(this, body);
    };
  }

  function toggleFullscreen(container) {
    if (!state.isFullscreen) {
      const rect = container.getBoundingClientRect();
      state.windowedBounds = {
        left: container.style.left || `${rect.left}px`,
        top: container.style.top || `${rect.top}px`,
        width: container.style.width || `${rect.width}px`,
        height: container.style.height || `${rect.height}px`,
      };
      container.classList.add('fullscreen');
      container.style.left = '0px';
      container.style.top = '0px';
      container.style.width = '100vw';
      container.style.height = '100vh';
      state.isFullscreen = true;
    } else {
      container.classList.remove('fullscreen');
      if (state.windowedBounds) {
        container.style.left = state.windowedBounds.left;
        container.style.top = state.windowedBounds.top;
        container.style.width = state.windowedBounds.width;
        container.style.height = state.windowedBounds.height;
      }
      state.isFullscreen = false;
    }
  }

  function makeDraggable(container, handle) {
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    let dragging = false;

    const onMouseDown = (event) => {
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      const rect = container.getBoundingClientRect();
      originX = rect.left;
      originY = rect.top;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (event) => {
      if (!dragging) {
        return;
      }
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      container.style.left = `${originX + dx}px`;
      container.style.top = `${originY + dy}px`;
    };

    const onMouseUp = () => {
      dragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    handle.addEventListener('mousedown', onMouseDown);
  }

  function mountUI() {
    const container = document.createElement('div');
    container.className = 'jm-container';
    container.style.left = '30px';
    container.style.top = '30px';
    container.style.width = '820px';
    container.style.height = '720px';
    const settings = getSettings();
    container.style.setProperty('--jm-thumb-width', `${settings.thumbWidth}px`);
    container.style.setProperty('--jm-thumb-height', `${settings.thumbHeight}px`);

    buildHeader(container);
    buildTabs(container);

    document.body.appendChild(container);
    refreshFolderList();
    refreshTrustedDomainList();
    refreshGrid();
  }

  function addToastStyles() {
    GM_addStyle(`
      .jm-notify-toast {
        position: fixed;
        right: 20px;
        bottom: 20px;
        top: auto;
        left: auto;
        padding: 10px 14px;
        background: #2d2d2d;
        color: #fff;
        border-radius: 6px;
        opacity: 0;
        transform: translateY(10px);
        transition: all 0.2s ease;
        z-index: 99999;
        pointer-events: none;
      }
      .jm-notify-toast.top-right {
        top: 20px;
        bottom: auto;
      }
      .jm-notify-toast.show {
        opacity: 1;
        transform: translateY(0);
      }
    `);
  }

  function registerMenus() {
    GM_registerMenuCommand('立即触发签到(忽略每日限制)', () => {
      triggerDailySign({ manual: true });
    });
    GM_registerMenuCommand('查看自动签到状态', () => {
      showDailySignStatus();
    });

    GM_registerMenuCommand('认可当前域名', () => {
      const result = addApprovedDomainByInput(domain);
      if (result.ok) {
        notify('已认可当前域名，请刷新页面生效。');
        window.alert('已认可当前域名，请刷新页面生效。');
        refreshTrustedDomainList();
      } else {
        notify('当前域名已被认可。');
      }
    });
    GM_registerMenuCommand('撤销当前域名认可', () => {
      removeApprovedDomain(domain);
      refreshTrustedDomainList();
      notify('已撤销认可，请刷新页面停止脚本。');
    });
  }

  function init() {
    addToastStyles();
    registerMenus();
    triggerDailySign();

    if (!isDomainApproved()) {
      return;
    }

    addStyles();
    ensureDefaultFolder();
    interceptAjax();
    mountUI();
    processCaptureState();
  }

  function addStyles() {
    GM_addStyle(`
      .jm-container {
        position: fixed;
        background: #1f1f1f;
        color: #fff;
        border-radius: 12px;
        box-shadow: 0 12px 28px rgba(0,0,0,0.4);
        z-index: 99999;
        display: flex;
        flex-direction: column;
        font-family: "Segoe UI", "PingFang SC", sans-serif;
        resize: both;
        overflow: hidden;
        min-width: 680px;
        min-height: 520px;
        max-width: 100vw;
        max-height: 100vh;
      }
      .jm-container.fullscreen {
        border-radius: 0;
        resize: none;
      }
      .jm-container.minimized .jm-tabs,
      .jm-container.minimized .jm-tab-content {
        display: none;
      }
      .jm-header {
        padding: 12px 16px;
        background: #2b2b2b;
        border-radius: 12px 12px 0 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: move;
      }
      .jm-title {
        font-size: 18px;
        font-weight: 600;
      }
      .jm-header-actions button {
        margin-left: 8px;
        background: #444;
        color: #fff;
        border: none;
        border-radius: 6px;
        width: 30px;
        height: 30px;
        cursor: pointer;
      }
      .jm-tabs {
        display: flex;
        padding: 8px 16px;
        gap: 8px;
        background: #2a2a2a;
      }
      .jm-tabs button {
        background: #3a3a3a;
        color: #fff;
        border: none;
        padding: 8px 14px;
        border-radius: 6px;
        cursor: pointer;
      }
      .jm-tabs button.active {
        background: #5680ff;
      }
      .jm-tab-content {
        flex: 1;
        padding: 16px;
        overflow: hidden;
      }
      .jm-panel {
        display: none;
        flex-direction: column;
        height: 100%;
      }
      .jm-panel.active {
        display: flex;
      }
      .jm-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 12px;
      }
      .jm-actions button {
        background: #4b4b4b;
        border: none;
        color: #fff;
        padding: 8px 12px;
        border-radius: 6px;
        cursor: pointer;
      }
      .jm-grid {
        flex: 1;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--jm-thumb-width, 170px), 1fr));
        gap: 12px;
        overflow-y: auto;
        padding-right: 4px;
        align-content: start;
      }
      .jm-card {
        background: #2d2d2d;
        border-radius: 8px;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .jm-card img {
        width: 100%;
        height: var(--jm-thumb-height, 227px);
        border-radius: 6px;
        background: #1a1a1a;
        object-fit: cover;
      }
      .jm-card-title {
        font-size: 14px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .jm-card-meta {
        font-size: 12px;
        color: #b0b0b0;
      }
      .jm-card-bottom {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .jm-delete-btn {
        border: none;
        border-radius: 4px;
        background: #a93a3a;
        color: #fff;
        font-size: 12px;
        padding: 4px 8px;
        cursor: pointer;
      }
      .jm-pager {
        margin-top: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .jm-pager button {
        background: #3a3a3a;
        border: none;
        color: #fff;
        padding: 6px 12px;
        border-radius: 6px;
        cursor: pointer;
      }
      .jm-jump-wrap {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
      }
      .jm-jump-input {
        width: 72px;
      }
      .jm-folder-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow-y: auto;
        flex: 1;
      }
      .jm-folder-card {
        background: #2d2d2d;
        border-radius: 8px;
        padding: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .jm-folder-card.active {
        border: 1px solid #5680ff;
      }
      .jm-folder-info span {
        display: block;
        color: #9a9a9a;
        font-size: 12px;
      }
      .jm-folder-actions button {
        margin-left: 6px;
        background: #3a3a3a;
        border: none;
        color: #fff;
        padding: 6px 10px;
        border-radius: 6px;
        cursor: pointer;
      }
      .jm-folder-create {
        display: flex;
        gap: 10px;
        margin-top: 12px;
      }
      .jm-folder-create input {
        flex: 1;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid #444;
        background: #1f1f1f;
        color: #fff;
      }
      .jm-section {
        background: #2d2d2d;
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 12px;
      }
      .jm-section h4 {
        margin: 0 0 8px;
      }
      .jm-form-row {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 8px;
        align-items: center;
      }
      .jm-form-row input[type="text"],
      .jm-form-row input[type="number"],
      .jm-form-row select {
        margin-left: 6px;
        padding: 4px 6px;
        border-radius: 4px;
        border: 1px solid #444;
        background: #1f1f1f;
        color: #fff;
      }
      .jm-section button {
        background: #5680ff;
        border: none;
        color: #fff;
        padding: 6px 10px;
        border-radius: 6px;
        cursor: pointer;
      }
      .jm-empty {
        color: #aaa;
        font-size: 14px;
      }
      .jm-notify-toast {
        position: fixed;
        right: 20px;
        bottom: 20px;
        padding: 10px 14px;
        background: #2d2d2d;
        color: #fff;
        border-radius: 6px;
        opacity: 0;
        transform: translateY(10px);
        transition: all 0.2s ease;
        z-index: 99999;
      }
      .jm-notify-toast.show {
        opacity: 1;
        transform: translateY(0);
      }
    `);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
