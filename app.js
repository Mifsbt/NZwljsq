/**
 * 逆战未来 · 武器伤害计算器
 * 无限画布节点编辑器 - 核心应用逻辑
 */

// ========== 全局状态 ==========
const state = {
  nodes: new Map(),       // id -> node
  connections: new Map(), // id -> connection
  nodeIdCounter: 0,
  connIdCounter: 0,
  pan: { x: 0, y: 0 },
  zoom: 1,
  selectedNode: null,
  selectedConnection: null,
  draggingNode: null,
  draggingOffset: { x: 0, y: 0 },
  panning: false,
  panStart: { x: 0, y: 0 },
  panStartOffset: { x: 0, y: 0 },
  connecting: false,
  connectStart: null,  // { nodeId, portEl, x, y }
  connectMouse: { x: 0, y: 0 },
  currentTab: '主武器',
  currentSubCategory: null,
  searchQuery: '',
  wireDropTarget: null,  // 拖拽节点时命中的连线（用于松手自动插入）
};

// ========== DOM 引用 ==========
const dom = {
  canvasArea: document.getElementById('canvas-area'),
  gridBg: document.getElementById('grid-bg'),
  connectionsSvg: document.getElementById('connections-svg'),
  connectionsGroup: document.getElementById('connections-group'),
  tempConnection: document.getElementById('temp-connection'),
  nodesLayer: document.getElementById('nodes-layer'),
  canvasHint: document.getElementById('canvas-hint'),
  sidebarTabs: document.getElementById('sidebar-tabs'),
  searchInput: document.getElementById('search-input'),
  subCategories: document.getElementById('sub-categories'),
  sidebarList: document.getElementById('sidebar-list'),
  nodeCount: document.getElementById('node-count'),
  connCount: document.getElementById('conn-count'),
  zoomLevel: document.getElementById('zoom-level'),
  finalDps: document.getElementById('final-dps'),
  contextMenu: document.getElementById('context-menu'),
};

// 保留 data.js 中的默认武器数据（用于合并默认图片等资源）
const DEFAULT_WEAPON_DATA = JSON.parse(JSON.stringify(WEAPON_DATA));

// 右键菜单可添加的节点类型
const CONTEXT_NODES = [
  { type: 'output', label: '输出节点' },
  { type: 'input-node', label: '输入节点' },
  { type: 'distance', label: '距离节点' },
  { type: 'attack', label: '攻击节点' },
  { type: 'vuln', label: '增伤节点' },
];

// ========== 右键上下文菜单 ==========
function showContextMenu(sx, sy) {
  const menu = dom.contextMenu;
  if (!menu) return;
  menu.innerHTML =
    `<div class="context-menu-title">添加节点</div>` +
    CONTEXT_NODES.map(n =>
      `<div class="context-menu-item" data-type="${n.type}">${n.label}</div>`
    ).join('');
  menu.style.display = 'block';
  // 定位（避免超出视口）
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = sx;
  let top = sy;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if (top + mh > window.innerHeight - 8) top = window.innerHeight - mh - 8;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  // 记录触发位置，用于在该处创建节点
  menu.dataset.x = sx;
  menu.dataset.y = sy;
  menu.dataset.conn = '';
}

function hideContextMenu() {
  if (dom.contextMenu) {
    dom.contextMenu.style.display = 'none';
    dom.contextMenu.dataset.conn = '';
  }
}

// 连线右键菜单：可断开连接
function showWireMenu(sx, sy, connId) {
  const menu = dom.contextMenu;
  if (!menu) return;
  menu.innerHTML =
    `<div class="context-menu-title">连线操作</div>` +
    `<div class="context-menu-item wire-item" data-action="disconnect" data-conn="${connId}">断开连接</div>`;
  menu.style.display = 'block';
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = sx;
  let top = sy;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if (top + mh > window.innerHeight - 8) top = window.innerHeight - mh - 8;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.dataset.conn = connId;
}

// ========== 工具函数 ==========

function screenToCanvas(sx, sy) {
  const rect = dom.canvasArea.getBoundingClientRect();
  return {
    x: (sx - rect.left - state.pan.x) / state.zoom,
    y: (sy - rect.top - state.pan.y) / state.zoom,
  };
}

function genNodeId() {
  return `node-${++state.nodeIdCounter}`;
}

function genConnId() {
  return `conn-${++state.connIdCounter}`;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ========== 画布变换 ==========

function updateTransform() {
  dom.nodesLayer.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  // SVG也需要同样的变换
  const svgTranslate = `translate(${state.pan.x}, ${state.pan.y}) scale(${state.zoom})`;
  dom.connectionsGroup.setAttribute('transform', svgTranslate);
  dom.tempConnection.setAttribute('transform', svgTranslate);
  // 网格背景跟随平移
  const gridSize = 24 * state.zoom;
  dom.gridBg.style.backgroundSize = `${gridSize}px ${gridSize}px`;
  dom.gridBg.style.backgroundPosition = `${state.pan.x}px ${state.pan.y}px`;
  // 更新缩放显示
  dom.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
  // 更新连线位置
  updateAllConnections();
}

function setZoom(newZoom, centerX, centerY) {
  newZoom = clamp(newZoom, 0.3, 2.5);
  const rect = dom.canvasArea.getBoundingClientRect();
  if (centerX !== undefined && centerY !== undefined) {
    // 保持鼠标位置不变
    const mx = centerX - rect.left;
    const my = centerY - rect.top;
    const ratio = newZoom / state.zoom;
    state.pan.x = mx - (mx - state.pan.x) * ratio;
    state.pan.y = my - (my - state.pan.y) * ratio;
  }
  state.zoom = newZoom;
  updateTransform();
}

// ========== 节点创建 ==========

function createNode(type, x, y, weaponData = null) {
  const id = genNodeId();
  const node = {
    id,
    type,
    x: x !== undefined ? x : 400,
    y: y !== undefined ? y : 300,
    weaponData: weaponData,
  };

  // 根据类型设置默认武器数据
  if (type === 'weapon-input' && !weaponData) {
    const first = getFirstWeapon('主武器');
    if (first) {
      node.weaponData = first.data;
      node.weaponCategory = '主武器';
      node.weaponSubCategory = first.sub;
    }
  } else if (type === 'distance') {
    node.distance = 10; // 默认当前距离 10 米
    node.attenDist = 30; // 默认衰减距离 30 米
    node.attenPct = 0; // 默认衰减百分比伤害 0%
  } else if (type === 'attack') {
    node.power = 0; // 攻击力加成，默认 0%（无加成），最高 1500%
  } else if (type === 'input-node') {
    node.value = 0; // 手动输入的数值（作为自定义伤害来源）
  } else if (type === 'vuln') {
    node.arcEnabled = false;  // 电弧易伤：敌人受到的伤害提升 5%（开关，默认关）
    node.weakPct = 0;         // 弱点易伤：敌人受到的伤害提升 %（滑块 0%~100%，默认 0%）
  } else if (type === 'output') {
    // 输出节点无需武器数据
  }

  state.nodes.set(id, node);
  renderNode(node);
  updateCanvasHint();
  updateStatus();
  scheduleSave();
  return node;
}

function createWeaponNode(tab, subCategory, weaponData, x, y) {
  let type = 'weapon-input';
  if (tab === '副武器') type = 'secondary-weapon';
  else if (tab === '近战武器') type = 'melee-weapon';
  else if (tab === '插件') type = 'plugin';

  const id = genNodeId();
  const node = {
    id,
    type,
    x: x !== undefined ? x : 300 + Math.random() * 200,
    y: y !== undefined ? y : 200 + Math.random() * 200,
    weaponData: weaponData,
    weaponCategory: tab,
    weaponSubCategory: subCategory,
  };

  state.nodes.set(id, node);
  renderNode(node);
  updateCanvasHint();
  updateStatus();
  recalculate();
  scheduleSave();
  return node;
}

// ========== 节点渲染 ==========

function renderNode(node) {
  const el = document.createElement('div');
  el.className = 'node';
  el.dataset.id = node.id;
  el.dataset.type = node.type;
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;

  const typeInfo = NODE_TYPES[node.type];

  let bodyHtml = '';
  let dpsHtml = '';

  if (node.type === 'weapon-input' && node.weaponData) {
    const w = node.weaponData;
    const dmgText = (w.pellets && w.pellets > 1) ? `${w.damage} × ${w.pellets}` : `${w.damage}`;
    // 属性徽章已在顶部显示，下方不再重复「属性」行，保留其他数值
    bodyHtml = `
      <div class="node-row"><span class="label">单发伤害</span><span class="value">${dmgText}</span></div>
      <div class="node-row"><span class="label">射速</span><span class="value">${w.fireRate}</span></div>
      <div class="node-row"><span class="label">换弹时间</span><span class="value">${w.reloadTime ?? 0}s</span></div>
      <div class="node-row"><span class="label">弹夹</span><span class="value">${w.magazine ?? 0}</span></div>
      <div class="node-row"><span class="label">总弹量</span><span class="value">${w.totalAmmo ?? 0}</span></div>
      <div class="node-row"><span class="label">爆炸范围</span><span class="value">${w.explosionRange ?? 0}</span></div>
      <div class="node-row"><span class="label">精准度</span><span class="value">${w.accuracy ?? 0}%</span></div>
      <div class="node-row"><span class="label">稳定度</span><span class="value">${w.stability ?? 0}%</span></div>
    `;
  } else if (node.type === 'plugin' && node.weaponData) {
    const p = node.weaponData;
    // 新格式：结构化属性显示
    let attrDisplay = '';
    let toggleHtml = '';
    if (p.attrType) {
      const typeDef = getPluginAttrType(p.attrType);
      const maxStacks = p.maxStacks != null ? p.maxStacks : 1;
      const stacks = node.stacks != null ? node.stacks : maxStacks;
      const totalVal = p.attrValue * stacks;
      let label = typeDef ? `${typeDef.label} +${totalVal}%` : p.attrType;
      attrDisplay = `<span class="value bonus" id="attr-label-${node.id}">${label}</span>`;
      // 交互式独立乘区开关
      const ind = p.independent ? 'checked' : '';
      toggleHtml = `
        <div class="plugin-toggle-row">
          <span class="label">独立乘区</span>
          <label class="plugin-switch">
            <input type="checkbox" id="ind-${node.id}" ${ind} />
            <span class="plugin-switch-track"></span>
          </label>
        </div>
      `;
      // 层数滑块（maxStacks > 1 时显示）
      if (maxStacks > 1) {
        toggleHtml += `
          <div class="node-row slider-row stack-slider-row">
            <span class="label">层数</span>
            <span class="slider-value" id="stack-val-${node.id}">${stacks}层</span>
          </div>
          <input type="range" class="node-slider stack-slider" id="stack-input-${node.id}" min="1" max="${maxStacks}" step="1" value="${stacks}" />
          <div class="node-row" style="margin-top:-4px;">
            <span class="label" style="font-size:11px;color:var(--text-muted);">合计 ${typeDef ? typeDef.label : p.attrType} +${totalVal}%</span>
          </div>
        `;
      }
    } else if (p.attribute) {
      // 旧格式兼容
      attrDisplay = `<span class="value bonus">${p.attribute}</span>`;
    }
    bodyHtml = `
      <div class="node-row"><span class="label">属性</span>${attrDisplay}</div>
      ${toggleHtml}
      ${p.detail ? `<div class="node-row" style="margin-top:4px;"><span class="label" style="font-size:11px;color:var(--text-muted);line-height:1.4;">${p.detail}</span></div>` : ''}
    `;
  } else if (node.type === 'secondary-weapon' && node.weaponData) {
    const w = node.weaponData;
    const effLines = secondaryEffectLines(w);
    // 已连入上游（如主武器）：作为配件，只显示特效
    const hasInput = Array.from(state.connections.values()).some(c => c.to === node.id);
    let innerHtml;
    if (hasInput) {
      innerHtml = effLines.length > 0
        ? effLines.map(e => `<div class="node-row"><span class="label" style="font-size:11px;color:var(--bonus);">· ${e}</span></div>`).join('')
        : `<div class="node-row"><span class="label" style="font-size:11px;color:var(--text-muted);">仅提供特效加成</span></div>`;
    } else {
      // 独立武器：展示自身属性 + 特效
      const dmgText = (w.pellets && w.pellets > 1) ? `${w.damage} × ${w.pellets}` : `${w.damage}`;
      innerHtml = `
        <div class="node-row"><span class="label">单发伤害</span><span class="value">${dmgText}</span></div>
        <div class="node-row"><span class="label">射速</span><span class="value">${w.fireRate}</span></div>
        <div class="node-row"><span class="label">换弹时间</span><span class="value">${w.reloadTime ?? 0}s</span></div>
        <div class="node-row"><span class="label">弹夹</span><span class="value">${w.magazine ?? 0}</span></div>
        <div class="node-row"><span class="label">总弹量</span><span class="value">${w.totalAmmo ?? 0}</span></div>
        <div class="node-row"><span class="label">爆炸范围</span><span class="value">${w.explosionRange ?? 0}</span></div>
        <div class="node-row"><span class="label">精准度</span><span class="value">${w.accuracy ?? 0}%</span></div>
        <div class="node-row"><span class="label">稳定度</span><span class="value">${w.stability ?? 0}%</span></div>
        ${effLines.map(e => `<div class="node-row"><span class="label" style="font-size:11px;color:var(--bonus);">· ${e}</span></div>`).join('')}
      `;
    }
    bodyHtml = innerHtml;
    dpsHtml = '';
  } else if (node.type === 'melee-weapon' && node.weaponData) {
    const w = node.weaponData;
    // 武器名/属性已在顶部标题与徽章展示，下方只保留伤害与特效
    const effLines = meleeEffectLines(w);
    bodyHtml = `
      <div class="node-row"><span class="label">轻击伤害</span><span class="value">${w.lightDamage ?? 0}</span></div>
      <div class="node-row"><span class="label">重击伤害</span><span class="value">${w.heavyDamage ?? 0}</span></div>
      ${effLines.map(e => `<div class="node-row"><span class="label" style="font-size:11px;color:var(--bonus);">· ${e}</span></div>`).join('')}
    `;
  } else if (node.type === 'distance') {
    const dVal = node.distance != null ? node.distance : 10;
    const aDist = node.attenDist != null ? node.attenDist : 30;
    const aPct = node.attenPct != null ? node.attenPct : 0;
    bodyHtml = `
      <div class="node-row slider-row">
        <span class="label">距离</span>
        <span class="slider-value" id="dist-val-${node.id}">${dVal}m</span>
      </div>
      <input type="range" class="node-slider distance-slider" id="dist-input-${node.id}" min="0" max="50" step="0.5" value="${dVal}" />
      <div class="node-row slider-row atten-row">
        <span class="label">衰减距离</span>
        <span class="slider-value" id="atten-dist-val-${node.id}">${aDist}m</span>
      </div>
      <input type="range" class="node-slider atten-dist-slider" id="atten-dist-input-${node.id}" min="0" max="50" step="0.5" value="${aDist}" />
      <div class="node-row slider-row atten-row">
        <span class="label">衰减百分比伤害</span>
        <span class="slider-value" id="atten-pct-val-${node.id}">${aPct}%</span>
      </div>
      <input type="range" class="node-slider atten-pct-slider" id="atten-pct-input-${node.id}" min="0" max="100" step="1" value="${aPct}" />
    `;
    dpsHtml = '';
  } else if (node.type === 'output') {
    bodyHtml = `
      <div class="node-row"><span class="label">等待输入...</span></div>
    `;
    dpsHtml = `
      <div class="node-dps">
        <span class="dps-label">5秒伤害</span>
        <span class="dps-value" id="output-dps-${node.id}">--</span>
      </div>
    `;
  } else if (node.type === 'attack') {
    const aVal = node.power != null ? node.power : 0;
    bodyHtml = `
      <div class="node-row slider-row">
        <span class="label">攻击</span>
        <span class="slider-value" id="atk-val-${node.id}">+${aVal}%</span>
      </div>
      <input type="range" class="node-slider attack-slider" id="atk-input-${node.id}" min="0" max="1500" step="100" value="${aVal}" />
    `;
    dpsHtml = '';
  } else if (node.type === 'input-node') {
    const v = node.value != null ? node.value : 0;
    bodyHtml = `
      <div class="node-row"><span class="label">数值</span></div>
      <input type="number" class="node-number-input" id="val-input-${node.id}" value="${v}" min="0" step="1" />
    `;
    dpsHtml = '';
  } else if (node.type === 'vuln') {
    const arc = node.arcEnabled !== false;      // 默认开启
    const weak = node.weakPct != null ? node.weakPct : 0;
    bodyHtml = `
      <div class="vuln-row">
        <span class="label">电弧易伤 (5%)</span>
        <label class="vuln-switch">
          <input type="checkbox" id="arc-${node.id}" ${arc ? 'checked' : ''} />
          <span class="vuln-switch-track"></span>
        </label>
      </div>
      <div class="node-row slider-row vuln-slider-row">
        <span class="label">弱点易伤</span>
        <span class="slider-value" id="weak-val-${node.id}">${weak}%</span>
      </div>
      <input type="range" class="node-slider weak-slider" id="weak-input-${node.id}" min="0" max="200" step="10" value="${weak}" />
    `;
    dpsHtml = '';
  }

  // 端口（输入节点的输出端口由 portsHtml 统一生成，样式控制其下移到输入框高度）
  let portsHtml = '';
  if (typeInfo.inputs > 0) {
    const inCls = node.type === 'vuln' ? 'input-port vuln-hidden-input' : 'input-port';
    portsHtml += `<div class="port ${inCls}" data-port="input" data-node="${node.id}"></div>`;
  }
  if (typeInfo.outputs > 0) {
    const extra = node.type === 'input-node' ? 'input-node-output' : '';
    portsHtml += `<div class="port output-port ${extra}" data-port="output" data-node="${node.id}"></div>`;
  }

  // 武器 / 近战 / 插件图片横幅：按原尺寸显示（不缩放）
  // 插件图案缩小到 40%
  const isPluginBanner = node.type === 'plugin' && node.weaponData && node.weaponData.image;
  const bannerHtml = (node.weaponData && node.weaponData.image)
    ? `<div class="node-banner${isPluginBanner ? ' plugin-banner' : ''}"><img src="${node.weaponData.image}" alt="${getNodeTitle(node)}" draggable="false" /></div>`
    : '';

  // 属性徽章（武器/近战显示元素属性，插件显示分类）
  let attrHtml = '';
  if (node.weaponData && node.weaponData.attribute) {
    attrHtml = attrBadge(node.weaponData.attribute);
  } else if (node.type === 'plugin' && node.weaponData && node.weaponData.category) {
    attrHtml = `<span class="attr-badge plugin-cat">${node.weaponData.category}号插件</span>`;
  } else if (node.type === 'distance') {
    attrHtml = '';
  }


  el.innerHTML = `
    ${bannerHtml}
    <div class="node-header">
      ${portsHtml}
      <span class="node-title">${getNodeTitle(node)}</span>
      ${attrHtml}
    </div>
    <div class="node-body">
      ${bodyHtml}
      ${dpsHtml}
    </div>
    <span class="node-delete" data-action="delete-node" data-id="${node.id}">✕</span>
  `;

  dom.nodesLayer.appendChild(el);
  attachNodeEvents(el, node);

  // 插件图案缩小到 20% 原尺寸
  if (isPluginBanner) {
    const bimg = el.querySelector('.node-banner img');
    if (bimg) {
      const scalePluginImg = () => {
        if (bimg.naturalWidth) bimg.style.width = (bimg.naturalWidth * 0.20) + 'px';
      };
      if (bimg.complete && bimg.naturalWidth) {
        scalePluginImg();
      } else {
        bimg.addEventListener('load', scalePluginImg);
      }
    }
  }

  // 距离节点：实时编辑距离
  const distInput = el.querySelector(`#dist-input-${node.id}`);
  if (distInput) {
    distInput.addEventListener('input', (e) => {
      e.stopPropagation();
      const v = parseFloat(e.target.value);
      node.distance = isNaN(v) ? 0 : v;
      const valEl = document.getElementById(`dist-val-${node.id}`);
      if (valEl) valEl.textContent = `${node.distance}m`;
      recalculate();
      scheduleSave();
    });
    distInput.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // 距离节点：实时编辑衰减距离
  const attenDistInput = el.querySelector(`#atten-dist-input-${node.id}`);
  if (attenDistInput) {
    attenDistInput.addEventListener('input', (e) => {
      e.stopPropagation();
      const v = parseFloat(e.target.value);
      node.attenDist = isNaN(v) ? 0 : v;
      const valEl = document.getElementById(`atten-dist-val-${node.id}`);
      if (valEl) valEl.textContent = `${node.attenDist}m`;
      recalculate();
      scheduleSave();
    });
    attenDistInput.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // 距离节点：实时编辑衰减百分比伤害
  const attenPctInput = el.querySelector(`#atten-pct-input-${node.id}`);
  if (attenPctInput) {
    attenPctInput.addEventListener('input', (e) => {
      e.stopPropagation();
      let v = parseFloat(e.target.value);
      if (isNaN(v)) v = 0;
      v = clamp(v, 0, 100);
      node.attenPct = v;
      const valEl = document.getElementById(`atten-pct-val-${node.id}`);
      if (valEl) valEl.textContent = `${v}%`;
      recalculate();
      scheduleSave();
    });
    attenPctInput.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // 攻击力节点：实时编辑攻击力（0% ~ 1500%，整数滑动）
  const atkInput = el.querySelector(`#atk-input-${node.id}`);
  if (atkInput) {
    atkInput.addEventListener('input', (e) => {
      e.stopPropagation();
      let v = parseInt(e.target.value, 10);
      if (isNaN(v)) v = 0;
      v = clamp(v, 0, 1500);
      node.power = v;
      const valEl = document.getElementById(`atk-val-${node.id}`);
      if (valEl) valEl.textContent = `+${v}%`;
      recalculate();
      scheduleSave();
    });
    atkInput.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // 数值输入节点：实时编辑手动输入的数值
  const valInput = el.querySelector(`#val-input-${node.id}`);
  if (valInput) {
    const onValueInput = (e) => {
      e.stopPropagation();
      let v = parseInt(e.target.value, 10);
      if (isNaN(v)) v = 0;
      if (v < 0) v = 0;
      node.value = v;
      recalculate();
      scheduleSave();
    };
    valInput.addEventListener('input', onValueInput);
    valInput.addEventListener('change', onValueInput);
    valInput.addEventListener('mousedown', (e) => e.stopPropagation());
    valInput.addEventListener('keydown', (e) => e.stopPropagation());
  }

  // 增伤节点：电弧易伤开关
  const arcInput = el.querySelector(`#arc-${node.id}`);
  if (arcInput) {
    arcInput.addEventListener('change', (e) => {
      e.stopPropagation();
      node.arcEnabled = e.target.checked;
      recalculate();
      scheduleSave();
    });
    arcInput.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // 插件节点：独立乘区开关
  const indInput = el.querySelector(`#ind-${node.id}`);
  if (indInput) {
    indInput.addEventListener('change', (e) => {
      e.stopPropagation();
      node.weaponData.independent = e.target.checked;
      recalculate();
      scheduleSave();
    });
    indInput.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // 插件节点：层数滑块
  const stackInput = el.querySelector(`#stack-input-${node.id}`);
  if (stackInput) {
    stackInput.addEventListener('input', (e) => {
      e.stopPropagation();
      let v = parseInt(e.target.value, 10);
      if (isNaN(v)) v = 1;
      const max = node.weaponData.maxStacks || 1;
      v = Math.max(1, Math.min(v, max));
      node.stacks = v;
      // 更新层数文字
      const valEl = document.getElementById(`stack-val-${node.id}`);
      if (valEl) valEl.textContent = `${v}层`;
      // 更新属性标签（实时显示合计倍率）
      const p = node.weaponData;
      const typeDef = getPluginAttrType(p.attrType);
      const totalVal = p.attrValue * v;
      const newLabel = typeDef ? `${typeDef.label} +${totalVal}%` : p.attrType;
      const attrLabel = document.getElementById(`attr-label-${node.id}`);
      if (attrLabel) attrLabel.textContent = newLabel;
      recalculate();
      scheduleSave();
    });
    stackInput.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // 增伤节点：弱点易伤滑块（20% ~ 100%）
  const weakInput = el.querySelector(`#weak-input-${node.id}`);
  if (weakInput) {
    weakInput.addEventListener('input', (e) => {
      e.stopPropagation();
      let v = parseInt(e.target.value, 10);
      if (isNaN(v)) v = 20;
      v = clamp(v, 0, 200);
      node.weakPct = v;
      const valEl = document.getElementById(`weak-val-${node.id}`);
      if (valEl) valEl.textContent = `${v}%`;
      recalculate();
      scheduleSave();
    });
    weakInput.addEventListener('mousedown', (e) => e.stopPropagation());
  }
}

function getNodeTitle(node) {
  if (node.weaponData) return node.weaponData.name;
  if (node.type === 'output') return '输出节点';
  if (node.type === 'distance') return '距离节点';
  if (node.type === 'attack') return '攻击节点';
  if (node.type === 'input-node') return '输入节点';
  if (node.type === 'vuln') return '增伤节点';
  if (node.type === 'weapon-input') return '武器类型';
  return NODE_TYPES[node.type]?.label || '节点';
}

function getAttributeInfo(attr) {
  return ATTRIBUTES[attr] || ATTRIBUTES['物理'];
}

// 图标映射（ass/UI 下由用户添加的 UI 图标）
const WEAPON_TYPE_ICONS = {
  '冲锋枪': 'ass/UI/冲锋枪.png',
  '单发榴弹': 'ass/UI/单发榴弹.png',
  '喷射器': 'ass/UI/喷射器.png',
  '射手步枪': 'ass/UI/射手步枪.png',
  '弓箭': 'ass/UI/弓箭.png',
  '手枪': 'ass/UI/手枪.png',
  '暗器': 'ass/UI/暗器.png',
  '机枪': 'ass/UI/机枪.png',
  '激光武器': 'ass/UI/激光武器.png',
  '火箭发射器': 'ass/UI/火箭发射器.png',
  '狙击步枪': 'ass/UI/狙击步枪.png',
  '突击步枪': 'ass/UI/突击步枪.png',
  '连发榴弹': 'ass/UI/连发榴弹.png',
  '霰弹枪': 'ass/UI/霰弹枪.png'
};
const ELEMENT_ICONS = {
  '电弧': 'ass/UI/电弧.webp',
  '物理': 'ass/UI/物理.webp',
  '火焰': 'ass/UI/火焰.webp',
  '腐蚀': 'ass/UI/腐蚀.webp',
  '寒冷': 'ass/UI/寒冷.webp'
};

function attrBadge(attr) {
  const info = getAttributeInfo(attr);
  const ic = ELEMENT_ICONS[attr];
  const iconHtml = ic ? `<img class="attr-icon" src="${ic}" alt="${attr}" />` : '';
  return `<span class="attr-badge" style="background:${info.color}22;color:${info.color};border-color:${info.color}66;" title="${info.desc}">${iconHtml}${attr}</span>`;
}

function cardAttrBadge(attr) {
  const info = getAttributeInfo(attr);
  const ic = ELEMENT_ICONS[attr];
  const iconHtml = ic ? `<img class="attr-icon" src="${ic}" alt="${attr}" />` : '';
  return `<span class="attr-badge card-attr-badge" style="color:${info.color};" title="${info.desc}">${attr}${iconHtml}</span>`;
}

function getTargetLabel(target) {
  const labels = {
    damage: '单发伤害',
    fireRate: '射速',
    reloadTime: '换弹时间',
    magazine: '弹夹',
    totalAmmo: '总弹量',
    explosionRange: '爆炸范围',
    accuracy: '精准度',
    stability: '稳定度',
  };
  return labels[target] || target;
}

// ========== 节点事件 ==========

function attachNodeEvents(el, node) {
  // 拖拽节点：整个节点都可拖动，但排除端口、删除按钮和可交互表单元素
  el.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('port') || e.target.classList.contains('node-delete')) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    e.stopPropagation();
    selectNode(node.id);
    // 清除上一次可能残留的连线高亮
    if (state.wireDropTarget) {
      const oldPath = dom.connectionsGroup.querySelector(`[data-id="${state.wireDropTarget.id}"]`);
      if (oldPath) oldPath.classList.remove('wire-highlight');
      state.wireDropTarget = null;
    }
    state.draggingNode = node;
    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    state.draggingOffset = {
      x: canvasPos.x - node.x,
      y: canvasPos.y - node.y,
    };
  });

  // 删除按钮
  const delBtn = el.querySelector('[data-action="delete-node"]');
  if (delBtn) {
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNode(node.id);
    });
  }

  // 端口事件
  const ports = el.querySelectorAll('.port');
  ports.forEach(port => {
    port.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const portType = port.dataset.port;
      const nodeId = port.dataset.node;

      if (portType === 'output') {
        // 从输出端口开始连线
        state.connecting = true;
        state.connectStart = { nodeId, portEl: port };
        const rect = port.getBoundingClientRect();
        const canvasPos = screenToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
        state.connectStart.x = canvasPos.x;
        state.connectStart.y = canvasPos.y;
        state.connectMouse = { ...canvasPos };
      } else if (portType === 'input') {
        // 如果正在连线，尝试连接到这个输入端口
        if (state.connecting && state.connectStart) {
          tryConnect(state.connectStart.nodeId, nodeId);
          cancelConnect();
        }
      }
    });
  });

  // 点击选中
  // 合并到上方节点 mousedown 中处理
}

// ========== 节点操作 ==========

function selectNode(id) {
  // 取消之前的选中
  if (state.selectedNode) {
    const prevEl = dom.nodesLayer.querySelector(`[data-id="${state.selectedNode}"]`);
    if (prevEl) prevEl.classList.remove('selected');
  }
  state.selectedNode = id;
  const el = dom.nodesLayer.querySelector(`[data-id="${id}"]`);
  if (el) el.classList.add('selected');
}

function deleteNode(id) {
  const node = state.nodes.get(id);
  if (!node) return;

  // 删除关联的连线
  const connsToDelete = [];
  state.connections.forEach((conn, cid) => {
    if (conn.from === id || conn.to === id) {
      connsToDelete.push(cid);
    }
  });
  connsToDelete.forEach(cid => deleteConnection(cid));

  // 删除节点DOM
  const el = dom.nodesLayer.querySelector(`[data-id="${id}"]`);
  if (el) el.remove();

  state.nodes.delete(id);
  if (state.selectedNode === id) state.selectedNode = null;

  updateCanvasHint();
  updateStatus();
  recalculate();
}

// ========== 连线操作 ==========

function tryConnect(fromNodeId, toNodeId) {
  // 不能连自己
  if (fromNodeId === toNodeId) return;

  // 检查是否会形成环
  if (wouldCreateCycle(fromNodeId, toNodeId)) {
    return;
  }

  // 允许同一节点接收多条输入（如增伤节点与武器节点并连到攻击节点），不删除已有连线
  // 检查是否已存在相同的连线
  const duplicate = Array.from(state.connections.values()).find(
    c => c.from === fromNodeId && c.to === toNodeId
  );
  if (duplicate) return;

  const conn = {
    id: genConnId(),
    from: fromNodeId,
    to: toNodeId,
  };

  state.connections.set(conn.id, conn);
  renderConnection(conn);
  updatePortStates();
  updateStatus();
  recalculate();
  scheduleSave();
}

// 拖拽节点时，检测节点中心是否落在某条连线上（用于松手自动插入）
function getWireDropTarget(node) {
  const typeInfo = NODE_TYPES[node.type];
  if (!typeInfo || typeInfo.inputs === 0 || typeInfo.outputs === 0) return null;
  const el = dom.nodesLayer.querySelector(`[data-id="${node.id}"]`);
  if (!el) return null;
  const w = el.offsetWidth, h = el.offsetHeight;
  const cx = node.x + w / 2, cy = node.y + h / 2;
  const threshold = 24; // 画布坐标系下的命中阈值（px）
  let best = null, bestDist = Infinity;
  state.connections.forEach(conn => {
    if (conn.from === node.id || conn.to === node.id) return;
    const path = dom.connectionsGroup.querySelector(`[data-id="${conn.id}"]`);
    if (!path || typeof path.getTotalLength !== 'function') return;
    let total = 0;
    try { total = path.getTotalLength(); } catch (e) { return; }
    if (!total) return;
    const steps = Math.max(12, Math.floor(total / 6));
    for (let i = 0; i <= steps; i++) {
      const p = path.getPointAtLength((i / steps) * total);
      const dx = p.x - cx, dy = p.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) { bestDist = dist; best = conn; }
    }
  });
  return bestDist <= threshold ? best : null;
}

// 将节点插入到一条连线的中间：A → B 变为 A → node → B
function insertNodeIntoWire(node, conn) {
  if (!conn) return;
  if (node.id === conn.from || node.id === conn.to) return;
  const typeInfo = NODE_TYPES[node.type];
  if (!typeInfo || typeInfo.inputs === 0 || typeInfo.outputs === 0) return;

  const from = conn.from, to = conn.to;
  // 删除原连线
  deleteConnection(conn.id);
  // 建立 A→node 与 node→B
  tryConnect(from, node.id);
  tryConnect(node.id, to);

  // 回滚保护：若两段未能同时建立（如被环检测拦截），恢复原连线
  const hasFrom = Array.from(state.connections.values()).some(c => c.from === from && c.to === node.id);
  const hasTo = Array.from(state.connections.values()).some(c => c.from === node.id && c.to === to);
  if (!hasFrom || !hasTo) {
    state.connections.forEach((c, cid) => {
      if ((c.from === from && c.to === node.id) || (c.from === node.id && c.to === to)) deleteConnection(cid);
    });
    const restored = { id: conn.id, from, to };
    state.connections.set(restored.id, restored);
    renderConnection(restored);
    updatePortStates();
    updateStatus();
    recalculate();
  }
}

function wouldCreateCycle(from, to) {
  // 从to出发，如果能到达from，则形成环
  const visited = new Set();
  const queue = [to];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === from) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    state.connections.forEach(conn => {
      if (conn.from === current) queue.push(conn.to);
    });
  }
  return false;
}

function renderConnection(conn) {
  const fromNode = state.nodes.get(conn.from);
  const toNode = state.nodes.get(conn.to);
  if (!fromNode || !toNode) return;

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('class', 'connection-path');
  path.setAttribute('data-id', conn.id);
  path.addEventListener('click', (e) => {
    e.stopPropagation();
    selectConnection(conn.id);
  });
  path.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showWireMenu(e.clientX, e.clientY, conn.id);
  });
  dom.connectionsGroup.appendChild(path);

  // 叠加一条流动光路径（传输动画），不拦截点击
  const flow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  flow.setAttribute('class', 'connection-flow');
  flow.setAttribute('data-flow', conn.id);
  dom.connectionsGroup.appendChild(flow);

  updateConnectionPath(conn);
}

function updateConnectionPath(conn) {
  const fromNode = state.nodes.get(conn.from);
  const toNode = state.nodes.get(conn.to);
  if (!fromNode || !toNode) return;

  const path = dom.connectionsGroup.querySelector(`.connection-path[data-id="${conn.id}"]`);
  if (!path) return;
  const flow = dom.connectionsGroup.querySelector(`.connection-flow[data-flow="${conn.id}"]`);

  // 获取端口实际位置
  const fromEl = dom.nodesLayer.querySelector(`[data-id="${conn.from}"]`);
  const toEl = dom.nodesLayer.querySelector(`[data-id="${conn.to}"]`);
  if (!fromEl || !toEl) return;

  const fromPort = fromEl.querySelector('.output-port');
  const toPort = toEl.querySelector('.input-port');
  if (!fromPort || !toPort) return;

  const fromRect = fromPort.getBoundingClientRect();
  const toRect = toPort.getBoundingClientRect();
  const p1 = screenToCanvas(fromRect.left + fromRect.width / 2, fromRect.top + fromRect.height / 2);
  const p2 = screenToCanvas(toRect.left + toRect.width / 2, toRect.top + toRect.height / 2);

  const dx = Math.max(50, Math.abs(p2.x - p1.x) * 0.5);
  const d = `M ${p1.x},${p1.y} C ${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}`;
  path.setAttribute('d', d);
  if (flow) flow.setAttribute('d', d);
}

function updateAllConnections() {
  state.connections.forEach(conn => updateConnectionPath(conn));
  if (state.connecting) {
    updateTempConnection();
  }
}

function deleteConnection(id) {
  const path = dom.connectionsGroup.querySelector(`[data-id="${id}"]`);
  if (path) path.remove();
  const flow = dom.connectionsGroup.querySelector(`[data-flow="${id}"]`);
  if (flow) flow.remove();
  state.connections.delete(id);
  if (state.selectedConnection === id) state.selectedConnection = null;
  updatePortStates();
  updateStatus();
  recalculate();
  scheduleSave();
}

function selectConnection(id) {
  // 取消之前的选中
  if (state.selectedConnection) {
    const prevPath = dom.connectionsGroup.querySelector(`[data-id="${state.selectedConnection}"]`);
    if (prevPath) prevPath.classList.remove('selected');
  }
  // 取消节点选中
  if (state.selectedNode) {
    const prevEl = dom.nodesLayer.querySelector(`[data-id="${state.selectedNode}"]`);
    if (prevEl) prevEl.classList.remove('selected');
    state.selectedNode = null;
  }
  state.selectedConnection = id;
  const path = dom.connectionsGroup.querySelector(`[data-id="${id}"]`);
  if (path) path.classList.add('selected');
}

function cancelConnect() {
  state.connecting = false;
  state.connectStart = null;
  dom.tempConnection.setAttribute('d', '');
}

function updateTempConnection() {
  if (!state.connecting || !state.connectStart) return;
  const { x: x1, y: y1 } = state.connectStart;
  const { x: x2, y: y2 } = state.connectMouse;
  const dx = Math.max(50, Math.abs(x2 - x1) * 0.5);
  const d = `M ${x1},${y1} C ${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  dom.tempConnection.setAttribute('d', d);
}

function updatePortStates() {
  // 清除所有端口的connected状态
  document.querySelectorAll('.port').forEach(p => p.classList.remove('connected'));

  // 标记已连接的端口
  state.connections.forEach(conn => {
    const fromPort = dom.nodesLayer.querySelector(
      `[data-id="${conn.from}"] .output-port`
    );
    const toPort = dom.nodesLayer.querySelector(
      `[data-id="${conn.to}"] .input-port`
    );
    if (fromPort) fromPort.classList.add('connected');
    if (toPort) toPort.classList.add('connected');
  });
}

// ========== DPS 计算 ==========

function calcDPS(stats) {
  if (!stats) return 0;
  const pellets = stats.pellets || 1;
  // 单发总伤害 = 单发伤害 × 弹丸数（霰弹枪等多弹丸武器必须计入）
  const damage = (stats.damage || 0) * pellets;
  const fireRate = stats.fireRate || 0;        // 射速：发/分钟（RPM）
  const magazine = stats.magazine || 0;
  const reloadTime = stats.reloadTime || 0;
  const accuracy = stats.accuracy || 0;
  const stability = stats.stability || 0;
  const explosionRange = stats.explosionRange || 0;

  // 基础校验：无伤害/无射速/无弹夹则伤害为 0
  if (damage <= 0 || fireRate <= 0 || magazine <= 0) return 0;

  // 5 秒窗口内的射击伤害（含换弹限制）
  const timeToEmpty = (magazine / fireRate) * 60;   // 打空一弹夹所需秒数
  let shotsIn5s;
  if (timeToEmpty >= 5) {
    // 5 秒内打不完一弹夹：受射速限制，且不超过弹夹容量
    shotsIn5s = Math.min((fireRate / 60) * 5, magazine);
  } else {
    // 能打空至少一弹夹
    let shots = magazine;
    let remaining = 5 - timeToEmpty;
    if (reloadTime > 0 && remaining > reloadTime) {
      remaining -= reloadTime;
      shots += Math.min(magazine, (fireRate / 60) * remaining);
    }
    // 剩余时间不足以换弹时，仅第一弹夹的 magazine 发
    shotsIn5s = shots;
  }

  // 精准度 0~100，按命中比例折算；稳定度/爆炸范围提供小幅增伤
  const accuracyMult = clamp(accuracy / 100, 0, 1);
  const stabilityMult = 1 + (stability / 200);
  const explosionMult = 1 + (explosionRange / 200);

  const dmg5s = damage * shotsIn5s * accuracyMult * stabilityMult * explosionMult;
  return Math.max(0, Math.round(dmg5s));
}

function recalculate() {
  // 找到所有输出节点（最终 DPS）
  const outputNodes = Array.from(state.nodes.values()).filter(
    n => n.type === 'output'
  );

  if (outputNodes.length === 0) {
    dom.finalDps.textContent = '--';
    return;
  }

  let maxDps = 0;

  outputNodes.forEach(outputNode => {
    const result = computeNode(outputNode.id, new Set());

    const dpsEl = document.getElementById(`output-dps-${outputNode.id}`);
    if (dpsEl) {
      const dps = result ? calcDPS(result) : 0;
      dpsEl.textContent = dps > 0 ? dps : '--';
      if (dps > maxDps) maxDps = dps;
    }

    // 更新输出节点的详细显示
    updateOutputNodeDetails(outputNode, result);
  });

  dom.finalDps.textContent = maxDps > 0 ? maxDps : '--';
}

function updateOutputNodeDetails(outputNode, result) {
  const body = dom.nodesLayer.querySelector(`[data-id="${outputNode.id}"] .node-body`);
  if (!body) return;
  if (!result) {
    body.innerHTML = `
      <div class="node-row"><span class="label">属性</span><span class="value">--</span></div>
      <div class="node-row"><span class="label">距离</span><span class="value">--</span></div>
      <div class="node-row"><span class="label">暴击率</span><span class="value">--</span></div>
      <div class="node-row"><span class="label">暴击伤害</span><span class="value">--</span></div>
      <div class="node-row"><span class="label">单发伤害</span><span class="value">--</span></div>
      <div class="node-row"><span class="label">单次暴击</span><span class="value">--</span></div>
      <div class="node-dps">
        <span class="dps-label">5秒伤害</span>
        <span class="dps-value" id="output-dps-${outputNode.id}">--</span>
      </div>
    `;
    return;
  }

  const dps = calcDPS(result);
  const perShot = Math.round((result.damage || 0) * (result.pellets || 1));
  const cr = result.critRate || 0;
  const cd = result.critDmg != null ? result.critDmg : 50;
  const critShot = Math.round(perShot * (1 + cd / 100));
  body.innerHTML = `
      <div class="node-row"><span class="label">属性</span><span class="value">${attrBadge(result.attribute)}</span></div>
      <div class="node-row"><span class="label">距离</span><span class="value">${result.distance != null ? result.distance + 'm' : '--'}</span></div>
      <div class="node-row"><span class="label">暴击率</span><span class="value">${cr}%</span></div>
      <div class="node-row"><span class="label">暴击伤害</span><span class="value">${cd}%</span></div>
      <div class="node-row"><span class="label">单发伤害</span><span class="value">${perShot}</span></div>
      <div class="node-row"><span class="label">单次暴击</span><span class="value" id="crit-shot-val-${outputNode.id}">${critShot}</span></div>
      <div class="node-dps">
        <span class="dps-label">5秒伤害</span>
        <span class="dps-value" id="output-dps-${outputNode.id}">${dps}</span>
      </div>
    `;
}


// 单位基准数据（damage=1），用于让攻击力/插件等加成节点作为纯乘子起点
function unitStats(damage) {
  return {
    damage: damage,
    pellets: 1,
    fireRate: 60,
    magazine: 1,
    reloadTime: 0,
    accuracy: 100,
    stability: 0,
    explosionRange: 0,
    attribute: '物理',
    isMelee: false,
    critRate: 0,
    critDmg: 50,
  };
}

function computeNode(nodeId, visited) {
  if (visited.has(nodeId)) return null;
  visited.add(nodeId);

  const node = state.nodes.get(nodeId);
  if (!node) return null;

  // 找到所有连入此节点的连线
  const incomingConns = Array.from(state.connections.values()).filter(c => c.to === nodeId);

  if (incomingConns.length === 0) {
    // 没有输入：如果是武器输入节点，返回基础数据
    if (node.type === 'weapon-input' && node.weaponData) {
      return { ...node.weaponData, isMelee: false, isFromWeapon: true, critRate: node.weaponData.critRate || 0, critDmg: (node.weaponData.critDmg != null ? node.weaponData.critDmg : 50) };
    }
    // 攻击力节点作为起点：以单位基准返回纯加成倍率（便于「攻击力 → …」作为数据源）
    if (node.type === 'attack') {
      const power = node.power != null ? node.power : 0;
      return unitStats(1 * (1 + power / 100));
    }
    // 插件节点作为起点：以单位基准应用插件加成（便于「插件 → 数值输入」生效）
    if (node.type === 'plugin' && node.weaponData) {
      return applyPlugin(unitStats(1), node.weaponData, node);
    }
    // 数值输入节点：返回手动输入的数值作为基础伤害（fireRate=60 使直连输出时 DPS≈该数值）
    if (node.type === 'input-node') {
      const v = node.value != null ? node.value : 0;
      return unitStats(v);
    }
    // 副武器 / 近战武器也可作为链路起点，直接输出自身数据
    if (node.type === 'secondary-weapon' && node.weaponData) {
      return { ...buildSecondaryBaseStats(node.weaponData), isFromWeapon: true };
    }
    if (node.type === 'melee-weapon' && node.weaponData) {
      return { ...buildMeleeBaseStats(node.weaponData), isFromWeapon: true };
    }
    if (node.type === 'vuln') {
      // 增伤节点作为独立易伤源（无输入）：只提供易伤乘区，不提供伤害
      const arc = node.arcEnabled !== false;
      const weak = node.weakPct != null ? node.weakPct : 0;
      const mult = 1 + (arc ? 0.05 : 0) + (weak / 100);
      return { ...unitStats(0), isVulnSource: true, vulnMult: mult };
    }
    return null;
  }

  // 计算所有输入
  let combinedStats = null;
  let vulnMult = 1;  // 易伤乘区累积（来自作为旁路源的增伤节点）
  for (const conn of incomingConns) {
    const inputStats = computeNode(conn.from, new Set(visited));
    if (!inputStats) continue;
    // 增伤节点作为独立易伤源：只提供乘区，不提供伤害
    if (inputStats.isVulnSource) {
      vulnMult *= (inputStats.vulnMult || 1);
      continue;
    }
    if (!combinedStats) {
      combinedStats = { ...inputStats };
    } else {
      // 合并多个普通输入（伤害相加，其余取最优/最大）
      combinedStats.damage = (combinedStats.damage || 0) + (inputStats.damage || 0);
      combinedStats.fireRate = Math.max(combinedStats.fireRate || 0, inputStats.fireRate || 0);
      combinedStats.magazine = Math.max(combinedStats.magazine || 0, inputStats.magazine || 0);
      combinedStats.totalAmmo = Math.max(combinedStats.totalAmmo || 0, inputStats.totalAmmo || 0);
      combinedStats.explosionRange = Math.max(combinedStats.explosionRange || 0, inputStats.explosionRange || 0);
      combinedStats.accuracy = Math.max(combinedStats.accuracy || 0, inputStats.accuracy || 0);
      combinedStats.stability = Math.max(combinedStats.stability || 0, inputStats.stability || 0);
      // 换弹时间取最短
      const reloadA = combinedStats.reloadTime || 0;
      const reloadB = inputStats.reloadTime || 0;
      combinedStats.reloadTime = (reloadA && reloadB) ? Math.min(reloadA, reloadB) : Math.max(reloadA, reloadB);
      // 累积 pendingBonus（加算奖励）
      if (inputStats.pendingBonus) {
        combinedStats.pendingBonus = (combinedStats.pendingBonus || 0) + inputStats.pendingBonus;
      }
      // 累积暴击率和暴击伤害（加算）
      combinedStats.critRate = (combinedStats.critRate || 0) + (inputStats.critRate || 0);
      combinedStats.critDmg = (combinedStats.critDmg != null ? combinedStats.critDmg : 50) + (inputStats.critDmg != null ? inputStats.critDmg : 50) - 50;
    }
  }

  if (!combinedStats) {
    // 所有输入都是易伤源（无实际伤害源）：用空基础数据承接，便于下游继续传递
    combinedStats = unitStats(0);
  }

  // 应用易伤乘区到伤害
  if (vulnMult !== 1) {
    combinedStats.damage = Math.round((combinedStats.damage || 0) * vulnMult);
  }

  // 根据节点类型应用修饰
  if (node.type === 'plugin' && node.weaponData) {
    return applyPlugin(combinedStats, node.weaponData, node);
  } else if (node.type === 'secondary-weapon' && node.weaponData) {
    flushPendingBonus(combinedStats);
    return applySecondary(combinedStats, node.weaponData);
  } else if (node.type === 'melee-weapon' && node.weaponData) {
    flushPendingBonus(combinedStats);
    return applyMelee(combinedStats, node.weaponData);
  } else if (node.type === 'distance') {
    flushPendingBonus(combinedStats);
    // 距离节点：把当前距离带入计算，并应用衰减百分比伤害
    const result = { ...combinedStats };
    result.distance = node.distance != null ? node.distance : (combinedStats.distance || 0);
    const attenDist = node.attenDist != null ? node.attenDist : 0;
    const attenPct = node.attenPct != null ? node.attenPct : 0;
    if (attenDist > 0 && attenPct > 0 && result.distance > attenDist) {
      result.damage = Math.round(result.damage * (1 - attenPct / 100));
    }
    return result;
  } else if (node.type === 'attack') {
    flushPendingBonus(combinedStats);
    // 攻击力节点：伤害 × (1 + 攻击力加成%/100)（0% = 无加成，100% = 双倍）
    const result = { ...combinedStats };
    const power = node.power != null ? node.power : 0;
    result.damage = Math.round(result.damage * (1 + power / 100));
    return result;
  } else if (node.type === 'input-node') {
    flushPendingBonus(combinedStats);
    // 数值输入节点：把自身输入的数值作为基础，乘以上游传来的属性加成倍率
    const v = node.value != null ? node.value : 0;
    return {
      damage: Math.round(v * (combinedStats.damage || 1)),
      pellets: combinedStats.pellets || 1,
      fireRate: combinedStats.fireRate || 60,
      magazine: combinedStats.magazine || 1,
      reloadTime: combinedStats.reloadTime || 0,
      accuracy: combinedStats.accuracy != null ? combinedStats.accuracy : 100,
      stability: combinedStats.stability || 0,
      explosionRange: combinedStats.explosionRange || 0,
      attribute: combinedStats.attribute || '物理',
      isMelee: false,
      critRate: combinedStats.critRate || 0,
      critDmg: combinedStats.critDmg != null ? combinedStats.critDmg : 50,
    };
  } else if (node.type === 'vuln') {
    flushPendingBonus(combinedStats);
    // 增伤（易伤）节点：按游戏实际加算模式
    // 总伤害 = 基础伤害 * (1 + 武器增伤系数 + 技能增伤系数)
    const result = { ...combinedStats };
    const arc = node.arcEnabled !== false;                       // 电弧易伤：+5%
    const weak = node.weakPct != null ? node.weakPct : 0;      // 弱点易伤：+weak%
    const multiplier = 1 + (arc ? 0.05 : 0) + (weak / 100);
    result.damage = Math.round(result.damage * multiplier);
    return result;
  } else if (node.type === 'output') {
    flushPendingBonus(combinedStats);
    return combinedStats;
  } else if (node.type === 'weapon-input') {
    flushPendingBonus(combinedStats);
    // 武器输入节点如果有输入（不应该有），直接返回自身数据
    return { ...node.weaponData, isMelee: false, isFromWeapon: true, critRate: node.weaponData.critRate || 0, critDmg: (node.weaponData.critDmg != null ? node.weaponData.critDmg : 50) };
  }

  return combinedStats;
}

function applyPlugin(stats, plugin, pluginNode) {
  const result = { ...stats };

  // 新格式：attrType + attrValue + independent (+ maxStacks)
  if (plugin.attrType && plugin.attrValue != null) {
    // 武器技能伤害提升不参与主武器伤害计算，只通过输入节点生效
    if (plugin.attrType === 'weaponSkillDmg' && stats.isFromWeapon) return result;
    const maxStacks = plugin.maxStacks != null ? plugin.maxStacks : 1;
    const stacks = (pluginNode && pluginNode.stacks != null) ? Math.min(pluginNode.stacks, maxStacks) : maxStacks;
    const value = plugin.attrValue * stacks;
    if (plugin.independent) {
      // 独立乘区：先结算累积的加算奖励，再乘以独立倍率
      if (result.pendingBonus) {
        if (result.damage > 0) {
          result.damage = Math.round(result.damage * (1 + result.pendingBonus / 100));
        }
        result.pendingBonus = 0;
      }
      if (result.damage > 0) {
        result.damage = Math.round(result.damage * (1 + value / 100));
      }
    } else {
      // 非独立乘区：累积加算奖励，等待后续结算
      result.pendingBonus = (result.pendingBonus || 0) + value;
    }
    return result;
  }

  // 旧格式兼容：attribute 文本字段，不参与计算（仅展示）
  // 旧 applyPlugin 的 target/value/modType 逻辑也保留，但编辑器不再生成此类数据
  const target = plugin.target;
  const value = plugin.value;
  const modType = plugin.modType;

  if (modType === 'multiplier') {
    if (target in result) {
      result[target] = result[target] * (1 + value);
    }
  } else if (modType === 'flat') {
    if (target in result) {
      result[target] = result[target] + value;
    }
  }

  // 处理额外属性
  if (plugin.extra) {
    for (const [k, v] of Object.entries(plugin.extra)) {
      if (k in result) {
        if (k === 'critDamage' || k === 'fireRate') {
          result[k] = result[k] + v;
        } else {
          result[k] = result[k] + v;
        }
      }
    }
  }

  return result;
}

// 结算累积的加算奖励（pendingBonus），在非插件节点处执行
function flushPendingBonus(stats) {
  if (stats.pendingBonus) {
    if (stats.damage > 0) {
      stats.damage = Math.round(stats.damage * (1 + stats.pendingBonus / 100));
    }
    delete stats.pendingBonus;
  }
  return stats;
}

function applySecondary(stats, secondaryWeapon) {
  const result = { ...stats };
  const eff = secondaryWeapon.effects;
  if (eff && eff.e1 && eff.e1.dmg && result.damage > 0) {
    result.damage = Math.round(result.damage * (1 + eff.e1.dmg / 100));
  }
  if (eff && eff.e2 && eff.e2.crit) {
    result.critRate = (result.critRate || 0) + eff.e2.crit;
  }
  if (eff && eff.e2 && eff.e2.critDmg) {
    result.critDmg = (result.critDmg != null ? result.critDmg : 50) + eff.e2.critDmg;
  }
  return result;
}

function meleeEffectLines(w) {
  const eff = w.effects;
  if (!eff) return [];
  if (Array.isArray(eff)) return eff; // 兼容旧字符串格式
  const lines = [];
  if (eff.e1) {
    if (eff.e1.attr && eff.e1.dmg) lines.push(`${eff.e1.attr}伤害 +${eff.e1.dmg}%`);
    if (eff.e1.crit) lines.push(`暴击率 +${eff.e1.crit}%`);
    if (eff.e1.custom) lines.push(`${eff.e1.custom}`);
  }
  if (eff.e2) {
    if (eff.e2.critDmg) lines.push(`暴击伤害 +${eff.e2.critDmg}%`);
    if (eff.e2.melee) lines.push(`近战武器 +${eff.e2.melee}%`);
    if (eff.e2.far) lines.push(`远处武器 +${eff.e2.far}%`);
    if (eff.e2.custom) lines.push(`${eff.e2.custom}`);
  }
  return lines;
}

function secondaryEffectLines(w) {
  const eff = w.effects;
  if (!eff) return [];
  const lines = [];
  if (eff.e1) {
    if (eff.e1.dmg) lines.push(`武器伤害 +${eff.e1.dmg}%`);
    if (eff.e1.duration) lines.push(`持续 ${eff.e1.duration}s`);
  }
  if (eff.e2) {
    if (eff.e2.crit) lines.push(`暴击率 +${eff.e2.crit}%`);
    if (eff.e2.critDmg) lines.push(`暴伤 +${eff.e2.critDmg}%`);
    if (eff.e2.duration) lines.push(`持续 ${eff.e2.duration}s`);
  }
  return lines;
}

function applyMelee(stats, meleeWeapon) {
  const result = { ...stats };
  const eff = meleeWeapon.effects;
  // 兼容旧字符串格式：含「提升」则按 5% 加成
  if (Array.isArray(eff)) {
    if (eff.some(e => /提升/.test(e)) && meleeWeapon.attribute && result.attribute === meleeWeapon.attribute && result.damage > 0) {
      result.damage = Math.round(result.damage * 1.05);
    }
    return result;
  }
  // 新结构化格式
  if (eff && eff.e1 && eff.e1.attr && eff.e1.dmg && result.attribute === eff.e1.attr && result.damage > 0) {
    // 第一条：指定属性伤害提升（如「电弧伤害 +5%」）
    result.damage = Math.round(result.damage * (1 + eff.e1.dmg / 100));
  }
  // 累积暴击率和暴击伤害
  if (eff && eff.e1 && eff.e1.crit) {
    result.critRate = (result.critRate || 0) + eff.e1.crit;
  }
  if (eff && eff.e2 && eff.e2.critDmg) {
    result.critDmg = (result.critDmg != null ? result.critDmg : 50) + eff.e2.critDmg;
  }
  if (eff && eff.e2 && eff.e2.melee && result.isMelee && result.damage > 0) {
    // 第二条：近战武器提升（仅对近战武器生效）
    result.damage = Math.round(result.damage * (1 + eff.e2.melee / 100));
  }
  if (eff && eff.e2 && eff.e2.far && !result.isMelee && result.damage > 0) {
    // 第二条：远处武器提升（仅对远程武器生效）
    result.damage = Math.round(result.damage * (1 + eff.e2.far / 100));
  }
  return result;
}

// 副武器作为链路起点：用自身数值构造基础数据（不叠加协同加成）
function buildSecondaryBaseStats(w) {
  return {
    damage: w.damage || 0,
    pellets: w.pellets || 1,
    fireRate: w.fireRate || 60,
    magazine: w.magazine || 1,
    reloadTime: w.reloadTime || 0,
    totalAmmo: w.totalAmmo || w.magazine || 1,
    explosionRange: w.explosionRange || 0,
    accuracy: w.accuracy != null ? w.accuracy : 100,
    stability: w.stability || 0,
    attribute: w.attribute || '物理',
    effects: w.effects,
    isMelee: false,
    critRate: 0,
    critDmg: 50,
  };
}

// 近战武器作为链路起点：以重击伤害作为单发伤害，给一个默认攻速用于估算
function buildMeleeBaseStats(w) {
  const hit = Math.max(w.heavyDamage || 0, w.lightDamage || 0);
  const eff = w.effects;
  let meleeCritRate = 0;
  let meleeCritDmg = 0;
  if (eff && !Array.isArray(eff)) {
    if (eff.e1 && eff.e1.crit) meleeCritRate += eff.e1.crit;
    if (eff.e2 && eff.e2.critDmg) meleeCritDmg += eff.e2.critDmg;
  }
  return {
    damage: hit,
    pellets: 1,
    fireRate: 60,
    magazine: 1,
    reloadTime: 0,
    totalAmmo: 1,
    explosionRange: 0,
    accuracy: 100,
    stability: 0,
    attribute: w.attribute || '物理',
    lightDamage: w.lightDamage,
    heavyDamage: w.heavyDamage,
    effects: w.effects,
    isMelee: true,
    critRate: meleeCritRate,
    critDmg: 50 + meleeCritDmg,
  };
}

// ========== 侧边栏 ==========

function initSidebar() {
  // 标签切换
  document.querySelectorAll('.sidebar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentTab = tab.dataset.tab;
      state.currentSubCategory = null;
      renderSubCategories();
      renderSidebarList();
    });
  });

  // 搜索
  dom.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderSidebarList();
  });

  renderSubCategories();
  renderSidebarList();
}

function renderSubCategories() {
  const tab = state.currentTab;
  let categories = [];
  let isPlugin = false;

  if (tab === '主武器') {
    categories = PRIMARY_CATEGORIES;
  } else if (tab === '副武器') {
    categories = SECONDARY_CATEGORIES;
  } else if (tab === '插件') {
    isPlugin = true;
    categories = PLUGIN_CATEGORIES; // [1, 2, 3, 4]
  }

  if (categories.length === 0) {
    dom.subCategories.classList.add('hidden');
    dom.subCategories.innerHTML = '';
    return;
  }

  dom.subCategories.classList.remove('hidden');

  // 插件分类显示为「一号 / 二号 / 三号 / 四号」；其余分类显示原名称
  dom.subCategories.innerHTML = categories.map(cat => {
    const catVal = String(cat);
    const label = isPlugin ? `${catVal}号` : cat;
    const active = state.currentSubCategory === catVal ? 'active' : '';
    return `
      <button class="sub-cat-btn ${active}" data-cat="${catVal}">
        ${label}
      </button>
    `;
  }).join('');

  dom.subCategories.querySelectorAll('.sub-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.currentSubCategory === btn.dataset.cat) {
        state.currentSubCategory = null;
      } else {
        state.currentSubCategory = btn.dataset.cat;
      }
      renderSubCategories();
      renderSidebarList();
    });
  });
}

function listItemThumb(item) {
  if (item && item.image) {
    return `<img class="item-thumb" src="${item.image}" alt="" draggable="false" />`;
  }
  return `<div class="item-thumb item-thumb-empty"></div>`;
}

function renderSidebarList() {
  const tab = state.currentTab;
  const query = state.searchQuery;
  let html = '';

  if (tab === '主武器' || tab === '副武器') {
    const data = WEAPON_DATA[tab];
    let categories = Object.keys(data);

    if (state.currentSubCategory) {
      categories = categories.filter(c => c === state.currentSubCategory);
    }

    categories.forEach(cat => {
      let items = data[cat];
      if (query) {
        items = items.filter(item =>
          item.name.toLowerCase().includes(query) ||
          cat.toLowerCase().includes(query)
        );
      }
      if (items.length === 0) return;

      items.forEach(item => {
        const itemClass = (tab === '主武器' ? '' : 'secondary-item') + ' weapon-card';
        html += `
          <div class="list-item ${itemClass}" data-tab="${tab}" data-subcat="${cat}" data-id="${item.id}">
            <div class="card-tag">${cat}</div>
            ${listItemThumb(item)}
            <div class="card-footer">
              <div class="card-name">${item.name}</div>
              <div class="card-attr">${cardAttrBadge(item.attribute)}</div>
            </div>
          </div>
        `;
      });
    });
  } else if (tab === '近战武器') {
    let items = WEAPON_DATA['近战武器'];
    if (query) {
      items = items.filter(item => item.name.toLowerCase().includes(query));
    }
    items.forEach(item => {
      html += `
        <div class="list-item melee-item weapon-card" data-tab="近战武器" data-subcat="" data-id="${item.id}">
          <div class="card-tag">近战</div>
          ${listItemThumb(item)}
          <div class="card-footer">
            <div class="card-name">${item.name}</div>
            <div class="card-attr">${cardAttrBadge(item.attribute)}</div>
          </div>
        </div>
      `;
    });
  } else if (tab === '插件') {
    let items = WEAPON_DATA['插件'];
    // 按插件分类（一号/二号/三号/四号）筛选
    if (state.currentSubCategory) {
      items = items.filter(item => String(item.category) === state.currentSubCategory);
    }
    if (query) {
      items = items.filter(item =>
        item.name.toLowerCase().includes(query) ||
        (item.attribute || '').toLowerCase().includes(query)
      );
    }
    items.forEach(item => {
      // 插件属性显示：新格式优先，旧格式兼容
      let attrText = '';
      if (item.attrType) {
        const typeDef = getPluginAttrType(item.attrType);
        attrText = typeDef
          ? `${typeDef.label} +${item.attrValue}%`
          : item.attrType;
        if (item.independent) attrText += ' [独立乘区]';
        if (item.maxStacks > 1) attrText += ` [${item.maxStacks}层]`;
      } else if (item.attribute) {
        attrText = item.attribute;
      }
      html += `
        <div class="list-item plugin-item" data-tab="插件" data-subcat="" data-id="${item.id}">
          ${listItemThumb(item)}
          <div class="item-info">
            <div class="item-name">${item.name} <span class="cat-tag">${item.category}号</span></div>
            <div class="item-stats">
              <span>${attrText}</span>
            </div>
          </div>
          <div class="item-add">+</div>
        </div>
      `;
    });
  }

  if (html === '') {
    html = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">无匹配结果</div>';
  }

  dom.sidebarList.innerHTML = html;

  // 绑定点击事件
  dom.sidebarList.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      const subcat = item.dataset.subcat;
      const weaponId = item.dataset.id;
      addWeaponFromSidebar(tab, subcat, weaponId);
    });
  });
}

function addWeaponFromSidebar(tab, subCategory, weaponId) {
  let weaponData = null;

  if (tab === '主武器' || tab === '副武器') {
    const catData = WEAPON_DATA[tab][subCategory];
    if (catData) {
      weaponData = catData.find(w => w.id === weaponId);
    }
  } else if (tab === '近战武器') {
    weaponData = WEAPON_DATA['近战武器'].find(w => w.id === weaponId);
  } else if (tab === '插件') {
    weaponData = WEAPON_DATA['插件'].find(w => w.id === weaponId);
  }

  if (!weaponData) return;

  // 在画布中心位置创建节点
  const rect = dom.canvasArea.getBoundingClientRect();
  const centerX = (rect.width / 2 - state.pan.x) / state.zoom;
  const centerY = (rect.height / 2 - state.pan.y) / state.zoom;
  const offsetX = (Math.random() - 0.5) * 80;
  const offsetY = (Math.random() - 0.5) * 80;

  createWeaponNode(tab, subCategory, weaponData, centerX + offsetX, centerY + offsetY);
}

// ========== 画布事件 ==========

function initCanvasEvents() {
  // 平移
  dom.canvasArea.addEventListener('mousedown', (e) => {
    if (e.target === dom.canvasArea || e.target === dom.gridBg) {
      state.panning = true;
      state.panStart = { x: e.clientX, y: e.clientY };
      state.panStartOffset = { ...state.pan };
      dom.canvasArea.classList.add('panning');

      // 取消选中
      if (state.selectedNode) {
        const el = dom.nodesLayer.querySelector(`[data-id="${state.selectedNode}"]`);
        if (el) el.classList.remove('selected');
        state.selectedNode = null;
      }
      if (state.selectedConnection) {
        const path = dom.connectionsGroup.querySelector(`[data-id="${state.selectedConnection}"]`);
        if (path) path.classList.remove('selected');
        state.selectedConnection = null;
      }
    }
  });

  // 全局鼠标移动
  document.addEventListener('mousemove', (e) => {
    // 拖拽节点
    if (state.draggingNode) {
      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      state.draggingNode.x = canvasPos.x - state.draggingOffset.x;
      state.draggingNode.y = canvasPos.y - state.draggingOffset.y;
      const el = dom.nodesLayer.querySelector(`[data-id="${state.draggingNode.id}"]`);
      if (el) {
        el.style.left = `${state.draggingNode.x}px`;
        el.style.top = `${state.draggingNode.y}px`;
      }
      updateAllConnections();

      // 检测是否拖到连线上（命中则高亮，松手自动插入）
      const hit = getWireDropTarget(state.draggingNode);
      if (hit !== state.wireDropTarget) {
        if (state.wireDropTarget) {
          const oldPath = dom.connectionsGroup.querySelector(`[data-id="${state.wireDropTarget.id}"]`);
          if (oldPath) oldPath.classList.remove('wire-highlight');
        }
        state.wireDropTarget = hit;
        if (hit) {
          const newPath = dom.connectionsGroup.querySelector(`[data-id="${hit.id}"]`);
          if (newPath) newPath.classList.add('wire-highlight');
        }
      }
    }

    // 平移画布
    if (state.panning) {
      state.pan.x = state.panStartOffset.x + (e.clientX - state.panStart.x);
      state.pan.y = state.panStartOffset.y + (e.clientY - state.panStart.y);
      updateTransform();
    }

    // 连线拖拽
    if (state.connecting) {
      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      state.connectMouse = canvasPos;
      updateTempConnection();
    }
  });

  // 鼠标释放
  document.addEventListener('mouseup', (e) => {
    if (state.draggingNode) {
      const droppedNode = state.draggingNode;
      // 若拖到了连线上，则自动插入到该连线中间（A→B 变为 A→node→B）
      if (state.wireDropTarget) {
        const target = state.wireDropTarget;
        const path = dom.connectionsGroup.querySelector(`[data-id="${target.id}"]`);
        if (path) path.classList.remove('wire-highlight');
        state.wireDropTarget = null;
        insertNodeIntoWire(droppedNode, target);
      }
      state.draggingNode = null;
      scheduleSave();
    }
    if (state.panning) {
      state.panning = false;
      dom.canvasArea.classList.remove('panning');
      scheduleSave();
    }
    if (state.connecting) {
      // 检查是否在一个输入端口上释放
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (target && target.classList.contains('port') && target.dataset.port === 'input') {
        const toNodeId = target.dataset.node;
        if (state.connectStart) {
          tryConnect(state.connectStart.nodeId, toNodeId);
        }
      }
      cancelConnect();
    }
  });

  // 缩放
  dom.canvasArea.addEventListener('wheel', (e) => {
    e.preventDefault();
    hideContextMenu();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(state.zoom * delta, e.clientX, e.clientY);
    scheduleSave();
  });

  // ========== 触摸支持 ==========
  let touchState = { panning: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0, lastDist: 0 };

  dom.canvasArea.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      // 只在画布空白处或网格上开始平移
      const target = document.elementFromPoint(t.clientX, t.clientY);
      if (target === dom.canvasArea || target === dom.gridBg || target.id === 'nodes-layer') {
        touchState.panning = true;
        touchState.startX = t.clientX;
        touchState.startY = t.clientY;
        touchState.startPanX = state.pan.x;
        touchState.startPanY = state.pan.y;
      }
    } else if (e.touches.length === 2) {
      // 双指缩放
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchState.lastDist = Math.sqrt(dx * dx + dy * dy);
    }
  }, { passive: true });

  dom.canvasArea.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && touchState.panning) {
      const t = e.touches[0];
      state.pan.x = touchState.startPanX + (t.clientX - touchState.startX);
      state.pan.y = touchState.startPanY + (t.clientY - touchState.startY);
      updateTransform();
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (touchState.lastDist > 0) {
        const scale = dist / touchState.lastDist;
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        setZoom(state.zoom * scale, cx, cy);
      }
      touchState.lastDist = dist;
    }
  }, { passive: false });

  dom.canvasArea.addEventListener('touchend', (e) => {
    touchState.panning = false;
    touchState.lastDist = 0;
    if (e.touches.length === 0) scheduleSave();
  }, { passive: true });

  // 长按画布空白处弹出上下文菜单（移动端替代右键）
  let longPressTimer = null;
  dom.canvasArea.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const target = document.elementFromPoint(t.clientX, t.clientY);
    if (target === dom.canvasArea || target === dom.gridBg) {
      longPressTimer = setTimeout(() => {
        showContextMenu(t.clientX, t.clientY);
      }, 500);
    }
  }, { passive: true });
  dom.canvasArea.addEventListener('touchend', () => { clearTimeout(longPressTimer); }, { passive: true });
  dom.canvasArea.addEventListener('touchmove', () => { clearTimeout(longPressTimer); }, { passive: true });

  // 右键菜单：在画布右键弹出「添加节点」菜单
  dom.canvasArea.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });

  // 右键菜单项点击：在光标处创建节点，或断开连线
  if (dom.contextMenu) {
    dom.contextMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.context-menu-item');
      if (!item) return;

      // 连线菜单：断开连接
      if (item.dataset.action === 'disconnect') {
        const connId = item.dataset.conn;
        if (connId) deleteConnection(connId);
        hideContextMenu();
        return;
      }

      // 节点菜单：创建节点
      const type = item.dataset.type;
      if (!type) return;
      const sx = parseFloat(dom.contextMenu.dataset.x);
      const sy = parseFloat(dom.contextMenu.dataset.y);
      const pos = screenToCanvas(sx, sy);
      createNode(type, pos.x - 110, pos.y - 40);
      recalculate();
      hideContextMenu();
      scheduleSave();
    });
  }

  // 点击画布其它地方关闭菜单
  document.addEventListener('click', (e) => {
    if (dom.contextMenu && !dom.contextMenu.contains(e.target)) hideContextMenu();
  });

  // 点击空白取消连线选中
  dom.canvasArea.addEventListener('click', (e) => {
    if (e.target === dom.canvasArea || e.target === dom.gridBg) {
      if (state.selectedNode) {
        const el = dom.nodesLayer.querySelector(`[data-id="${state.selectedNode}"]`);
        if (el) el.classList.remove('selected');
        state.selectedNode = null;
      }
      if (state.selectedConnection) {
        const path = dom.connectionsGroup.querySelector(`[data-id="${state.selectedConnection}"]`);
        if (path) path.classList.remove('selected');
        state.selectedConnection = null;
      }
    }
  });

  // 键盘删除
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // 不在输入框中
      if (document.activeElement.tagName === 'INPUT') return;

      if (state.selectedNode) {
        deleteNode(state.selectedNode);
      } else if (state.selectedConnection) {
        deleteConnection(state.selectedConnection);
      }
    }
    if (e.key === 'Escape') {
      cancelConnect();
      hideContextMenu();
      if (state.selectedNode) {
        const el = dom.nodesLayer.querySelector(`[data-id="${state.selectedNode}"]`);
        if (el) el.classList.remove('selected');
        state.selectedNode = null;
      }
      if (state.selectedConnection) {
        const path = dom.connectionsGroup.querySelector(`[data-id="${state.selectedConnection}"]`);
        if (path) path.classList.remove('selected');
        state.selectedConnection = null;
      }
    }
  });
}

// ========== 工具栏事件 ==========

function initToolbar() {
  // 输出结果 / 单次伤害 / 距离节点 / 攻击力 节点均在画布右键菜单中添加

  // 导入数据
  const importBtn = document.getElementById('btn-import');
  const importFile = document.getElementById('import-file');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) importDataFromFile(file);
      e.target.value = ''; // 允许重复选择同一文件
    });
  }

  document.getElementById('btn-clear').addEventListener('click', () => {
    if (state.nodes.size === 0) return;
    if (confirm('确定要清空画布吗？所有节点和连线将被删除。')) {
      clearAll();
    }
  });

  document.getElementById('btn-help').addEventListener('click', () => {
    document.getElementById('help-modal').style.display = 'flex';
  });

  document.getElementById('help-close').addEventListener('click', () => {
    document.getElementById('help-modal').style.display = 'none';
  });

  document.getElementById('help-modal').addEventListener('click', (e) => {
    if (e.target.id === 'help-modal') {
      e.target.style.display = 'none';
    }
  });

  // ========== 移动端侧边栏切换 ==========
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const sidebar = document.getElementById('sidebar');

  function toggleSidebar() {
    sidebar.classList.toggle('open');
    sidebarBackdrop.classList.toggle('show');
  }

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', toggleSidebar);
  }
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', toggleSidebar);
  }

  // 选中武器后自动关闭移动端侧边栏
  document.addEventListener('click', (e) => {
    const item = e.target.closest('.list-item');
    if (item && window.innerWidth <= 768) {
      sidebar.classList.remove('open');
      sidebarBackdrop.classList.remove('show');
    }
  });
}

function clearAll() {
  state.nodes.clear();
  state.connections.clear();
  state.selectedNode = null;
  state.selectedConnection = null;
  dom.nodesLayer.innerHTML = '';
  dom.connectionsGroup.innerHTML = '';
  updateCanvasHint();
  updateStatus();
  recalculate();
  scheduleSave();
}

// ========== 进度持久化（localStorage） ==========
const CANVAS_STORAGE_KEY = 'nzw_canvas_state_v1';

// 在 WEAPON_DATA（含导入的自定义数据）中按 id 查找武器/插件/近战等条目
function findWeaponById(id) {
  if (!WEAPON_DATA) return null;
  for (const tab of Object.keys(WEAPON_DATA)) {
    const entry = WEAPON_DATA[tab];
    if (!entry) continue;
    const lists = Array.isArray(entry) ? [entry] : Object.values(entry);
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      const found = list.find(w => w && w.id === id);
      if (found) return found;
    }
  }
  return null;
}

function serializeState() {
  const nodes = Array.from(state.nodes.values()).map(n => {
    const o = { id: n.id, type: n.type, x: n.x, y: n.y };
    if (n.weaponData) {
      o.weaponId = n.weaponData.id;
      if (n.weaponCategory) o.weaponCategory = n.weaponCategory;
      if (n.weaponSubCategory) o.weaponSubCategory = n.weaponSubCategory;
    }
    if (n.type === 'distance') {
      o.distance = n.distance; o.attenDist = n.attenDist; o.attenPct = n.attenPct;
    } else if (n.type === 'attack') {
      o.power = n.power;
    } else if (n.type === 'input-node') {
      o.value = n.value;
    } else if (n.type === 'vuln') {
      o.arcEnabled = n.arcEnabled !== false;
      o.weakPct = n.weakPct != null ? n.weakPct : 0;
    }
    return o;
  });
  const connections = Array.from(state.connections.values()).map(c => ({ id: c.id, from: c.from, to: c.to }));
  return {
    v: 1,
    nodes,
    connections,
    pan: state.pan,
    zoom: state.zoom,
    nodeIdCounter: state.nodeIdCounter,
    connIdCounter: state.connIdCounter,
  };
}

// 从存档重建画布（不存储 base64 图片，只存武器 id，加载时按 WEAPON_DATA 解析）
function deserializeState(data) {
  if (!data || !Array.isArray(data.nodes)) return false;
  state.nodes.clear();
  state.connections.clear();
  state.selectedNode = null;
  state.selectedConnection = null;
  dom.nodesLayer.innerHTML = '';
  dom.connectionsGroup.innerHTML = '';

  data.nodes.forEach(o => {
    if (!NODE_TYPES[o.type]) return; // 跳过未知类型（如已删除的「单次伤害」节点）
    let weaponData = null;
    if (o.weaponId) {
      const w = findWeaponById(o.weaponId);
      if (w) weaponData = w;
    }
    const node = { id: o.id, type: o.type, x: o.x || 0, y: o.y || 0, weaponData: weaponData };
    if (o.weaponCategory) node.weaponCategory = o.weaponCategory;
    if (o.weaponSubCategory) node.weaponSubCategory = o.weaponSubCategory;
    if (o.type === 'distance') {
      node.distance = o.distance != null ? o.distance : 10;
      node.attenDist = o.attenDist != null ? o.attenDist : 30;
      node.attenPct = o.attenPct != null ? o.attenPct : 0;
    } else if (o.type === 'attack') {
      // power 表示「攻击力加成%」；旧存档存的是「倍率%」（>=100 视为旧倍率格式，换算回加成）
      let p = o.power != null ? o.power : 0;
      if (p >= 100) p = p - 100; // 旧倍率格式 → 加成格式，保持结果一致
      node.power = p;
    } else if (o.type === 'input-node') {
      node.value = o.value != null ? o.value : 0;
    } else if (o.type === 'vuln') {
      node.arcEnabled = o.arcEnabled !== false;
      node.weakPct = o.weakPct != null ? o.weakPct : 0;
    }
    state.nodes.set(node.id, node);
    renderNode(node);
  });

  (data.connections || []).forEach(c => {
    if (state.nodes.has(c.from) && state.nodes.has(c.to)) {
      const conn = { id: c.id, from: c.from, to: c.to };
      state.connections.set(conn.id, conn);
      renderConnection(conn);
    }
  });

  state.pan = data.pan || { x: 0, y: 0 };
  state.zoom = data.zoom || 1;
  state.nodeIdCounter = data.nodeIdCounter || 0;
  state.connIdCounter = data.connIdCounter || 0;

  updateTransform();
  updatePortStates();
  updateStatus();
  updateCanvasHint();
  recalculate();
  return true;
}

function saveState() {
  try {
    localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(serializeState()));
    showSaveStatus();
  } catch (e) {
    console.warn('保存画布失败', e);
  }
}

let _saveTimer = null;
function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveState, 400);
}

function hasSavedCanvasState() {
  try {
    return !!localStorage.getItem(CANVAS_STORAGE_KEY);
  } catch (e) { return false; }
}

function loadCanvasState() {
  try {
    const raw = localStorage.getItem(CANVAS_STORAGE_KEY);
    if (!raw) return false;
    return deserializeState(JSON.parse(raw));
  } catch (e) {
    console.warn('读取画布失败', e);
    return false;
  }
}

function showSaveStatus() {
  const el = document.getElementById('save-status');
  if (!el) return;
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  el.textContent = `已自动保存 ${hh}:${mm}:${ss}`;
  el.classList.add('dirty');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('dirty'), 1200);
}

// ========== UI 更新 ==========

function updateCanvasHint() {
  if (state.nodes.size === 0) {
    dom.canvasHint.classList.remove('hidden');
  } else {
    dom.canvasHint.classList.add('hidden');
  }
}

function updateStatus() {
  dom.nodeCount.textContent = state.nodes.size;
  dom.connCount.textContent = state.connections.size;
}

// ========== 初始化 ==========

async function init() {
  // 优先从 IndexedDB / localStorage 加载自定义数据
  await loadFromLocalStorage();
  initSidebar();
  initCanvasEvents();
  initToolbar();
  updateTransform();

  // 优先恢复上次进度；否则在存在武器数据时构建示例
  if (loadCanvasState()) {
    // 进度已恢复（deserializeState 内部已重建画布并 updateTransform）
  } else if (hasWeaponData()) {
    setTimeout(() => {
      const rect = dom.canvasArea.getBoundingClientRect();
      const cx = (rect.width / 2 - state.pan.x) / state.zoom;
      const cy = (rect.height / 2 - state.pan.y) / state.zoom;

      const firstPrimary = getFirstWeapon('主武器');
      const firstPlugin = getFirstWeapon('插件');
      if (firstPrimary) {
        // 武器输入
        const weapon = createWeaponNode('主武器', firstPrimary.sub, firstPrimary.data, cx - 360, cy - 40);
        // 距离节点（通用）
        const distance = createNode('distance', cx - 80, cy + 60);
        // DPS 输出
        const output = createNode('output', cx + 240, cy - 40);

        tryConnect(weapon.id, distance.id);
        tryConnect(weapon.id, output.id);

        if (firstPlugin) {
          const plugin = createWeaponNode('插件', '', firstPlugin.data, cx - 80, cy - 160);
          tryConnect(plugin.id, output.id);
        }
      }
    }, 100);
  }
}

// 从 IndexedDB / localStorage 加载自定义武器数据
// 如果本地没有数据，自动从 weapon-data.json 拉取
async function loadFromLocalStorage() {
  try {
    const loaded = await NZWStorage.loadWeaponData();
    if (loaded && typeof loaded === 'object' && Object.keys(loaded).length > 0) {
      WEAPON_DATA = loaded;
      // 一次性迁移：旧数据中的「电狐」属性统一改名为「电弧」
      if (migrateDianHu(WEAPON_DATA)) {
        try { await NZWStorage.saveWeaponData(WEAPON_DATA); } catch (e) {}
      }
      // 用 data.js 默认数据补全图片等资源（避免旧数据覆盖掉默认图片）
      mergeDefaultAssets();
      return;
    }
  } catch (e) {
    console.warn('读取本地数据失败', e);
  }
  // 本地无数据 → 尝试从 weapon-data.json 自动拉取
  try {
    const resp = await fetch('weapon-data.json');
    if (resp.ok) {
      const text = await resp.text();
      let clean = text;
      if (clean.charCodeAt(0) === 0xFEFF) clean = clean.slice(1);
      const parsed = JSON.parse(clean);
      const remote = parsed.WEAPON_DATA || parsed;
      if (remote && typeof remote === 'object') {
        WEAPON_DATA = remote;
        mergeDefaultAssets();
        try {
          await NZWStorage.saveWeaponData(remote);
        } catch (e) { /* 保存失败也无妨，至少本次可用 */ }
        return;
      }
    }
  } catch (e) {
    console.warn('自动拉取 weapon-data.json 失败，使用内置默认数据', e);
  }
}

// 把武器/插件/近战数据里的「电狐」属性名改为「电弧」，返回是否有改动
function migrateDianHu(data) {
  let changed = false;
  if (!data) return false;
  const fix = (it) => {
    if (!it || typeof it !== 'object') return;
    if (it.attribute === '电狐') { it.attribute = '电弧'; changed = true; }
    if (it.effects && it.effects.e1 && it.effects.e1.attr === '电狐') {
      it.effects.e1.attr = '电弧'; changed = true;
    }
  };
  for (const sub in (data['主武器'] || {})) (data['主武器'][sub] || []).forEach(fix);
  for (const sub in (data['副武器'] || {})) (data['副武器'][sub] || []).forEach(fix);
  (data['近战武器'] || []).forEach(fix);
  (data['插件'] || []).forEach(fix);
  return changed;
}

// 将 data.js 默认武器中的图片（等）合并进已加载数据（按 id 匹配，仅在加载数据缺失时补全）
function mergeDefaultAssets() {
  const def = DEFAULT_WEAPON_DATA;
  const mergeList = (defList, loadList) => {
    if (!Array.isArray(defList) || !Array.isArray(loadList)) return;
    defList.forEach(dw => {
      if (!dw || !dw.id) return;
      const lw = loadList.find(w => w.id === dw.id);
      if (lw && (!lw.image || lw.image === '') && dw.image) {
        lw.image = dw.image;
      }
    });
  };
  for (const cat of ['主武器', '副武器']) {
    if (!def[cat] || !WEAPON_DATA[cat]) continue;
    for (const sub in def[cat]) {
      if (WEAPON_DATA[cat][sub]) mergeList(def[cat][sub], WEAPON_DATA[cat][sub]);
    }
  }
  mergeList(def['近战武器'], WEAPON_DATA['近战武器']);
  mergeList(def['插件'], WEAPON_DATA['插件']);
}

// 判断是否存在武器数据
function hasWeaponData() {
  if (WEAPON_DATA['主武器']) {
    for (const sub in WEAPON_DATA['主武器']) {
      if (Array.isArray(WEAPON_DATA['主武器'][sub]) && WEAPON_DATA['主武器'][sub].length > 0) return true;
    }
  }
  if (WEAPON_DATA['副武器']) {
    for (const sub in WEAPON_DATA['副武器']) {
      if (Array.isArray(WEAPON_DATA['副武器'][sub]) && WEAPON_DATA['副武器'][sub].length > 0) return true;
    }
  }
  if (Array.isArray(WEAPON_DATA['近战武器']) && WEAPON_DATA['近战武器'].length > 0) return true;
  if (Array.isArray(WEAPON_DATA['插件']) && WEAPON_DATA['插件'].length > 0) return true;
  return false;
}

// 获取第一个可用武器（用于示例）
function getFirstWeapon(category) {
  if (category === '主武器' || category === '副武器') {
    const data = WEAPON_DATA[category];
    for (const sub in data) {
      if (Array.isArray(data[sub]) && data[sub].length > 0) {
        return { sub, data: data[sub][0] };
      }
    }
  } else if (Array.isArray(WEAPON_DATA[category]) && WEAPON_DATA[category].length > 0) {
    return { sub: '', data: WEAPON_DATA[category][0] };
  }
  return null;
}

// 按 id 在全部数据中查找武器
function findWeaponById(id) {
  const cats = ['主武器', '副武器', '近战武器', '插件'];
  for (const cat of cats) {
    if (cat === '主武器' || cat === '副武器') {
      const data = WEAPON_DATA[cat] || {};
      for (const sub in data) {
        const found = (data[sub] || []).find(w => w.id === id);
        if (found) return found;
      }
    } else {
      const found = (WEAPON_DATA[cat] || []).find(w => w.id === id);
      if (found) return found;
    }
  }
  return null;
}

// 导入 JSON 数据文件（武器数据持久化到 IndexedDB，支持大图片）
function importDataFromFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    (async () => {
      try {
        let text = e.target.result;
        // 去除 UTF-8 BOM（Windows 记事本等保存会带上），否则 JSON.parse 会抛异常
        if (text && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        const parsed = JSON.parse(text);
        const newData = parsed.WEAPON_DATA || parsed;
        if (newData && typeof newData === 'object') {
          WEAPON_DATA = newData;
          try {
            const mode = await NZWStorage.saveWeaponData(newData);
            renderSidebarList();
            renderSubCategories();
            refreshNodesAfterImport();
            updateCanvasHint();
            if (mode === 'ls') {
              alert('数据导入成功！但当前环境不支持 IndexedDB，已用本地存储降级保存（图片可能不完整）。');
            } else {
              alert('数据导入成功！右侧面板已更新，画布中的同类节点也会同步刷新。');
            }
          } catch (se) {
            alert('导入成功但无法保存：' + (se && se.message ? se.message : '存储空间已满') + '\n可尝试清理浏览器缓存后再导入。');
          }
        } else {
          alert('导入失败：数据格式不正确（缺少 WEAPON_DATA 字段）。');
        }
      } catch (err) {
        console.error(err);
        // 给出更明确的错误提示，便于排查
        let snippet = (e.target.result || '').slice(0, 60).replace(/\s+/g, ' ');
        alert('导入失败：文件解析错误。\n' + err.message + '\n文件开头：' + snippet);
      }
    })();
  };
  reader.readAsText(file);
}

// 导入后刷新已存在的节点
function refreshNodesAfterImport() {
  state.nodes.forEach(node => {
    if (node.weaponData && node.weaponData.id) {
      const fresh = findWeaponById(node.weaponData.id);
      if (fresh) {
        node.weaponData = fresh;
        const existing = dom.nodesLayer.querySelector(`[data-id="${node.id}"]`);
        if (existing) {
          existing.remove();
          renderNode(node);
        }
      }
    }
  });
  updatePortStates();
  updateAllConnections();
  recalculate();
}

// 启动
window.addEventListener('DOMContentLoaded', init);
