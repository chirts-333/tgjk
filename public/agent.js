const contactList = document.getElementById("contactList");
const agentMessageList = document.getElementById("agentMessageList");
const agentChatTitle = document.getElementById("agentChatTitle");
const agentSubTitle = document.getElementById("agentSubTitle");
const clientMeta = document.getElementById("clientMeta");
const agentMessageInput = document.getElementById("agentMessageInput");
const agentSendBtn = document.getElementById("agentSendBtn");
const quickReplyBar = document.getElementById("quickReplyBar");
const agentFileInput = document.getElementById("agentFileInput");
const loginOverlay = document.getElementById("loginOverlay");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");
const totalCount = document.getElementById("totalCount");
const onlineCount = document.getElementById("onlineCount");
const contactSearchInput = document.getElementById("contactSearchInput");
const filterAllBtn = document.getElementById("filterAllBtn");
const filterOnlineBtn = document.getElementById("filterOnlineBtn");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const settingsOverlay = document.getElementById("settingsOverlay");
const autoReplyEnabled = document.getElementById("autoReplyEnabled");
const autoReplyText = document.getElementById("autoReplyText");
const saveAutoReplyBtn = document.getElementById("saveAutoReplyBtn");
const welcomeMessageEnabled = document.getElementById("welcomeMessageEnabled");
const welcomeMessageText = document.getElementById("welcomeMessageText");
const saveWelcomeMessageBtn = document.getElementById("saveWelcomeMessageBtn");
const quickReplyInput = document.getElementById("quickReplyInput");
const addQuickReplyBtn = document.getElementById("addQuickReplyBtn");
const quickReplyList = document.getElementById("quickReplyList");
const accountUsernameInput = document.getElementById("accountUsernameInput");
const accountCurrentPasswordInput = document.getElementById("accountCurrentPasswordInput");
const accountNextPasswordInput = document.getElementById("accountNextPasswordInput");
const saveAccountBtn = document.getElementById("saveAccountBtn");
const settingsMessage = document.getElementById("settingsMessage");
const telegramEnabled = document.getElementById("telegramEnabled");
const telegramBotTokenInput = document.getElementById("telegramBotTokenInput");
const telegramChatIdInput = document.getElementById("telegramChatIdInput");
const saveTelegramBtn = document.getElementById("saveTelegramBtn");
const testTelegramBtn = document.getElementById("testTelegramBtn");
const telegramHint = document.getElementById("telegramHint");
const openContactListBtn = document.getElementById("openContactListBtn");
const backToListBtn = document.getElementById("backToListBtn");

let socket = null;
let contacts = [];
let activeClientId = "";
let activeConversation = { client: null, messages: [] };
let clientMetaExpanded = false;
const lastMessageIds = new Map();
const unreadCounts = new Map();
let showOnlineOnly = false;
const selfSender = "agent";
let quickReplies = [];
let telegramTokenDirty = false;
const unreadAlarm = createUnreadAlarm();

["click", "keydown", "touchstart"].forEach((eventName) => {
  window.addEventListener(eventName, unlockNotificationAudio, { passive: true });
});

attachMessageMenu(agentMessageList, {
  getMessage(messageId) {
    return activeConversation.messages.find((message) => message.id === messageId) || null;
  },
  canEdit(message) {
    return message.type === "text";
  },
  canDelete() {
    return true;
  },
  async onEdit(message, nextText) {
    if (!activeClientId) return;
    socket.emit("message:update", {
      targetClientId: activeClientId,
      messageId: message.id,
      text: nextText,
    });
  },
  async onDelete(message) {
    if (!activeClientId) return;
    socket.emit("message:delete", {
      targetClientId: activeClientId,
      messageId: message.id,
    });
  },
});

function setMobileChatOpen(open) {
  document.body.classList.toggle("mobile-chat-open", !!open);
}

function isMobileViewport() {
  return window.innerWidth <= 980;
}

function isPageReadable() {
  return document.visibilityState === "visible" && document.hasFocus();
}

function getTotalUnread() {
  return Array.from(unreadCounts.values()).reduce((sum, count) => sum + Number(count || 0), 0);
}

function syncUnreadAlarm() {
  if (getTotalUnread() > 0) {
    unreadAlarm.start();
    return;
  }
  unreadAlarm.stop();
}

function markActiveConversationRead() {
  if (!activeClientId || !isPageReadable()) return;
  unreadCounts.set(activeClientId, 0);
  syncUnreadAlarm();
  renderContacts();
}

function resetActiveConversation(message = "选择左侧联系人后开始回复。") {
  activeClientId = "";
  activeConversation = { client: null, messages: [] };
  clientMetaExpanded = false;
  clientMeta.innerHTML = message;
  clientMeta.classList.add("empty-state");
  agentMessageList.innerHTML = "";
  agentChatTitle.textContent = "请选择联系人";
  agentSubTitle.textContent = "支持查看 IP、地区和客户备注";
  setMobileChatOpen(false);
}

async function deleteConversation(clientId) {
  const confirmed = window.confirm("删除后该会话的聊天记录和备注都会清空，是否继续？");
  if (!confirmed) return;

  const response = await fetch(`/api/agent/conversations/${clientId}`, {
    method: "DELETE",
  });
  const data = await response.json();
  if (!response.ok || !data.ok) return;

  if (activeClientId === clientId) {
    resetActiveConversation("该会话已删除。");
  }
}

function getFilteredContacts() {
  const keyword = contactSearchInput.value.trim().toLowerCase();
  return contacts.filter((contact) => {
    if (showOnlineOnly && !contact.connected) return false;
    if (!keyword) return true;

    const haystack = [
      contact.note,
      contact.nickname,
      contact.ip,
      contact.location,
      contact.lastMessage?.text,
      contact.lastMessage?.fileName,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(keyword);
  });
}

function renderContacts() {
  totalCount.textContent = String(contacts.length);
  onlineCount.textContent = String(contacts.filter((contact) => contact.connected).length);

  contactList.innerHTML = getFilteredContacts()
    .map((contact) => {
      const preview = contact.lastMessage
        ? contact.lastMessage.type === "text"
          ? contact.lastMessage.text
          : `[${contact.lastMessage.type}] ${contact.lastMessage.fileName || ""}`
        : "暂无消息";

      return `
        <button
          class="contact-card ${contact.clientId === activeClientId ? "active" : ""}"
          data-id="${contact.clientId}"
        >
          <div class="contact-row">
            <strong>${escapeHtml(contact.note || contact.nickname)}</strong>
            <span class="contact-status-wrap">
              ${unreadCounts.get(contact.clientId) ? `<i class="unread-badge">${unreadCounts.get(contact.clientId)}</i>` : ""}
              <span>${contact.connected ? "在线" : "离线"}</span>
            </span>
          </div>
          <p>${escapeHtml(preview)}</p>
          <small>${escapeHtml(contact.ip || "未知 IP")} / ${escapeHtml(contact.location || "未知地区")}</small>
          <small>消息 ${contact.messageCount || 0} 条 / 最后活动 ${formatTime(contact.lastSeen)}</small>
        </button>
      `;
    })
    .join("");

  contactList.querySelectorAll(".contact-card").forEach((button) => {
    button.addEventListener("click", async () => {
      activeClientId = button.dataset.id;
      await loadConversation(activeClientId);
      renderContacts();
      if (isMobileViewport()) {
        setMobileChatOpen(true);
      }
    });

    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const clientId = button.dataset.id;
      showFloatingMenu({
        x: event.clientX,
        y: event.clientY,
        title: "会话操作",
        items: [
          {
            label: "删除会话",
            danger: true,
            onClick: async () => {
              await deleteConversation(clientId);
            },
          },
        ],
      });
    });
  });
}

function renderClientMeta(client) {
  clientMeta.classList.remove("empty-state");
  clientMeta.innerHTML = `
    <details id="clientMetaDetails" class="meta-details" ${clientMetaExpanded ? "open" : ""}>
      <summary class="meta-summary">
        <div class="meta-summary-item">
          <span>客户昵称</span>
          <strong>${escapeHtml(client.nickname)}</strong>
        </div>
        <div class="meta-summary-item">
          <span>IP 地址</span>
          <strong>${escapeHtml(client.ip || "未知")}</strong>
        </div>
        <div class="meta-summary-item">
          <span>最后活跃</span>
          <strong>${formatTime(client.lastSeen)}</strong>
        </div>
        <span class="meta-expand-text">${clientMetaExpanded ? "收起" : "展开全部"}</span>
      </summary>
      <div class="meta-grid">
        <div><span>备注名称</span><strong>${escapeHtml(client.note || "未设置")}</strong></div>
        <div><span>IP 地区</span><strong>${escapeHtml(client.location || "未知")}</strong></div>
        <div><span>消息总数</span><strong>${client.messageCount || 0}</strong></div>
        <div><span>设备标识</span><strong>${escapeHtml(client.deviceKey || "未记录")}</strong></div>
        <div><span>首次接入</span><strong>${formatTime(client.createdAt)}</strong></div>
        <div><span>当前状态</span><strong>${client.connected ? "在线" : "离线"}</strong></div>
      </div>
      <div class="note-editor">
        <input id="noteInput" type="text" maxlength="30" placeholder="给客户设置备注" value="${escapeHtml(client.note || "")}" />
        <button id="saveNoteBtn" class="ghost-btn" type="button">保存备注</button>
      </div>
    </details>
  `;

  const details = document.getElementById("clientMetaDetails");
  details.addEventListener("toggle", () => {
    clientMetaExpanded = details.open;
    const label = details.querySelector(".meta-expand-text");
    if (label) label.textContent = details.open ? "收起" : "展开全部";
  });

  document.getElementById("saveNoteBtn").addEventListener("click", async () => {
    const note = document.getElementById("noteInput").value.trim();
    const response = await fetch(`/api/agent/contacts/${activeClientId}/note`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) return;
    agentSubTitle.textContent = `备注已更新：${data.note || "未设置"}`;
  });
}

async function loadConversation(clientId) {
  const response = await fetch(`/api/agent/conversations/${clientId}`);
  const data = await response.json();
  if (!response.ok || !data.ok) return;

  activeConversation = data;
  const newestMessage = getLastItem(data.messages);
  lastMessageIds.set(clientId, newestMessage ? newestMessage.id : "");
  unreadCounts.set(clientId, 0);
  syncUnreadAlarm();

  agentChatTitle.textContent = data.client.note || data.client.nickname;
  agentSubTitle.textContent = `${data.client.ip || "未知 IP"} / ${data.client.location || "未知地区"}`;
  renderClientMeta(data.client);
  renderMessages(agentMessageList, data.messages, { selfSender });
}

function connectSocket() {
  socket = io({
    auth: { role: "agent" },
  });

  socket.on("contacts:update", (nextContacts) => {
    contacts = nextContacts;
    renderContacts();
    syncUnreadAlarm();
  });

  socket.on("conversation:update", (payload) => {
    const newestMessage = getLastItem(payload.messages);
    const previousMessageId = lastMessageIds.get(payload.client.clientId) || "";

    if (newestMessage && newestMessage.id !== previousMessageId && newestMessage.sender === "client") {
      const readableCurrentConversation = payload.client.clientId === activeClientId && isPageReadable();

      if (readableCurrentConversation) {
        playNotificationSound();
        unreadCounts.set(payload.client.clientId, 0);
      } else {
        unreadCounts.set(payload.client.clientId, (unreadCounts.get(payload.client.clientId) || 0) + 1);
      }
    }

    lastMessageIds.set(payload.client.clientId, newestMessage ? newestMessage.id : "");

    if (payload.client.clientId === activeClientId) {
      activeConversation = payload;
      if (isPageReadable()) {
        unreadCounts.set(payload.client.clientId, 0);
      }
      renderMessages(agentMessageList, payload.messages, { selfSender });
      renderClientMeta(payload.client);
      agentChatTitle.textContent = payload.client.note || payload.client.nickname;
      agentSubTitle.textContent = `${payload.client.ip || "未知 IP"} / ${payload.client.location || "未知地区"}`;
    }
    syncUnreadAlarm();
    renderContacts();
  });

  socket.on("auth:error", (message) => {
    loginOverlay.classList.remove("hidden");
    loginError.textContent = message;
  });

  socket.on("session:deleted", ({ clientId }) => {
    contacts = contacts.filter((contact) => contact.clientId !== clientId);
    lastMessageIds.delete(clientId);
    unreadCounts.delete(clientId);
    if (activeClientId === clientId) {
      resetActiveConversation("该会话已删除。");
    }
    syncUnreadAlarm();
    renderContacts();
  });
}

function updateTelegramHint(settings = {}) {
  const label = [];
  if (settings.telegramEnabled) label.push("Telegram 已启用");
  if (settings.telegramBotName) label.push(`机器人 @${settings.telegramBotName}`);
  if (settings.telegramChatId) label.push(`Chat ID: ${settings.telegramChatId}`);
  if (!telegramTokenDirty && settings.telegramBotTokenMasked) {
    telegramBotTokenInput.value = settings.telegramBotTokenMasked;
  }
  telegramHint.textContent = label.join(" / ") || "保存后，客户发消息会通知到 Telegram，也支持在 Telegram 中直接回复。";
}

async function loadAgentSettings() {
  const response = await fetch("/api/agent/settings");
  const data = await response.json();
  if (!response.ok || !data.ok) return;
  autoReplyEnabled.checked = !!data.settings.autoReplyEnabled;
  autoReplyText.value = data.settings.autoReplyText || "";
  welcomeMessageEnabled.checked = !!data.settings.welcomeMessageEnabled;
  welcomeMessageText.value = data.settings.welcomeMessageText || "";
  quickReplies = Array.isArray(data.settings.quickReplies) ? data.settings.quickReplies : [];
  accountUsernameInput.value = data.agentAccount.username || "";
  telegramEnabled.checked = !!data.settings.telegramEnabled;
  telegramChatIdInput.value = data.settings.telegramChatId || "";
  telegramTokenDirty = false;
  updateTelegramHint(data.settings);
  renderQuickReplies();
}

function renderQuickReplies() {
  quickReplyBar.innerHTML = quickReplies.length
    ? quickReplies
        .map(
          (reply, index) =>
            `<button class="quick-reply-chip" type="button" data-index="${index}" title="${escapeHtml(reply)}">${escapeHtml(reply)}</button>`,
        )
        .join("")
    : "";
  quickReplyBar.classList.toggle("is-empty", quickReplies.length === 0);

  quickReplyList.innerHTML = quickReplies.length
    ? quickReplies
        .map(
          (reply, index) => `
            <div class="quick-reply-item">
              <span>${escapeHtml(reply)}</span>
              <button class="ghost-btn quick-reply-remove" type="button" data-index="${index}">删除</button>
            </div>
          `,
        )
        .join("")
    : `<p class="tips-text">还没有常用话术，可以先添加几条。</p>`;

  quickReplyBar.querySelectorAll(".quick-reply-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const reply = quickReplies[Number(button.dataset.index)] || "";
      agentMessageInput.value = reply;
      agentMessageInput.focus();
    });
  });

  quickReplyList.querySelectorAll(".quick-reply-remove").forEach((button) => {
    button.addEventListener("click", async () => {
      quickReplies = quickReplies.filter((_, index) => index !== Number(button.dataset.index));
      await saveAgentSettings({ closeAfterSave: false, successText: "快捷回复已更新" });
    });
  });
}

async function saveAgentSettings({ closeAfterSave = true, successText = "设置已保存" } = {}) {
  const response = await fetch("/api/agent/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      autoReplyEnabled: autoReplyEnabled.checked,
      autoReplyText: autoReplyText.value.trim(),
      welcomeMessageEnabled: welcomeMessageEnabled.checked,
      welcomeMessageText: welcomeMessageText.value.trim(),
      quickReplies,
      telegramEnabled: telegramEnabled.checked,
      telegramBotToken: telegramTokenDirty ? telegramBotTokenInput.value.trim() : undefined,
      telegramChatId: telegramChatIdInput.value.trim(),
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    settingsMessage.textContent = data.message || "保存失败";
    return false;
  }

  quickReplies = Array.isArray(data.settings.quickReplies) ? data.settings.quickReplies : [];
  telegramEnabled.checked = !!data.settings.telegramEnabled;
  telegramChatIdInput.value = data.settings.telegramChatId || "";
  telegramTokenDirty = false;
  renderQuickReplies();
  updateTelegramHint(data.settings);
  agentSubTitle.textContent = data.settings.autoReplyEnabled ? "自动回复已开启" : "自动回复已关闭";
  settingsMessage.textContent = successText;
  if (closeAfterSave) settingsOverlay.classList.add("hidden");
  return true;
}

function sendAgentText() {
  const text = agentMessageInput.value.trim();
  if (!text || !activeClientId) return;
  socket.emit("message:send", {
    targetClientId: activeClientId,
    type: "text",
    text,
  });
  agentMessageInput.value = "";
}

agentSendBtn.addEventListener("click", sendAgentText);

agentMessageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendAgentText();
  }
});

agentFileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file || !activeClientId) return;

  try {
    const uploaded = await uploadSelectedFile(file);
    socket.emit("message:send", {
      ...uploaded,
      targetClientId: activeClientId,
    });
  } catch (error) {
    window.alert(error.message || "上传失败");
  } finally {
    agentFileInput.value = "";
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";

  const formData = new FormData(loginForm);
  const response = await fetch("/api/agent/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: formData.get("username"),
      password: formData.get("password"),
    }),
  });
  const data = await response.json();

  if (!response.ok || !data.ok) {
    loginError.textContent = data.message || "登录失败";
    return;
  }

  loginOverlay.classList.add("hidden");
  connectSocket();
  const contactsResponse = await fetch("/api/agent/contacts");
  const contactsData = await contactsResponse.json();
  contacts = contactsData.contacts || [];
  await loadAgentSettings();
  renderContacts();
});

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/agent/logout", { method: "POST" });
  socket?.disconnect();
  unreadAlarm.stop();
  loginOverlay.classList.remove("hidden");
  contacts = [];
  unreadCounts.clear();
  renderContacts();
  resetActiveConversation();
});

contactSearchInput.addEventListener("input", renderContacts);

filterAllBtn.addEventListener("click", () => {
  showOnlineOnly = false;
  filterAllBtn.classList.add("active-filter");
  filterOnlineBtn.classList.remove("active-filter");
  renderContacts();
});

filterOnlineBtn.addEventListener("click", () => {
  showOnlineOnly = true;
  filterOnlineBtn.classList.add("active-filter");
  filterAllBtn.classList.remove("active-filter");
  renderContacts();
});

openSettingsBtn.addEventListener("click", () => {
  settingsOverlay.classList.remove("hidden");
});

closeSettingsBtn.addEventListener("click", () => {
  settingsOverlay.classList.add("hidden");
});

settingsOverlay.addEventListener("click", (event) => {
  if (event.target === settingsOverlay) {
    settingsOverlay.classList.add("hidden");
  }
});

saveAutoReplyBtn.addEventListener("click", async () => {
  await saveAgentSettings({ closeAfterSave: true, successText: "自动回复已保存" });
});

saveWelcomeMessageBtn.addEventListener("click", async () => {
  await saveAgentSettings({ closeAfterSave: false, successText: "进入通知已保存" });
});

addQuickReplyBtn.addEventListener("click", async () => {
  const value = quickReplyInput.value.trim();
  if (!value) return;
  if (quickReplies.includes(value)) {
    settingsMessage.textContent = "这条话术已经存在";
    return;
  }
  quickReplies = [...quickReplies, value].slice(0, 20);
  quickReplyInput.value = "";
  await saveAgentSettings({ closeAfterSave: false, successText: "快捷回复已保存" });
});

saveTelegramBtn.addEventListener("click", async () => {
  await saveAgentSettings({ closeAfterSave: false, successText: "Telegram 配置已保存" });
});

testTelegramBtn.addEventListener("click", async () => {
  const response = await fetch("/api/agent/telegram/test", { method: "POST" });
  const data = await response.json();
  telegramHint.textContent = response.ok && data.ok ? "测试消息已发送到 Telegram" : data.message || "测试消息发送失败";
});

telegramBotTokenInput.addEventListener("input", () => {
  telegramTokenDirty = true;
});

saveAccountBtn.addEventListener("click", async () => {
  const response = await fetch("/api/agent/account", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: accountUsernameInput.value.trim(),
      currentPassword: accountCurrentPasswordInput.value,
      nextPassword: accountNextPasswordInput.value,
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    settingsMessage.textContent = data.message || "保存失败";
    return;
  }

  accountCurrentPasswordInput.value = "";
  accountNextPasswordInput.value = "";
  settingsMessage.textContent = "账号密码已更新";
});

openContactListBtn.addEventListener("click", () => {
  setMobileChatOpen(false);
});

backToListBtn.addEventListener("click", () => {
  setMobileChatOpen(false);
});

window.addEventListener("focus", markActiveConversationRead);
document.addEventListener("visibilitychange", markActiveConversationRead);
window.addEventListener("resize", () => {
  if (!isMobileViewport()) {
    document.body.classList.remove("mobile-chat-open");
  }
});

async function bootstrapAgent() {
  const response = await fetch("/api/agent/session");
  const data = await response.json();
  if (!data.authenticated) return;

  loginOverlay.classList.add("hidden");
  connectSocket();
  const contactsResponse = await fetch("/api/agent/contacts");
  const contactsData = await contactsResponse.json();
  contacts = contactsData.contacts || [];
  await loadAgentSettings();
  renderContacts();
}

bootstrapAgent();
