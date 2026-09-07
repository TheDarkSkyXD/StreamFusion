from pathlib import Path
import re
b=Path('apps/desktop/src/backend')
p=b/'features/settings/data/persistent-store-schema.ts';t=p.read_text();a=t.index('  authTokens:');z=t.index('  preferences:');fields=t[a:z];a2=t.index('  authTokens: {}');z2=t.index('  preferences: DEFAULT');defs=t[a2:z2];t=t[:a]+t[z:];t=t.replace(defs,'  ...authenticationDefaults,\n').replace('export interface ElectronStoreSchema {','export interface ElectronStoreSchema extends AuthenticationStoreSchema {');t='import { authenticationDefaults, type AuthenticationStoreSchema } from "../../authentication/data/authentication-store-schema";\n'+t;p.write_text(t)
(b/'features/authentication/data/authentication-store-schema.ts').write_text('import type { EncryptedToken, KickUser, TwitchUser } from "@shared/auth-types";\nimport type { Platform } from "@streamfusion/core/platform";\n\nexport interface AuthenticationStoreSchema {\n'+fields+'}\n\nexport const authenticationDefaults: AuthenticationStoreSchema = {\n'+defs+'};\n')
p=b/'features/authentication/data/follow-repository.ts';t=p.read_text();a=t.index('export type PendingFollowAction');z=t.index('interface PendingFollowWriteDbRow');types=t[a:z];(b/'features/authentication/capabilities/follow-persistence.ts').write_text(types);t=t[:a]+t[z:];t='import type { PendingFollowAction, PendingFollowWrite, PendingFollowWriteStatus } from "../capabilities/follow-persistence";\n'+t;p.write_text(t)
for p in Path('apps/desktop').rglob('*.ts'):
 if 'node_modules' in p.parts or 'out' in p.parts:continue
 t=p.read_text();old=t
 # Separate public contracts from concrete SQL repository imports.
 pattern=r'import\s+(type\s+)?\{([^}]*PendingFollow[^}]*)\}\s+from\s+["\']([^"\']*follow-repository)["\'];'
 def repl(m):
  names=[n.strip() for n in m[2].split(',') if n.strip()];types=[n.removeprefix('type ') for n in names if 'PendingFollow' in n];values=[n for n in names if 'PendingFollow' not in n];return ('import { '+', '.join(values)+' } from "'+m[3]+'";\n' if values else '')+'import type { '+', '.join(types)+' } from "@backend/features/authentication/capabilities/follow-persistence";'
 t=re.sub(pattern,repl,t)
 if t!=old:p.write_text(t)
p=b/'services/storage-service.ts';t=p.read_text();a=t.index('  // ========== Window State Management');z=t.index('  // ========== Generic Renderer Storage');t=t[:a]+t[z:];a=t.index('  /**\n   * Clear all storage');z=t.index('  /**\n   * Get storage file path',a);t=t[:a]+t[z:];p.write_text(t)
# Persisted verification data belongs beside the account follow repository.
p=b/'features/authentication/adapters/kick/kick-follow-identity-service.ts';t=p.read_text();a=t.index('type KickFollowVerificationEntry');z=t.index('function isFreshVerification');data=t[a:z];batch='const KICK_FOLLOW_VERIFICATION_BATCH_SIZE = 3;\n';ttl='const KICK_FOLLOW_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;\n';data=data.replace(batch,'').replace(ttl,'');c=t.index('async function commitVerificationCache');end=t.index('function uniqueByLowercase',c);data+=t[c:end];data=data.replace('type KickFollowVerificationEntry','export type KickFollowVerificationEntry').replace('function readVerificationCache','export function readVerificationCache').replace('async function commitVerificationCache','export async function commitVerificationCache');(b/'features/authentication/data/kick-follow-verification-repository.ts').write_text('import { dbService } from "@backend/services/database-service";\n\n'+data)
t=t[:a]+ttl+batch+'\n'+t[z:c]+t[end:];t=t.replace('import { dbService } from "@backend/services/database-service";','import { readVerificationCache, commitVerificationCache, type KickFollowVerificationEntry } from "../../data/kick-follow-verification-repository";');p.write_text(t)
