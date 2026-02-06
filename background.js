/**
 * Background Service Worker
 * 管理多标签页注册任务
 */

// 注册状态（串行模式，一次只处理一个账号）
let registrationState = {
    accounts: [],
    isRunning: false,
    concurrency: 1, // 强制串行
    currentIndex: 0,
    activeTabs: new Map() // tabId -> email
};

/**
 * 生成随机英文名
 */
function generateRandomName() {
    const firstNames = [
        'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph',
        'Thomas', 'Charles', 'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth',
        'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen', 'Emma', 'Oliver', 'Ava',
        'Isabella', 'Sophia', 'Mia', 'Charlotte', 'Amelia', 'Harper', 'Evelyn'
    ];
    const lastNames = [
        'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
        'Rodriguez', 'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Jackson', 'White',
        'Harris', 'Martin', 'Thompson', 'Robinson', 'Clark', 'Lewis', 'Lee', 'Walker'
    ];

    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];

    return { firstName, lastName };
}

/**
 * 发送消息给 popup
 */
function notifyPopup(type, data) {
    chrome.runtime.sendMessage({ type, data }).catch(() => {
        // popup 可能未打开，忽略错误
    });
}

/**
 * 更新账号状态
 */
function updateAccountStatus(email, status, statusText) {
    const account = registrationState.accounts.find(a => a.email === email);
    if (account) {
        account.status = status;
        account.statusText = statusText;
    }

    notifyPopup('STATUS_UPDATE', { email, status, statusText });
    saveState();
}

/**
 * 添加日志
 */
function log(message, level = 'info') {
    console.log(`[Background][${level}] ${message}`);
    notifyPopup('LOG', { message, level });
}

/**
 * 在指定标签页中清除 localStorage 和 sessionStorage（必须在关闭标签页之前调用）
 */
async function clearTabStorage(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                try { localStorage.clear(); } catch(e) {}
                try { sessionStorage.clear(); } catch(e) {}
                console.log('[Content Script] localStorage/sessionStorage 已清除');
            }
        });
        log('已清除标签页 localStorage/sessionStorage');
    } catch (e) {
        log('清除标签页 storage 失败: ' + e.message, 'warning');
    }
}

/**
 * 清除 Windsurf 相关的所有 cookies
 */
async function clearWindsurfCookies() {
    const domains = ['windsurf.com', '.windsurf.com', 'codeium.com', '.codeium.com'];
    let cleared = 0;

    // 通过 domain 获取并删除所有 cookies
    for (const domain of domains) {
        try {
            const cookies = await chrome.cookies.getAll({ domain });
            for (const cookie of cookies) {
                const url = `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
                await chrome.cookies.remove({ url, name: cookie.name });
                cleared++;
            }
        } catch (e) {}
    }

    // 使用 browsingData API 清除 windsurf.com 的所有浏览数据
    try {
        await chrome.browsingData.remove(
            { origins: ['https://windsurf.com', 'https://codeium.com'] },
            {
                cookies: true,
                localStorage: true,
                sessionStorage: true,
                cacheStorage: true,
                indexedDB: true
            }
        );
        log('已通过 browsingData API 清除所有浏览数据');
    } catch (e) {
        log('browsingData 清除失败: ' + e.message, 'warning');
    }

    log(`已清除 ${cleared} 个 cookies`);
}

async function startRegistration(accounts, concurrency) {
    registrationState.accounts = accounts;
    registrationState.concurrency = 1; // 强制串行
    registrationState.isRunning = true;
    registrationState.currentIndex = 0;
    registrationState.activeTabs.clear();

    log(`开始注册流程，共 ${accounts.length} 个账号（串行模式）`);
    saveState();

    // 先清除旧 cookies
    await clearWindsurfCookies();

    // 开始处理第一个账号
    await processNextAccount();
}

/**
 * 处理下一个账号
 */
async function processNextAccount() {
    if (!registrationState.isRunning) {
        log('注册已停止，跳过处理', 'warning');
        return;
    }

    // 找到下一个未处理的账号
    const account = registrationState.accounts.find(
        a => a.status === 'pending' && !a.tabId
    );

    if (!account) {
        log('没有待处理的账号了');
        // 检查是否所有任务完成
        checkAllComplete();
        return;
    }

    const activeCount = registrationState.activeTabs.size;
    log(`开始处理: ${account.email} (当前活动: ${activeCount}/${registrationState.concurrency})`);
    updateAccountStatus(account.email, 'running', '正在打开页面...');

    try {
        // 打开注册页面
        const tab = await chrome.tabs.create({
            url: 'https://windsurf.com/account/register',
            active: true
        });

        account.tabId = tab.id;
        registrationState.activeTabs.set(tab.id, account.email);

        // 等待页面加载完成
        log(`${account.email}: 等待页面加载...`);
        await waitForTabLoad(tab.id);
        log(`${account.email}: 页面加载完成，准备发送数据`);

        // 发送注册数据给 content script
        const names = generateRandomName();
        log(`${account.email}: 生成随机姓名 ${names.firstName} ${names.lastName}`);

        try {
            await chrome.tabs.sendMessage(tab.id, {
                type: 'START_REGISTRATION',
                data: {
                    email: account.email,
                    password: account.password,
                    firstName: names.firstName,
                    lastName: names.lastName
                }
            });
            log(`${account.email}: 数据已发送到 content script`);
            updateAccountStatus(account.email, 'running', '正在填写表单...');
        } catch (sendError) {
            log(`${account.email}: 发送消息失败 - ${sendError.message}`, 'error');
            // 可能是 content script 还没加载，等待后重试
            await new Promise(r => setTimeout(r, 2000));
            await chrome.tabs.sendMessage(tab.id, {
                type: 'START_REGISTRATION',
                data: {
                    email: account.email,
                    password: account.password,
                    firstName: names.firstName,
                    lastName: names.lastName
                }
            });
            updateAccountStatus(account.email, 'running', '正在填写表单...');
        }

    } catch (error) {
        log(`处理 ${account.email} 失败: ${error.message}`, 'error');
        updateAccountStatus(account.email, 'error', '失败: ' + error.message);
        // 清理
        if (account.tabId) {
            registrationState.activeTabs.delete(account.tabId);
        }
        processNextAccount();
    }
}

/**
 * 等待标签页加载完成
 */
function waitForTabLoad(tabId) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('页面加载超时'));
        }, 30000);

        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                // 额外等待一下让 content script 加载
                setTimeout(resolve, 1000);
            }
        };

        chrome.tabs.onUpdated.addListener(listener);

        // 检查是否已经加载完成
        chrome.tabs.get(tabId).then(tab => {
            if (tab.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(resolve, 1000);
            }
        }).catch(reject);
    });
}

/**
 * 检查是否所有任务完成
 */
function checkAllComplete() {
    const allDone = registrationState.accounts.every(
        a => a.status === 'success' || a.status === 'error'
    );

    if (allDone) {
        registrationState.isRunning = false;
        log('所有注册任务已完成', 'success');
        notifyPopup('REGISTRATION_COMPLETE', {});
        saveState();
    }
}

/**
 * 停止注册
 */
async function stopRegistration() {
    registrationState.isRunning = false;

    // 关闭所有活动标签页
    for (const [tabId, email] of registrationState.activeTabs) {
        try {
            await chrome.tabs.remove(tabId);
            updateAccountStatus(email, 'error', '已停止');
        } catch (e) {
            // 标签页可能已关闭
        }
    }

    registrationState.activeTabs.clear();
    log('注册已停止', 'warning');
    notifyPopup('REGISTRATION_COMPLETE', {});
    saveState();
}

/**
 * 处理来自 content script 的消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    const email = tabId ? registrationState.activeTabs.get(tabId) : null;

    switch (message.type) {
        case 'START_REGISTRATION':
            startRegistration(message.data.accounts, message.data.concurrency);
            sendResponse({ success: true });
            break;

        case 'STOP_REGISTRATION':
            stopRegistration();
            sendResponse({ success: true });
            break;

        case 'GET_STATE':
            sendResponse({
                state: {
                    accounts: registrationState.accounts,
                    isRunning: registrationState.isRunning
                }
            });
            break;

        case 'CLEAR_STATE':
            registrationState.accounts = [];
            registrationState.isRunning = false;
            registrationState.activeTabs.clear();
            chrome.storage.session.remove('registrationState').catch(() => {});
            log('状态已清空');
            sendResponse({ success: true });
            break;

        case 'FORM_FILLED':
            if (email) {
                log(`${email}: 表单已填写，等待继续...`);
                updateAccountStatus(email, 'running', '表单已填写');
            }
            sendResponse({ success: true });
            break;

        case 'WAITING_VERIFICATION':
            if (email) {
                log(`${email}: 等待验证码，请手动输入`, 'warning');
                updateAccountStatus(email, 'waiting', '⚠️ 请输入验证码');
            }
            sendResponse({ success: true });
            break;

        case 'REGISTRATION_SUCCESS':
            if (email) {
                log(`${email}: 注册成功!`, 'success');
                updateAccountStatus(email, 'success', '注册成功');
                registrationState.activeTabs.delete(tabId);
                // 先清 storage → 关闭标签页 → 清除 cookies → 处理下一个
                (async () => {
                    await clearTabStorage(tabId);
                    try { await chrome.tabs.remove(tabId); } catch(e) {}
                    await clearWindsurfCookies();
                    setTimeout(() => processNextAccount(), 1500);
                })();
            }
            sendResponse({ success: true });
            break;

        case 'REGISTRATION_ERROR':
            if (email) {
                const errorMsg = message.data?.error || '未知错误';
                log(`${email}: 注册失败 - ${errorMsg}`, 'error');
                updateAccountStatus(email, 'error', errorMsg);
                registrationState.activeTabs.delete(tabId);
                // 先清 storage → 关闭标签页 → 清除 cookies → 处理下一个
                (async () => {
                    await clearTabStorage(tabId);
                    try { await chrome.tabs.remove(tabId); } catch(e) {}
                    await clearWindsurfCookies();
                    setTimeout(() => processNextAccount(), 1500);
                })();
            }
            sendResponse({ success: true });
            break;

        case 'NEED_CAPTCHA':
            if (email) {
                log(`${email}: 需要人机验证，请手动完成`, 'warning');
                updateAccountStatus(email, 'waiting', '⚠️ 请完成人机验证');
            }
            sendResponse({ success: true });
            break;

        case 'PAGE_CHANGED':
            if (email) {
                const page = message.data?.page || '未知';
                log(`${email}: 页面变化 -> ${page}`);
                updateAccountStatus(email, 'running', page);
            }
            sendResponse({ success: true });
            break;

        default:
            sendResponse({ success: false, error: '未知消息类型' });
    }

    return true;
});

// 监听标签页关闭
chrome.tabs.onRemoved.addListener((tabId) => {
    const email = registrationState.activeTabs.get(tabId);
    if (email) {
        const account = registrationState.accounts.find(a => a.email === email);
        if (account && account.status !== 'success') {
            log(`${email}: 标签页被关闭`, 'warning');
            updateAccountStatus(email, 'error', '标签页已关闭');
        }
        registrationState.activeTabs.delete(tabId);
        checkAllComplete();
    }
});

// 监听标签页 URL 变化，检测注册成功跳转
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.url) return;

    const email = registrationState.activeTabs.get(tabId);
    if (!email) return;

    const url = changeInfo.url;
    console.log(`[Background] 标签页 URL 变化: ${email} -> ${url}`);

    // 检测成功跳转（注册成功后通常跳转到 /download 或 /dashboard 等）
    const successPaths = ['/download', '/dashboard', '/home', '/welcome', '/editor'];
    const isSuccess = successPaths.some(p => url.includes(p));

    if (isSuccess) {
        const account = registrationState.accounts.find(a => a.email === email);
        if (account && account.status !== 'success') {
            log(`${email}: 检测到成功跳转 -> ${url}`, 'success');
            updateAccountStatus(email, 'success', '注册成功');
            registrationState.activeTabs.delete(tabId);
            // 先清 storage → 关闭标签页 → 清除 cookies → 处理下一个
            (async () => {
                await clearTabStorage(tabId);
                try { await chrome.tabs.remove(tabId); } catch(e) {}
                await clearWindsurfCookies();
                setTimeout(() => processNextAccount(), 1500);
            })();
        }
    }
});

/**
 * 保存状态到 chrome.storage.session
 */
function saveState() {
    const stateToSave = {
        accounts: registrationState.accounts.map(a => ({
            email: a.email,
            password: a.password,
            status: a.status,
            statusText: a.statusText
        })),
        isRunning: registrationState.isRunning
    };
    chrome.storage.session.set({ registrationState: stateToSave }).catch(() => {});
}

console.log('[Background] Service Worker 已启动');

// 启动时恢复状态
chrome.storage.session.get('registrationState').then(result => {
    if (result.registrationState) {
        const saved = result.registrationState;
        registrationState.accounts = saved.accounts || [];
        registrationState.isRunning = saved.isRunning || false;
        console.log('[Background] 已恢复状态:', registrationState.accounts.length, '个账号');
    }
}).catch(() => {});
