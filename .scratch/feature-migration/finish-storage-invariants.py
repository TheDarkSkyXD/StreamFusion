from pathlib import Path
b=Path('apps/desktop/src/backend')
p=b/'features/authentication/data/authentication-store-schema.ts';t=p.read_text()+'\nexport const AUTHENTICATION_STORE_KEYS = [\n  "authTokens", "twitchFollowWriteToken", "kickWebBearer", "appTokens", "twitchUser", "kickUser",\n] as const satisfies readonly (keyof AuthenticationStoreSchema)[];\n';p.write_text(t)
p=b/'features/settings/data/legacy-store-migration.ts';t=p.read_text();t='import { AUTHENTICATION_STORE_KEYS } from "../../authentication/data/authentication-store-schema";\n'+t;a=t.index('  "authTokens",');z=t.index('  "preferences",');t=t[:a]+'  ...AUTHENTICATION_STORE_KEYS,\n'+t[z:];p.write_text(t)
p=Path('apps/desktop/tests/backend/services/database-service.test.ts');t=p.read_text();a=t.index('    svc.migrateKeyValues({');z=t.index('\n\n    expect(svc.getJson',a);t=t[:a]+'    svc.transaction(() => {\n'+t[a:z]+'\n    });'+t[z:];p.write_text(t)
