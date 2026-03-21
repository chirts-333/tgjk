# TGJK

TGJK 是一个基于 Telegram 账号的消息监控与转发工具，提供可视化后台，支持关键词监控、分类转发、原群自动回复、定时群发任务，以及 Docker / Windows / Linux 多种运行方式。

## 功能介绍

### 1. Telegram 账号登录
- 支持手机号登录
- 支持验证码登录
- 支持 2FA 二步验证密码
- 支持代理设置
  - 跟随系统
  - Socks5
  - MTProxy

### 2. 关键词监控
- 监听当前 Telegram 账号可接收到的消息
- 支持多种关键词匹配方式
  - 全字匹配
  - 包含匹配
  - 正则匹配
  - 模糊匹配
  - 按用户匹配
- 支持关键词动作
  - 监控
  - 排除

### 3. 分类转发
- 命中不同关键词后可转发到不同目标群
- 一条关键词可配置多个目标群
- 每个目标群可单独设置：
  - 是否显示消息来源
  - 转发方式为“原格式转发”或“纯消息内容”
- 未设置分类目标群时，默认沿用 Telegram 控制台中的默认目标群

### 4. 原群自动回复
- 命中关键词后可在原会话直接回复对方
- 支持默认回复模板
- 支持多模板随机回复
- 支持变量：
  - `{sender}`
  - `{keywords}`
  - `{chat}`

### 5. 定时群发任务
- 读取当前账号群组列表
- 用户可勾选多个目标群组
- 支持群发模板库
- 支持顺序群发
- 支持群与群之间等待
- 支持整轮发送后随机等待

### 6. 多实例隔离运行
- 数据库、日志、Telegram session 支持独立目录
- Docker 默认数据目录为 `/data`
- 适合多个容器同时运行，互不影响

## 后台页面

- Telegram 控制台：`/telegram.html`
- 关键词管理：`/keywords.html`

本地默认地址：

- [http://127.0.0.1:5005/telegram.html](http://127.0.0.1:5005/telegram.html)
- [http://127.0.0.1:5005/keywords.html](http://127.0.0.1:5005/keywords.html)

## 使用方法

### 第一步：登录 Telegram
1. 打开 `telegram.html`
2. 点击“登录 / 重新登录”
3. 输入手机号
4. 输入验证码
5. 如开启 2FA，再输入二步验证密码

### 第二步：设置默认目标群
1. 点击“加载会话”
2. 选择一个目标群
3. 点击“设为目标”

### 第三步：配置关键词
1. 打开 `keywords.html`
2. 添加或编辑关键词
3. 配置匹配类型、动作、样式
4. 如需分类转发，可配置多个目标群
5. 对每个目标群设置：
   - 是否显示来源
   - 转发方式

### 第四步：启动监控
1. 回到 `telegram.html`
2. 点击“启动监控”

## 本地运行

### Windows

```powershell
cd "C:\Users\sava\Documents\New project\TelegramMonitor"
$env:DOTNET_CLI_HOME="$PWD\.dotnet-cli-home"
$env:NUGET_USER_HOME="$PWD\.nuget\user-home"
$env:APPDATA="$PWD\.nuget\appdata"
$env:NUGET_PACKAGES="$PWD\.nuget\packages"
$env:NUGET_HTTP_CACHE_PATH="$PWD\.nuget\http-cache"
$env:NUGET_PLUGINS_CACHE_PATH="$PWD\.nuget\plugins-cache"
& "$env:USERPROFILE\dotnet\dotnet.exe" run --project .\src\TelegramMonitor.csproj
```

### Linux

```bash
dotnet run --project ./src/TelegramMonitor.csproj
```

## 打包方法

### Windows 单文件程序

```powershell
& "$env:USERPROFILE\dotnet\dotnet.exe" publish .\src\TelegramMonitor.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  /p:PublishSingleFile=true `
  -o .\out\win-x64
```

输出文件：

- `out\win-x64\tgjk.exe`

### Linux 单文件程序

```powershell
& "$env:USERPROFILE\dotnet\dotnet.exe" publish .\src\TelegramMonitor.csproj `
  -c Release `
  -r linux-x64 `
  --self-contained true `
  /p:PublishSingleFile=true `
  -o .\out\linux-amd64
```

## Docker 使用方法

### 构建镜像

```powershell
docker build -t g3770/tgjk:latest --build-arg TARGETARCH=amd64 .
```

### 运行单个实例

```bash
docker run -d --name tgjk --restart unless-stopped -p 5055:5005 -v /opt/tgjk-data:/data g3770/tgjk:latest
```

访问地址：

- `http://服务器IP:5055/telegram.html`
- `http://服务器IP:5055/keywords.html`

### 运行多个实例

第一个实例：

```bash
docker run -d --name tgjk1 --restart unless-stopped -p 5055:5005 -v /opt/tgjk1:/data g3770/tgjk:latest
```

第二个实例：

```bash
docker run -d --name tgjk2 --restart unless-stopped -p 5056:5005 -v /opt/tgjk2:/data g3770/tgjk:latest
```

说明：

- 每个实例使用独立 `/data` 挂载目录
- 数据库、日志、session 自动隔离

## GitHub Release 与 Linux 一键安装

仓库已内置：

- GitHub Actions 自动构建工作流
- Linux 一键安装脚本 `scripts/install-linux.sh`

如果已经发布 Release，可在 Linux 上一键安装：

```bash
curl -fsSL https://raw.githubusercontent.com/chirts-333/tgjk/main/scripts/install-linux.sh | bash -s -- chirts-333/tgjk
```

## 常见问题

### 1. 页面打不开
- 检查程序是否启动
- 检查端口是否被占用
- 检查防火墙是否放行

### 2. 前端修改后没生效
- 浏览器按 `Ctrl + F5` 强制刷新缓存

### 3. Docker 多开互相串数据
- 确保每个容器挂载不同的 `/data` 目录

### 4. 登录失败
- 检查手机号格式
- 检查验证码是否正确
- 检查 2FA 密码是否正确
- 检查代理和网络环境

## 版本说明

### v1.1.0
- 保留原有全部功能
- 新增关键词分类转发
- 支持一条关键词多个目标群
- 支持每个目标群单独设置：
  - 原格式转发 / 纯消息内容
  - 是否显示消息来源
- 优化登录流程
- 优化多实例数据隔离
- 优化前端中文提示和后台使用体验
