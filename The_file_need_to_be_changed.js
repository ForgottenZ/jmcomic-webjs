// ==UserScript==
// @name         B站小工具
// @namespace    https://luoboworld.top
// @version      3.6
// @description  B站视频快捷键控制翻页，支持Shift+Q/Shift+`切换和菜单控制，简易隐私保护，自动关闭结尾相关推荐（可开关）
// @author       Luobo & DeepSeek-R1 & ChatGPT
// @match        *://*.bilibili.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    let isEnabled = false;
    let intervalId = null;
    let isDragging = false;
    let lastX = 0, lastY = 0;
    const hotkey = 'Shift+Q / Shift+`';

    // 自动关闭相关推荐开关 & 观察器
    let autoCancelEnabled = true;
    let relatedObserver = null;

    // 剪贴板处理选项：
    // 'ask'       每次询问
    // 'remove-all' 移除问号后的所有参数
    // 'remove-vd'  只移除 vd_source
    // 'keep-all'   保持原样
    let clipboardAction = 'ask';

    // ========= 悬浮面板 UI =========

    const panel = document.createElement('div');
    panel.style.cssText = `
        position: fixed;
        top: 20px;
        left: 20px;
        z-index: 999999;
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 20px 10px 10px;
        border-radius: 5px;
        cursor: move;
        user-select: none;
        min-width: 120px;
    `;

    const closeBtn = document.createElement('div');
    closeBtn.style.cssText = `
        position: absolute;
        top: 2px;
        right: 2px;
        width: 16px;
        height: 16px;
        line-height: 16px;
        text-align: center;
        cursor: pointer;
        font-size: 14px;
        color: white;
        transition: 0.3s;
    `;
    closeBtn.innerHTML = '×';
    closeBtn.addEventListener('mouseover', () => closeBtn.style.color = '#ff4444');
    closeBtn.addEventListener('mouseout', () => closeBtn.style.color = 'white');

    const btn = document.createElement('button');
    btn.style.cssText = `
        margin-top: 8px;
        padding: 4px 8px;
        background: #4CAF50;
        border: none;
        color: white;
        border-radius: 3px;
        cursor: pointer;
        font-size: 12px;
    `;
    btn.textContent = '启动';

    const status = document.createElement('div');
    status.textContent = '状态：已停止';
    status.style.marginBottom = '6px';
    status.style.fontSize = '13px';

    const hotkeyInfo = document.createElement('div');
    hotkeyInfo.textContent = `快捷键：${hotkey}`;
    hotkeyInfo.style.fontSize = '11px';
    hotkeyInfo.style.opacity = '0.8';
    hotkeyInfo.style.marginBottom = '4px';

    // 新增：自动关相关推荐状态显示
    const autoCancelStatus = document.createElement('div');
    autoCancelStatus.style.fontSize = '11px';
    autoCancelStatus.style.opacity = '0.8';
    autoCancelStatus.style.marginBottom = '8px';

    panel.appendChild(closeBtn);
    panel.appendChild(status);
    panel.appendChild(hotkeyInfo);
    panel.appendChild(autoCancelStatus);
    panel.appendChild(btn);
    document.body.appendChild(panel);

    function closePanel() {
        if (isEnabled) toggleFunction();
        panel.style.display = 'none';
    }

    function togglePanelVisibility() {
        panel.style.display = panel.style.display === 'none' ? '' : 'none';
    }

    // ========= 核心功能：持续发右键 =========

    function simulateKey() {
        const eventDown = new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            code: 'ArrowRight',
            keyCode: 39,
            bubbles: true,
            repeat: true
        });
        window.dispatchEvent(eventDown);
    }

    function toggleFunction() {
        isEnabled = !isEnabled;
        if (isEnabled) {
            status.textContent = '状态：运行中';
            btn.textContent = '停止';
            btn.style.background = '#f44336';
            intervalId = setInterval(simulateKey, 50);
        } else {
            status.textContent = '状态：已停止';
            btn.textContent = '启动';
            btn.style.background = '#4CAF50';
            if (intervalId) clearInterval(intervalId);

            const eventUp = new KeyboardEvent('keyup', {
                key: 'ArrowRight',
                code: 'ArrowRight',
                keyCode: 39,
                bubbles: true
            });
            window.dispatchEvent(eventUp);
        }
    }

    // 新增：强制停止三倍速（外部调用用这个，避免误开）
    function stopTripleSpeed() {
        if (isEnabled) {
            toggleFunction(); // 当前是开就关掉
        }
    }

    // ========= 剪贴板监控相关（vd_source） =========

    function setupClipboardMonitor() {
        try {
            if (typeof GM_getValue !== 'undefined') {
                clipboardAction = GM_getValue('clipboard_action', 'ask');
            }

            const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

            if (!win.navigator || !win.navigator.clipboard || typeof win.navigator.clipboard.writeText !== 'function') {
                console.warn('[B站小工具] navigator.clipboard.writeText 不可用，剪贴板监控功能已禁用');
                return;
            }

            const clipboard = win.navigator.clipboard;
            const originalWriteText = clipboard.writeText.bind(clipboard);

            clipboard.writeText = async function(text) {
                try {
                    if (typeof text !== 'string' || !text.includes('vd_source')) {
                        return originalWriteText(text);
                    }

                    let actionToUse = clipboardAction;
                    let rememberChoice = false;

                    if (actionToUse === 'ask') {
                        const result = await showClipboardActionDialog(text);
                        if (!result || !result.action) {
                            return originalWriteText(text);
                        }
                        actionToUse = result.action;
                        rememberChoice = result.remember;

                        if (rememberChoice && typeof GM_setValue !== 'undefined') {
                            GM_setValue('clipboard_action', actionToUse);
                            clipboardAction = actionToUse;
                        }
                    }

                    const modifiedText = processClipboardText(text, actionToUse);
                    return originalWriteText(modifiedText);
                } catch (err) {
                    console.error('[B站小工具] 拦截 clipboard 出错：', err);
                    return originalWriteText(text);
                }
            };

            console.log('[B站小工具] 剪贴板监控已启用，当前模式：', clipboardAction);
        } catch (e) {
            console.error('[B站小工具] 初始化剪贴板监控失败：', e);
        }
    }

    function processClipboardText(text, action) {
        const questionMarkIndex = text.indexOf('?');
        if (questionMarkIndex === -1) return text;

        switch (action) {
            case 'remove-all':
                return text.substring(0, questionMarkIndex);
            case 'remove-vd': {
                const beforeQM = text.substring(0, questionMarkIndex);
                let afterQM = text.substring(questionMarkIndex);

                const newParams = afterQM.substring(1)
                    .split('&')
                    .filter(param => !param.startsWith('vd_source='))
                    .join('&');

                return beforeQM + (newParams ? '?' + newParams : '');
            }
            case 'keep-all':
            default:
                return text;
        }
    }

    function showClipboardActionDialog(text) {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 9999999;
                background: rgba(0,0,0,0.9);
                color: white;
                padding: 20px;
                border-radius: 5px;
                width: 400px;
                max-width: 90%;
                box-sizing: border-box;
                backdrop-filter: blur(5px);
            `;

            const title = document.createElement('h3');
            title.textContent = '检测到 vd_source 参数';
            title.style.marginTop = '0';
            dialog.appendChild(title);

            const content = document.createElement('div');
            content.textContent = '检测到要复制的链接包含跟踪参数 (vd_source)，您希望如何处理？';
            content.style.margin = '10px 0';
            dialog.appendChild(content);

            const optionsDiv = document.createElement('div');
            optionsDiv.style.margin = '15px 0';

            function createOption(value, text) {
                const div = document.createElement('div');
                div.style.margin = '8px 0';

                const input = document.createElement('input');
                input.type = 'radio';
                input.name = 'clipboardAction';
                input.value = value;
                input.id = 'option_' + value;

                const label = document.createElement('label');
                label.htmlFor = input.id;
                label.textContent = text;
                label.style.marginLeft = '8px';
                label.style.cursor = 'pointer';

                div.appendChild(input);
                div.appendChild(label);
                return div;
            }

            optionsDiv.appendChild(createOption('remove-all', '移除所有问号后的参数'));
            optionsDiv.appendChild(createOption('remove-vd', '只移除 vd_source 参数'));
            optionsDiv.appendChild(createOption('keep-all', '保持原样复制'));
            dialog.appendChild(optionsDiv);

            const rememberDiv = document.createElement('div');
            rememberDiv.style.marginTop = '10px';

            const rememberInput = document.createElement('input');
            rememberInput.type = 'checkbox';
            rememberInput.id = 'clipboardRemember';

            const rememberLabel = document.createElement('label');
            rememberLabel.htmlFor = 'clipboardRemember';
            rememberLabel.textContent = '记住我的选择，下次不再询问';
            rememberLabel.style.marginLeft = '8px';
            rememberLabel.style.cursor = 'pointer';

            rememberDiv.appendChild(rememberInput);
            rememberDiv.appendChild(rememberLabel);
            dialog.appendChild(rememberDiv);

            const buttonsDiv = document.createElement('div');
            buttonsDiv.style.display = 'flex';
            buttonsDiv.style.justifyContent = 'flex-end';
            buttonsDiv.style.marginTop = '15px';

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = '取消';
            cancelBtn.style.marginRight = '10px';
            cancelBtn.style.padding = '5px 10px';
            cancelBtn.addEventListener('click', () => {
                document.body.removeChild(dialog);
                resolve(null);
            });

            const okBtn = document.createElement('button');
            okBtn.textContent = '确定';
            okBtn.style.padding = '5px 15px';
            okBtn.addEventListener('click', () => {
                const selectedOption = dialog.querySelector('input[name="clipboardAction"]:checked');
                let action;

                if (!selectedOption) {
                    action = 'keep-all';
                } else {
                    action = selectedOption.value;
                }

                const remember = rememberInput.checked;
                document.body.removeChild(dialog);
                resolve({ action, remember });
            });

            buttonsDiv.appendChild(cancelBtn);
            buttonsDiv.appendChild(okBtn);
            dialog.appendChild(buttonsDiv);

            document.body.appendChild(dialog);
        });
    }

    setupClipboardMonitor();

    // ========= 记住离开页面时的视频播放状态 + 防止后台偷播 =========

    // lastVideoPaused：离开/记录时的视频状态
    // desiredVideoPaused：用户「期望」的状态（在页面可见时由 play/pause 事件更新）
    let lastVideoPaused = null;
    let desiredVideoPaused = null;

    function getBilibiliVideo() {
        return document.querySelector('video');
    }

    function rememberVideoState() {
        const video = getBilibiliVideo();
        if (!video) {
            lastVideoPaused = null;
            if (desiredVideoPaused === null) desiredVideoPaused = null;
            return;
        }
        lastVideoPaused = video.paused;
        if (desiredVideoPaused === null) {
            desiredVideoPaused = video.paused;
        }
    }

    function restoreVideoState() {
        if (lastVideoPaused === null) return;

        const video = getBilibiliVideo();
        if (!video) return;

        if (lastVideoPaused === true && !video.paused) {
            video.pause();
        }

        if (lastVideoPaused === false && video.paused) {
            video.play().catch(() => {});
        }
    }

    // 在页面可见时，用户的播放/暂停操作会更新「期望状态」
    document.addEventListener('play', (e) => {
        const target = e.target;
        if (!target || target.tagName !== 'VIDEO') return;

        if (!document.hidden) {
            desiredVideoPaused = false;
            lastVideoPaused = false;
        } else {
            // 页面隐藏时，如果期望是暂停，但有人偷偷 play，就立刻再 pause 回去
            if (desiredVideoPaused === true) {
                setTimeout(() => {
                    if (!target.paused) target.pause();
                }, 0);
            }
        }
    }, true);

    document.addEventListener('pause', (e) => {
        const target = e.target;
        if (!target || target.tagName !== 'VIDEO') return;

        if (!document.hidden) {
            desiredVideoPaused = true;
            lastVideoPaused = true;
        }
    }, true);

    // 离开页面时记录状态，并自动停止三倍速
    window.addEventListener('blur', () => {
        rememberVideoState();
        // 新增：失焦时自动停止三倍速
        stopTripleSpeed();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            rememberVideoState();
            // 新增：不可见时自动停止三倍速
            stopTripleSpeed();
        }
    });

    // 回到页面时恢复状态（不自动恢复三倍速，由你自己再按快捷键开）
    window.addEventListener('focus', () => {
        restoreVideoState();
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            restoreVideoState();
        }
    });

    // ========= 新功能：自动点击 class=bpx-player-ending-related-item-cancel =========

    function clickAllCancelBtns() {
        const btns = document.querySelectorAll('.bpx-player-ending-related-item-cancel');
        if (!btns.length) return;
        btns.forEach(btn => {
            if (!btn.dataset.__autoClicked) {
                btn.click();
                btn.dataset.__autoClicked = '1';
            }
        });
    }

    function startAutoCancelObserver() {
        if (relatedObserver) return;

        relatedObserver = new MutationObserver(() => {
            clickAllCancelBtns();
        });

        if (document.body) {
            relatedObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        } else {
            // 保险：极少情况 body 还没就绪
            window.addEventListener('load', () => {
                if (!relatedObserver) return;
                relatedObserver.observe(document.body, {
                    childList: true,
                    subtree: true
                });
                clickAllCancelBtns();
            });
        }

        // 刚开启时先尝试点一次
        clickAllCancelBtns();
        console.log('[B站小工具] 自动关闭结尾相关推荐已启用');
    }

    function stopAutoCancelObserver() {
        if (relatedObserver) {
            relatedObserver.disconnect();
            relatedObserver = null;
        }
        console.log('[B站小工具] 自动关闭结尾相关推荐观察已停止');
    }

    function updateAutoCancelStatusText() {
        autoCancelStatus.textContent = '自动关相关推荐：' + (autoCancelEnabled ? '已开启' : '已关闭');
    }

    function initAutoCancelRelated() {
        try {
            if (typeof GM_getValue !== 'undefined') {
                autoCancelEnabled = GM_getValue('auto_cancel_related', true);
            }
        } catch (e) {
            autoCancelEnabled = true;
        }

        if (autoCancelEnabled) {
            startAutoCancelObserver();
        }
        updateAutoCancelStatusText();
    }

    function toggleAutoCancelRelated() {
        autoCancelEnabled = !autoCancelEnabled;
        try {
            if (typeof GM_setValue !== 'undefined') {
                GM_setValue('auto_cancel_related', autoCancelEnabled);
            }
        } catch (e) {}

        if (autoCancelEnabled) {
            startAutoCancelObserver();
        } else {
            stopAutoCancelObserver();
        }
        updateAutoCancelStatusText();
        alert(autoCancelEnabled ? '已开启自动关闭结尾相关推荐' : '已关闭自动关闭结尾相关推荐');
    }

    initAutoCancelRelated();

    // ========= 键盘快捷键 & UI 事件 =========

    document.addEventListener('keydown', (e) => {
        if ((e.shiftKey && e.key === 'Q') || (e.shiftKey && e.code === 'Backquote')) {
            e.preventDefault();
            toggleFunction();
        }
    });

    btn.addEventListener('click', toggleFunction);
    closeBtn.addEventListener('click', closePanel);

    panel.addEventListener('mousedown', (e) => {
        if (!['BUTTON', 'DIV'].includes(e.target.tagName) || e.target === closeBtn) return;
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const deltaX = e.clientX - lastX;
            const deltaY = e.clientY - lastY;
            panel.style.left = (panel.offsetLeft + deltaX) + 'px';
            panel.style.top = (panel.offsetTop + deltaY) + 'px';
            lastX = e.clientX;
            lastY = e.clientY;
        }
    });

    document.addEventListener('mouseup', () => isDragging = false);

    if (typeof GM_registerMenuCommand !== 'undefined') {
        GM_registerMenuCommand('🚀 启动/停止三倍速', toggleFunction);
        GM_registerMenuCommand('👁️ 显示/隐藏控制面板', togglePanelVisibility);
        GM_registerMenuCommand('🧹 开关自动关闭相关推荐', toggleAutoCancelRelated);
        GM_registerMenuCommand('📋 重置剪贴板处理设置', () => {
            if (typeof GM_setValue !== 'undefined') {
                GM_setValue('clipboard_action', 'ask');
                clipboardAction = 'ask';
                alert('已重置剪贴板处理设置，下次会询问如何处理 vd_source 参数');
            } else {
                alert('无法重置设置，油猴API不可用');
            }
        });
    }
})();
