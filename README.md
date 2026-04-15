# 在线客服聊天软件

## 启动

```bash
npm install
npm start
```

打开 [http://localhost:3000](http://localhost:3000)

- 默认首页：客户端
- 客服入口：`/agent`
- 默认客服账号：`admin`
- 默认客服密码：`123456`

## 已实现功能

- 客户端免登录进入会话
- 客户端保持单一聊天窗口，界面精简
- 同设备优先复用旧会话，无法识别设备时按同 IP 复用旧会话
- 客服端账号密码登录
- 文字、图片、视频、文件、表情消息
- 客服端多联系人列表、搜索、在线筛选、会话统计
- 显示客户端 IP 地址与 IP 归属地
- 客服备注、消息数、最后活跃时间、设备标识查看
- 聊天记录与备注保存到 `data/store.json`

## 说明

- 浏览器网页无法直接读取真实 MAC 地址，因此项目使用浏览器持久设备标识来近似识别“同一设备”
- 如果多个客户处于同一公网 IP，下次访问会被视为同一旧会话，这是当前按你的要求实现的规则

## Docker

构建镜像：

```bash
docker build -t customer-service-chat:latest .
```

运行容器：

```bash
docker run -d \
  --name customer-service-chat \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/uploads:/app/uploads \
  customer-service-chat:latest
```

说明：

- `data` 用于保存会话、账号和设置
- `uploads` 用于保存图片、视频和文件上传内容
