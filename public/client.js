const clientIdKey = "support_client_id";
const deviceKeyName = "support_client_device_key";

const messageList = document.getElementById("messageList");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const statusText = document.getElementById("statusText");
const fileInput = document.getElementById("fileInput");

let lastMessageId = "";
let currentMessages = [];
const selfSender = "client";
const unreadAlarm = createUnreadAlarm();
let pendingUnreadMessageId = "";

["click", "keydown", "touchstart"].forEach((eventName) => {
  window.addEventListener(eventName, unlockNotificationAudio, { passive: true });
});

let deviceKey = localStorage.getItem(deviceKeyName);
if (!deviceKey) {
  deviceKey = createId("device");
  localStorage.setItem(deviceKeyName, deviceKey);
}

const socket = io({
  auth: {
    role: "client",
    clientId: localStorage.getItem(clientIdKey) || "",
    deviceKey,
  },
});

attachMessageMenu(messageList, {
  getMessage(messageId) {
    return currentMessages.find((message) => message.id === messageId) || null;
  },
  canEdit(message) {
    return false;
  },
  canDelete(message) {
    return false;
  },
  async onEdit(message, nextText) {
    return;
  },
  async onDelete(message) {
    return;
  },
});

function isPageReadable() {
  return document.visibilityState === "visible" && document.hasFocus();
}

function syncUnreadAlarm() {
  if (pendingUnreadMessageId && !isPageReadable()) {
    unreadAlarm.start();
    return;
  }
  pendingUnreadMessageId = "";
  unreadAlarm.stop();
}

function markConversationRead() {
  if (!isPageReadable()) return;
  pendingUnreadMessageId = "";
  unreadAlarm.stop();
}

socket.on("connect", () => {
  statusText.textContent = "已连接客服";
});

socket.on("disconnect", () => {
  statusText.textContent = "连接断开，正在尝试重连...";
});

socket.on("connect_error", (error) => {
  statusText.textContent = `连接失败：${error && error.message ? error.message : "无法连接服务"}`;
});

socket.on("client:registered", ({ clientId, nickname }) => {
  localStorage.setItem(clientIdKey, clientId);
  statusText.textContent = `已连接客服 · ${nickname}`;
});

socket.on("conversation:update", ({ messages, client }) => {
  currentMessages = messages;
  const newestMessage = getLastItem(messages);
  if (newestMessage && newestMessage.id !== lastMessageId && newestMessage.sender === "agent") {
    if (isPageReadable()) {
      playNotificationSound();
      pendingUnreadMessageId = "";
    } else {
      pendingUnreadMessageId = newestMessage.id;
    }
  }
  lastMessageId = newestMessage ? newestMessage.id : "";
  renderMessages(messageList, messages, {
    selfSender,
    getDisplaySenderName(message) {
      return message.sender === "agent" ? "在线客服" : message.senderName || "访客";
    },
  });
  statusText.textContent = `已接入客服 · ${client.note || client.nickname}`;
  syncUnreadAlarm();
});

socket.on("session:deleted", () => {
  localStorage.removeItem(clientIdKey);
  localStorage.removeItem(deviceKeyName);
  statusText.textContent = "当前会话已被删除，正在重新建立会话...";
  setTimeout(() => {
    window.location.reload();
  }, 600);
});

function sendText() {
  const text = messageInput.value.trim();
  if (!text) return;
  socket.emit("message:send", {
    type: "text",
    text,
  });
  messageInput.value = "";
}

window.addEventListener("focus", markConversationRead);
document.addEventListener("visibilitychange", markConversationRead);

sendBtn.addEventListener("click", sendText);

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendText();
  }
});

fileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;

  try {
    const uploaded = await uploadSelectedFile(file);
    socket.emit("message:send", uploaded);
  } catch (error) {
    window.alert(error.message || "上传失败");
  } finally {
    fileInput.value = "";
  }
});
