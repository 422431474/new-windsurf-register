# Windsurf 批量注册工具

Chrome 浏览器扩展，自动化批量注册 Windsurf 账号。串行模式逐个注册，每次自动清除登录态，确保多账号互不干扰。

## 功能特点

- **批量注册** — 一次输入多个账号密码，自动逐个注册
- **串行模式** — 逐个处理，每次注册前自动清除 cookies、localStorage、Firebase IndexedDB
- **自动填表** — 自动填写邮箱、随机英文姓名、密码，自动勾选同意条款
- **验证码处理** — 检测到人机验证/邮箱验证码后暂停，等待手动完成
- **成功检测** — 自动检测注册成功页面，关闭标签页并处理下一个
- **状态持久化** — 关闭 popup 不丢失注册进度，重新打开自动恢复
- **一键复制** — 注册成功的账号密码可一键复制
- **清空记录** — 支持手动清空所有注册记录和状态

## 安装方法

1. 打开 Chrome 浏览器，进入 `chrome://extensions/`
2. 开启右上角**开发者模式**
3. 点击**加载已解压的扩展程序**
4. 选择本项目文件夹

## 使用方法

1. 点击浏览器工具栏的扩展图标
2. 在文本框中输入账号密码，每行一个：
   ```
   example1@qq.com  password123
   example2@qq.com  password456
   example3@qq.com  password789
   ```
3. 点击 **🚀 开始批量注册**
4. 等待自动处理：
   - ✅ **自动完成**：填写表单、设置密码、勾选条款、点击 Continue
   - ⚠️ **需手动操作**：Cloudflare 人机验证（点击复选框）、邮箱验证码输入
5. 注册成功的账号会显示在底部，可一键复制

## 输入格式

支持以下分隔符（每行一个账号）：
- 双空格：`email@qq.com  password123`
- Tab：`email@qq.com	password123`
- 逗号：`email@qq.com,password123`
- 单空格：`email@qq.com password123`

> 密码长度至少 6 位

## 注册流程

```
每个账号的注册流程：
1. 清除 cookies + IndexedDB（Firebase Auth 登录态）
2. 打开注册页面 → 清除 IndexedDB → 刷新页面
3. 自动填写邮箱、姓名（并行填写）
4. 自动勾选同意条款 → 点击 Continue
5. [手动] 完成 Cloudflare 人机验证
6. 自动填写密码 → 点击 Continue
7. [手动] 输入邮箱验证码
8. 检测注册成功 → 关闭标签页 → 清除数据 → 下一个
```

## 注意事项

- 邮箱验证码需要手动从邮箱获取并输入
- Cloudflare 人机验证需要手动点击复选框
- 密码长度至少 6 位
- 注册过程中请勿关闭 Chrome 浏览器

## 文件结构

```
new-windsurf-register/
├── manifest.json        # 扩展配置（MV3）
├── popup.html           # 弹出界面
├── popup.css            # 界面样式
├── popup.js             # 界面逻辑 + 状态恢复
├── background.js        # 后台服务 + 注册调度 + 数据清除
├── content-script.js    # 页面自动化 + 表单填写 + SPA 导航检测
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 技术实现

### 架构

- **Popup**：UI 展示 + 用户交互 + 状态恢复（`chrome.storage.session`）
- **Background Service Worker**：注册调度 + 标签页管理 + 数据清除 + 状态持久化
- **Content Script**：DOM 操作 + 表单自动填写 + SPA 路由检测 + 验证码检测

### 数据清除策略

每次注册新账号前执行三重清除：
1. `chrome.cookies` API — 删除所有 windsurf/codeium 域名的 cookies
2. `chrome.browsingData` API — 清除指定源的 cookies、localStorage、IndexedDB
3. `chrome.scripting.executeScript` — 在页面中删除 `firebaseLocalStorageDb` IndexedDB

### 消息通信

| 方向 | 消息类型 | 说明 |
|------|---------|------|
| Popup → Background | `START_REGISTRATION` | 开始批量注册 |
| Popup → Background | `STOP_REGISTRATION` | 停止注册 |
| Popup → Background | `GET_STATE` | 获取当前状态 |
| Popup → Background | `CLEAR_STATE` | 清空所有记录 |
| Content → Background | `FORM_FILLED` | 表单已填写 |
| Content → Background | `WAITING_VERIFICATION` | 等待验证码 |
| Content → Background | `NEED_CAPTCHA` | 需要人机验证 |
| Content → Background | `REGISTRATION_SUCCESS` | 注册成功 |
| Content → Background | `REGISTRATION_ERROR` | 注册失败 |
| Background → Popup | `STATUS_UPDATE` | 账号状态更新 |
| Background → Popup | `LOG` | 运行日志 |
| Background → Popup | `REGISTRATION_COMPLETE` | 全部完成 |

## License

MIT
