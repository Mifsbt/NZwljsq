/**
 * 逆战未来 · 武器数据编辑器
 * 自定义武器/插件，上传图片，导出 JSON 供无限画布计算器导入
 */

const LS_KEY = 'nzw_weapon_data';

// 编辑器数据（与计算器 WEAPON_DATA 结构一致）
let editorData = {
  主武器: {},
  副武器: {},
  近战武器: [],
  插件: [],
};

// 编辑态
let editingId = null;
let currentImage = null; // base64 data URL 或 null

// 列表筛选状态
const listFilter = { cat: '全部', search: '' };

// ========== DOM ==========
const el = {
  form: document.getElementById('editor-form'),
  category: document.getElementById('f-category'),
  subcatGroup: document.getElementById('f-subcat-group'),
  subcatLabel: document.getElementById('f-subcat-label'),
  subcat: document.getElementById('f-subcat'),
  imagePreview: document.getElementById('f-image-preview'),
  imageInput: document.getElementById('f-image'),
  btnUpload: document.getElementById('btn-upload'),
  btnClearImage: document.getElementById('btn-clear-image'),
  name: document.getElementById('f-name'),
  weaponFields: document.getElementById('weapon-fields'),
  meleeFields: document.getElementById('melee-fields'),
  pluginFields: document.getElementById('plugin-fields'),
  // weapon
  attribute: document.getElementById('f-attribute'),
  damage: document.getElementById('f-damage'),
  pellets: document.getElementById('f-pellets'),
  fireRate: document.getElementById('f-fireRate'),
  reloadTime: document.getElementById('f-reloadTime'),
  magazine: document.getElementById('f-magazine'),
  totalAmmo: document.getElementById('f-totalAmmo'),
  explosionRange: document.getElementById('f-explosionRange'),
  accuracy: document.getElementById('f-accuracy'),
  stability: document.getElementById('f-stability'),
  // melee
  meleeAttribute: document.getElementById('f-melee-attribute'),
  lightDamage: document.getElementById('f-light-damage'),
  heavyDamage: document.getElementById('f-heavy-damage'),
  eff1Attr: document.getElementById('f-eff1-attr'),
  eff1Dmg: document.getElementById('f-eff1-dmg'),
  eff1Crit: document.getElementById('f-eff1-crit'),
  eff1Custom: document.getElementById('f-eff1-custom'),
  eff2CritDmg: document.getElementById('f-eff2-critdmg'),
  eff2Melee: document.getElementById('f-eff2-melee'),
  eff2Far: document.getElementById('f-eff2-far'),
  eff2Custom: document.getElementById('f-eff2-custom'),
  // secondary effects
  secEff1Dmg: document.getElementById('f-sec-eff1-dmg'),
  secEff1Dur: document.getElementById('f-sec-eff1-dur'),
  secEff2Crit: document.getElementById('f-sec-eff2-crit'),
  secEff2CritDmg: document.getElementById('f-sec-eff2-critdmg'),
  secEff2Dur: document.getElementById('f-sec-eff2-dur'),
  secondaryEffects: document.getElementById('secondary-effects'),
  // plugin
  pluginCategory: document.getElementById('f-plugin-category'),
  pluginAttrType: document.getElementById('f-plugin-attr-type'),
  pluginAttrValue: document.getElementById('f-plugin-attr-value'),
  pluginIndependent: document.getElementById('f-plugin-independent'),
  pluginMaxStacks: document.getElementById('f-plugin-max-stacks'),
  pluginDetail: document.getElementById('f-plugin-detail'),
  // actions
  btnSubmit: document.getElementById('btn-submit'),
  btnCancelEdit: document.getElementById('btn-cancel-edit'),
  // list
  list: document.getElementById('editor-list'),
  itemCount: document.getElementById('item-count'),
  listSearch: document.getElementById('list-search'),
  filterTabs: document.getElementById('filter-tabs'),
  // header buttons
  btnExport: document.getElementById('btn-export-json'),
  btnImport: document.getElementById('btn-import-json'),
  btnClearAll: document.getElementById('btn-clear-all'),
  importFile: document.getElementById('import-file'),
};

// ========== 工具 ==========
function genId() {
  return 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function toast(msg, type = 'success') {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.className = `toast ${type}`;
  }, 2200);
}

// 保存武器数据：委托给共享存储层（IndexedDB，支持大图片）
function saveToLocalStorage() {
  return NZWStorage.saveWeaponData(editorData).catch((e) => {
    console.warn('保存到本地失败', e);
  });
}

async function loadFromLocalStorage() {
  try {
    const loaded = await NZWStorage.loadWeaponData();
    if (loaded && typeof loaded === 'object') {
      editorData = Object.assign({
        主武器: {}, 副武器: {}, 近战武器: [], 插件: []
      }, loaded);
    }
    // 一次性迁移：旧数据中的「电狐」属性统一改名为「电弧」
    if (migrateDianHu()) saveToLocalStorage();
  } catch (e) {
    console.warn('读取本地数据失败', e);
  }
}

// 把武器/插件/近战数据里的「电狐」属性名改为「电弧」，返回是否有改动
function migrateDianHu() {
  let changed = false;
  const fix = (it) => {
    if (!it || typeof it !== 'object') return;
    if (it.attribute === '电狐') { it.attribute = '电弧'; changed = true; }
    if (it.effects && it.effects.e1 && it.effects.e1.attr === '电狐') {
      it.effects.e1.attr = '电弧'; changed = true;
    }
  };
  for (const sub in editorData['主武器']) (editorData['主武器'][sub] || []).forEach(fix);
  for (const sub in editorData['副武器']) (editorData['副武器'][sub] || []).forEach(fix);
  (editorData['近战武器'] || []).forEach(fix);
  (editorData['插件'] || []).forEach(fix);
  return changed;
}

function countItems() {
  let n = 0;
  for (const sub in editorData['主武器']) n += (editorData['主武器'][sub] || []).length;
  for (const sub in editorData['副武器']) n += (editorData['副武器'][sub] || []).length;
  n += editorData['近战武器'].length;
  n += editorData['插件'].length;
  return n;
}

function findItemById(id) {
  const search = (arr) => arr.find(x => x.id === id);
  for (const sub in editorData['主武器']) {
    const f = search(editorData['主武器'][sub] || []);
    if (f) return { item: f, cat: '主武器', sub };
  }
  for (const sub in editorData['副武器']) {
    const f = search(editorData['副武器'][sub] || []);
    if (f) return { item: f, cat: '副武器', sub };
  }
  let f = search(editorData['近战武器']);
  if (f) return { item: f, cat: '近战武器', sub: '' };
  f = search(editorData['插件']);
  if (f) return { item: f, cat: '插件', sub: '' };
  return null;
}

function removeItemById(id) {
  const found = findItemById(id);
  if (!found) return;
  if (found.cat === '主武器' || found.cat === '副武器') {
    editorData[found.cat][found.sub] = (editorData[found.cat][found.sub] || [])
      .filter(x => x.id !== id);
  } else {
    editorData[found.cat] = editorData[found.cat].filter(x => x.id !== id);
  }
}

// ========== 表单渲染 ==========
function renderSubcatOptions() {
  const cat = el.category.value;
  let options = [];
  if (cat === '主武器') {
    options = PRIMARY_CATEGORIES;
    el.subcatLabel.textContent = '子分类（武器类型）';
  } else if (cat === '副武器') {
    options = SECONDARY_CATEGORIES;
    el.subcatLabel.textContent = '子分类（武器类型）';
  } else {
    el.subcatGroup.style.display = 'none';
    return;
  }
  el.subcatGroup.style.display = '';
  el.subcat.innerHTML = options.map(o => `<option value="${o}">${o}</option>`).join('');
}

function populateAttributeSelects() {
  const opts = ATTRIBUTE_KEYS.map(k => `<option value="${k}">${k}</option>`).join('');
  el.attribute.innerHTML = opts;
  el.meleeAttribute.innerHTML = opts;
  el.eff1Attr.innerHTML = opts;
  // 插件属性类型下拉
  el.pluginAttrType.innerHTML = PLUGIN_ATTRIBUTE_TYPES
    .map(t => `<option value="${t.key}">${t.label}</option>`).join('');
}

// 迁移旧的插件 attribute 文本到新的 attrType + attrValue
function migratePluginAttribute(oldAttr) {
  if (!oldAttr) return { attrType: 'dmgUp', attrValue: 0 };
  // 尝试匹配关键词到 attrType
  const lower = oldAttr.toLowerCase();
  if (oldAttr.includes('射击')) return { attrType: 'weaponShootDmg', attrValue: extractPercent(oldAttr) };
  if (oldAttr.includes('增伤')) return { attrType: 'dmgUp', attrValue: extractPercent(oldAttr) };
  if (oldAttr.includes('额外')) return { attrType: 'extraDmg', attrValue: extractPercent(oldAttr) };
  if (oldAttr.includes('技能')) return { attrType: 'weaponSkillDmg', attrValue: extractPercent(oldAttr) };
  if (oldAttr.includes('伤害提升') || oldAttr.includes('伤害增加')) return { attrType: 'dmgUp2', attrValue: extractPercent(oldAttr) };
  return { attrType: 'dmgUp', attrValue: extractPercent(oldAttr) };
}

// 从文本中提取百分比数值
function extractPercent(text) {
  const m = text.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

function toggleFieldsByCategory() {
  const cat = el.category.value;
  const isPlugin = cat === '插件';
  const isMelee = cat === '近战武器';
  el.pluginFields.style.display = isPlugin ? '' : 'none';
  el.meleeFields.style.display = isMelee ? '' : 'none';
  el.weaponFields.style.display = (isPlugin || isMelee) ? 'none' : '';
  el.secondaryEffects.style.display = (cat === '副武器') ? '' : 'none';
  renderSubcatOptions();
}

// ========== 图片上传 ==========
el.btnUpload.addEventListener('click', () => el.imageInput.click());

el.imageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('请选择图片文件', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    currentImage = ev.target.result;
    el.imagePreview.innerHTML = `<img src="${currentImage}" alt="preview" />`;
    el.btnClearImage.style.display = '';
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

el.btnClearImage.addEventListener('click', () => {
  currentImage = null;
  el.imagePreview.innerHTML = '<span class="placeholder">无图片</span>';
  el.btnClearImage.style.display = 'none';
});

// ========== 提交（添加 / 保存修改） ==========
el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const cat = el.category.value;
  const name = el.name.value.trim();
  if (!name) {
    toast('请填写名称', 'error');
    return;
  }

  let item;
  if (cat === '插件') {
    const attrType = el.pluginAttrType.value;
    const attrValue = parseFloat(el.pluginAttrValue.value);
    if (!attrType) {
      toast('请选择插件单一属性类型', 'error');
      return;
    }
    if (isNaN(attrValue) || attrValue === 0) {
      toast('请填写有效的属性数值', 'error');
      return;
    }
    item = {
      id: editingId || genId(),
      name,
      image: currentImage || undefined,
      category: parseInt(el.pluginCategory.value) || 1,
      attrType,
      attrValue,
      independent: el.pluginIndependent.checked,
      maxStacks: parseInt(el.pluginMaxStacks.value, 10) || 1,
      detail: el.pluginDetail.value.trim() || '',
    };
  } else if (cat === '近战武器') {
    const lightDamage = parseFloat(el.lightDamage.value);
    const heavyDamage = parseFloat(el.heavyDamage.value);
    if (isNaN(lightDamage) || isNaN(heavyDamage)) {
      toast('请填写有效的轻击/重击伤害', 'error');
      return;
    }
    const eff1 = {
      attr: el.eff1Attr.value || '物理',
      dmg: parseFloat(el.eff1Dmg.value) || 0,
      crit: parseFloat(el.eff1Crit.value) || 0,
      custom: el.eff1Custom.value.trim() || '',
    };
    const eff2 = {
      critDmg: parseFloat(el.eff2CritDmg.value) || 0,
      melee: parseFloat(el.eff2Melee.value) || 0,
      far: parseFloat(el.eff2Far.value) || 0,
      custom: el.eff2Custom.value.trim() || '',
    };
    item = {
      id: editingId || genId(),
      name,
      image: currentImage || undefined,
      attribute: el.meleeAttribute.value || '物理',
      lightDamage,
      heavyDamage,
      effects: { e1: eff1, e2: eff2 },
    };
  } else {
    const damage = parseFloat(el.damage.value);
    if (isNaN(damage)) {
      toast('请填写有效的单发伤害', 'error');
      return;
    }
    const pellets = parseFloat(el.pellets.value);
    item = {
      id: editingId || genId(),
      name,
      image: currentImage || undefined,
      attribute: el.attribute.value || '物理',
      damage,
      pellets: isNaN(pellets) ? 1 : pellets,
      fireRate: parseFloat(el.fireRate.value) || 0,
      reloadTime: parseFloat(el.reloadTime.value) || 0,
      magazine: parseInt(el.magazine.value) || 0,
      totalAmmo: parseInt(el.totalAmmo.value) || 0,
      explosionRange: parseFloat(el.explosionRange.value) || 0,
      accuracy: parseFloat(el.accuracy.value) || 0,
      stability: parseFloat(el.stability.value) || 0,
    };
    // 副武器：附带特效（武器伤害提升 / 暴击 / 持续）
    if (cat === '副武器') {
      item.effects = {
        e1: {
          dmg: parseFloat(el.secEff1Dmg.value) || 0,
          duration: parseFloat(el.secEff1Dur.value) || 0,
        },
        e2: {
          crit: parseFloat(el.secEff2Crit.value) || 0,
          critDmg: parseFloat(el.secEff2CritDmg.value) || 0,
          duration: parseFloat(el.secEff2Dur.value) || 0,
        },
      };
    }
  }

  if (editingId) {
    // 保存修改：移除旧项，添加新项
    removeItemById(editingId);
  }

  // 添加
  if (cat === '主武器' || cat === '副武器') {
    const sub = el.subcat.value;
    if (!sub) { toast('请选择子分类', 'error'); return; }
    editorData[cat][sub] = editorData[cat][sub] || [];
    editorData[cat][sub].push(item);
  } else {
    editorData[cat].push(item);
  }

  saveToLocalStorage();
  setFilterCat(cat); // 添加/修改后自动切换到该武器分类，确保用户能立刻看到
  resetForm();
  toast(editingId ? '修改已保存' : '已添加武器');
  editingId = null;
});

el.btnCancelEdit.addEventListener('click', () => {
  editingId = null;
  resetForm();
});

// ========== 编辑 / 删除 ==========
function startEdit(id) {
  const found = findItemById(id);
  if (!found) return;
  const item = found.item;
  editingId = id;
  currentImage = item.image || null;

  el.category.value = found.cat;
  toggleFieldsByCategory();
  if (found.sub) el.subcat.value = found.sub;
  el.name.value = item.name;

  // 图片预览
  if (currentImage) {
    el.imagePreview.innerHTML = `<img src="${currentImage}" alt="preview" />`;
    el.btnClearImage.style.display = '';
  } else {
    el.imagePreview.innerHTML = '<span class="placeholder">无图片</span>';
    el.btnClearImage.style.display = 'none';
  }

  if (found.cat === '插件') {
    el.pluginCategory.value = String(item.category || 1);
    // 新格式：attrType + attrValue + independent
    if (item.attrType) {
      el.pluginAttrType.value = item.attrType;
      el.pluginAttrValue.value = item.attrValue != null ? item.attrValue : '';
      el.pluginIndependent.checked = !!item.independent;
      el.pluginMaxStacks.value = item.maxStacks != null ? item.maxStacks : '';
    } else if (item.attribute) {
      // 旧格式迁移：attribute 文本 → 尝试匹配 attrType，数值从文本提取
      const migrated = migratePluginAttribute(item.attribute);
      el.pluginAttrType.value = migrated.attrType;
      el.pluginAttrValue.value = migrated.attrValue;
      el.pluginIndependent.checked = false;
    } else {
      el.pluginAttrType.value = '';
      el.pluginAttrValue.value = '';
      el.pluginIndependent.checked = false;
    }
    el.pluginDetail.value = item.detail || '';
  } else if (found.cat === '近战武器') {
    el.meleeAttribute.value = item.attribute || '物理';
    el.lightDamage.value = item.lightDamage !== undefined ? item.lightDamage : '';
    el.heavyDamage.value = item.heavyDamage !== undefined ? item.heavyDamage : '';
    const eff = item.effects || {};
    el.eff1Attr.value = (eff.e1 && eff.e1.attr) || '物理';
    el.eff1Dmg.value = (eff.e1 && eff.e1.dmg != null) ? eff.e1.dmg : '';
    el.eff1Crit.value = (eff.e1 && eff.e1.crit != null) ? eff.e1.crit : '';
    el.eff1Custom.value = (eff.e1 && eff.e1.custom != null) ? eff.e1.custom : '';
    el.eff2CritDmg.value = (eff.e2 && eff.e2.critDmg != null) ? eff.e2.critDmg : '';
    el.eff2Melee.value = (eff.e2 && eff.e2.melee != null) ? eff.e2.melee : '';
    el.eff2Far.value = (eff.e2 && eff.e2.far != null) ? eff.e2.far : '';
  } else {
    el.attribute.value = item.attribute || '物理';
    el.damage.value = item.damage !== undefined ? item.damage : '';
    el.pellets.value = item.pellets && item.pellets !== 1 ? item.pellets : '';
    el.fireRate.value = item.fireRate || '';
    el.reloadTime.value = item.reloadTime || '';
    el.magazine.value = item.magazine || '';
    el.totalAmmo.value = item.totalAmmo || '';
    el.explosionRange.value = item.explosionRange || '';
    el.accuracy.value = item.accuracy || '';
    el.stability.value = item.stability || '';
    const eff = item.effects || {};
    el.secEff1Dmg.value = (eff.e1 && eff.e1.dmg != null) ? eff.e1.dmg : '';
    el.secEff1Dur.value = (eff.e1 && eff.e1.duration != null) ? eff.e1.duration : '';
    el.secEff2Crit.value = (eff.e2 && eff.e2.crit != null) ? eff.e2.crit : '';
    el.secEff2CritDmg.value = (eff.e2 && eff.e2.critDmg != null) ? eff.e2.critDmg : '';
    el.secEff2Dur.value = (eff.e2 && eff.e2.duration != null) ? eff.e2.duration : '';
  }

  el.btnSubmit.textContent = '✓ 保存修改';
  el.btnCancelEdit.style.display = '';
  el.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function deleteItem(id) {
  const found = findItemById(id);
  if (!found) return;
  if (!confirm(`确定删除「${found.item.name}」吗？`)) return;
  removeItemById(id);
  if (editingId === id) {
    editingId = null;
    resetForm();
  }
  saveToLocalStorage();
  renderList();
  toast('已删除');
}

// ========== 重置表单 ==========
function resetForm() {
  el.form.reset();
  currentImage = null;
  el.imagePreview.innerHTML = '<span class="placeholder">无图片</span>';
  el.btnClearImage.style.display = 'none';
  el.btnSubmit.textContent = '✓ 添加武器';
  el.btnCancelEdit.style.display = 'none';
  toggleFieldsByCategory();
}

// ========== 列表渲染 ==========
function renderList() {
  const items = [];
  const collect = (arr, cat, sub) => (arr || []).forEach(x => items.push({ ...x, _cat: cat, _sub: sub }));

  for (const sub in editorData['主武器']) collect(editorData['主武器'][sub], '主武器', sub);
  for (const sub in editorData['副武器']) collect(editorData['副武器'][sub], '副武器', sub);
  collect(editorData['近战武器'], '近战武器', '');
  collect(editorData['插件'], '插件', '');

  // 应用筛选：分类 + 搜索
  const kw = (listFilter.search || '').trim().toLowerCase();
  const filtered = items.filter(it => {
    if (listFilter.cat !== '全部' && it._cat !== listFilter.cat) return false;
    if (kw) {
      const hay = [
        it.name,
        it.attribute,
        it._sub,
        it._cat,
        it._cat === '插件' ? `${it.category}号插件` : '',
        renderItemStats(it),
        it._cat === '近战武器' ? meleeEffectsSummary(it.effects) : '',
        it._cat === '副武器' ? secondaryEffectsSummary(it.effects) : '',
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });

  el.itemCount.textContent = `${filtered.length} 项`;

  if (filtered.length === 0) {
    const msg = items.length === 0
      ? `还没有任何武器数据<br/>在左侧填写信息并点击「添加武器」<br/>或点击右上角「导入JSON」合并已有数据`
      : `没有匹配「${listFilter.cat === '全部' ? '' : listFilter.cat + ' '}${kw}」的武器`;
    el.list.innerHTML = `
      <div class="empty-hint">${msg}</div>`;
    return;
  }

  const cardHtml = (it) => {
    const thumb = it.image
      ? `<img src="${it.image}" alt="${it.name}" />`
      : `<span class="no-img">${categoryEmoji(it._cat)}</span>`;
    const stats = renderItemStats(it);
    const catLabel = it._cat + (it._sub ? ` · ${it._sub}` : '');
    return `
      <div class="editor-item" data-id="${it.id}">
        <div class="item-thumb">${thumb}</div>
        <div class="item-info">
          <div class="item-name">
            ${it.name}
            <span class="item-cat">${it._cat === '插件' ? `${it.category}号插件` : catLabel}</span>
          </div>
          <div class="item-stats">${stats}</div>
        </div>
        <div class="item-actions">
          <button class="item-btn edit" title="编辑" data-action="edit" data-id="${it.id}">编辑</button>
          <button class="item-btn delete" title="删除" data-action="delete" data-id="${it.id}">删除</button>
        </div>
      </div>`;
  };

  const sections = [
    { label: '主武器', cat: '主武器' },
    { label: '副武器', cat: '副武器' },
    { label: '近战武器', cat: '近战武器' },
    { label: '插件', cat: '插件' },
  ];

  let html = '';
  sections.forEach(sec => {
    const secItems = filtered.filter(i => i._cat === sec.cat);
    if (secItems.length === 0) return;
    html += `<div class="editor-section-title">${sec.label}<span class="sec-count">${secItems.length}</span></div>`;
    if (sec.cat === '主武器' || sec.cat === '副武器') {
      const subMap = {};
      secItems.forEach(i => {
        const k = i._sub || '其他';
        (subMap[k] = subMap[k] || []).push(i);
      });
      Object.keys(subMap).forEach(sub => {
        html += `<div class="editor-subsection-title">${sub}</div>`;
        subMap[sub].forEach(i => html += cardHtml(i));
      });
    } else {
      secItems.forEach(i => html += cardHtml(i));
    }
  });

  el.list.innerHTML = html;

  el.list.querySelectorAll('.item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (btn.dataset.action === 'edit') startEdit(id);
      else if (btn.dataset.action === 'delete') deleteItem(id);
    });
  });
}

function categoryEmoji(cat) {
  return { '主武器': '主', '副武器': '副', '近战武器': '近', '插件': '插' }[cat] || '■';
}

function renderItemStats(it) {
  if (it._cat === '插件') {
    const parts = [`<span class="cat-tag">${it.category}号插件</span>`];
    // 新格式：attrType + attrValue + independent
    if (it.attrType) {
      const typeDef = getPluginAttrType(it.attrType);
      if (typeDef) {
        const label = `${typeDef.label} +${it.attrValue}%`;
        parts.push(`<span>${label}</span>`);
      }
      if (it.independent) parts.push(`<span class="independent-tag">独立乘区</span>`);
      if (it.maxStacks > 1) parts.push(`<span class="stack-tag">最高${it.maxStacks}层</span>`);
    } else if (it.attribute) {
      // 旧格式兼容
      parts.push(`<span>${it.attribute}</span>`);
    }
    if (it.detail) parts.push(`<span class="eff">${it.detail}</span>`);
    return parts.filter(Boolean).map(s => `<span>${s}</span>`).join('');
  }
  if (it._cat === '近战武器') {
    const dmg = `轻击 ${it.lightDamage ?? 0} / 重击 ${it.heavyDamage ?? 0}`;
    const eff = meleeEffectsSummary(it.effects);
    return [attrChip(it.attribute), `<span>${dmg}</span>`, eff ? `<span class="eff">${eff}</span>` : ''].filter(Boolean).map(s => `<span>${s}</span>`).join('');
  }
  // 主武器 / 副武器
  const dmgText = it.pellets && it.pellets > 1 ? `${it.damage} × ${it.pellets}` : `${it.damage}`;
  const parts = [
    attrChip(it.attribute),
    `<span>单发 ${dmgText}</span>`,
    it.fireRate ? `<span>射速 ${it.fireRate}</span>` : '',
    it.magazine ? `<span>弹夹 ${it.magazine}</span>` : '',
  ];
  if (it._cat === '副武器') {
    const eff = secondaryEffectsSummary(it.effects);
    if (eff) parts.push(`<span class="eff">${eff}</span>`);
  }
  return parts.filter(Boolean).map(s => `<span>${s}</span>`).join('');
}

function attrChip(attr) {
  const info = ATTRIBUTES[attr] || ATTRIBUTES['物理'];
  return `<span class="attr-chip" style="background:${info.color}22;color:${info.color};border-color:${info.color}66;">${attr}</span>`;
}

function meleeEffectsSummary(effects) {
  if (!effects) return '';
  if (Array.isArray(effects)) return effects.join('；');
  const parts = [];
  if (effects.e1) {
    if (effects.e1.attr && effects.e1.dmg) parts.push(`${effects.e1.attr}伤害+${effects.e1.dmg}%`);
    if (effects.e1.crit) parts.push(`暴击率+${effects.e1.crit}%`);
    if (effects.e1.custom) parts.push(`${effects.e1.custom}`);
  }
  if (effects.e2) {
    if (effects.e2.critDmg) parts.push(`暴伤+${effects.e2.critDmg}%`);
    if (effects.e2.melee) parts.push(`近战+${effects.e2.melee}%`);
    if (effects.e2.far) parts.push(`远武+${effects.e2.far}%`);
    if (effects.e2.custom) parts.push(`${effects.e2.custom}`);
  }
  return parts.join('；');
}

function secondaryEffectsSummary(effects) {
  if (!effects) return '';
  const parts = [];
  if (effects.e1) {
    if (effects.e1.dmg) parts.push(`武器伤害+${effects.e1.dmg}%`);
    if (effects.e1.duration) parts.push(`持续${effects.e1.duration}s`);
  }
  if (effects.e2) {
    if (effects.e2.crit) parts.push(`暴击率+${effects.e2.crit}%`);
    if (effects.e2.critDmg) parts.push(`暴伤+${effects.e2.critDmg}%`);
    if (effects.e2.duration) parts.push(`持续${effects.e2.duration}s`);
  }
  return parts.join('；');
}

// ========== 导出 / 导入 ==========
el.btnExport.addEventListener('click', () => {
  if (countItems() === 0) {
    toast('暂无可导出的数据', 'error');
    return;
  }
  const payload = { WEAPON_DATA: editorData };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `weapon-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('已导出 JSON');
});

el.btnImport.addEventListener('click', () => el.importFile.click());

// 合并导入：保留已有武器，并入导入文件中的武器（按 id 去重，重复覆盖）
function mergeEditorData(newData) {
  // 主武器 / 副武器：按子分类合并
  ['主武器', '副武器'].forEach(cat => {
    const src = newData[cat];
    if (!src || typeof src !== 'object') return;
    for (const sub in src) {
      const arr = src[sub];
      if (!Array.isArray(arr)) continue;
      editorData[cat][sub] = editorData[cat][sub] || [];
      arr.forEach(item => {
        if (!item || !item.id) return;
        const idx = editorData[cat][sub].findIndex(x => x.id === item.id);
        if (idx >= 0) editorData[cat][sub][idx] = item;
        else editorData[cat][sub].push(item);
      });
    }
  });
  // 近战武器 / 插件：合并
  ['近战武器', '插件'].forEach(cat => {
    const arr = newData[cat];
    if (!Array.isArray(arr)) return;
    arr.forEach(item => {
      if (!item || !item.id) return;
      const idx = editorData[cat].findIndex(x => x.id === item.id);
      if (idx >= 0) editorData[cat][idx] = item;
      else editorData[cat].push(item);
    });
  });
}

el.importFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      let text = ev.target.result;
      // 去除 UTF-8 BOM（Windows 记事本等保存会带上），否则 JSON.parse 会抛异常
      if (text && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const parsed = JSON.parse(text);
      const newData = parsed.WEAPON_DATA || parsed;
      if (newData && typeof newData === 'object') {
        const before = countItems();
        mergeEditorData(newData);
        saveToLocalStorage();
        renderList();
        const added = countItems() - before;
        toast(`导入成功！合并新增 ${added} 项，现有 ${countItems()} 项`);
      } else {
        toast('数据格式不正确', 'error');
      }
    } catch (err) {
      toast('解析失败，请检查文件', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

el.btnClearAll.addEventListener('click', () => {
  if (countItems() === 0) return;
  if (!confirm('确定清空所有武器数据吗？此操作不可撤销。')) return;
  editorData = { 主武器: {}, 副武器: {}, 近战武器: [], 插件: [] };
  editingId = null;
  resetForm();
  saveToLocalStorage();
  renderList();
  toast('已清空');
});

// 列表筛选：搜索框
el.listSearch.addEventListener('input', (e) => {
  listFilter.search = e.target.value || '';
  renderList();
});

// 列表筛选：分类标签
function setFilterCat(cat) {
  listFilter.cat = cat || '全部';
  el.filterTabs.querySelectorAll('.filter-tab').forEach(t => {
    t.classList.toggle('active', (t.dataset.cat || '全部') === listFilter.cat);
  });
  renderList();
}

el.filterTabs.querySelectorAll('.filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    setFilterCat(tab.dataset.cat || '全部');
  });
});

// ========== 初始化 ==========
async function init() {
  await loadFromLocalStorage();
  populateAttributeSelects();
  toggleFieldsByCategory();
  renderList();

  el.category.addEventListener('change', toggleFieldsByCategory);
}

init();
