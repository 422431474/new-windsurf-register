/**
 * Content Script
 * 自动填写表单、检测页面状态、等待验证码
 */

console.log('[Content Script] 已加载, URL:', location.href);

// 注册数据（从 background 接收）
let registrationData = null;

// 状态标志
let formFilled = false;
let passwordFilled = false;
let isWaitingVerification = false;

/**
 * 发送消息给 background
 */
function sendMessage(type, data = {}) {
    chrome.runtime.sendMessage({ type, data }).catch(err => {
        console.error('[Content Script] 发送消息失败:', err);
    });
}

/**
 * 延迟函数
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 触发输入事件
 */
function triggerInputEvents(element) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
}

/**
 * 填写输入框
 */
async function fillInput(selector, value, description = '') {
    const input = document.querySelector(selector);
    if (!input) {
        console.warn(`[Content Script] 未找到输入框: ${selector}`);
        return false;
    }

    input.focus();
    input.value = value;
    triggerInputEvents(input);

    console.log(`[Content Script] 已填写 ${description}: ${value.substring(0, 20)}...`);
    return true;
}

/**
 * 查找并填写输入框（通过多个选择器尝试）
 */
async function findAndFillInput(selectors, value, description = '') {
    for (const selector of selectors) {
        const input = document.querySelector(selector);
        if (input && !input.disabled && input.offsetParent !== null) {
            input.focus();
            await delay(100);
            input.value = value;
            triggerInputEvents(input);
            console.log(`[Content Script] 已填写 ${description}`);
            return true;
        }
    }
    console.warn(`[Content Script] 未找到 ${description} 输入框`);
    return false;
}

/**
 * 点击按钮
 */
async function clickButton(selectors, description = '') {
    for (const selector of selectors) {
        if (typeof selector === 'string') {
            const btn = document.querySelector(selector);
            if (btn && !btn.disabled && btn.offsetParent !== null) {
                btn.focus();
                btn.click();
                console.log(`[Content Script] 已点击 ${description}`);
                return true;
            }
        } else if (typeof selector === 'function') {
            const btn = selector();
            if (btn && !btn.disabled) {
                btn.focus();
                btn.click();
                console.log(`[Content Script] 已点击 ${description}`);
                return true;
            }
        }
    }
    return false;
}

/**
 * 查找 Continue 按钮
 */
function findContinueButton() {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
        const text = (btn.textContent || btn.innerText || '').trim();
        if ((text === 'Continue' || text === '继续') && !btn.disabled) {
            // 排除 "Other options" 按钮
            if (!text.includes('Other') && !text.includes('options')) {
                return btn;
            }
        }
    }
    return null;
}

/**
 * 检测当前页面类型
 */
function detectPageType() {
    const path = location.pathname;
    console.log('[Content Script] 检测页面类型, path:', path);

    // 注册初始页面
    if (path.includes('/account/register') && !path.includes('password')) {
        // 检查是否有邮箱输入框
        const emailInput = document.querySelector('input[type="email"], input[name*="email" i], input[id*="email" i]');
        console.log('[Content Script] 邮箱输入框:', emailInput ? '找到' : '未找到');
        if (emailInput) {
            return 'register_form';
        }
    }

    // 密码设置页面
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    if (passwordInputs.length > 0 && !isVerificationPage()) {
        return 'password_form';
    }

    // 验证码页面
    if (isVerificationPage()) {
        return 'verification';
    }

    // 人机验证页面
    if (isCaptchaPage()) {
        return 'captcha';
    }

    // 成功页面
    if (isSuccessPage()) {
        return 'success';
    }

    return 'unknown';
}

/**
 * 检测是否是验证码页面
 */
function isVerificationPage() {
    const selectors = [
        'input[name*="code" i]',
        'input[id*="code" i]',
        'input[placeholder*="code" i]',
        'input[placeholder*="验证码"]',
        'input[autocomplete="one-time-code"]',
        'input[maxlength="1"]'
    ];

    for (const selector of selectors) {
        const inputs = document.querySelectorAll(selector);
        if (inputs.length > 0) {
            // 检查是否有多个单字符输入框（常见的验证码输入方式）
            const singleCharInputs = document.querySelectorAll('input[maxlength="1"]');
            if (singleCharInputs.length >= 4) {
                return true;
            }
            // 或者有专门的验证码输入框
            if (inputs.length > 0 && inputs[0].offsetParent !== null) {
                return true;
            }
        }
    }

    // 检查页面文本
    const bodyText = document.body.innerText || '';
    if (bodyText.includes('verification code') || 
        bodyText.includes('验证码') ||
        bodyText.includes('enter the code')) {
        return true;
    }

    return false;
}

/**
 * 检测是否是人机验证页面
 */
function isCaptchaPage() {
    const selectors = [
        'iframe[src*="challenges.cloudflare.com"]',
        'iframe[src*="turnstile"]',
        'iframe[src*="recaptcha"]',
        'input[name="cf-turnstile-response"]',
        'div[class*="turnstile"]',
        'div[class*="recaptcha"]'
    ];

    for (const selector of selectors) {
        if (document.querySelector(selector)) {
            return true;
        }
    }

    const bodyText = document.body.innerText || '';
    if (bodyText.includes('verify that you are human') ||
        bodyText.includes('请验证您是人类')) {
        return true;
    }

    return false;
}

/**
 * 检测是否是成功页面
 */
function isSuccessPage() {
    const bodyText = document.body.innerText || '';
    const successIndicators = [
        'successfully registered',
        '注册成功',
        'welcome to windsurf',
        'account created',
        'verify your email'
    ];

    for (const indicator of successIndicators) {
        if (bodyText.toLowerCase().includes(indicator.toLowerCase())) {
            return true;
        }
    }

    // 检查 URL
    if (location.pathname.includes('/dashboard') || 
        location.pathname.includes('/home') ||
        location.pathname.includes('/welcome') ||
        location.pathname.includes('/download') ||
        location.pathname.includes('/editor') ||
        location.pathname.includes('/profile')) {
        return true;
    }

    return false;
}

/**
 * 填写注册表单
 */
async function fillRegistrationForm() {
    if (!registrationData || formFilled) {
        console.log('[Content Script] 跳过填写表单: registrationData=', !!registrationData, 'formFilled=', formFilled);
        return;
    }

    console.log('[Content Script] 开始填写注册表单...');
    console.log('[Content Script] 注册数据:', JSON.stringify({
        email: registrationData.email,
        firstName: registrationData.firstName,
        lastName: registrationData.lastName,
        passwordLength: registrationData.password?.length
    }));

    // 等待页面稳定
    await delay(1000);

    // 填写邮箱
    const emailSelectors = [
        'input[type="email"]',
        'input[name*="email" i]',
        'input[id*="email" i]',
        'input[placeholder*="email" i]'
    ];
    const emailFilled = await findAndFillInput(emailSelectors, registrationData.email, '邮箱');

    if (!emailFilled) {
        sendMessage('REGISTRATION_ERROR', { error: '找不到邮箱输入框' });
        return;
    }

    await delay(300);

    // 填写名字
    const firstNameSelectors = [
        'input[name*="first" i]',
        'input[id*="first" i]',
        'input[placeholder*="first" i]',
        'input[name*="given" i]'
    ];
    await findAndFillInput(firstNameSelectors, registrationData.firstName, '名');

    await delay(300);

    // 填写姓氏
    const lastNameSelectors = [
        'input[name*="last" i]',
        'input[id*="last" i]',
        'input[placeholder*="last" i]',
        'input[name*="family" i]',
        'input[name*="surname" i]'
    ];
    await findAndFillInput(lastNameSelectors, registrationData.lastName, '姓');

    await delay(500);

    // 勾选同意条款复选框
    await delay(300);
    const tosCheckbox = document.querySelector('input#terms, input[name="agreeTOS"], input[type="checkbox"][name*="agree" i], input[type="checkbox"][id*="terms" i]');
    if (tosCheckbox) {
        if (!tosCheckbox.checked) {
            tosCheckbox.click();
            tosCheckbox.checked = true;
            tosCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
            tosCheckbox.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[Content Script] 已勾选同意条款');
        } else {
            console.log('[Content Script] 同意条款已勾选');
        }
    } else {
        console.warn('[Content Script] 未找到同意条款复选框');
    }

    formFilled = true;
    sendMessage('FORM_FILLED');
    console.log('[Content Script] 表单填写完成，准备点击 Continue');

    // 尝试点击 Continue 按钮
    await delay(500);
    const continueBtn = findContinueButton();
    console.log('[Content Script] Continue 按钮:', continueBtn ? '找到' : '未找到');
    
    const clicked = await clickButton([findContinueButton], 'Continue 按钮');

    if (clicked) {
        sendMessage('PAGE_CHANGED', { page: '等待下一步...' });
        // SPA 页面可能不会改变 URL，需要主动轮询检测下一步页面
        console.log('[Content Script] 开始轮询等待密码页面...');
        await waitForNextPage();
    } else {
        console.log('[Content Script] 未能点击 Continue 按钮，页面按钮:', document.querySelectorAll('button').length);
        // 列出所有按钮文本
        document.querySelectorAll('button').forEach((btn, i) => {
            console.log(`[Content Script] 按钮${i}:`, btn.textContent?.trim().substring(0, 30));
        });
    }
}

/**
 * 等待下一步页面出现（SPA 导航后轮询检测）
 */
async function waitForNextPage() {
    const maxWait = 30000;
    const interval = 500;
    let waited = 0;

    while (waited < maxWait) {
        await delay(interval);
        waited += interval;

        // 检测密码输入框是否出现（仅在密码尚未填写时）
        if (!passwordFilled) {
            const passwordInputs = document.querySelectorAll('input[type="password"]');
            if (passwordInputs.length > 0) {
                console.log('[Content Script] 检测到密码页面，开始填写密码');
                await fillPasswordForm();
                return;
            }
        }

        // 检测人机验证（优先于验证码检测）
        if (isCaptchaPage()) {
            console.log('[Content Script] 检测到人机验证页面');
            await handleCaptchaPage();
            return;
        }

        // 检测验证码页面
        if (isVerificationPage()) {
            console.log('[Content Script] 检测到验证码页面');
            await handleVerificationPage();
            return;
        }

        // 检测成功页面
        if (isSuccessPage()) {
            console.log('[Content Script] 检测到成功页面');
            sendMessage('REGISTRATION_SUCCESS');
            return;
        }

        // 检测是否回到了注册表单（可能出错重来）
        if (!formFilled) {
            const emailInput = document.querySelector('input[type="email"]');
            if (emailInput) {
                console.log('[Content Script] 检测到注册表单，重新填写');
                await fillRegistrationForm();
                return;
            }
        }
    }

    console.warn('[Content Script] 等待下一步页面超时');
}

/**
 * 填写密码表单
 */
async function fillPasswordForm() {
    if (!registrationData || passwordFilled) {
        return;
    }

    console.log('[Content Script] 开始填写密码...');

    // 保存密码到 sessionStorage（供后续使用）
    sessionStorage.setItem('windsurf_registration_password', registrationData.password);

    await delay(500);

    // 查找密码输入框
    const passwordInputs = document.querySelectorAll('input[type="password"]');

    if (passwordInputs.length === 0) {
        return;
    }

    // 填写主密码
    const mainPassword = passwordInputs[0];
    mainPassword.focus();
    await delay(100);
    mainPassword.value = registrationData.password;
    triggerInputEvents(mainPassword);
    console.log('[Content Script] 已填写主密码');

    // 填写确认密码（如果有）
    if (passwordInputs.length > 1) {
        await delay(300);
        const confirmPassword = passwordInputs[1];
        confirmPassword.focus();
        await delay(100);
        confirmPassword.value = registrationData.password;
        triggerInputEvents(confirmPassword);
        console.log('[Content Script] 已填写确认密码');
    }

    passwordFilled = true;
    sendMessage('PAGE_CHANGED', { page: '密码已填写' });

    // 等待一下再点击提交
    await delay(1000);

    // 尝试点击 Continue 按钮
    const clicked = await clickButton([
        findContinueButton,
        'button[type="submit"]',
        'button.bg-sk-aqua'
    ], '提交按钮');

    if (clicked) {
        sendMessage('PAGE_CHANGED', { page: '等待验证...' });
        // 密码提交后轮询等待验证码/成功页面
        console.log('[Content Script] 密码已提交，开始轮询等待验证码页面...');
        await waitForNextPage();
    }
}

/**
 * 处理验证码页面（等待用户手动输入）
 */
async function handleVerificationPage() {
    if (isWaitingVerification) {
        return;
    }

    isWaitingVerification = true;
    console.log('[Content Script] 检测到验证码页面，等待用户输入...');
    sendMessage('WAITING_VERIFICATION');

    // 监听验证码输入完成
    const observer = new MutationObserver(() => {
        // 检查是否已经提交成功
        if (isSuccessPage()) {
            observer.disconnect();
            sendMessage('REGISTRATION_SUCCESS');
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 5分钟超时
    setTimeout(() => {
        observer.disconnect();
        if (isWaitingVerification && !isSuccessPage()) {
            sendMessage('REGISTRATION_ERROR', { error: '验证码输入超时' });
        }
    }, 300000);
}

/**
 * 检测 Cloudflare Turnstile 是否验证通过
 */
function isCaptchaCompleted() {
    // 检查 cf-turnstile-response 是否有值
    const response = document.querySelector('input[name="cf-turnstile-response"]');
    if (response && response.value) {
        return true;
    }
    // 检查页面是否有"成功"文本（Turnstile 验证通过后显示）
    const bodyText = document.body.innerText || '';
    if (bodyText.includes('成功') || bodyText.includes('Success')) {
        // 同时页面还有 Continue 按钮
        if (findContinueButton()) {
            return true;
        }
    }
    return false;
}

/**
 * 处理人机验证页面
 */
async function handleCaptchaPage() {
    console.log('[Content Script] 检测到人机验证页面');
    sendMessage('NEED_CAPTCHA', { message: '请完成人机验证' });

    // 尝试自动点击 Turnstile 复选框（可能因跨域限制不生效）
    await delay(1500);
    try {
        const turnstileIframe = document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]');
        if (turnstileIframe) {
            console.log('[Content Script] 尝试自动点击 Turnstile iframe...');
            turnstileIframe.focus();
            turnstileIframe.click();
            // 也尝试点击 Turnstile 容器
            const container = turnstileIframe.parentElement;
            if (container) {
                container.click();
            }
            // 尝试模拟鼠标事件
            const rect = turnstileIframe.getBoundingClientRect();
            const clickX = rect.left + 30; // 复选框大概在左侧30px处
            const clickY = rect.top + rect.height / 2;
            turnstileIframe.dispatchEvent(new MouseEvent('click', {
                bubbles: true, clientX: clickX, clientY: clickY
            }));
            console.log('[Content Script] Turnstile 自动点击已尝试');
        }
    } catch (e) {
        console.log('[Content Script] Turnstile 自动点击失败:', e.message);
    }

    // 轮询检测验证完成或 Continue 按钮可用
    const maxWait = 120000;
    const interval = 1000;
    let waited = 0;

    while (waited < maxWait) {
        await delay(interval);
        waited += interval;

        // 检测验证是否已完成（必须验证通过才点 Continue）
        if (isCaptchaCompleted()) {
            console.log('[Content Script] 人机验证已完成，尝试点击 Continue');
            sendMessage('PAGE_CHANGED', { page: '人机验证通过，继续...' });

            await delay(500);
            const clicked = await clickButton([findContinueButton], 'Continue（验证后）');
            if (clicked) {
                console.log('[Content Script] 已点击验证后的 Continue');
                // 继续等待下一步页面
                await waitForNextPage();
            }
            return;
        }

        // 如果页面已经不是 captcha 页面了（可能自动跳转了）
        if (!isCaptchaPage()) {
            console.log('[Content Script] 人机验证页面已消失，重新检测');
            await processPage();
            return;
        }
    }

    console.warn('[Content Script] 人机验证超时');
    sendMessage('REGISTRATION_ERROR', { error: '人机验证超时' });
}

/**
 * 处理当前页面
 */
async function processPage() {
    const pageType = detectPageType();
    console.log('[Content Script] 当前页面类型:', pageType);

    switch (pageType) {
        case 'register_form':
            await fillRegistrationForm();
            break;

        case 'password_form':
            await fillPasswordForm();
            break;

        case 'verification':
            await handleVerificationPage();
            break;

        case 'captcha':
            await handleCaptchaPage();
            break;

        case 'success':
            sendMessage('REGISTRATION_SUCCESS');
            break;

        default:
            console.log('[Content Script] 未知页面类型，等待...');
    }
}

/**
 * 监听来自 background 的消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Content Script] 收到消息:', message.type, message.data ? JSON.stringify(message.data).substring(0, 100) : '');

    if (message.type === 'START_REGISTRATION') {
        console.log('[Content Script] 收到注册数据:', message.data.email);
        registrationData = message.data;
        formFilled = false;
        passwordFilled = false;
        isWaitingVerification = false;

        // 开始处理页面
        console.log('[Content Script] 开始处理页面...');
        processPage();
        sendResponse({ success: true });
    }

    return true;
});

// 监听页面变化（SPA 路由）
let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.log('[Content Script] URL 变化:', location.href);

        // 延迟处理，等待页面加载
        setTimeout(() => {
            if (registrationData) {
                processPage();
            }
        }, 1500);
    }
});

urlObserver.observe(document.body, {
    childList: true,
    subtree: true
});

// 监听 pushState
const originalPushState = history.pushState;
history.pushState = function(...args) {
    originalPushState.apply(history, args);
    if (registrationData) {
        setTimeout(processPage, 1500);
    }
};

// 页面加载完成后，如果有保存的密码，尝试自动填写
window.addEventListener('load', () => {
    const savedPassword = sessionStorage.getItem('windsurf_registration_password');
    if (savedPassword && !registrationData) {
        // 这可能是页面刷新或重定向，尝试恢复
        console.log('[Content Script] 检测到保存的密码，尝试继续流程');
        registrationData = { password: savedPassword };
        setTimeout(processPage, 1500);
    }
});

console.log('[Content Script] 初始化完成');
