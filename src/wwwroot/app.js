
const API = { auth: '/api/auth', telegram: '/api/telegram', keyword: '/api/keyword' };

const state = {
  token: localStorage.getItem('tgjk_token') || '',
  currentUser: null,
  telegramLoginStep: 0,
  telegramPhone: '',
  telegramLoggedIn: false,
  monitoring: false,
  groupTaskRunning: false,
  dialogs: [],
  selectedMonitorChatIds: [],
  selectedGroupTaskChatIds: [],
  replyTemplates: [],
  groupTaskTemplates: [],
  keywords: []
};

const keywordTypeMap = ['全字', '包含', '正则', '模糊', '用户'];
const keywordActionMap = ['排除', '监控'];
const forwardModeMap = ['原格式转发', '纯消息内容'];

function normalizeKeywordType(value) {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  return { FullWord: 0, Contains: 1, Regex: 2, Fuzzy: 3, User: 4 }[value] ?? 0;
}

function normalizeKeywordAction(value) {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  return { Exclude: 0, Monitor: 1 }[value] ?? 1;
}

function normalizeForwardMode(value) {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  return { Formatted: 0, PlainText: 1 }[value] ?? 0;
}

function isAdminUser() {
  return !!state.currentUser && (state.currentUser.role === 'Admin' || Number(state.currentUser.role) === 1);
}

function toast(message, ok = true) {
  const box = document.getElementById('toast');
  const node = document.createElement('div');
  node.className = `alert ${ok ? 'alert-success' : 'alert-error'} shadow-lg`;
  node.innerHTML = `<span>${message}</span>`;
  box.appendChild(node);
  setTimeout(() => node.remove(), 4000);
}

async function api(path, init = {}) {
  const headers = Object.assign({}, init.headers || {});
  if (!headers.Authorization && state.token) headers.Authorization = `Bearer ${state.token}`;
  if (init.body !== undefined && typeof init.body !== 'string') headers['Content-Type'] = 'application/json';

  const response = await fetch(path, {
    ...init,
    headers,
    body: init.body !== undefined && typeof init.body !== 'string' ? JSON.stringify(init.body) : init.body
  });

  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = text; }

  if (!response.ok || (payload && typeof payload === 'object' && payload.succeeded === false)) {
    throw new Error(payload?.message || payload?.errors || text || 'Request failed');
  }

  return payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'data')
    ? payload.data
    : payload;
}

function switchTab(panelId) {
  document.querySelectorAll('[role="tab"]').forEach(tab => {
    tab.classList.toggle('tab-active', tab.dataset.panel === panelId);
  });
  document.querySelectorAll('.panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === panelId);
  });
}

function formatDateTime(value) {
  if (!value) return '永久';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function getDialogTitle(chatId) {
  const id = Number(chatId);
  return state.dialogs.find(x => Number(x.id) === id)?.displayTitle || `群(${id})`;
}

function renderAuthView() {
  const loginView = document.getElementById('loginView');
  const appView = document.getElementById('appView');
  const adminTab = document.getElementById('adminTab');
  if (state.currentUser) {
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    adminTab.classList.toggle('hidden', !isAdminUser());
    document.getElementById('userSummary').textContent =
      `当前用户: ${state.currentUser.userName} | 角色: ${isAdminUser() ? '管理员' : '普通用户'}`
      + (state.currentUser.expiresAtUtc ? ` | 到期: ${formatDateTime(state.currentUser.expiresAtUtc)}` : '');
  } else {
    loginView.classList.remove('hidden');
    appView.classList.add('hidden');
  }
}

function renderDefaultTargetOptions() {
  const select = document.getElementById('defaultTargetChatId');
  const currentValue = Number(select.value || 0);
  select.innerHTML = ['<option value="0">不设置默认目标群</option>']
    .concat(state.dialogs.map(dialog => `<option value="${dialog.id}">${dialog.displayTitle}</option>`))
    .join('');
  select.value = String(currentValue || 0);
}

function renderReplyTemplates() {
  document.getElementById('replyTemplateList').innerHTML = state.replyTemplates.map((item, index) => `
    <div class="flex gap-2 items-center rounded-lg bg-base-200 p-2">
      <div class="flex-1 break-all">${item}</div>
      <button class="btn btn-xs btn-error" onclick="removeReplyTemplate(${index})">删除</button>
    </div>
  `).join('');
}

function renderGroupTaskTemplates() {
  document.getElementById('groupTaskTemplateList').innerHTML = state.groupTaskTemplates.map((item, index) => `
    <div class="flex gap-2 items-center rounded-lg bg-base-200 p-2">
      <div class="flex-1 break-all">${item}</div>
      <button class="btn btn-xs btn-error" onclick="removeGroupTaskTemplate(${index})">删除</button>
    </div>
  `).join('');
}

function collectStyleText(item) {
  const result = [];
  if (item.isCaseSensitive) result.push('大小写');
  if (item.isBold) result.push('粗体');
  if (item.isItalic) result.push('斜体');
  if (item.isUnderline) result.push('下划线');
  if (item.isStrikeThrough) result.push('删除线');
  if (item.isQuote) result.push('引用');
  if (item.isMonospace) result.push('等宽');
  if (item.isSpoiler) result.push('剧透');
  return result.length ? result.join('/') : '-';
}

function normalizeTargetRoutes(keyword) {
  const routes = Array.isArray(keyword.targetRoutes) ? keyword.targetRoutes : [];
  if (routes.length > 0) {
    return routes
      .map(route => ({
        targetChatId: Number(route.targetChatId || 0),
        includeSource: route.includeSource !== false,
        forwardMode: normalizeForwardMode(route.forwardMode)
      }))
      .filter(route => route.targetChatId !== 0);
  }

  const chatId = Number(keyword.targetChatId || 0);
  if (chatId === 0) return [];
  return [{ targetChatId: chatId, includeSource: true, forwardMode: normalizeForwardMode(keyword.forwardMode) }];
}

function forwardOptionsHtml(selected = 0) {
  return forwardModeMap.map((name, idx) => (
    `<option value="${idx}" ${Number(selected) === idx ? 'selected' : ''}>${name}</option>`
  )).join('');
}

function targetRouteRowHtml(route = {}) {
  const chatId = Number(route.targetChatId || 0);
  const includeSource = route.includeSource !== false;
  const forwardMode = normalizeForwardMode(route.forwardMode);
  return `
    <div class="target-route-row grid grid-cols-1 md:grid-cols-12 gap-2 items-center rounded-lg bg-base-200 p-2">
      <select class="target-route-chat select select-bordered md:col-span-5">
        <option value="0">请选择目标群</option>
        ${state.dialogs.map(dialog => `<option value="${dialog.id}" ${Number(dialog.id) === chatId ? 'selected' : ''}>${dialog.displayTitle}</option>`).join('')}
      </select>
      <select class="target-route-mode select select-bordered md:col-span-3">
        ${forwardOptionsHtml(forwardMode)}
      </select>
      <label class="label cursor-pointer justify-start md:col-span-3">
        <span class="label-text mr-2">显示来源</span>
        <input type="checkbox" class="checkbox target-route-source" ${includeSource ? 'checked' : ''}>
      </label>
      <button class="btn btn-error btn-sm md:col-span-1" onclick="removeTargetRouteRow(this)">删除</button>
    </div>
  `;
}

function setTargetRouteRows(containerId, routes = []) {
  const container = document.getElementById(containerId);
  const safeRoutes = routes.length > 0 ? routes : [{}];
  container.innerHTML = safeRoutes.map(route => targetRouteRowHtml(route)).join('');
}

function applyForwardDialogOptions() {
  document.querySelectorAll('.target-route-chat').forEach(select => {
    const current = Number(select.value || 0);
    select.innerHTML = `<option value="0">请选择目标群</option>${state.dialogs.map(dialog =>
      `<option value="${dialog.id}" ${Number(dialog.id) === current ? 'selected' : ''}>${dialog.displayTitle}</option>`
    ).join('')}`;
  });
}

function addTargetRouteRow(containerId) {
  const container = document.getElementById(containerId);
  container.insertAdjacentHTML('beforeend', targetRouteRowHtml({}));
}

function removeTargetRouteRow(button) {
  const container = button.closest('#kwTargetRoutes, #editKeywordTargetRoutes');
  button.closest('.target-route-row')?.remove();
  if (container && container.querySelectorAll('.target-route-row').length === 0) {
    addTargetRouteRow(container.id);
  }
}

function collectTargetRoutes(containerId) {
  const rows = Array.from(document.querySelectorAll(`#${containerId} .target-route-row`));
  return rows
    .map(row => ({
      targetChatId: Number(row.querySelector('.target-route-chat')?.value || 0),
      includeSource: !!row.querySelector('.target-route-source')?.checked,
      forwardMode: Number(row.querySelector('.target-route-mode')?.value || 0)
    }))
    .filter(route => route.targetChatId !== 0);
}

function renderMonitorDialogs() {
  const list = document.getElementById('monitorDialogList');
  if (!state.dialogs.length) {
    list.innerHTML = '<div class="text-sm opacity-60">请先登录 Telegram 后再加载群组列表。</div>';
    return;
  }
  const selected = new Set(state.selectedMonitorChatIds.map(Number));
  list.innerHTML = state.dialogs.map(dialog => `
    <label class="label cursor-pointer justify-start gap-3 rounded-lg bg-base-100 px-3 py-2">
      <input class="checkbox monitor-chat" type="checkbox" value="${dialog.id}" ${selected.has(Number(dialog.id)) ? 'checked' : ''} onchange="syncSelectedMonitorChatIds()">
      <span>${dialog.displayTitle}</span>
    </label>
  `).join('');
  syncSelectedMonitorChatIds();
}

function renderGroupTaskDialogs() {
  const list = document.getElementById('groupTaskDialogList');
  if (!state.dialogs.length) {
    list.innerHTML = '<div class="text-sm opacity-60">请先登录 Telegram 后再加载群组列表。</div>';
    return;
  }
  const selected = new Set(state.selectedGroupTaskChatIds.map(Number));
  list.innerHTML = state.dialogs.map(dialog => `
    <label class="label cursor-pointer justify-start gap-3 rounded-lg bg-base-100 px-3 py-2">
      <input class="checkbox group-task-chat" type="checkbox" value="${dialog.id}" ${selected.has(Number(dialog.id)) ? 'checked' : ''} onchange="syncGroupTaskChatIds()">
      <span>${dialog.displayTitle}</span>
    </label>
  `).join('');
  syncGroupTaskChatIds();
}

function renderKeywordTable() {
  const body = document.getElementById('keywordTableBody');
  if (!state.keywords.length) {
    body.innerHTML = '<tr><td colspan="7" class="text-center opacity-60">暂无关键词</td></tr>';
    return;
  }

  body.innerHTML = state.keywords.map(item => {
    const keywordType = normalizeKeywordType(item.keywordType);
    const keywordAction = normalizeKeywordAction(item.keywordAction);
    const routes = normalizeTargetRoutes(item);
    const routeText = routes.length
      ? routes.map(route => {
        const name = getDialogTitle(route.targetChatId);
        const mode = forwardModeMap[normalizeForwardMode(route.forwardMode)] || forwardModeMap[0];
        return `${name} / ${mode} / ${route.includeSource ? '显示来源' : '隐藏来源'}`;
      }).join('<br>')
      : '-';

    return `
      <tr>
        <td>${item.id}</td>
        <td class="max-w-xs break-all">${item.keywordContent || ''}</td>
        <td>${keywordTypeMap[keywordType] || keywordTypeMap[0]}</td>
        <td>${keywordActionMap[keywordAction] || keywordActionMap[1]}</td>
        <td class="max-w-sm break-all">${routeText}</td>
        <td>${collectStyleText(item)}</td>
        <td>
          <div class="flex gap-2">
            <button class="btn btn-xs btn-primary" onclick="editKeyword(${item.id})">编辑</button>
            <button class="btn btn-xs btn-error" onclick="deleteKeyword(${item.id})">删除</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function resetTelegramScopedState() {
  state.telegramLoginStep = 0;
  state.telegramPhone = '';
  state.telegramLoggedIn = false;
  state.monitoring = false;
  state.groupTaskRunning = false;
  state.dialogs = [];
  state.selectedMonitorChatIds = [];
  state.selectedGroupTaskChatIds = [];
  state.replyTemplates = [];
  state.groupTaskTemplates = [];
  state.keywords = [];

  const ids = [
    'telegramPhone', 'telegramStepInput', 'proxyUrl', 'defaultReplyTemplate',
    'newReplyTemplate', 'newGroupTaskTemplate', 'kwContent',
    'groupTaskPerGroupInterval', 'groupTaskMinInterval', 'groupTaskMaxInterval'
  ];
  ids.forEach(id => {
    const element = document.getElementById(id);
    if (element) element.value = '';
  });

  document.getElementById('telegramStepLabel').textContent = '验证码 / 二步密码';
  document.getElementById('telegramLoginHint').textContent = '先输入手机号提交，系统会按步骤要求验证码或二步密码。';
  document.getElementById('monitorSelectAll').checked = false;
  document.getElementById('groupTaskSelectAll').checked = false;
  document.getElementById('enableInChatReply').checked = false;
  document.getElementById('useRandomReplyTemplate').checked = false;

  renderDefaultTargetOptions();
  renderMonitorDialogs();
  renderGroupTaskDialogs();
  renderReplyTemplates();
  renderGroupTaskTemplates();
  renderKeywordTable();
  setTargetRouteRows('kwTargetRoutes', [{}]);
  setTargetRouteRows('editKeywordTargetRoutes', [{}]);
}
async function loginApp() {
  const userName = document.getElementById('authUserName').value.trim();
  const password = document.getElementById('authPassword').value;
  if (!userName || !password) return toast('请输入用户名和密码', false);

  try {
    const result = await api(`${API.auth}/login`, { method: 'POST', body: { userName, password } });
    state.token = result.token;
    localStorage.setItem('tgjk_token', state.token);
    state.currentUser = result.user;
    resetTelegramScopedState();
    renderAuthView();
    await refreshAll();
    toast('登录成功');
  } catch (error) {
    toast(`登录失败: ${error.message}`, false);
  }
}

function logoutApp() {
  state.token = '';
  state.currentUser = null;
  localStorage.removeItem('tgjk_token');
  resetTelegramScopedState();
  renderAuthView();
}

function openPasswordDialog() {
  document.getElementById('currentPassword').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('passwordDialog').showModal();
}

async function changePassword() {
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  if (!currentPassword || !newPassword) return toast('请填写完整密码信息', false);

  try {
    await api(`${API.auth}/change-password`, { method: 'POST', body: { currentPassword, newPassword } });
    document.getElementById('passwordDialog').close();
    toast('密码修改成功');
  } catch (error) {
    toast(`密码修改失败: ${error.message}`, false);
  }
}

async function loadCurrentUser() {
  if (!state.token) {
    state.currentUser = null;
    return;
  }
  try {
    state.currentUser = await api(`${API.auth}/me`);
  } catch {
    state.currentUser = null;
    state.token = '';
    localStorage.removeItem('tgjk_token');
  }
}

async function refreshAll() {
  if (!state.currentUser) return;
  await Promise.all([
    fetchTelegramStatus(),
    loadTelegramSettings(),
    loadReplyConfig(),
    loadGroupTaskConfig(),
    refreshKeywords(),
    isAdminUser() ? loadUsers() : Promise.resolve()
  ]);
}

async function fetchTelegramStatus() {
  const status = await api(`${API.telegram}/status`);
  state.telegramLoggedIn = !!status.loggedIn;
  state.monitoring = !!status.monitoring;
  state.groupTaskRunning = !!status.groupMessageTaskRunning;
  if (status.phoneNumber) document.getElementById('telegramPhone').value = status.phoneNumber;
}

async function submitTelegramLogin() {
  const phone = document.getElementById('telegramPhone').value.trim();
  const loginInfo = document.getElementById('telegramStepInput').value;
  const payload = state.telegramLoginStep === 0
    ? { phoneNumber: phone, loginInfo: '' }
    : { phoneNumber: state.telegramPhone, loginInfo };

  if (!payload.phoneNumber) return toast('请输入手机号', false);

  try {
    if (state.telegramLoginStep === 0) state.telegramPhone = payload.phoneNumber;
    const result = await api(`${API.telegram}/login`, { method: 'POST', body: payload });
    if (result === 'WaitingForVerificationCode') {
      state.telegramLoginStep = 1;
      document.getElementById('telegramStepLabel').textContent = '验证码';
      document.getElementById('telegramStepInput').value = '';
      document.getElementById('telegramLoginHint').textContent = '请输入 Telegram 发送的验证码后再次提交。';
      return toast('请输入验证码');
    }
    if (result === 'WaitingForPassword') {
      state.telegramLoginStep = 2;
      document.getElementById('telegramStepLabel').textContent = '二步验证密码';
      document.getElementById('telegramStepInput').value = '';
      document.getElementById('telegramLoginHint').textContent = '请输入二步验证密码后再次提交。';
      return toast('请输入二步验证密码');
    }

    state.telegramLoginStep = 0;
    document.getElementById('telegramStepLabel').textContent = '验证码 / 二步密码';
    document.getElementById('telegramStepInput').value = '';
    document.getElementById('telegramLoginHint').textContent = '登录完成后可以加载群组并配置监控。';
    await fetchTelegramStatus();
    await loadTelegramSettings();
    await loadDialogs(false);
    toast(result === 'LoggedIn' ? 'Telegram 登录成功' : `登录结果: ${result}`);
  } catch (error) {
    toast(`Telegram 登录失败: ${error.message}`, false);
  }
}

async function saveProxy() {
  try {
    const result = await api(`${API.telegram}/proxy`, {
      method: 'POST',
      body: {
        type: Number(document.getElementById('proxyType').value),
        url: document.getElementById('proxyUrl').value.trim()
      }
    });
    await fetchTelegramStatus();
    toast(`代理设置完成: ${result}`);
  } catch (error) {
    toast(`保存代理失败: ${error.message}`, false);
  }
}

async function clearTelegramSession() {
  if (!confirm('确定清理当前 Telegram 会话吗？清理后需要重新登录。')) return;

  try {
    await api(`${API.telegram}/clear-session`, { method: 'POST' });
    state.telegramLoginStep = 0;
    state.telegramPhone = '';
    state.telegramLoggedIn = false;
    state.monitoring = false;
    state.groupTaskRunning = false;
    state.dialogs = [];
    state.selectedMonitorChatIds = [];
    state.selectedGroupTaskChatIds = [];

    document.getElementById('telegramStepLabel').textContent = '验证码 / 二步密码';
    document.getElementById('telegramStepInput').value = '';
    document.getElementById('telegramLoginHint').textContent = '会话已清理，请重新输入手机号登录。';
    renderDefaultTargetOptions();
    renderMonitorDialogs();
    renderGroupTaskDialogs();
    await refreshKeywords();
    toast('Telegram 会话已清理');
  } catch (error) {
    toast(`清理 Telegram 会话失败: ${error.message}`, false);
  }
}

async function loadDialogs(showToast = false) {
  try {
    state.dialogs = await api(`${API.telegram}/dialogs`);
  } catch (error) {
    state.dialogs = [];
    if (showToast) toast(`加载群组失败: ${error.message}`, false);
  }
  renderDefaultTargetOptions();
  renderMonitorDialogs();
  renderGroupTaskDialogs();
  applyForwardDialogOptions();
  if (showToast && state.dialogs.length) toast(`已加载 ${state.dialogs.length} 个群组`);
}

function syncSelectedMonitorChatIds() {
  state.selectedMonitorChatIds = [...document.querySelectorAll('.monitor-chat')]
    .filter(x => x.checked)
    .map(x => Number(x.value));
  document.getElementById('monitorSelectAll').checked =
    state.dialogs.length > 0 && state.selectedMonitorChatIds.length === state.dialogs.length;
}

function toggleMonitorAll(checked) {
  document.querySelectorAll('.monitor-chat').forEach(item => { item.checked = checked; });
  syncSelectedMonitorChatIds();
}

async function loadTelegramSettings() {
  try {
    const settings = await api(`${API.telegram}/settings`);
    state.selectedMonitorChatIds = (settings.monitorChatIds || []).map(Number);
    await loadDialogs(false);
    document.getElementById('defaultTargetChatId').value = String(Number(settings.defaultTargetChatId || 0));
  } catch (error) {
    state.selectedMonitorChatIds = [];
    state.dialogs = [];
    renderDefaultTargetOptions();
    renderMonitorDialogs();
    renderGroupTaskDialogs();
  }
}

async function saveTelegramSettings() {
  syncSelectedMonitorChatIds();
  try {
    await api(`${API.telegram}/settings`, {
      method: 'POST',
      body: {
        defaultTargetChatId: Number(document.getElementById('defaultTargetChatId').value || 0),
        monitorChatIds: state.selectedMonitorChatIds
      }
    });
    toast('监控设置已保存');
  } catch (error) {
    toast(`保存监控设置失败: ${error.message}`, false);
  }
}

async function startMonitor() {
  try {
    const result = await api(`${API.telegram}/start`, { method: 'POST' });
    await fetchTelegramStatus();
    toast(`监控启动结果: ${result}`);
  } catch (error) {
    toast(`启动监控失败: ${error.message}`, false);
  }
}

async function stopMonitor() {
  try {
    await api(`${API.telegram}/stop`, { method: 'POST' });
    await fetchTelegramStatus();
    toast('监控已停止');
  } catch (error) {
    toast(`停止监控失败: ${error.message}`, false);
  }
}
async function loadReplyConfig() {
  try {
    const config = await api(`${API.telegram}/reply-config`);
    document.getElementById('enableInChatReply').checked = !!config.enableInChatReply;
    document.getElementById('useRandomReplyTemplate').checked = !!config.useRandomReplyTemplate;
    document.getElementById('defaultReplyTemplate').value = config.defaultReplyTemplate || '';
    state.replyTemplates = Array.isArray(config.templates) ? config.templates : [];
    renderReplyTemplates();
  } catch (error) {
    toast(`加载自动回复配置失败: ${error.message}`, false);
  }
}

function addReplyTemplate() {
  const input = document.getElementById('newReplyTemplate');
  const value = input.value.trim();
  if (!value) return;
  if (!state.replyTemplates.includes(value)) state.replyTemplates.push(value);
  input.value = '';
  renderReplyTemplates();
}

function removeReplyTemplate(index) {
  state.replyTemplates.splice(index, 1);
  renderReplyTemplates();
}

async function saveReplyConfig() {
  try {
    await api(`${API.telegram}/reply-config`, {
      method: 'POST',
      body: {
        enableInChatReply: document.getElementById('enableInChatReply').checked,
        useRandomReplyTemplate: document.getElementById('useRandomReplyTemplate').checked,
        defaultReplyTemplate: document.getElementById('defaultReplyTemplate').value.trim(),
        templates: state.replyTemplates
      }
    });
    toast('自动回复配置已保存');
  } catch (error) {
    toast(`保存自动回复配置失败: ${error.message}`, false);
  }
}

function syncGroupTaskChatIds() {
  state.selectedGroupTaskChatIds = [...document.querySelectorAll('.group-task-chat')]
    .filter(x => x.checked)
    .map(x => Number(x.value));
  document.getElementById('groupTaskSelectAll').checked =
    state.dialogs.length > 0 && state.selectedGroupTaskChatIds.length === state.dialogs.length;
}

function toggleGroupTaskAll(checked) {
  document.querySelectorAll('.group-task-chat').forEach(item => { item.checked = checked; });
  syncGroupTaskChatIds();
}

async function loadGroupTaskConfig() {
  try {
    const config = await api(`${API.telegram}/group-task-config`);
    document.getElementById('groupTaskPerGroupInterval').value = Number(config.perGroupIntervalSeconds || 3);
    document.getElementById('groupTaskMinInterval').value = Number(config.minIntervalSeconds || 60);
    document.getElementById('groupTaskMaxInterval').value = Number(config.maxIntervalSeconds || 120);
    state.groupTaskTemplates = Array.isArray(config.templates) ? config.templates : [];
    state.selectedGroupTaskChatIds = Array.isArray(config.targetChatIds) ? config.targetChatIds.map(Number) : [];
    state.groupTaskRunning = !!config.running;
    renderGroupTaskTemplates();
    renderGroupTaskDialogs();
  } catch (error) {
    toast(`加载群发配置失败: ${error.message}`, false);
  }
}

function addGroupTaskTemplate() {
  const input = document.getElementById('newGroupTaskTemplate');
  const value = input.value.trim();
  if (!value) return;
  if (!state.groupTaskTemplates.includes(value)) state.groupTaskTemplates.push(value);
  input.value = '';
  renderGroupTaskTemplates();
}

function removeGroupTaskTemplate(index) {
  state.groupTaskTemplates.splice(index, 1);
  renderGroupTaskTemplates();
}

async function saveGroupTaskConfig() {
  syncGroupTaskChatIds();
  try {
    await api(`${API.telegram}/group-task-config`, {
      method: 'POST',
      body: {
        perGroupIntervalSeconds: Number(document.getElementById('groupTaskPerGroupInterval').value || 3),
        minIntervalSeconds: Number(document.getElementById('groupTaskMinInterval').value || 60),
        maxIntervalSeconds: Number(document.getElementById('groupTaskMaxInterval').value || 120),
        templates: state.groupTaskTemplates,
        targetChatIds: state.selectedGroupTaskChatIds
      }
    });
    toast('群发配置已保存');
  } catch (error) {
    toast(`保存群发配置失败: ${error.message}`, false);
  }
}

async function startGroupTask() {
  try {
    const result = await api(`${API.telegram}/group-task-start`, { method: 'POST' });
    state.groupTaskRunning = true;
    toast(`群发启动结果: ${result}`);
  } catch (error) {
    toast(`启动群发失败: ${error.message}`, false);
  }
}

async function stopGroupTask() {
  try {
    await api(`${API.telegram}/group-task-stop`, { method: 'POST' });
    state.groupTaskRunning = false;
    toast('群发已停止');
  } catch (error) {
    toast(`停止群发失败: ${error.message}`, false);
  }
}

async function refreshKeywords() {
  try {
    const list = await api(`${API.keyword}/list`);
    state.keywords = Array.isArray(list) ? list : [];
    renderKeywordTable();
  } catch (error) {
    toast(`加载关键词失败: ${error.message}`, false);
  }
}

function buildKeywordPayload(fromEdit = false) {
  const prefix = fromEdit ? 'editKeyword' : 'kw';
  return {
    id: fromEdit ? Number(document.getElementById(`${prefix}Id`).value || 0) : 0,
    keywordContent: document.getElementById(`${prefix}Content`).value.trim(),
    keywordType: Number(document.getElementById(`${prefix}Type`).value || 0),
    keywordAction: Number(document.getElementById(`${prefix}Action`).value || 1),
    targetChatId: 0,
    targetRoutes: collectTargetRoutes(fromEdit ? 'editKeywordTargetRoutes' : 'kwTargetRoutes'),
    forwardMode: 0,
    isCaseSensitive: document.getElementById(`${prefix}Case`).checked,
    isBold: document.getElementById(`${prefix}Bold`).checked,
    isItalic: document.getElementById(`${prefix}Italic`).checked,
    isUnderline: document.getElementById(`${prefix}Underline`).checked,
    isStrikeThrough: document.getElementById(`${prefix}Strike`).checked,
    isQuote: document.getElementById(`${prefix}Quote`).checked,
    isMonospace: document.getElementById(`${prefix}Mono`).checked,
    isSpoiler: document.getElementById(`${prefix}Spoiler`).checked
  };
}

function clearKeywordForm() {
  document.getElementById('kwContent').value = '';
  document.getElementById('kwType').value = '1';
  document.getElementById('kwAction').value = '1';
  document.getElementById('kwCase').checked = false;
  document.getElementById('kwBold').checked = false;
  document.getElementById('kwItalic').checked = false;
  document.getElementById('kwUnderline').checked = false;
  document.getElementById('kwStrike').checked = false;
  document.getElementById('kwQuote').checked = false;
  document.getElementById('kwMono').checked = false;
  document.getElementById('kwSpoiler').checked = false;
  setTargetRouteRows('kwTargetRoutes', [{}]);
}

async function addKeyword() {
  const payload = buildKeywordPayload(false);
  if (!payload.keywordContent) return toast('请输入关键词内容', false);
  try {
    await api(`${API.keyword}/add`, { method: 'POST', body: payload });
    clearKeywordForm();
    await refreshKeywords();
    toast('关键词添加成功');
  } catch (error) {
    toast(`添加关键词失败: ${error.message}`, false);
  }
}

function editKeyword(id) {
  const item = state.keywords.find(x => Number(x.id) === Number(id));
  if (!item) return;

  document.getElementById('editKeywordId').value = String(item.id);
  document.getElementById('editKeywordContent').value = item.keywordContent || '';
  document.getElementById('editKeywordType').value = String(normalizeKeywordType(item.keywordType));
  document.getElementById('editKeywordAction').value = String(normalizeKeywordAction(item.keywordAction));
  document.getElementById('editKeywordCase').checked = !!item.isCaseSensitive;
  document.getElementById('editKeywordBold').checked = !!item.isBold;
  document.getElementById('editKeywordItalic').checked = !!item.isItalic;
  document.getElementById('editKeywordUnderline').checked = !!item.isUnderline;
  document.getElementById('editKeywordStrike').checked = !!item.isStrikeThrough;
  document.getElementById('editKeywordQuote').checked = !!item.isQuote;
  document.getElementById('editKeywordMono').checked = !!item.isMonospace;
  document.getElementById('editKeywordSpoiler').checked = !!item.isSpoiler;
  setTargetRouteRows('editKeywordTargetRoutes', normalizeTargetRoutes(item));
  document.getElementById('keywordEditDialog').showModal();
}

async function saveKeywordEdit() {
  const payload = buildKeywordPayload(true);
  if (!payload.id) return toast('关键词 ID 无效', false);
  if (!payload.keywordContent) return toast('请输入关键词内容', false);
  try {
    await api(`${API.keyword}/update`, { method: 'PUT', body: payload });
    document.getElementById('keywordEditDialog').close();
    await refreshKeywords();
    toast('关键词修改成功');
  } catch (error) {
    toast(`修改关键词失败: ${error.message}`, false);
  }
}

async function deleteKeyword(id) {
  if (!confirm(`确定删除关键词 #${id} 吗？`)) return;
  try {
    await api(`${API.keyword}/remove`, { method: 'POST', body: { id: Number(id) } });
    await refreshKeywords();
    toast('关键词已删除');
  } catch (error) {
    toast(`删除关键词失败: ${error.message}`, false);
  }
}
function toLocalDateTimeInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function parseLocalDateTimeToUtc(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function renderUserTable(users) {
  const body = document.getElementById('userTableBody');
  if (!users.length) {
    body.innerHTML = '<tr><td colspan="7" class="text-center opacity-60">暂无用户</td></tr>';
    return;
  }

  body.innerHTML = users.map(user => `
    <tr>
      <td>${user.id}</td>
      <td>${user.userName}</td>
      <td>
        <select id="user-role-${user.id}" class="select select-bordered select-sm w-28">
          <option value="0" ${(Number(user.role) === 0 || user.role === 'User') ? 'selected' : ''}>普通用户</option>
          <option value="1" ${(Number(user.role) === 1 || user.role === 'Admin') ? 'selected' : ''}>管理员</option>
        </select>
      </td>
      <td><input id="user-expire-${user.id}" type="datetime-local" class="input input-bordered input-sm w-52" value="${toLocalDateTimeInput(user.expiresAtUtc)}"></td>
      <td><input id="user-enabled-${user.id}" type="checkbox" class="toggle toggle-sm" ${user.isEnabled ? 'checked' : ''}></td>
      <td><input id="user-pass-${user.id}" type="text" class="input input-bordered input-sm w-40" placeholder="留空不修改"></td>
      <td>
        <div class="flex gap-2">
          <button class="btn btn-sm btn-primary" onclick="saveUser(${user.id})">保存</button>
          <button class="btn btn-sm btn-error" onclick="deleteUser(${user.id}, '${user.userName}')">删除</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function loadUsers() {
  if (!isAdminUser()) return;
  try {
    const users = await api(`${API.auth}/users`);
    renderUserTable(Array.isArray(users) ? users : []);
  } catch (error) {
    toast(`加载用户失败: ${error.message}`, false);
  }
}

async function createUser() {
  if (!isAdminUser()) return toast('仅管理员可操作', false);
  const userName = document.getElementById('newUserName').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const role = Number(document.getElementById('newUserRole').value || 0);
  const expiresAtUtc = parseLocalDateTimeToUtc(document.getElementById('newUserExpiresAt').value);

  if (!userName || !password) return toast('请输入用户名和密码', false);

  try {
    await api(`${API.auth}/users`, {
      method: 'POST',
      body: { userName, password, role, expiresAtUtc }
    });
    document.getElementById('newUserName').value = '';
    document.getElementById('newUserPassword').value = '';
    document.getElementById('newUserRole').value = '0';
    document.getElementById('newUserExpiresAt').value = '';
    await loadUsers();
    toast('用户创建成功');
  } catch (error) {
    toast(`创建用户失败: ${error.message}`, false);
  }
}

async function saveUser(userId) {
  if (!isAdminUser()) return toast('仅管理员可操作', false);
  const payload = {
    id: Number(userId),
    role: Number(document.getElementById(`user-role-${userId}`).value || 0),
    expiresAtUtc: parseLocalDateTimeToUtc(document.getElementById(`user-expire-${userId}`).value),
    isEnabled: !!document.getElementById(`user-enabled-${userId}`).checked,
    newPassword: document.getElementById(`user-pass-${userId}`).value.trim() || null
  };
  try {
    await api(`${API.auth}/users`, { method: 'PUT', body: payload });
    await loadUsers();
    toast('用户信息已更新');
  } catch (error) {
    toast(`更新用户失败: ${error.message}`, false);
  }
}

async function deleteUser(userId, userName) {
  if (!isAdminUser()) return toast('仅管理员可操作', false);
  if (!confirm(`确定删除用户 ${userName} 吗？`)) return;

  try {
    await api(`${API.auth}/users/delete`, { method: 'POST', body: { id: Number(userId) } });
    await loadUsers();
    toast('用户已删除');
  } catch (error) {
    toast(`删除用户失败: ${error.message}`, false);
  }
}

function bindTabEvents() {
  document.querySelectorAll('[role="tab"]').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.panel));
  });
}

async function initApp() {
  bindTabEvents();
  setTargetRouteRows('kwTargetRoutes', [{}]);
  setTargetRouteRows('editKeywordTargetRoutes', [{}]);
  renderAuthView();
  if (state.token) {
    await loadCurrentUser();
    renderAuthView();
    if (state.currentUser) {
      resetTelegramScopedState();
      await refreshAll();
    }
  }
}

window.loginApp = loginApp;
window.logoutApp = logoutApp;
window.openPasswordDialog = openPasswordDialog;
window.changePassword = changePassword;
window.refreshAll = refreshAll;
window.submitTelegramLogin = submitTelegramLogin;
window.clearTelegramSession = clearTelegramSession;
window.saveProxy = saveProxy;
window.loadDialogs = loadDialogs;
window.toggleMonitorAll = toggleMonitorAll;
window.syncSelectedMonitorChatIds = syncSelectedMonitorChatIds;
window.saveTelegramSettings = saveTelegramSettings;
window.startMonitor = startMonitor;
window.stopMonitor = stopMonitor;
window.addReplyTemplate = addReplyTemplate;
window.removeReplyTemplate = removeReplyTemplate;
window.saveReplyConfig = saveReplyConfig;
window.startGroupTask = startGroupTask;
window.stopGroupTask = stopGroupTask;
window.toggleGroupTaskAll = toggleGroupTaskAll;
window.syncGroupTaskChatIds = syncGroupTaskChatIds;
window.addGroupTaskTemplate = addGroupTaskTemplate;
window.removeGroupTaskTemplate = removeGroupTaskTemplate;
window.saveGroupTaskConfig = saveGroupTaskConfig;
window.refreshKeywords = refreshKeywords;
window.addKeyword = addKeyword;
window.editKeyword = editKeyword;
window.saveKeywordEdit = saveKeywordEdit;
window.deleteKeyword = deleteKeyword;
window.addTargetRouteRow = addTargetRouteRow;
window.removeTargetRouteRow = removeTargetRouteRow;
window.createUser = createUser;
window.loadUsers = loadUsers;
window.saveUser = saveUser;
window.deleteUser = deleteUser;

document.addEventListener('DOMContentLoaded', () => {
  initApp().catch(error => toast(`初始化失败: ${error.message}`, false));
});
