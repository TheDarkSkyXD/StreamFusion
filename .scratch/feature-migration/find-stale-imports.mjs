import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const desktop=path.resolve('apps/desktop');
const require=createRequire(path.join(desktop,'package.json'));
const ts=require('typescript');
const config=ts.readConfigFile(path.join(desktop,'tsconfig.json'),ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,desktop);
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','apps/desktop/src','apps/desktop/tests','apps/desktop/.storybook']).toString().split('\0').filter(f=>/\.[cm]?[jt]sx?$/.test(f)&&fs.existsSync(f));
const cache=ts.createModuleResolutionCache(desktop,f=>f,parsed.options);
const failures=[];
for(const file of files){
 const text=fs.readFileSync(file,'utf8');
 const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 function inspect(node){
  let target;
  if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))target=node.moduleSpecifier;
  if(ts.isCallExpression(node)&&node.arguments.length){
   const name=node.expression.getText(ast);
   if(name==='import'||name==='require'||/^(vi|vitest|jest)\.(mock|doMock|unmock|doUnmock|importActual|importMock)$/.test(name))target=node.arguments[0];
  }
  if(target&&ts.isStringLiteralLike(target)&&/^(\.|@\/|@backend\/|@frontend\/|@shared\/)/.test(target.text)){
   const spec=target.text.split('?')[0];
   if(!/\.(css|svg|png|webp|jpg)$/.test(spec)&&!ts.resolveModuleName(spec,path.resolve(file),parsed.options,ts.sys,cache).resolvedModule)
    failures.push({file,line:ast.getLineAndCharacterOfPosition(target.pos).line+1,spec});
  }
  ts.forEachChild(node,inspect);
 }
 inspect(ast);
}
fs.writeFileSync('.scratch/feature-migration/stale-imports.json',JSON.stringify(failures,null,2)+'\n');
console.log(JSON.stringify(failures,null,2));
