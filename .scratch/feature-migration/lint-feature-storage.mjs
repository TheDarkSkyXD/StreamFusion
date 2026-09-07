import fs from 'node:fs';import path from 'node:path';import { ESLint } from '../../node_modules/eslint/lib/api.js';
const files=JSON.parse(fs.readFileSync('.scratch/feature-migration/storage-owned-files.json','utf8')).map(f=>path.resolve(f));
const eslint=new ESLint({cwd:path.resolve('apps/desktop')});const results=await eslint.lintFiles(files);const formatter=await eslint.loadFormatter('stylish');console.log(formatter.format(results));process.exitCode=results.some(r=>r.errorCount)?1:0;
