const API = '/api/keyword';

const typeMap = {
  FullWord: '全字',
  Contains: '包含',
  Regex: '正则',
  Fuzzy: '模糊',
  User: '用户'
};

const actionMap = {
  Exclude: '排除',
  Monitor: '监控'
};

const forwardModeMap = {
  Formatted: '原格式转发',
  PlainText: '纯消息内容'
};

const styleMap = {
  isCaseSensitive: '大小写',
  isBold: '粗体',
  isItalic: '斜体',
  isUnderline: '下划线',
  isStrikeThrough: '删除线',
  isQuote: '引用',
  isMonospace: '等宽',
  isSpoiler: '剧透'
};

const toastBox = document.getElementById('toast');
const tbody = document.getElementById('kwBody');
const editModal = document.getElementById('editModal');
const dynamicRows = document.getElementById('dynamicRows');

let currentRowsSeed = 0;
let forwardDialogs = [];

const defaultTargetOption = '<option value="0">沿用默认目标群</option>';

function toast(message, ok = true) {
  const node = document.createElement('div');
  node.setAttribute('role', 'alert');
  node.className = `alert ${ok ? 'alert-success' : 'alert-error'} alert-horizontal shadow-lg`;
  node.innerHTML = `<span>${message}</span>`;
  toastBox.appendChild(node);
  setTimeout(() => node.remove(), 3500);
}

async function api(path, init = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {});
  const payload = Object.assign({}, init, { headers });

  if (payload.body !== undefined && typeof payload.body !== 'string') {
    payload.body = JSON.stringify(payload.body);
  }

  const res = await fetch(path, payload);
  const text = await res.text();

  let raw;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    raw = text;
  }

  const fail = raw && typeof raw === 'object' && raw.succeeded === false;
  if (!res.ok || fail) {
    const msg = (raw && raw.errors && (typeof raw.errors === 'string'
      ? raw.errors
      : Object.values(raw.errors)[0]?.[0])) || raw.message || text || '操作失败';
    throw new Error(msg);
  }

  if (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'data')) {
    return raw.data;
  }

  return raw;
}

function styleString(item) {
  return Object.entries(styleMap)
    .filter(([k]) => !!item[k])
    .map(([, name]) => name)
    .join(' ');
}

function normalizeKeywordType(value) {
  if (typeof value === 'number') return value;
  const keys = ['FullWord', 'Contains', 'Regex', 'Fuzzy', 'User'];
  return Math.max(keys.indexOf(value), 0);
}

function normalizeKeywordAction(value) {
  if (typeof value === 'number') return value;
  const keys = ['Exclude', 'Monitor'];
  return Math.max(keys.indexOf(value), 0);
}

function normalizeForwardMode(value) {
  if (typeof value === 'number') return value;
  const keys = ['Formatted', 'PlainText'];
  return Math.max(keys.indexOf(value), 0);
}

function normalizeTargetRoutes(routes, fallbackTargetChatId = 0) {
  const source = Array.isArray(routes) && routes.length
    ? routes
    : (fallbackTargetChatId ? [{ targetChatId: fallbackTargetChatId, includeSource: true, forwardMode: 0 }] : []);

  const dedup = new Map();
  source.forEach(route => {
    const targetChatId = Number(route?.targetChatId || 0);
    if (!targetChatId) return;
    dedup.set(targetChatId, {
      targetChatId,
      includeSource: route?.includeSource !== false,
      forwardMode: normalizeForwardMode(route?.forwardMode)
    });
  });
  return Array.from(dedup.values());
}

function forwardOptionsHtml(selected = 0) {
  return [
    defaultTargetOption,
    ...forwardDialogs.map(dialog => `<option value="${dialog.id}" ${Number(selected) === Number(dialog.id) ? 'selected' : ''}>${dialog.displayTitle}</option>`)
  ].join('');
}

function applyForwardDialogOptions() {
  document.querySelectorAll('select[data-role="forward-target"]').forEach(el => {
    const currentValue = Number(el.value || el.dataset.selected || 0);
    el.innerHTML = forwardOptionsHtml(currentValue);
    el.value = String(currentValue);
  });
}

function getForwardTargetText(targetChatId) {
  const numericId = Number(targetChatId || 0);
  if (!numericId) return '默认目标群';

  const dialog = forwardDialogs.find(item => Number(item.id) === numericId);
  return dialog ? dialog.displayTitle : `ID:${numericId}`;
}

function formatTargetRoutes(item) {
  const routes = normalizeTargetRoutes(item.targetRoutes, item.targetChatId);
  if (!routes.length) return '默认目标群';

  return routes.map(route => {
    const title = getForwardTargetText(route.targetChatId);
    const modeText = forwardModeMap[route.forwardMode] ?? '原格式转发';
    return `${title}${route.includeSource ? '（显示来源）' : '（隐藏来源）'} ${modeText}`;
  }).join(' / ');
}

function targetRouteRowHtml(route = {}) {
  const selected = Number(route.targetChatId || 0);
  const includeSource = route.includeSource !== false;
  const forwardMode = normalizeForwardMode(route.forwardMode);
  return `
    <div class="flex flex-wrap gap-2 items-center target-route-row">
      <select class="select select-bordered flex-1 min-w-64" data-role="forward-target" data-selected="${selected}">
        ${forwardOptionsHtml(selected)}
      </select>
      <select class="select select-bordered" data-role="forward-mode">
        <option value="0" ${forwardMode === 0 ? 'selected' : ''}>原格式转发</option>
        <option value="1" ${forwardMode === 1 ? 'selected' : ''}>纯消息内容</option>
      </select>
      <label class="label gap-2 cursor-pointer">
        <span>显示来源</span>
        <input type="checkbox" class="checkbox" data-role="include-source" ${includeSource ? 'checked' : ''}>
      </label>
      <button type="button" class="btn btn-sm btn-error" onclick="removeTargetRouteRow(this)">删除</button>
    </div>
  `;
}

function setTargetRouteRows(containerId, routes = []) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const normalizedRoutes = normalizeTargetRoutes(routes);
  container.innerHTML = normalizedRoutes.length
    ? normalizedRoutes.map(route => targetRouteRowHtml(route)).join('')
    : targetRouteRowHtml();
}

function addTargetRouteRow(containerId, route = null) {
  const container = typeof containerId === 'string'
    ? document.getElementById(containerId)
    : containerId;
  if (!container) return;

  container.insertAdjacentHTML('beforeend', targetRouteRowHtml(route || {}));
  applyForwardDialogOptions();
}

function removeTargetRouteRow(button) {
  const row = button.closest('.target-route-row');
  const container = row?.parentElement;
  row?.remove();

  if (container && !container.querySelector('.target-route-row')) {
    addTargetRouteRow(container);
  }
}

function collectTargetRoutes(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];

  const routes = [...container.querySelectorAll('.target-route-row')].map(row => ({
    targetChatId: Number(row.querySelector('select[data-role="forward-target"]')?.value || 0),
    includeSource: !!row.querySelector('input[data-role="include-source"]')?.checked,
    forwardMode: Number(row.querySelector('select[data-role="forward-mode"]')?.value || 0)
  }));

  return normalizeTargetRoutes(routes);
}

function renderRow(item) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="checkbox" class="row-check" value="${item.id}"></td>
    <td>${item.id}</td>
    <td>${item.keywordContent ?? ''}</td>
    <td>${typeMap[item.keywordType] ?? item.keywordType}</td>
    <td>${actionMap[item.keywordAction] ?? item.keywordAction}</td>
    <td>${formatTargetRoutes(item)}</td>
    <td>${styleString(item)}</td>
    <td>
      <button class="btn btn-xs" onclick='openEdit(${JSON.stringify(item).replace(/'/g, '&#39;')})'>编辑</button>
      <button class="btn btn-xs btn-error ml-1" onclick="del(${item.id})">删</button>
    </td>
  `;
  return tr;
}

async function refresh() {
  try {
    const list = await api(`${API}/list`);
    tbody.innerHTML = '';
    (list || []).forEach(item => tbody.appendChild(renderRow(item)));
  } catch (err) {
    toast(`加载关键词失败：${err.message}`, false);
  }
}

async function del(id) {
  try {
    await api(`${API}/delete/${id}`, { method: 'DELETE' });
    toast('删除成功');
    refresh();
  } catch (err) {
    toast(`删除失败：${err.message}`, false);
  }
}

async function loadForwardDialogs() {
  const statusEl = document.getElementById('forwardDialogStatus');
  try {
    const dialogs = await api('/api/telegram/dialogs');
    forwardDialogs = dialogs || [];
    applyForwardDialogOptions();
    if (statusEl) {
      statusEl.textContent = `已加载 ${forwardDialogs.length} 个可转发群组。`;
    }
    toast('群组列表加载成功');
    refresh();
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = '加载群组失败，请先在 Telegram 控制台完成登录。';
    }
    toast(`加载群组失败：${err.message}`, false);
  }
}

function toggleAll(source) {
  document.querySelectorAll('.row-check').forEach(el => {
    el.checked = source.checked;
  });
}

async function deleteSelected() {
  const ids = [...document.querySelectorAll('.row-check')]
    .filter(el => el.checked)
    .map(el => Number(el.value));

  if (!ids.length) {
    toast('请先勾选要删除的项', false);
    return;
  }

  try {
    await api(`${API}/batchdelete`, { method: 'DELETE', body: ids });
    toast('批量删除成功');
    refresh();
  } catch (err) {
    toast(`批量删除失败：${err.message}`, false);
  }
}

function buildPayload(prefix) {
  const content = document.getElementById(`${prefix}Content`)?.value?.trim() ?? '';

  return {
    keywordContent: content,
    keywordType: Number(document.getElementById(`${prefix}Type`).value),
    keywordAction: Number(document.getElementById(`${prefix}Action`).value),
    targetRoutes: collectTargetRoutes(`${prefix}TargetRoutes`),
    isCaseSensitive: document.getElementById(`${prefix}Case`).checked,
    isBold: document.getElementById(`${prefix}Bold`).checked,
    isItalic: document.getElementById(`${prefix}Italic`).checked,
    isUnderline: document.getElementById(`${prefix}Under`).checked,
    isStrikeThrough: document.getElementById(`${prefix}Strike`).checked,
    isQuote: document.getElementById(`${prefix}Quote`).checked,
    isMonospace: document.getElementById(`${prefix}Mono`).checked,
    isSpoiler: document.getElementById(`${prefix}Spoil`).checked
  };
}

async function addSingle() {
  const payload = buildPayload('s');
  if (!payload.keywordContent) {
    toast('关键词内容不能为空', false);
    return;
  }

  try {
    await api(`${API}/add`, { method: 'POST', body: payload });
    toast('添加成功');
    refresh();
  } catch (err) {
    toast(`添加失败：${err.message}`, false);
  }
}

function rowTpl(id) {
  return `
  <div class="flex flex-wrap gap-2 items-center border p-2 rounded" id="row-${id}">
    <input class="input input-bordered w-40" placeholder="关键词">
    <select class="select select-bordered">
      <option value="0">全字</option>
      <option value="1">包含</option>
      <option value="2">正则</option>
      <option value="3">模糊</option>
      <option value="4">用户</option>
    </select>
    <select class="select select-bordered">
      <option value="1">监控</option>
      <option value="0">排除</option>
    </select>
    <div class="w-full space-y-2">
      <div class="text-sm opacity-70">目标群列表</div>
      <div data-role="target-routes"></div>
      <button type="button" class="btn btn-sm btn-outline" onclick="addTargetRouteRow(this.previousElementSibling)">添加目标群</button>
    </div>
    ${Object.entries(styleMap).map(([k, name]) => `
      <label class="label gap-1 text-xs">
        <span>${name}</span>
        <input type="checkbox" data-flag="${k}" class="checkbox">
      </label>`).join('')}
    <button class="btn btn-error" onclick="this.parentNode.remove()">x</button>
  </div>`;
}

function addRow() {
  currentRowsSeed += 1;
  dynamicRows.insertAdjacentHTML('beforeend', rowTpl(Date.now() + currentRowsSeed));
  const row = dynamicRows.lastElementChild;
  const routesContainer = row?.querySelector('[data-role="target-routes"]');
  if (routesContainer) {
    addTargetRouteRow(routesContainer);
  }
}

async function uploadRows() {
  const rows = [...dynamicRows.children]
    .map(row => {
      const input = row.querySelector('input.input');
      if (!input || !input.value.trim()) return null;

      const typeSel = row.querySelectorAll('select')[0];
      const actionSel = row.querySelectorAll('select')[1];
      const targetRoutes = [...row.querySelectorAll('[data-role="target-routes"] .target-route-row')].map(routeRow => ({
        targetChatId: Number(routeRow.querySelector('select[data-role="forward-target"]')?.value || 0),
        includeSource: !!routeRow.querySelector('input[data-role="include-source"]')?.checked,
        forwardMode: Number(routeRow.querySelector('select[data-role="forward-mode"]')?.value || 0)
      }));
      const payload = {
        keywordContent: input.value.trim(),
        keywordType: Number(typeSel.value),
        keywordAction: Number(actionSel.value),
        targetRoutes: normalizeTargetRoutes(targetRoutes)
      };

      row.querySelectorAll('input[data-flag]').forEach(c => {
        payload[c.dataset.flag] = c.checked;
      });

      return payload;
    })
    .filter(Boolean);

  if (!rows.length) {
    toast('没有可上传的数据行', false);
    return;
  }

  try {
    await api(`${API}/batchadd`, { method: 'POST', body: rows });
    toast('批量添加成功');
    refresh();
  } catch (err) {
    toast(`批量添加失败：${err.message}`, false);
  }
}

async function uploadText() {
  const lines = (document.getElementById('txtKeywords').value || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  if (!lines.length) {
    toast('文本为空', false);
    return;
  }

  const style = {
    isCaseSensitive: document.getElementById('tCase').checked,
    isBold: document.getElementById('tBold').checked,
    isItalic: document.getElementById('tItalic').checked,
    isUnderline: document.getElementById('tUnder').checked,
    isStrikeThrough: document.getElementById('tStrike').checked,
    isQuote: document.getElementById('tQuote').checked,
    isMonospace: document.getElementById('tMono').checked,
    isSpoiler: document.getElementById('tSpoil').checked
  };

  const list = lines.map(line => ({
    keywordContent: line,
    keywordType: Number(document.getElementById('tType').value),
    keywordAction: Number(document.getElementById('tAction').value),
    targetRoutes: collectTargetRoutes('tTargetRoutes'),
    ...style
  }));

  try {
    await api(`${API}/batchadd`, { method: 'POST', body: list });
    toast('文本批量添加成功');
    refresh();
  } catch (err) {
    toast(`文本批量添加失败：${err.message}`, false);
  }
}

function fillEdit(item) {
  document.getElementById('eId').value = item.id;
  document.getElementById('eContent').value = item.keywordContent ?? '';
  document.getElementById('eType').value = String(normalizeKeywordType(item.keywordType));
  document.getElementById('eAction').value = String(normalizeKeywordAction(item.keywordAction));
  setTargetRouteRows('eTargetRoutes', normalizeTargetRoutes(item.targetRoutes, item.targetChatId));

  document.getElementById('eCase').checked = !!item.isCaseSensitive;
  document.getElementById('eBold').checked = !!item.isBold;
  document.getElementById('eItalic').checked = !!item.isItalic;
  document.getElementById('eUnder').checked = !!item.isUnderline;
  document.getElementById('eStrike').checked = !!item.isStrikeThrough;
  document.getElementById('eQuote').checked = !!item.isQuote;
  document.getElementById('eMono').checked = !!item.isMonospace;
  document.getElementById('eSpoil').checked = !!item.isSpoiler;
}

function openEdit(item) {
  fillEdit(item);
  editModal.showModal();
}

async function saveEdit() {
  const payload = {
    id: Number(document.getElementById('eId').value),
    keywordContent: document.getElementById('eContent').value.trim(),
    keywordType: Number(document.getElementById('eType').value),
    keywordAction: Number(document.getElementById('eAction').value),
    targetRoutes: collectTargetRoutes('eTargetRoutes'),
    isCaseSensitive: document.getElementById('eCase').checked,
    isBold: document.getElementById('eBold').checked,
    isItalic: document.getElementById('eItalic').checked,
    isUnderline: document.getElementById('eUnder').checked,
    isStrikeThrough: document.getElementById('eStrike').checked,
    isQuote: document.getElementById('eQuote').checked,
    isMonospace: document.getElementById('eMono').checked,
    isSpoiler: document.getElementById('eSpoil').checked
  };

  if (!payload.keywordContent) {
    toast('关键词内容不能为空', false);
    return;
  }

  try {
    await api(`${API}/update`, { method: 'PUT', body: payload });
    toast('修改成功');
    refresh();
  } catch (err) {
    toast(`修改失败：${err.message}`, false);
  }
}

function initTabs() {
  document.querySelectorAll('[role=tab]').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('[role=tab]').forEach(t => t.classList.remove('tab-active'));
      tab.classList.add('tab-active');

      ['list', 'single', 'batch', 'text'].forEach(name => {
        const panel = document.getElementById(`panel-${name}`);
        panel.classList.toggle('hidden', !tab.id.endsWith(name));
      });
    };
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setTargetRouteRows('sTargetRoutes');
  setTargetRouteRows('tTargetRoutes');
  setTargetRouteRows('eTargetRoutes');
  initTabs();
  refresh();
});

window.refresh = refresh;
window.del = del;
window.toggleAll = toggleAll;
window.deleteSelected = deleteSelected;
window.addSingle = addSingle;
window.addRow = addRow;
window.uploadRows = uploadRows;
window.uploadText = uploadText;
window.loadForwardDialogs = loadForwardDialogs;
window.addTargetRouteRow = addTargetRouteRow;
window.removeTargetRouteRow = removeTargetRouteRow;
window.openEdit = openEdit;
window.saveEdit = saveEdit;
