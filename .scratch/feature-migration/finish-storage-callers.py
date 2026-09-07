from pathlib import Path
import re,json
root=Path('apps/desktop'); b=root/'src/backend'
def edit(p,fn):p=Path(p);p.write_text(fn(p.read_text()))
for p in [b/'features/authentication/adapters/kick/kick-follow-write-service.ts',b/'features/authentication/adapters/twitch/twitch-follow-write-service.ts']:
 edit(p,lambda t:t.replace('storageService','authenticationRepository').replace('@backend/services/storage-service','@backend/features/authentication/data/authentication-repository'))
p=b/'features/settings/routes/preferences-routes.ts'
p.write_text('''import type { UserPreferences } from "@shared/auth-types";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import { trustedIpcMain as ipcMain } from "../../../ipc/trusted-ipc-main";
import { preferencesRepository } from "../data/preferences-repository";

export function registerPreferenceRoutes(
  preferences: Pick<typeof preferencesRepository, "getPreferences" | "updatePreferences" | "resetPreferences"> = preferencesRepository
): void {
  ipcMain.handle(IPC_CHANNELS.PREFERENCES_GET, () => preferences.getPreferences());
  ipcMain.handle(IPC_CHANNELS.PREFERENCES_UPDATE,
    (_event, { updates }: { updates: Partial<UserPreferences> }) => preferences.updatePreferences(updates));
  ipcMain.handle(IPC_CHANNELS.PREFERENCES_RESET, () => preferences.resetPreferences());
}
''')
edit(b/'services/native-copy.ts',lambda t:t.replace('"./storage-service"','"@backend/features/settings/data/preferences-repository"'))
edit(b/'features/authentication/data/follow-repository.ts',lambda t:t.replace('private readonly driver: Pick<DatabaseService, "getConnection"> = dbService','private readonly driver?: Pick<DatabaseService, "getConnection">').replace('this.driver.getConnection()','(this.driver ?? dbService).getConnection()'))
p=root/'tests/backend/services/database-service.test.ts';t=p.read_text();methods=json.loads(Path('.scratch/feature-migration/follow-method-map.json').read_text())
t='import { FollowRepository, importLegacyFollows } from "@backend/features/authentication/data/follow-repository";\n'+t
for m in methods:t=re.sub(r'\b(svc2?)\.'+m+r'\b',lambda x:'new FollowRepository('+x[1]+').'+m,t)
a=t.index('    svc.migrateKeyValues({');z=t.index('\n    });',a)+len('\n    });');block=t[a:z];l=block.index('      legacyFollows: ');arr=block[l+len('      legacyFollows: '):block.rindex(',\n    });')]
block=block[:l]+'    });\n    importLegacyFollows(svc.getConnection(), '+arr+');';t=t[:a]+block+t[z:];p.write_text(t)
p=b/'features/authentication/tests/adapters/twitch/twitch-auth-restart.integration.test.ts';t=p.read_text().replace('  return storageService;','  const { authenticationRepository } = await import("@backend/features/authentication/data/authentication-repository");\n  return authenticationRepository;').replace('firstStart.authenticationRepository','firstStart.storageService').replace('secondStart.authenticationRepository','secondStart.storageService');p.write_text(t)
p=root/'tests/backend/services/storage-service.test.ts';t=p.read_text().replace('import { preferencesRepository }','import { PreferencesRepository, preferencesRepository }').replace('import { authenticationRepository }','import { AuthenticationRepository, authenticationRepository }')
methodmap=json.loads(Path('.scratch/feature-migration/storage-method-map.json').read_text())
for m,(owner,module) in methodmap.items():
 cls={'authenticationRepository':'AuthenticationRepository','preferencesRepository':'PreferencesRepository'}.get(owner)
 if cls:
  t=re.sub(r'\b(firstStart|secondStart|service)\.'+m+r'\b',lambda x:'new '+cls+'('+x[1]+').'+m,t)
t=t.replace('createStreamRecordingSessionStore({ storage: storageService','createStreamRecordingSessionStore({ storage: mediaLibraryPersistence')
t=t.replace('({ entries, deleteKeys, legacyFollows = [] })','({ entries, deleteKeys })')
a=t.index('      for (const follow of legacyFollows)');z=t.index('\n    }\n  );',a);t=t[:a]+t[z:]
p.write_text(t)
