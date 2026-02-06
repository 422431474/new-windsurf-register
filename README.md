# Windsurf 批量注册工具

Chrome 浏览器扩展，支持批量注册 Windsurf 账号。

## 功能特点

- **批量输入**：支持多行文本输入账号密码，格式：`邮箱  密码`
- **并行注册**：支持同时处理多个账号（1-5个）
- **自动填表**：自动填写邮箱、密码、随机英文姓名
- **验证码等待**：检测到验证码页面后暂停，等待用户手动输入
- **状态追踪**：实时显示每个账号的注册状态

## 安装方法

1. 打开 Chrome 浏览器，进入 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目文件夹

## 使用方法

1. 点击浏览器工具栏的扩展图标
2. 在文本框中输入账号密码，每行一个：
   ```
   example1@qq.com  password123
   example2@qq.com  password456
   example3@qq.com  password789
   ```
3. 选择同时注册数量
4. 点击「开始批量注册」
5. **验证码需要手动输入**：当状态显示「等待验证码」时，请到对应标签页手动输入验证码

## 输入格式

支持以下分隔符：
- 空格：`email@qq.com password123`
- Tab：`email@qq.com	password123`
- 逗号：`email@qq.com,password123`

## 注意事项

- 邮箱验证码需要手动从 QQ 邮箱获取并输入
- 人机验证（Cloudflare Turnstile）需要手动完成
- 建议不要同时注册太多账号，避免触发风控
- 密码长度至少 6 位

## 文件结构

```
new-windsurf-register/
├── manifest.json        # 扩展配置
├── popup.html           # 弹出界面
├── popup.css            # 界面样式
├── popup.js             # 界面逻辑
├── background.js        # 后台服务
├── content-script.js    # 页面自动化
├── icons/               # 图标
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## 开发说明

### 消息类型

**Popup -> Background:**
- `START_REGISTRATION`: 开始注册
- `STOP_REGISTRATION`: 停止注册
- `GET_STATE`: 获取状态

**Content Script -> Background:**
- `FORM_FILLED`: 表单已填写
- `WAITING_VERIFICATION`: 等待验证码
- `NEED_CAPTCHA`: 需要人机验证
- `REGISTRATION_SUCCESS`: 注册成功
- `REGISTRATION_ERROR`: 注册失败

**Background -> Popup:**
- `STATUS_UPDATE`: 状态更新
- `LOG`: 日志
- `REGISTRATION_COMPLETE`: 全部完成
