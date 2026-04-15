const express = require("express");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const session = require("express-session");
const multer = require("multer");
const geoip = require("geoip-lite");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "customer-service-demo-secret";
const AGENT_USERNAME = process.env.AGENT_USERNAME || "admin";
const AGENT_PASSWORD = process.env.AGENT_PASSWORD || "123456";
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const HOST = process.env.HOST || "0.0.0.0";
const PASSWORD_KEYLEN = 64;
const PASSWORD_COST = 16384;
const TELEGRAM_API_BASE = "https://api.telegram.org";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: {
    fileSize: 1024 * 1024 * 100,
  },
});

let store = {
  clients: {},
  agentAccount: {
    username: AGENT_USERNAME,
    passwordHash: "",
    passwordSalt: "",
  },
  settings: {
    autoReplyEnabled: false,
    autoReplyText: "",
    welcomeMessageEnabled: false,
    welcomeMessageText: "",
    quickReplies: [],
    telegramEnabled: false,
    telegramBotToken: "",
    telegramChatId: "",
    telegramBotName: "",
  },
};

let saveTimer = null;
const locationCache = new Map();
let telegramPollTimer = null;
let telegramState = {
  token: "",
  chatId: "",
  enabled: false,
  offset: 0,
  polling: false,
};
const telegramMessageLinks = new Map();

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await fsp.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  }, 200);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, PASSWORD_KEYLEN, { N: PASSWORD_COST }).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, passwordHash, passwordSalt) {
  if (!passwordHash || !passwordSalt) return false;
  const candidate = crypto.scryptSync(password, passwordSalt, PASSWORD_KEYLEN, { N: PASSWORD_COST }).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(passwordHash, "hex"));
}

function normalizeQuickReplies(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

function sanitizeSettings(settings = {}) {
  return {
    autoReplyEnabled: !!settings.autoReplyEnabled,
    autoReplyText: String(settings.autoReplyText || ""),
    welcomeMessageEnabled: !!settings.welcomeMessageEnabled,
    welcomeMessageText: String(settings.welcomeMessageText || ""),
    quickReplies: normalizeQuickReplies(settings.quickReplies),
    telegramEnabled: !!settings.telegramEnabled,
    telegramBotToken: String(settings.telegramBotToken || "").trim(),
    telegramChatId: String(settings.telegramChatId || "").trim(),
    telegramBotName: String(settings.telegramBotName || "").trim(),
  };
}

function maskTelegramToken(token) {
  const value = String(token || "").trim();
  if (!value) return "";
  if (value.length <= 10) return "已设置";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function getPublicSettings() {
  return {
    autoReplyEnabled: store.settings.autoReplyEnabled,
    autoReplyText: store.settings.autoReplyText,
    welcomeMessageEnabled: store.settings.welcomeMessageEnabled,
    welcomeMessageText: store.settings.welcomeMessageText,
    quickReplies: store.settings.quickReplies,
    telegramEnabled: store.settings.telegramEnabled,
    telegramChatId: store.settings.telegramChatId,
    telegramBotName: store.settings.telegramBotName,
    telegramBotTokenMasked: maskTelegramToken(store.settings.telegramBotToken),
  };
}

function getPublicAgentAccount() {
  return {
    username: store.agentAccount.username,
  };
}

async function loadStore() {
  try {
    const raw = await fsp.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.clients) {
      const parsedUsername = String(parsed.agentAccount?.username || AGENT_USERNAME);
      const parsedHash = String(parsed.agentAccount?.passwordHash || "");
      const parsedSalt = String(parsed.agentAccount?.passwordSalt || "");
      const legacyPassword = String(parsed.agentAccount?.password || "");
      const normalizedAccount =
        parsedHash && parsedSalt
          ? {
              username: parsedUsername,
              passwordHash: parsedHash,
              passwordSalt: parsedSalt,
            }
          : (() => {
              const seeded = hashPassword(legacyPassword || AGENT_PASSWORD);
              return {
                username: parsedUsername,
                passwordHash: seeded.hash,
                passwordSalt: seeded.salt,
              };
            })();

      store = {
        clients: parsed.clients || {},
        agentAccount: normalizedAccount,
        settings: sanitizeSettings(parsed.settings),
      };

      if (!parsedHash || !parsedSalt || parsed.agentAccount?.password) {
        scheduleSave();
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Failed to load store:", error);
    }
  }

  if (!store.agentAccount.passwordHash || !store.agentAccount.passwordSalt) {
    const seeded = hashPassword(AGENT_PASSWORD);
    store.agentAccount.passwordHash = seeded.hash;
    store.agentAccount.passwordSalt = seeded.salt;
    scheduleSave();
  }
}

async function telegramRequest(method, payload = {}, token = store.settings.telegramBotToken) {
  const resolvedToken = String(token || "").trim();
  if (!resolvedToken) {
    throw new Error("Telegram Bot Token 未设置");
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${resolvedToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram ${method} 请求失败`);
  }
  return data.result;
}

function buildTelegramPreview(message) {
  if (!message) return "";
  if (message.type === "text") return message.text || "";
  if (message.type === "image") return `[图片] ${message.fileName || ""}`.trim();
  if (message.type === "video") return `[视频] ${message.fileName || ""}`.trim();
  return `[文件] ${message.fileName || ""}`.trim();
}

function buildTelegramNotificationText(client, message) {
  const label = client.note || client.nickname;
  return [
    "网站新消息",
    `会话ID: ${client.clientId}`,
    `客户: ${label}`,
    `IP: ${client.ip || "未知"}`,
    `地区: ${client.location || "未知"}`,
    "",
    buildTelegramPreview(message),
    "",
    "回复方式:",
    `/reply ${client.clientId} 这里输入回复内容`,
    "或直接回复这条 Telegram 通知",
  ].join("\n");
}

async function sendTelegramNotification(clientId, message) {
  const settings = store.settings;
  if (!settings.telegramEnabled || !settings.telegramBotToken || !settings.telegramChatId) return;
  const client = getClient(clientId);
  if (!client || message.sender !== "client") return;

  try {
    const result = await telegramRequest("sendMessage", {
      chat_id: settings.telegramChatId,
      text: buildTelegramNotificationText(client, message),
    });
    if (result?.message_id) {
      telegramMessageLinks.set(`${result.chat.id}:${result.message_id}`, clientId);
    }
  } catch (error) {
    console.error("Failed to send Telegram notification:", error.message);
  }
}

async function sendTelegramReplyAck(chatId, text) {
  try {
    await telegramRequest("sendMessage", { chat_id: chatId, text });
  } catch (error) {
    console.error("Failed to send Telegram ack:", error.message);
  }
}

async function handleTelegramUpdate(update) {
  const message = update?.message;
  if (!message?.text) return;

  const configuredChatId = String(store.settings.telegramChatId || "").trim();
  const currentChatId = String(message.chat?.id || "").trim();
  if (!configuredChatId || currentChatId !== configuredChatId) return;

  const text = String(message.text || "").trim();
  if (!text) return;

  let targetClientId = "";
  let replyText = "";
  const explicitMatch = text.match(/^\/reply(?:@\S+)?\s+([a-zA-Z0-9-]+)\s+([\s\S]+)$/i);

  if (explicitMatch) {
    [, targetClientId, replyText] = explicitMatch;
  } else if (message.reply_to_message?.message_id) {
    targetClientId = telegramMessageLinks.get(`${currentChatId}:${message.reply_to_message.message_id}`) || "";
    replyText = text;
  }

  replyText = String(replyText || "").trim();
  if (!targetClientId || !replyText) {
    if (text.startsWith("/reply")) {
      await sendTelegramReplyAck(currentChatId, "格式不正确，请使用 /reply 会话ID 回复内容");
    }
    return;
  }

  const target = getClient(targetClientId);
  if (!target) {
    await sendTelegramReplyAck(currentChatId, `会话 ${targetClientId} 不存在或已删除`);
    return;
  }

  const reply = buildMessage({
    sender: "agent",
    senderName: "Telegram 客服",
    type: "text",
    text: replyText,
  });
  appendMessage(targetClientId, reply);
  broadcastContacts();
  emitConversation(targetClientId);
  await sendTelegramReplyAck(currentChatId, `已回复 ${target.note || target.nickname}`);
}

async function pollTelegramUpdates() {
  if (!telegramState.enabled || !telegramState.token || !telegramState.chatId || telegramState.polling) return;

  telegramState.polling = true;
  try {
    const updates = await telegramRequest(
      "getUpdates",
      {
        timeout: 0,
        offset: telegramState.offset,
        allowed_updates: ["message"],
      },
      telegramState.token,
    );

    for (const update of updates) {
      telegramState.offset = Math.max(telegramState.offset, Number(update.update_id || 0) + 1);
      await handleTelegramUpdate(update);
    }
  } catch (error) {
    console.error("Telegram polling failed:", error.message);
  } finally {
    telegramState.polling = false;
  }
}

function refreshTelegramPolling() {
  telegramState = {
    ...telegramState,
    token: store.settings.telegramBotToken,
    chatId: store.settings.telegramChatId,
    enabled:
      !!store.settings.telegramEnabled &&
      !!store.settings.telegramBotToken &&
      !!store.settings.telegramChatId,
  };

  if (telegramPollTimer) {
    clearInterval(telegramPollTimer);
    telegramPollTimer = null;
  }

  if (!telegramState.enabled) return;
  pollTelegramUpdates();
  telegramPollTimer = setInterval(pollTelegramUpdates, 3000);
}

function extractIp(reqLike) {
  const forwarded = reqLike.headers["x-forwarded-for"];
  const source = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const candidate = source ? source.split(",")[0].trim() : reqLike.socket.remoteAddress || "";
  return candidate.replace(/^::ffff:/, "");
}

function isPrivateIp(ip) {
  return (
    ip === "::1" ||
    ip === "127.0.0.1" ||
    ip === "localhost" ||
    ip === "::" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) ||
    ip.startsWith("169.254.") ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe80:")
  );
}

function resolveGeoipLocation(ip) {
  const geo = geoip.lookup(ip);
  if (!geo) return "";

  const parts = [];
  if (geo.country) parts.push(geo.country);
  if (geo.region && geo.region !== geo.country) parts.push(geo.region);
  if (geo.city) parts.push(geo.city);

  return parts.filter(Boolean).join(" / ");
}

async function resolveIpLocation(ip) {
  if (!ip) return "未知";
  if (isPrivateIp(ip)) return "局域网 / 本机";
  if (locationCache.has(ip)) return locationCache.get(ip);

  const localLocation = resolveGeoipLocation(ip);
  if (localLocation) {
    locationCache.set(ip, localLocation);
    return localLocation;
  }

  try {
    const response = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN&fields=status,country,regionName,city`);
    const data = await response.json();
    const location = data.status === "success"
      ? [data.country, data.regionName, data.city].filter(Boolean).join(" / ")
      : "未知";
    locationCache.set(ip, location || "未知");
    return location || "未知";
  } catch (_error) {
    return "未知";
  }
}

function getClient(clientId) {
  return store.clients[clientId];
}

function findExistingClientId({ clientId, deviceKey, ip }) {
  if (clientId && store.clients[clientId]) {
    return clientId;
  }

  if (deviceKey) {
    const matchedByDevice = Object.values(store.clients).find((client) => client.deviceKey === deviceKey);
    if (matchedByDevice) return matchedByDevice.clientId;
  }

  if (ip) {
    const matchedByIp = Object.values(store.clients).find((client) => client.ip === ip);
    if (matchedByIp) return matchedByIp.clientId;
  }

  return clientId || crypto.randomUUID();
}

function summarizeClient(client) {
  const lastMessage = client.messages.at(-1) || null;
  return {
    clientId: client.clientId,
    nickname: client.nickname,
    note: client.note || "",
    ip: client.ip || "",
    location: client.location || "未知",
    connected: !!client.connected,
    createdAt: client.createdAt,
    lastSeen: client.lastSeen,
    deviceKey: client.deviceKey || "",
    messageCount: client.messages.length,
    lastMessage,
  };
}

function ensureClient(clientId, ip, deviceKey) {
  if (!store.clients[clientId]) {
    store.clients[clientId] = {
      clientId,
      nickname: `访客-${clientId.slice(-4)}`,
      note: "",
      ip: ip || "",
      deviceKey: deviceKey || "",
      location: "查询中",
      connected: false,
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      welcomeSent: false,
      socketId: "",
      messages: [],
    };
  }
  const client = store.clients[clientId];
  if (typeof client.welcomeSent !== "boolean") client.welcomeSent = false;
  if (ip) client.ip = ip;
  if (deviceKey) client.deviceKey = deviceKey;
  client.lastSeen = new Date().toISOString();
  return client;
}

function appendMessage(clientId, message) {
  const client = getClient(clientId);
  if (!client) return;
  client.messages.push(message);
  client.lastSeen = new Date().toISOString();
  scheduleSave();
}

function getMessageRecord(clientId, messageId) {
  const client = getClient(clientId);
  if (!client) return null;
  const index = client.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return null;
  return {
    client,
    index,
    message: client.messages[index],
  };
}

function updateMessage(clientId, messageId, updater) {
  const record = getMessageRecord(clientId, messageId);
  if (!record) return false;
  updater(record.message, record.client);
  record.client.lastSeen = new Date().toISOString();
  scheduleSave();
  broadcastContacts();
  emitConversation(clientId);
  return true;
}

function deleteMessage(clientId, messageId) {
  const record = getMessageRecord(clientId, messageId);
  if (!record) return false;
  record.client.messages.splice(record.index, 1);
  record.client.lastSeen = new Date().toISOString();
  scheduleSave();
  broadcastContacts();
  emitConversation(clientId);
  return true;
}

function buildMessage(payload) {
  return {
    id: crypto.randomUUID(),
    sender: payload.sender,
    senderName: payload.senderName,
    systemTag: payload.systemTag || "",
    type: payload.type,
    text: payload.text || "",
    fileName: payload.fileName || "",
    fileSize: payload.fileSize || 0,
    mimeType: payload.mimeType || "",
    url: payload.url || "",
    createdAt: new Date().toISOString(),
    editedAt: "",
  };
}

function hasWelcomeMessage(client, welcomeText = "") {
  if (!client || !Array.isArray(client.messages)) return false;
  const normalizedText = String(welcomeText || "").trim();
  return client.messages.some((message) => {
    if (message.systemTag === "welcome") return true;
    return (
      normalizedText &&
      message.sender === "agent" &&
      String(message.text || "").trim() === normalizedText
    );
  });
}

function broadcastContacts() {
  const contacts = Object.values(store.clients)
    .sort((a, b) => {
      const aTime = a.messages.at(-1)?.createdAt || a.createdAt;
      const bTime = b.messages.at(-1)?.createdAt || b.createdAt;
      return String(bTime).localeCompare(String(aTime));
    })
    .map(summarizeClient);

  io.to("agents").emit("contacts:update", contacts);
}

function emitConversation(clientId) {
  const client = getClient(clientId);
  if (!client) return;

  const payload = {
    client: summarizeClient(client),
    messages: client.messages,
  };

  io.to(`client:${clientId}`).emit("conversation:update", payload);
  io.to("agents").emit("conversation:update", payload);
}

function requireAgent(req, res, next) {
  if (req.session.agentAuth) {
    return next();
  }
  res.status(401).json({ ok: false, message: "未登录" });
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }

  return addresses;
}

app.get("/api/agent/session", (req, res) => {
  res.json({
    ok: true,
    authenticated: !!req.session.agentAuth,
    username: req.session.agentUsername || "",
    agentAccount: getPublicAgentAccount(),
    settings: getPublicSettings(),
  });
});

app.post("/api/agent/login", (req, res) => {
  const { username, password } = req.body;
  if (
    username === store.agentAccount.username &&
    verifyPassword(String(password || ""), store.agentAccount.passwordHash, store.agentAccount.passwordSalt)
  ) {
    req.session.agentAuth = true;
    req.session.agentUsername = username;
    return req.session.save(() => {
      res.json({ ok: true, username });
    });
  }
  res.status(401).json({ ok: false, message: "账号或密码错误" });
});

app.post("/api/agent/logout", requireAgent, (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/agent/contacts", requireAgent, (_req, res) => {
  const contacts = Object.values(store.clients)
    .sort((a, b) => {
      const aTime = a.messages.at(-1)?.createdAt || a.createdAt;
      const bTime = b.messages.at(-1)?.createdAt || b.createdAt;
      return String(bTime).localeCompare(String(aTime));
    })
    .map(summarizeClient);

  res.json({ ok: true, contacts });
});

app.get("/api/agent/settings", requireAgent, (_req, res) => {
  res.json({
    ok: true,
    agentAccount: getPublicAgentAccount(),
    settings: getPublicSettings(),
  });
});

app.patch("/api/agent/settings", requireAgent, async (req, res) => {
  const nextSettings = sanitizeSettings({
    ...store.settings,
    ...req.body,
  });

  if (nextSettings.telegramEnabled && (!nextSettings.telegramBotToken || !nextSettings.telegramChatId)) {
    return res.status(400).json({ ok: false, message: "启用 Telegram 前请先填写 Bot Token 和 Chat ID" });
  }

  if (nextSettings.telegramBotToken && nextSettings.telegramChatId) {
    try {
      const me = await telegramRequest("getMe", {}, nextSettings.telegramBotToken);
      nextSettings.telegramBotName = me.username || me.first_name || "";
    } catch (error) {
      return res.status(400).json({ ok: false, message: `Telegram 配置不可用：${error.message}` });
    }
  } else {
    nextSettings.telegramEnabled = false;
    nextSettings.telegramBotName = "";
  }

  store.settings = nextSettings;
  scheduleSave();
  refreshTelegramPolling();
  res.json({
    ok: true,
    agentAccount: getPublicAgentAccount(),
    settings: getPublicSettings(),
  });
});

app.post("/api/agent/telegram/test", requireAgent, async (_req, res) => {
  if (!store.settings.telegramBotToken || !store.settings.telegramChatId) {
    return res.status(400).json({ ok: false, message: "请先保存 Telegram Bot Token 和 Chat ID" });
  }

  try {
    await telegramRequest("sendMessage", {
      chat_id: store.settings.telegramChatId,
      text: "客服系统测试消息已送达，Telegram 通知配置可用。",
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message || "测试消息发送失败" });
  }
});

app.patch("/api/agent/account", requireAgent, (req, res) => {
  const username = String(req.body.username || "").trim();
  const currentPassword = String(req.body.currentPassword || "");
  const nextPassword = String(req.body.nextPassword || "");

  if (!username) {
    return res.status(400).json({ ok: false, message: "账号不能为空" });
  }

  if (!verifyPassword(currentPassword, store.agentAccount.passwordHash, store.agentAccount.passwordSalt)) {
    return res.status(400).json({ ok: false, message: "当前密码不正确" });
  }

  if (!nextPassword || nextPassword.length < 4) {
    return res.status(400).json({ ok: false, message: "新密码至少 4 位" });
  }

  store.agentAccount.username = username;
  const nextHashed = hashPassword(nextPassword);
  store.agentAccount.passwordHash = nextHashed.hash;
  store.agentAccount.passwordSalt = nextHashed.salt;
  req.session.agentUsername = username;
  scheduleSave();

  res.json({
    ok: true,
    agentAccount: getPublicAgentAccount(),
  });
});

app.get("/api/agent/conversations/:clientId", requireAgent, (req, res) => {
  const client = getClient(req.params.clientId);
  if (!client) {
    return res.status(404).json({ ok: false, message: "联系人不存在" });
  }
  res.json({
    ok: true,
    client: summarizeClient(client),
    messages: client.messages,
  });
});

app.delete("/api/agent/conversations/:clientId", requireAgent, (req, res) => {
  const client = getClient(req.params.clientId);
  if (!client) {
    return res.status(404).json({ ok: false, message: "联系人不存在" });
  }

  io.to(`client:${req.params.clientId}`).emit("session:deleted");
  io.to("agents").emit("session:deleted", { clientId: req.params.clientId });
  delete store.clients[req.params.clientId];
  scheduleSave();
  broadcastContacts();
  res.json({ ok: true });
});

app.patch("/api/agent/contacts/:clientId/note", requireAgent, (req, res) => {
  const client = getClient(req.params.clientId);
  if (!client) {
    return res.status(404).json({ ok: false, message: "联系人不存在" });
  }
  client.note = String(req.body.note || "").trim();
  scheduleSave();
  broadcastContacts();
  emitConversation(req.params.clientId);
  res.json({ ok: true, note: client.note });
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, message: "未检测到文件" });
  }

  const mime = req.file.mimetype || "";
  let type = "file";
  if (mime.startsWith("image/")) type = "image";
  if (mime.startsWith("video/")) type = "video";

  res.json({
    ok: true,
    file: {
      type,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: mime,
      url: `/uploads/${req.file.filename}`,
    },
  });
});

app.get("/agent", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "agent.html"));
});

io.engine.use(sessionMiddleware);

io.on("connection", async (socket) => {
  const role = socket.handshake.auth.role;

  if (role === "agent") {
    if (!socket.request.session?.agentAuth) {
      socket.emit("auth:error", "客服未登录");
      socket.disconnect();
      return;
    }

    socket.join("agents");
    socket.emit(
      "contacts:update",
      Object.values(store.clients)
        .sort((a, b) => {
          const aTime = a.messages.at(-1)?.createdAt || a.createdAt;
          const bTime = b.messages.at(-1)?.createdAt || b.createdAt;
          return String(bTime).localeCompare(String(aTime));
        })
        .map(summarizeClient),
    );

    socket.on("message:send", (payload) => {
      const targetClientId = payload?.targetClientId;
      const target = getClient(targetClientId);
      if (!target) return;

      const message = buildMessage({
        sender: "agent",
        senderName: "\u5728\u7ebf\u5ba2\u670d",
        type: payload?.type,
        text: payload?.text,
        fileName: payload?.fileName,
        fileSize: payload?.fileSize,
        mimeType: payload?.mimeType,
        url: payload?.url,
      });

      appendMessage(targetClientId, message);
      broadcastContacts();
      emitConversation(targetClientId);
    });

    socket.on("message:update", (payload) => {
      const targetClientId = payload?.targetClientId;
      const nextText = String(payload?.text || "").trim();
      if (!targetClientId || !payload?.messageId || !nextText) return;
      const record = getMessageRecord(targetClientId, payload.messageId);
      if (!record || record.message.type !== "text") return;

      updateMessage(targetClientId, payload.messageId, (message) => {
        message.text = nextText;
        message.editedAt = new Date().toISOString();
      });
    });

    socket.on("message:delete", (payload) => {
      const targetClientId = payload?.targetClientId;
      if (!targetClientId || !payload?.messageId) return;
      const record = getMessageRecord(targetClientId, payload.messageId);
      if (!record) return;
      deleteMessage(targetClientId, payload.messageId);
    });

    return;
  }

  const requestedClientId = socket.handshake.auth.clientId || "";
  const deviceKey = socket.handshake.auth.deviceKey || "";
  const ip = extractIp(socket.request);
  const clientId = findExistingClientId({
    clientId: requestedClientId,
    deviceKey,
    ip,
  });
  const client = ensureClient(clientId, ip, deviceKey);

  client.connected = true;
  client.socketId = socket.id;
  socket.join(`client:${clientId}`);
  socket.emit("client:registered", { clientId, nickname: client.nickname });

  broadcastContacts();
  emitConversation(clientId);

  if (
    !hasWelcomeMessage(client, store.settings.welcomeMessageText) &&
    store.settings.welcomeMessageEnabled &&
    store.settings.welcomeMessageText
  ) {
    const welcomeMessage = buildMessage({
      sender: "agent",
      senderName: "\u5728\u7ebf\u5ba2\u670d",
      systemTag: "welcome",
      type: "text",
      text: store.settings.welcomeMessageText,
    });
    appendMessage(clientId, welcomeMessage);
    broadcastContacts();
    emitConversation(clientId);
  }

  if (!client.location || client.location === "查询中" || client.location === "未知") {
    client.location = await resolveIpLocation(ip);
    scheduleSave();
    broadcastContacts();
    emitConversation(clientId);
  }

  socket.on("message:send", (payload) => {
    const message = buildMessage({
      sender: "client",
      senderName: client.nickname,
      type: payload?.type,
      text: payload?.text,
      fileName: payload?.fileName,
      fileSize: payload?.fileSize,
      mimeType: payload?.mimeType,
      url: payload?.url,
    });

    appendMessage(clientId, message);
    broadcastContacts();
    emitConversation(clientId);
    sendTelegramNotification(clientId, message);

    if (store.settings.autoReplyEnabled && store.settings.autoReplyText) {
      const reply = buildMessage({
        sender: "agent",
        senderName: "\u5728\u7ebf\u5ba2\u670d",
        type: "text",
        text: store.settings.autoReplyText,
      });
      appendMessage(clientId, reply);
      broadcastContacts();
      emitConversation(clientId);
    }
  });

  socket.on("disconnect", () => {
    const current = getClient(clientId);
    if (!current) return;
    current.connected = false;
    current.socketId = "";
    current.lastSeen = new Date().toISOString();
    scheduleSave();
    broadcastContacts();
  });
});

loadStore().then(() => {
  refreshTelegramPolling();
  server.listen(PORT, HOST, () => {
    console.log(`Customer service app running at http://localhost:${PORT}`);
    for (const address of getLanAddresses()) {
      console.log(`LAN access: http://${address}:${PORT}`);
    }
    console.log(`Agent login: ${AGENT_USERNAME} / ${AGENT_PASSWORD}`);
  });
});
