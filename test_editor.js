// 模拟浏览器 DOM 环境测试 editor.js
const fs = require('fs');

// 模拟 document
global.document = {
  getElementById: (id) => {
    const el = {
      id,
      value: '',
      checked: false,
      innerHTML: '',
      style: { display: '' },
      classList: { add: ()=>{}, remove: ()=>{} },
      dataset: {},
      addEventListener: ()=>{},
      querySelectorAll: ()=>[],
      querySelector: ()=>null,
      textContent: '',
      className: '',
      complete: true,
      naturalWidth: 0,
    };
    if (id === 'f-plugin-category') el.value = '1';
    if (id === 'f-category') el.value = '主武器';
    return el;
  },
  createElement: (tag) => ({ className: '', style: {}, textContent: '', innerHTML: '', appendChild: ()=>{}, dataset: {} }),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: { appendChild: ()=>{}, innerHTML: '' },
};

// 模拟 data.js 全局变量
global.NODE_TYPES = {};
global.SIDEBAR_TABS = [];
global.ATTRIBUTES = {};
global.ATTRIBUTE_KEYS = ['物理','火焰','寒冰','电弧','腐蚀'];
global.PRIMARY_CATEGORIES = [];
global.SECONDARY_CATEGORIES = [];
global.PLUGIN_CATEGORIES = [1,2,3,4];
global.PLUGIN_ATTRIBUTE_TYPES = [
  { key: 'weaponShootDmg', label: '武器射击伤害', field: 'damage', desc: '' },
  { key: 'dmgUp', label: '增伤提升', field: 'damage', desc: '' },
];
global.getPluginAttrType = (k) => global.PLUGIN_ATTRIBUTE_TYPES.find(t => t.key === k) || null;
global.WEAPON_DATA = {};

// 模拟 storage-helper.js
global.NZWStorage = {
  saveWeaponData: () => Promise.resolve('idb'),
  loadWeaponData: () => Promise.resolve(null),
  clearWeaponData: () => Promise.resolve(),
};

// 模拟 window
global.window = { localStorage: { getItem: ()=>null, setItem: ()=>{}, removeItem: ()=>{} }, indexedDB: null };

const filePath = 'C:\\Users\\Administrator\\WorkBuddy\\2026-07-11-21-26-11\\editor.js';
const code = fs.readFileSync(filePath, 'utf8');

try {
  eval(code);
  console.log('OK: editor.js loaded without syntax or runtime errors');
  console.log('populateAttributeSelects exists:', typeof populateAttributeSelects !== 'undefined');
  console.log('toggleFieldsByCategory exists:', typeof toggleFieldsByCategory !== 'undefined');
  console.log('resetForm exists:', typeof resetForm !== 'undefined');
  console.log('el.pluginMaxStacks:', typeof el !== 'undefined' && el.pluginMaxStacks ? 'yes' : 'no');
  console.log('el.pluginAttrType:', typeof el !== 'undefined' && el.pluginAttrType ? 'yes' : 'no');
} catch (e) {
  console.error('ERROR:', e.message);
  console.error('At line:', e.stack?.split('\n')[0]);
}
