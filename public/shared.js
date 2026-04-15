let sharedAudioContext = null;
let floatingMenuRoot = null;
let floatingMenuPanel = null;
let floatingMenuBackdrop = null;
let notificationAudio = null;

const NOTIFICATION_AUDIO_URL = "/assets/audio/simple-notification-152054.mp3?v=20260412a";

function createId(prefix) {
  const randomPart = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}-${randomPart}` : randomPart;
}

function getLastItem(list) {
  return Array.isArray(list) && list.length ? list[list.length - 1] : null;
}

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextClass();
  }
  return sharedAudioContext;
}

function getNotificationAudio() {
  if (!notificationAudio) {
    notificationAudio = new Audio(NOTIFICATION_AUDIO_URL);
    notificationAudio.preload = "auto";
    notificationAudio.volume = 1;
  }
  return notificationAudio;
}

async function unlockNotificationAudio() {
  const context = getAudioContext();
  if (context && context.state === "suspended") {
    try {
      await context.resume();
    } catch (_error) {
      // ignore
    }
  }

  const audio = getNotificationAudio();
  try {
    audio.muted = true;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
  } catch (_error) {
    audio.muted = false;
  }
}

async function playNotificationSound() {
  const audio = getNotificationAudio();
  audio.volume = 1;
  try {
    audio.currentTime = 0;
  } catch (_error) {
    // ignore seek errors
  }

  try {
    await audio.play();
  } catch (_error) {
    const context = getAudioContext();
    if (!context) return;
    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch (_resumeError) {
        return;
      }
    }
  }
}

function createUnreadAlarm(intervalMs = 2200) {
  let timer = null;
  let active = false;

  async function tick() {
    if (!active) return;
    await playNotificationSound();
  }

  return {
    start() {
      if (active) return;
      active = true;
      tick();
      timer = window.setInterval(tick, intervalMs);
    },
    stop() {
      active = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    get active() {
      return active;
    },
  };
}

function formatTime(time) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));
}

function formatFileSize(size) {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkifyText(value) {
  const escaped = escapeHtml(value);
  const urlPattern = /((https?:\/\/|www\.)[^\s<]+)/gi;
  return escaped.replace(urlPattern, (rawUrl) => {
    const href = rawUrl.startsWith("www.") ? `http://${rawUrl}` : rawUrl;
    return `<a class="message-link" href="${href}" target="_blank" rel="noreferrer">${rawUrl}</a>`;
  });
}

function ensureFloatingMenu() {
  if (floatingMenuRoot) return;

  floatingMenuRoot = document.createElement("div");
  floatingMenuRoot.className = "floating-menu-root hidden";
  floatingMenuRoot.innerHTML = `
    <div class="floating-menu-backdrop"></div>
    <div class="floating-menu-panel"></div>
  `;

  document.body.appendChild(floatingMenuRoot);
  floatingMenuBackdrop = floatingMenuRoot.querySelector(".floating-menu-backdrop");
  floatingMenuPanel = floatingMenuRoot.querySelector(".floating-menu-panel");

  floatingMenuBackdrop.addEventListener("click", hideFloatingMenu);
  window.addEventListener("resize", hideFloatingMenu);
  document.addEventListener("scroll", hideFloatingMenu, true);
}

function hideFloatingMenu() {
  ensureFloatingMenu();
  floatingMenuRoot.classList.add("hidden");
  floatingMenuPanel.classList.remove("floating-menu-sheet");
  floatingMenuPanel.classList.remove("floating-menu-context");
  floatingMenuPanel.style.left = "";
  floatingMenuPanel.style.top = "";
  floatingMenuPanel.innerHTML = "";
}

function showFloatingMenu({ items, x, y, title = "" }) {
  ensureFloatingMenu();
  const useSheet = typeof x !== "number" || typeof y !== "number";

  floatingMenuPanel.className = `floating-menu-panel ${useSheet ? "floating-menu-sheet" : "floating-menu-context"}`;
  floatingMenuPanel.innerHTML = `
    ${title ? `<div class="floating-menu-title">${escapeHtml(title)}</div>` : ""}
    ${items
      .map(
        (item, index) => `
          <button type="button" class="floating-menu-item ${item.danger ? "danger-item" : ""}" data-index="${index}">
            ${escapeHtml(item.label)}
          </button>
        `,
      )
      .join("")}
  `;

  floatingMenuPanel.querySelectorAll(".floating-menu-item").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = items[Number(button.dataset.index)];
      hideFloatingMenu();
      await item.onClick();
    });
  });

  if (!useSheet) {
    const maxX = window.innerWidth - 220;
    const maxY = window.innerHeight - 220;
    floatingMenuPanel.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
    floatingMenuPanel.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
  }

  floatingMenuRoot.classList.remove("hidden");
}

async function copyText(text) {
  const value = String(text || "");
  if (!value) return;

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (_error) {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const result = document.execCommand("copy");
    document.body.removeChild(textarea);
    return result;
  }
}

function getMessageCopyText(message) {
  if (!message) return "";
  if (message.type === "text") return message.text || "";
  return message.fileName || message.url || "";
}

function buildAttachment(message) {
  if (message.type === "image") {
    return `<img src="${message.url}" alt="${escapeHtml(message.fileName)}" class="bubble-image" />`;
  }
  if (message.type === "video") {
    return `<video class="bubble-video" controls src="${message.url}"></video>`;
  }
  if (message.type === "file") {
    return `
      <a class="file-card" href="${message.url}" target="_blank" rel="noreferrer">
        <strong>${escapeHtml(message.fileName)}</strong>
        <span>${formatFileSize(message.fileSize)}</span>
      </a>
    `;
  }
  return `<p>${linkifyText(message.text)}</p>`;
}

function renderMessages(container, messages, options = {}) {
  const selfSender = options.selfSender || "agent";
  const getDisplaySenderName =
    typeof options.getDisplaySenderName === "function"
      ? options.getDisplaySenderName
      : (message) => message.senderName || (message.sender === "agent" ? "\u5ba2\u670d" : "\u8bbf\u5ba2");
  container.innerHTML = messages
    .map(
      (message) => `
      <article
        class="bubble-row ${message.sender === selfSender ? "from-self" : "from-other"}"
        data-message-id="${escapeHtml(message.id)}"
      >
        <div class="bubble-meta">
          <span>${escapeHtml(getDisplaySenderName(message))}</span>
          <time>${formatTime(message.createdAt)}${message.editedAt ? " (???)" : ""}</time>
        </div>
        <div class="bubble" data-message-id="${escapeHtml(message.id)}">
          ${message.type === "text" ? `<p>${linkifyText(message.text)}</p>` : buildAttachment(message)}
        </div>
      </article>
    `,
    )
    .join("");

  container.scrollTop = container.scrollHeight;
}

function attachMessageMenu(container, config) {
  if (container.dataset.messageMenuBound === "true") return;
  container.dataset.messageMenuBound = "true";

  let longPressTimer = null;
  let pressTarget = null;

  function openMenu(target, x, y) {
    const messageId = target.dataset.messageId;
    const message = config.getMessage(messageId);
    if (!message) return;

    const items = [
      {
        label: "复制",
        onClick: async () => {
          await copyText(getMessageCopyText(message));
        },
      },
    ];

    if (config.canEdit && config.canEdit(message)) {
      items.push({
        label: "修改",
        onClick: async () => {
          const currentText = message.text || "";
          const nextText = window.prompt("修改消息内容", currentText);
          if (nextText === null) return;
          const trimmed = nextText.trim();
          if (!trimmed || trimmed === currentText) return;
          await config.onEdit(message, trimmed);
        },
      });
    }

    if (config.canDelete && config.canDelete(message)) {
      items.push({
        label: "删除",
        danger: true,
        onClick: async () => {
          const confirmed = window.confirm("确定删除这条消息吗？");
          if (!confirmed) return;
          await config.onDelete(message);
        },
      });
    }

    showFloatingMenu({
      items,
      x,
      y,
      title: "消息操作",
    });
  }

  container.addEventListener("contextmenu", (event) => {
    const target = event.target.closest(".bubble[data-message-id]");
    if (!target) return;
    event.preventDefault();
    openMenu(target, event.clientX, event.clientY);
  });

  container.addEventListener("touchstart", (event) => {
    const target = event.target.closest(".bubble[data-message-id]");
    if (!target) return;
    pressTarget = target;
    longPressTimer = setTimeout(() => {
      openMenu(pressTarget);
      pressTarget = null;
      longPressTimer = null;
    }, 500);
  });

  ["touchend", "touchmove", "touchcancel"].forEach((eventName) => {
    container.addEventListener(eventName, () => {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      pressTarget = null;
    });
  });
}

async function uploadSelectedFile(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.message || "上传失败");
  }
  return data.file;
}
