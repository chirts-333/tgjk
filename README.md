# TGJK

TGJK 是一个基于 Telegram 账号的消息监控与转发工具，提供可视化后台，支持关键词监控、分类转发、原群自动回复、定时群发、多用户隔离和 Docker / Windows / Linux 多种运行方式。

## 主要功能

### 1. Telegram 登录
- 支持手机号登录
- 支持验证码登录
- 支持 2FA 二步验证密码
- 支持代理设置
  - 跟随系统
  - Socks5
  - MTProxy
- 支持清理当前 Telegram 会话并重新登录

### 2. 关键词监控
- 监听当前 Telegram 账号可接收到的消息
- 支持多种关键词匹配方式
  - 全字
  - 包含
  - 正则
  - 模糊
  - 按用户匹配
- 支持关键词动作
  - 监控
  - 排除
- 默认匹配模式为“包含”

### 3. 分类转发
- 命中不同关键词后可转发到不同目标群组
- 一条关键词可配置多个目标群
- 每个目标群可单独设置
  - 是否显示消息来源
  - 原格式转发 / 纯消息内容
- 未设置分类目标群时，可沿用默认转发目标

### 4. 原群自动回复
- 命中关键词后可在原会话直接回复对方
- 支持默认回复模板
- 支持随机模板回复
- 支持占位符
  - `{sender}`
  - `{keywords}`
  - `{chat}`
- 默认关闭，需要用户手动开启

### 5. 定时群发任务
- 读取当前账号群组列表
- 可选择多个目标群组
- 支持模板库随机发送
- 支持顺序群发
- 支持群与群之间固定等待
- 支持每轮完成后按范围随机等待

### 6. 多用户隔离后台
- 管理员 / 普通用户账号体系
- 管理员可创建、修改、删除用户
- 支持设置用户到期时间
- 每个用户使用独立 Telegram 环境
- 每个用户的数据库配置、会话、日志互相隔离

### 7. 多实例 Docker 部署
- Docker 默认数据目录为 `/data`
- 支持多个容器同时运行
- 每个实例只要挂载不同目录即可互不影响

## 页面入口

程序启动后，直接访问根地址即可：

- `http://127.0.0.1:5005/`

不需要再输入 `telegram.html` 或 `keywords.html`。

## 本地运行

### Windows

```powershell
cd "C:\Users\sava\Documents\New project\TelegramMonitor"
$root = "C:\Users\sava\Documents\New project\TelegramMonitor"
$nugetDir = Join-Path $root ".nuget"
$env:DOTNET_CLI_HOME = Join-Path $root ".dotnet-cli-home"
$env:NUGET_USER_HOME = Join-Path $nugetDir "user-home"
$env:APPDATA = Join-Path $nugetDir "appdata"
$env:NUGET_PACKAGES = Join-Path $nugetDir "packages"
$env:NUGET_HTTP_CACHE_PATH = Join-Path $nugetDir "http-cache"
$env:NUGET_PLUGINS_CACHE_PATH = Join-Path $nugetDir "plugins-cache"
& "$env:USERPROFILE\dotnet\dotnet.exe" run --project .\src\TelegramMonitor.csproj
```

### Linux

```bash
dotnet run --project ./src/TelegramMonitor.csproj
```

## Docker 使用

### 构建镜像

```powershell
docker build -t g3770/tgjk:latest .
```

### 运行单实例

```bash
docker run -d \
  --name tgjk \
  --restart unless-stopped \
  -p 5055:5005 \
  -v /opt/tgjk-data:/data \
  g3770/tgjk:latest
```

访问地址：

- `http://服务器IP:5055/`

### 运行多实例

第一个实例：

```bash
docker run -d \
  --name tgjk1 \
  --restart unless-stopped \
  -p 5055:5005 \
  -v /opt/tgjk1:/data \
  g3770/tgjk:latest
```

第二个实例：

```bash
docker run -d \
  --name tgjk2 \
  --restart unless-stopped \
  -p 5056:5005 \
  -v /opt/tgjk2:/data \
  g3770/tgjk:latest
```

说明：

- 每个实例使用独立 `/data` 挂载目录
- 数据库、日志、session 自动隔离

## Windows 打包

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

## Linux 打包

```powershell
& "$env:USERPROFILE\dotnet\dotnet.exe" publish .\src\TelegramMonitor.csproj `
  -c Release `
  -r linux-x64 `
  --self-contained true `
  /p:PublishSingleFile=true `
  -o .\out\linux-amd64
```

## 常见问题

### 1. 前端修改后没生效
- 浏览器按 `Ctrl + F5` 强制刷新缓存

### 2. Telegram 登录异常
- 可先点击“清理 Telegram 会话”后重新登录
- 检查手机号格式、验证码、2FA 密码是否正确
- 检查代理与网络环境

### 3. Docker 多开串数据
- 确保每个容器挂载不同 `/data` 目录

## 最新版本包含

- 一体化中文后台页面
- 用户与管理员机制
- 多用户 Telegram 隔离
- 关键词多目标群转发
- 每个目标群独立转发方式与来源显示设置
- 默认匹配模式改为“包含”
- 删除用户时自动清理对应 session 目录
- Telegram 会话清理按钮
