const fs=require('fs');
const s=fs.readFileSync('data.js','utf8');
const i=s.indexOf('w_yingzhishang');
const seg=s.slice(i, i+2500);
const m=seg.match(/attribute:/s*'([^']+)'/);
console.log('attribute:', m?m[1]:'(not found)');
