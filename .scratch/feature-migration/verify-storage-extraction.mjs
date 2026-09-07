import fs from 'node:fs';
import ts from '../../node_modules/typescript/lib/typescript.js';
const read=p=>fs.readFileSync(p,'utf8');
const originalStorage=read('.scratch/feature-migration/storage-before.ts');
const originalDatabase=read('.scratch/feature-migration/database-before.ts');
function members(text){const ast=ts.createSourceFile('source.ts',text,ts.ScriptTarget.Latest,true);const found=new Map();for(const statement of ast.statements)if(ts.isClassDeclaration(statement))for(const member of statement.members)if(ts.isMethodDeclaration(member)&&member.body&&member.name)found.set(member.name.getText(ast),member.body.getText(ast));return found;}
function tokens(text){const scanner=ts.createScanner(ts.ScriptTarget.Latest,true,ts.LanguageVariant.Standard,text.replaceAll("\r\n", "\n"));const result=[];while(scanner.scan()!==ts.SyntaxKind.EndOfFileToken)result.push(scanner.getTokenText());return result.join('\n');}
const storageBefore=members(originalStorage),databaseBefore=members(originalDatabase);
const driverStorage=members(read('apps/desktop/src/backend/services/storage-service.ts'));
const driverDatabase=members(read('apps/desktop/src/backend/services/database-service.ts'));
const cases=[['authentication/data/authentication-repository.ts',storageBefore,driverStorage],['settings/data/preferences-repository.ts',storageBefore,driverStorage],['authentication/data/follow-repository.ts',databaseBefore,driverDatabase]];
let checked=0;const errors=[];
for(const [file,before,driver] of cases){for(const [name,body] of members(read('apps/desktop/src/backend/features/'+file))){if(!before.has(name))continue;if(driver.has(name))errors.push('Legacy method remains on shared driver: '+name);const normalized=before.get(name).replace(/dbService\.(?=\w+\()/g,(match,offset,whole)=>{const method=whole.slice(offset+match.length).match(/^\w+/)?.[0];return databaseBefore.has(method)&&!driverDatabase.has(method)?'followRepository.':match;});if(tokens(body)!==tokens(normalized))errors.push('Behavior changed in extracted method: '+file+'#'+name);checked++;}}
if(errors.length)throw new Error(errors.join('\n'));
console.log('Verified '+checked+' extracted method bodies preserve their tokens and are absent from the shared drivers.');

