const API = '/api/telegram';

const toastBox = document.getElementById('toast');
const dialogList = document.getElementById('dialogList');

const btns = {
  load: document.getElementById('btnLoadDialogs'),
  loadGroupTaskDialogs: document.getElementById('btnLoadGroupTaskDialogs'),
  target: document.getElementById('btnSetTarget'),
  start: document.getElementById('btnStart'),
  stop: document.getElementById('btnStop'),
  startGroupTask: document.getElementById('btnStartGroupTask'),
  stopGroupTask: document.getElementById('btnStopGroupTask'),
  login: document.getElementById('btnLogin')
};

const proxyTypeEl = document.getElementById('proxyType');
const proxyUrlEl = document.getElementById('proxyUrl');

const replyEls = {
  enable: document.getElementById('enableInChatReply'),
  random: document.getElementById('useRandomReplyTemplate'),
  defaultTemplate: document.getElementById('defaultReplyTemplate'),
  newTemplate: document.getElementById('newReplyTemplate'),
  list: document.getElementById('replyTemplateList')
};

const groupTaskEls = {
  list: document.getElementById('groupTaskDialogList'),
  perGroupInterval: document.getElementById('groupTaskPerGroupInterval'),
  minInterval: document.getElementById('groupTaskMinInterval'),
  maxInterval: document.getElementById('groupTaskMaxInterval'),
  newTemplate: document.getElementById('newGroupTaskTemplate'),
  templateList: document.getElementById('groupTaskTemplateList')
};

let state = { logged: false, mon: false, groupTaskRunning: false };
let loginStepState = 0;
let currentPhone = '';
let replyTemplates = [];
let allDialogs = [];
let groupTaskTemplates = [];
let selectedGroupTaskChatIds = [];
let loginSubmitting = false;

function toast(message, ok = true) {
  const node = document.createElement('div');
  node.setAttribute('role', 'alert');
  node.className = `alert ${ok ? 'alert-success' : 'alert-error'} alert-horizontal shadow-lg`;
  node.innerHTML = `<span>${message}</span>`;
  toastBox.appendChild(node);
  setTimeout(() => node.remove(), 4000);
}

async function api(path, init = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {});
  const payload = Object.assign({}, init, { headers });

  if (payload.body !== undefined && typeof payload.body !== 'string') {
    payload.body = JSON.stringify(payload.body);
  }

  const res = await fetch(path, payload);
  const text = await res.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }

  const logicalFail = data && typeof data === 'object' && data.succeeded === false;
  if (!res.ok || logicalFail) {
    const msg = (data && data.errors && (typeof data.errors === 'string'
      ? data.errors
      : Object.values(data.errors)[0]?.[0])) || data.message || text || 'Request failed';
    throw new Error(msg);
  }

  if (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'data')) {
    return data.data;
  }

  return data;
}

function normalizeTemplates(list) {
  const map = new Map();
  (list || []).forEach(item => {
    const text = (item || '').trim();
    if (!text) return;
    map.set(text.toLowerCase(), text);
  });
  return Array.from(map.values());
}

function normalizeIds(list) {
  return Array.from(new Set((list || []).map(Number).filter(Boolean)));
}

function applyState() {
  btns.load.disabled = !state.logged;
  btns.loadGroupTaskDialogs.disabled = !state.logged;
  dialogList.disabled = !state.logged;
  btns.target.disabled = !state.logged;
  btns.start.disabled = !state.logged || state.mon;
  btns.stop.disabled = !state.logged || !state.mon;
  btns.startGroupTask.disabled = !state.logged || state.groupTaskRunning;
  btns.stopGroupTask.disabled = !state.logged || !state.groupTaskRunning;
  btns.login.innerText = state.logged ? '已登录（点击重新登录）' : '登录 / 重新登录';
}

async function fetchState() {
  const status = await api(`${API}/status`);
  state = {
    logged: !!status.loggedIn,
    mon: !!status.monitoring,
    groupTaskRunning: !!status.groupMessageTaskRunning
  };
  applyState();
}

function proxyTypeChanged() {
  const proxyType = proxyTypeEl.value;

  if (proxyType === '0') {
    proxyUrlEl.disabled = true;
    proxyUrlEl.placeholder = '无需代理时保持为空';
  } else if (proxyType === '1') {
    proxyUrlEl.disabled = false;
    proxyUrlEl.placeholder = 'host:port 或 host:port:username:password';
  } else {
    proxyUrlEl.disabled = false;
    proxyUrlEl.placeholder = '请输入 MTProxy 链接';
  }
}

async function setProxy() {
  const type = Number(proxyTypeEl.value);
  const url = type === 0 ? '' : proxyUrlEl.value.trim();

  try {
    const result = await api(`${API}/proxy`, {
      method: 'POST',
      body: { type, url }
    });

    if (result === 'LoggedIn') {
      toast('代理已保存，当前登录状态保持不变');
    } else if (result === 'NotLoggedIn') {
      toast('代理已保存，但需要重新登录', false);
    } else {
      toast(`代理设置结果：${result}`);
    }

    await fetchState();
  } catch (err) {
    toast(`设置代理失败：${err.message}`, false);
  }
}

const loginModal = document.getElementById('loginModal');
const loginTitle = document.getElementById('loginTitle');
const loginInput = document.getElementById('stepInput');

function openLogin() {
  loginStepState = 0;
  loginTitle.innerText = '手机号登录';
  loginInput.placeholder = '+8613812345678';
  loginInput.value = '';
  loginModal.showModal();
}

function handleLoginResponse(result) {
  switch (result) {
    case 'WaitingForVerificationCode':
      loginStepState = 1;
      loginTitle.innerText = '输入验证码';
      loginInput.placeholder = '请输入验证码';
      loginInput.value = '';
      break;
    case 'WaitingForPassword':
      loginStepState = 2;
      loginTitle.innerText = '输入二步验证密码';
      loginInput.placeholder = '请输入二步验证密码';
      loginInput.value = '';
      break;
    case 'LoggedIn':
      toast('登录成功');
      loginModal.close();
      fetchState().catch(err => toast(`刷新状态失败：${err.message}`, false));
      break;
    case 'NotLoggedIn':
      toast('登录失败', false);
      break;
    default:
      toast(`未知登录状态：${result}`, false);
      break;
  }
}

async function loginStep() {
  if (loginSubmitting) return;

  const rawValue = loginInput.value;
  const value = loginStepState === 2 ? rawValue : rawValue.trim();
  if (!value || !value.trim()) {
    toast('输入内容不能为空', false);
    return;
  }

  try {
    loginSubmitting = true;
    if (loginStepState === 0) currentPhone = value;

    const payload = loginStepState === 0
      ? { phoneNumber: value, loginInfo: '' }
      : { phoneNumber: currentPhone, loginInfo: value };

    const result = await api(`${API}/login`, {
      method: 'POST',
      body: payload
    });

    handleLoginResponse(result);
  } catch (err) {
    toast(`登录失败：${err.message}`, false);
    if (loginStepState !== 2) {
      loginInput.value = '';
    }
  } finally {
    loginSubmitting = false;
  }
}

function renderGroupTaskDialogList() {
  if (!allDialogs.length) {
    groupTaskEls.list.innerHTML = '<div class="text-sm opacity-60">请先加载群组列表。</div>';
    return;
  }

  const selected = new Set(selectedGroupTaskChatIds);
  groupTaskEls.list.innerHTML = allDialogs.map(dialog => `
    <label class="label cursor-pointer justify-start gap-3 rounded-lg bg-base-100 px-3 py-2">
      <input type="checkbox" class="checkbox group-task-chat" value="${dialog.id}" ${selected.has(dialog.id) ? 'checked' : ''}>
      <span class="label-text break-all">${dialog.displayTitle}</span>
    </label>
  `).join('');

  document.querySelectorAll('.group-task-chat').forEach(el => {
    el.addEventListener('change', () => {
      selectedGroupTaskChatIds = normalizeIds(
        [...document.querySelectorAll('.group-task-chat')]
          .filter(item => item.checked)
          .map(item => Number(item.value))
      );
    });
  });
}

async function loadDialogs() {
  try {
    const dialogs = await api(`${API}/dialogs`);
    allDialogs = dialogs || [];
    dialogList.innerHTML = allDialogs
      .map(d => `<option value="${d.id}">${d.displayTitle}</option>`)
      .join('');
    renderGroupTaskDialogList();
    toast('会话加载成功');
  } catch (err) {
    toast(`加载会话失败：${err.message}`, false);
  }
}

async function loadGroupTaskDialogs() {
  await loadDialogs();
}

async function setTarget() {
  if (!dialogList.value) {
    toast('请先选择一个目标会话', false);
    return;
  }

  try {
    await api(`${API}/target`, {
      method: 'POST',
      body: Number(dialogList.value)
    });
    toast('目标群保存成功');
  } catch (err) {
    toast(`保存目标群失败：${err.message}`, false);
  }
}

async function startMonitor() {
  try {
    const result = await api(`${API}/start`, { method: 'POST' });

    if (result === 'Started') {
      state.mon = true;
      toast('监控已启动');
    } else if (result === 'AlreadyRunning') {
      state.mon = true;
      toast('监控已经在运行');
    } else if (result === 'MissingTarget') {
      toast('请先设置监控目标群', false);
    } else if (result === 'NoUserInfo') {
      toast('用户信息尚未加载完成', false);
    } else {
      toast(`启动监控失败：${result}`, false);
    }

    applyState();
  } catch (err) {
    toast(`启动监控失败：${err.message}`, false);
  }
}

async function stopMonitor() {
  try {
    await api(`${API}/stop`, { method: 'POST' });
    state.mon = false;
    applyState();
    toast('监控已停止');
  } catch (err) {
    toast(`停止监控失败：${err.message}`, false);
  }
}

function renderReplyTemplateList() {
  if (!replyTemplates.length) {
    replyEls.list.innerHTML = '<div class="text-sm opacity-60">暂时没有随机回复模板，将使用默认回复模板。</div>';
    return;
  }

  replyEls.list.innerHTML = replyTemplates.map((tpl, idx) => `
    <div class="flex items-start gap-2 rounded-lg border p-2 bg-base-200">
      <div class="flex-1 break-all">${tpl}</div>
      <button class="btn btn-xs btn-error" onclick="removeReplyTemplate(${idx})">删除</button>
    </div>
  `).join('');
}

function addReplyTemplate() {
  const text = replyEls.newTemplate.value.trim();
  if (!text) {
    toast('回复模板不能为空', false);
    return;
  }

  replyTemplates.push(text);
  replyTemplates = normalizeTemplates(replyTemplates);
  replyEls.newTemplate.value = '';
  renderReplyTemplateList();
}

function removeReplyTemplate(index) {
  replyTemplates.splice(index, 1);
  renderReplyTemplateList();
}

async function loadReplyConfig() {
  try {
    const cfg = await api(`${API}/reply-config`);
    replyEls.enable.checked = !!cfg.enableInChatReply;
    replyEls.random.checked = !!cfg.useRandomReplyTemplate;
    replyEls.defaultTemplate.value = cfg.defaultReplyTemplate || '收到，{sender}，你的消息命中了关键词：{keywords}';
    replyTemplates = normalizeTemplates(cfg.templates || []);
    renderReplyTemplateList();
  } catch (err) {
    toast(`加载自动回复配置失败：${err.message}`, false);
  }
}

async function saveReplyConfig() {
  const payload = {
    enableInChatReply: replyEls.enable.checked,
    useRandomReplyTemplate: replyEls.random.checked,
    defaultReplyTemplate: replyEls.defaultTemplate.value.trim(),
    templates: normalizeTemplates(replyTemplates)
  };

  if (!payload.defaultReplyTemplate) {
    toast('默认回复模板不能为空', false);
    return;
  }

  try {
    await api(`${API}/reply-config`, {
      method: 'POST',
      body: payload
    });
    toast('自动回复配置已保存');
    await loadReplyConfig();
  } catch (err) {
    toast(`保存自动回复配置失败：${err.message}`, false);
  }
}

function renderGroupTaskTemplateList() {
  if (!groupTaskTemplates.length) {
    groupTaskEls.templateList.innerHTML = '<div class="text-sm opacity-60">暂时没有群发模板，启动前至少添加一条。</div>';
    return;
  }

  groupTaskEls.templateList.innerHTML = groupTaskTemplates.map((tpl, idx) => `
    <div class="flex items-start gap-2 rounded-lg border p-2 bg-base-200">
      <div class="flex-1 break-all">${tpl}</div>
      <button class="btn btn-xs btn-error" onclick="removeGroupTaskTemplate(${idx})">删除</button>
    </div>
  `).join('');
}

function addGroupTaskTemplate() {
  const text = groupTaskEls.newTemplate.value.trim();
  if (!text) {
    toast('群发模板不能为空', false);
    return;
  }

  groupTaskTemplates.push(text);
  groupTaskTemplates = normalizeTemplates(groupTaskTemplates);
  groupTaskEls.newTemplate.value = '';
  renderGroupTaskTemplateList();
}

function removeGroupTaskTemplate(index) {
  groupTaskTemplates.splice(index, 1);
  renderGroupTaskTemplateList();
}

async function loadGroupTaskConfig() {
  try {
    const cfg = await api(`${API}/group-task-config`);
    groupTaskEls.perGroupInterval.value = cfg.perGroupIntervalSeconds || 30;
    groupTaskEls.minInterval.value = cfg.minIntervalSeconds || 300;
    groupTaskEls.maxInterval.value = cfg.maxIntervalSeconds || 600;
    groupTaskTemplates = normalizeTemplates(cfg.templates || []);
    selectedGroupTaskChatIds = normalizeIds(cfg.targetChatIds || []);
    state.groupTaskRunning = !!cfg.running;
    renderGroupTaskTemplateList();
    renderGroupTaskDialogList();
    applyState();
  } catch (err) {
    toast(`加载群发任务配置失败：${err.message}`, false);
  }
}

async function saveGroupTaskConfig() {
  const payload = {
    perGroupIntervalSeconds: Number(groupTaskEls.perGroupInterval.value),
    minIntervalSeconds: Number(groupTaskEls.minInterval.value),
    maxIntervalSeconds: Number(groupTaskEls.maxInterval.value),
    templates: normalizeTemplates(groupTaskTemplates),
    targetChatIds: normalizeIds(selectedGroupTaskChatIds)
  };

  if (!payload.templates.length) {
    toast('请至少添加一条群发模板', false);
    return false;
  }

  if (!payload.targetChatIds.length) {
    toast('请至少选择一个群组', false);
    return false;
  }

  if (!payload.perGroupIntervalSeconds || payload.perGroupIntervalSeconds < 1) {
    toast('群与群之间等待时间无效', false);
    return false;
  }

  if (!payload.minIntervalSeconds || !payload.maxIntervalSeconds || payload.minIntervalSeconds < 5 || payload.maxIntervalSeconds < payload.minIntervalSeconds) {
    toast('整轮等待时间区间无效', false);
    return false;
  }

  try {
    await api(`${API}/group-task-config`, {
      method: 'POST',
      body: payload
    });
    toast('群发任务配置已保存');
    await loadGroupTaskConfig();
    return true;
  } catch (err) {
    toast(`保存群发任务配置失败：${err.message}`, false);
    return false;
  }
}

async function startGroupTask() {
  try {
    const saved = await saveGroupTaskConfig();
    if (!saved) return;

    const result = await api(`${API}/group-task-start`, { method: 'POST' });

    if (result === 'Started') {
      state.groupTaskRunning = true;
      toast('群发任务已启动');
    } else if (result === 'AlreadyRunning') {
      state.groupTaskRunning = true;
      toast('群发任务已经在运行');
    } else if (result === 'MissingTargets') {
      toast('请先选择目标群组', false);
    } else if (result === 'MissingTemplates') {
      toast('请先添加群发模板', false);
    } else if (result === 'NotLoggedIn') {
      toast('当前账号未登录', false);
    } else {
      toast(`启动群发任务失败：${result}`, false);
    }

    applyState();
  } catch (err) {
    toast(`启动群发任务失败：${err.message}`, false);
  }
}

async function stopGroupTask() {
  try {
    await api(`${API}/group-task-stop`, { method: 'POST' });
    state.groupTaskRunning = false;
    applyState();
    toast('群发任务已停止');
  } catch (err) {
    toast(`停止群发任务失败：${err.message}`, false);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  proxyTypeChanged();
  renderReplyTemplateList();
  renderGroupTaskTemplateList();
  renderGroupTaskDialogList();
  await fetchState().catch(err => toast(`加载状态失败：${err.message}`, false));
  await loadReplyConfig();
  await loadGroupTaskConfig();
});

window.proxyTypeChanged = proxyTypeChanged;
window.setProxy = setProxy;
window.openLogin = openLogin;
window.loginStep = loginStep;
window.loadDialogs = loadDialogs;
window.loadGroupTaskDialogs = loadGroupTaskDialogs;
window.setTarget = setTarget;
window.startMonitor = startMonitor;
window.stopMonitor = stopMonitor;
window.addReplyTemplate = addReplyTemplate;
window.removeReplyTemplate = removeReplyTemplate;
window.saveReplyConfig = saveReplyConfig;
window.addGroupTaskTemplate = addGroupTaskTemplate;
window.removeGroupTaskTemplate = removeGroupTaskTemplate;
window.saveGroupTaskConfig = saveGroupTaskConfig;
window.startGroupTask = startGroupTask;
window.stopGroupTask = stopGroupTask;
