/**
 * Popup 界面逻辑
 * 解析账号密码、管理注册队列、与 background 通信
 */

// DOM 元素
const elements = {
    accountsInput: null,
    accountCount: null,
    startBtn: null,
    stopBtn: null,
    statusList: null,
    logContainer: null,
    clearLogBtn: null,
    successCount: null,
    pendingCount: null,
    errorCount: null,
    successCard: null,
    successAccounts: null,
    copySuccessBtn: null,
    copyTip: null,
    clearBtn: null
};

// 注册状态
let registrationState = {
    accounts: [],
    isRunning: false,
    stats: {
        success: 0,
        pending: 0,
        error: 0
    }
};

/**
 * 初始化
 */
function init() {
    // 获取 DOM 元素
    elements.accountsInput = document.getElementById('accountsInput');
    elements.accountCount = document.getElementById('accountCount');
    elements.startBtn = document.getElementById('startBtn');
    elements.stopBtn = document.getElementById('stopBtn');
    elements.statusList = document.getElementById('statusList');
    elements.logContainer = document.getElementById('logContainer');
    elements.clearLogBtn = document.getElementById('clearLogBtn');
    elements.successCount = document.getElementById('successCount');
    elements.pendingCount = document.getElementById('pendingCount');
    elements.errorCount = document.getElementById('errorCount');
    elements.successCard = document.getElementById('successCard');
    elements.successAccounts = document.getElementById('successAccounts');
    elements.copySuccessBtn = document.getElementById('copySuccessBtn');
    elements.copyTip = document.getElementById('copyTip');
    elements.clearBtn = document.getElementById('clearBtn');

    // 绑定事件
    elements.accountsInput.addEventListener('input', onAccountsInputChange);
    elements.startBtn.addEventListener('click', startRegistration);
    elements.stopBtn.addEventListener('click', stopRegistration);
    elements.clearLogBtn.addEventListener('click', clearLog);
    elements.copySuccessBtn.addEventListener('click', copySuccessAccounts);
    elements.clearBtn.addEventListener('click', clearAllRecords);

    // 监听来自 background 的消息
    chrome.runtime.onMessage.addListener(handleBackgroundMessage);

    // 恢复状态
    restoreState();

    addLog('插件已加载', 'info');
}

/**
 * 解析账号密码输入
 */
function parseAccounts(text) {
    const lines = text.split('\n').filter(line => line.trim());
    const accounts = [];

    console.log('[Popup] 开始解析账号，共', lines.length, '行');

    for (const line of lines) {
        // 支持多种分隔符：多个空格、Tab、逗号
        // 只分割一次，保留密码中的空格
        const trimmedLine = line.trim();
        let email = '';
        let password = '';

        // 尝试不同的分隔符
        const separators = ['\t', '  ', ', ', ',', ' '];
        for (const sep of separators) {
            const idx = trimmedLine.indexOf(sep);
            if (idx > 0) {
                email = trimmedLine.substring(0, idx).trim();
                password = trimmedLine.substring(idx + sep.length).trim();
                break;
            }
        }

        // 简单验证邮箱格式
        if (email.includes('@') && password.length >= 6) {
            accounts.push({
                email: email,
                password: password,
                status: 'pending',
                statusText: '等待中',
                tabId: null
            });
            console.log('[Popup] 解析成功:', email);
        } else if (trimmedLine) {
            console.warn('[Popup] 解析失败:', trimmedLine.substring(0, 30) + '...');
        }
    }

    console.log('[Popup] 解析完成，共', accounts.length, '个有效账号');
    return accounts;
}

/**
 * 输入框内容变化
 */
function onAccountsInputChange() {
    const accounts = parseAccounts(elements.accountsInput.value);
    elements.accountCount.textContent = accounts.length;
}

/**
 * 开始批量注册
 */
async function startRegistration() {
    const accounts = parseAccounts(elements.accountsInput.value);

    if (accounts.length === 0) {
        addLog('请输入有效的账号密码', 'error');
        return;
    }

    const concurrency = 1; // 串行模式

    registrationState.accounts = accounts;
    registrationState.isRunning = true;
    registrationState.stats = { success: 0, pending: accounts.length, error: 0 };

    // 更新 UI
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    elements.accountsInput.disabled = true;

    updateStats();
    renderStatusList();

    addLog(`开始批量注册，共 ${accounts.length} 个账号（串行模式）`, 'info');

    // 发送消息给 background 开始注册
    try {
        await chrome.runtime.sendMessage({
            type: 'START_REGISTRATION',
            data: {
                accounts: accounts,
                concurrency: concurrency
            }
        });
    } catch (error) {
        addLog('启动注册失败: ' + error.message, 'error');
        resetUI();
    }
}

/**
 * 停止注册
 */
async function stopRegistration() {
    try {
        await chrome.runtime.sendMessage({ type: 'STOP_REGISTRATION' });
        addLog('正在停止注册...', 'warning');
    } catch (error) {
        addLog('停止失败: ' + error.message, 'error');
    }
}

/**
 * 处理来自 background 的消息
 */
function handleBackgroundMessage(message, sender, sendResponse) {
    switch (message.type) {
        case 'STATUS_UPDATE':
            updateAccountStatus(message.data);
            break;
        case 'LOG':
            addLog(message.data.message, message.data.level);
            break;
        case 'REGISTRATION_COMPLETE':
            onRegistrationComplete();
            break;
        case 'STATE_UPDATE':
            syncState(message.data);
            break;
    }
    sendResponse({ received: true });
    return true;
}

/**
 * 更新账号状态
 */
function updateAccountStatus(data) {
    const { email, status, statusText } = data;

    const account = registrationState.accounts.find(a => a.email === email);
    if (account) {
        const oldStatus = account.status;
        account.status = status;
        account.statusText = statusText;

        // 更新统计
        if (oldStatus !== status) {
            if (oldStatus === 'pending') registrationState.stats.pending--;
            if (status === 'success') registrationState.stats.success++;
            if (status === 'error') registrationState.stats.error++;
        }

        updateStats();
        renderStatusList();
        updateSuccessAccounts();
    }
}

/**
 * 同步状态
 */
function syncState(state) {
    if (state.accounts) {
        registrationState.accounts = state.accounts;
    }
    if (state.isRunning !== undefined) {
        registrationState.isRunning = state.isRunning;
    }
    renderStatusList();
    updateStats();
    updateSuccessAccounts();
}

/**
 * 注册完成
 */
function onRegistrationComplete() {
    addLog('所有注册任务已完成', 'success');
    resetUI();
}

/**
 * 重置 UI
 */
function resetUI() {
    registrationState.isRunning = false;
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    elements.accountsInput.disabled = false;
}

/**
 * 更新统计数字
 */
function updateStats() {
    // 重新计算
    const stats = { success: 0, pending: 0, error: 0 };
    for (const account of registrationState.accounts) {
        if (account.status === 'success') stats.success++;
        else if (account.status === 'error') stats.error++;
        else stats.pending++;
    }

    elements.successCount.textContent = stats.success;
    elements.pendingCount.textContent = stats.pending;
    elements.errorCount.textContent = stats.error;
}

/**
 * 渲染状态列表
 */
function renderStatusList() {
    if (registrationState.accounts.length === 0) {
        elements.statusList.innerHTML = '<div class="empty-state">暂无注册任务</div>';
        return;
    }

    const html = registrationState.accounts.map(account => {
        let icon = '⏳';
        let statusClass = 'pending';

        switch (account.status) {
            case 'success':
                icon = '✅';
                statusClass = 'success';
                break;
            case 'error':
                icon = '❌';
                statusClass = 'error';
                break;
            case 'waiting':
                icon = '🔔';
                statusClass = 'waiting';
                break;
            case 'running':
                icon = '⏳';
                statusClass = 'pending';
                break;
        }

        return `
            <div class="status-item ${statusClass}">
                <span class="status-icon">${icon}</span>
                <span class="status-email">${account.email}</span>
                <span class="status-text">${account.statusText}</span>
            </div>
        `;
    }).join('');

    elements.statusList.innerHTML = html;
}

/**
 * 添加日志
 */
function addLog(message, level = 'info') {
    const time = new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const entry = document.createElement('div');
    entry.className = `log-entry ${level}`;
    entry.innerHTML = `<span class="time">[${time}]</span><span class="message">${message}</span>`;

    elements.logContainer.appendChild(entry);
    elements.logContainer.scrollTop = elements.logContainer.scrollHeight;

    // 限制日志数量
    while (elements.logContainer.children.length > 100) {
        elements.logContainer.removeChild(elements.logContainer.firstChild);
    }
}

/**
 * 清空日志
 */
function clearLog() {
    elements.logContainer.innerHTML = '';
    addLog('日志已清空', 'info');
}

/**
 * 更新成功账号显示
 */
function updateSuccessAccounts() {
    const successList = registrationState.accounts.filter(a => a.status === 'success');
    
    if (successList.length > 0) {
        elements.successCard.style.display = 'block';
        // 格式：账号  密码
        const text = successList.map(a => `${a.email}  ${a.password}`).join('\n');
        elements.successAccounts.value = text;
    } else {
        elements.successCard.style.display = 'none';
        elements.successAccounts.value = '';
    }
}

/**
 * 一键复制成功账号
 */
async function copySuccessAccounts() {
    const text = elements.successAccounts.value;
    if (!text) {
        addLog('没有可复制的账号', 'warning');
        return;
    }

    try {
        await navigator.clipboard.writeText(text);
        elements.copyTip.style.display = 'block';
        addLog(`已复制 ${text.split('\n').length} 个账号到剪贴板`, 'success');
        
        // 2秒后隐藏提示
        setTimeout(() => {
            elements.copyTip.style.display = 'none';
        }, 2000);
    } catch (error) {
        addLog('复制失败: ' + error.message, 'error');
        // 回退方案：选中文本
        elements.successAccounts.select();
        document.execCommand('copy');
        elements.copyTip.style.display = 'block';
        setTimeout(() => {
            elements.copyTip.style.display = 'none';
        }, 2000);
    }
}

/**
 * 恢复状态（优先从 background 获取，回退到 storage.session）
 */
async function restoreState() {
    try {
        // 先尝试从 background 获取实时状态
        const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
        if (response && response.state && response.state.accounts.length > 0) {
            syncState(response.state);
            if (response.state.isRunning) {
                elements.startBtn.disabled = true;
                elements.stopBtn.disabled = false;
                elements.accountsInput.disabled = true;
            }
            return;
        }
    } catch (error) {
        console.log('[Popup] 从 background 恢复状态失败:', error);
    }

    // 回退：从 chrome.storage.session 获取持久化状态
    try {
        const result = await chrome.storage.session.get('registrationState');
        if (result.registrationState && result.registrationState.accounts.length > 0) {
            console.log('[Popup] 从 storage.session 恢复状态');
            syncState(result.registrationState);
            if (result.registrationState.isRunning) {
                elements.startBtn.disabled = true;
                elements.stopBtn.disabled = false;
                elements.accountsInput.disabled = true;
            }
        }
    } catch (error) {
        console.log('[Popup] 从 storage.session 恢复状态失败:', error);
    }
}

/**
 * 清空所有记录
 */
async function clearAllRecords() {
    // 停止运行中的任务
    if (registrationState.isRunning) {
        try {
            await chrome.runtime.sendMessage({ type: 'STOP_REGISTRATION' });
        } catch (e) {}
    }

    // 清空本地状态
    registrationState.accounts = [];
    registrationState.isRunning = false;
    registrationState.stats = { success: 0, pending: 0, error: 0 };

    // 清空持久化状态
    try {
        await chrome.storage.session.remove('registrationState');
    } catch (e) {}

    // 通知 background 清空
    try {
        await chrome.runtime.sendMessage({ type: 'CLEAR_STATE' });
    } catch (e) {}

    // 重置 UI
    resetUI();
    elements.accountsInput.value = '';
    elements.accountCount.textContent = '0';
    renderStatusList();
    updateStats();
    updateSuccessAccounts();
    elements.logContainer.innerHTML = '';
    addLog('记录已清空', 'info');
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
