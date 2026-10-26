'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let failed = false;
function visit(dir) { for (const item of fs.readdirSync(dir,{withFileTypes:true})) { const file=path.join(dir,item.name); if(item.isDirectory())visit(file); else if(/\.(cjs|js)$/.test(file)){ const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'}); if(result.status){console.error(result.stderr);failed=true;} } } }
for (const folder of ['desktop','src','scripts','test']) visit(path.join(root,folder));
const html=fs.readFileSync(path.join(root,'desktop/renderer/index.html'),'utf8');
if(!html.includes("connect-src 'none'") || !html.includes("script-src 'self'")){failed=true;console.error('Renderer CSP must remain restricted.');}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.build.publish!==null || !pkg.private){failed=true;console.error('Automatic publishing must remain disabled.');}
console.log(failed?'Checks failed.':'Syntax, local-only renderer and no-auto-publish checks passed.');
process.exitCode=failed?1:0;
