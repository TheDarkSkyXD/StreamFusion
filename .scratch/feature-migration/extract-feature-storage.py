from pathlib import Path
import re,json
root=Path('apps/desktop/src/backend'); s=(root/'services/storage-service.ts').read_text(); d=(root/'services/database-service.ts').read_text()
out=Path('.scratch/feature-migration');out.mkdir(parents=True,exist_ok=True)
(out/'storage-before.ts').write_text(s);(out/'database-before.ts').write_text(d)
def between(t,a,b):return t[t.index(a):t.index(b)]
def write(p,t):
 p=root/p;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(t)
imports=between(s,'import { safeStorage','// ========== Default Values').replace('../../shared/','@shared/').replace('"./database-service"','"@backend/services/database-service"')
schema=between(s,'interface ElectronStoreSchema','interface KickApiRateLimitState').replace('interface ElectronStoreSchema','export interface ElectronStoreSchema')
defaults=between(s,'const defaults:','// ========== Storage Service Class').replace('const defaults:','export const defaults:')
write(Path('features/settings/data/persistent-store-schema.ts'),imports+'\n'+schema+defaults)
# SQL follow repository owns schema and mappers, driver retains only generic key-values and connection lifecycle.
followtypes=between(d,'/**\n * Source tag','export class DatabaseService')
followtypes=re.sub(r'export type JsonReadResult =[\s\S]*?legacyFollows\?: readonly LocalFollow\[\];\n}\n','',followtypes)
followmethods=between(d,'  getAllFollows():','\n}\n\nexport const dbService')
followinit=between(d,'    // 2. Local Follows','    logger.debug("Service:DB", "SQLite Schema initialized")')
followimports=between(d,'import type { FollowSource','/**\n * Source tag').replace('../../shared/','@shared/')
write(Path('features/authentication/data/follow-repository.ts'),'import type Database from "better-sqlite3";\nimport { dbService, type DatabaseService } from "@backend/services/database-service";\n'+followimports+'\n'+followtypes+'\nexport function initializeFollowSchema(database: Database.Database): void {\n'+followinit.replace('this.database','database')+'}\n\nexport class FollowRepository {\n  constructor(private readonly driver: Pick<DatabaseService, "getConnection"> = dbService) {}\n  private get database(): Database.Database { return this.driver.getConnection(); }\n'+followmethods+'}\n\nexport const followRepository = new FollowRepository();\n')
# Keep legacy SQL in feature-owned migration helper inside the same transaction.
legacy_sql=between(d,'    const insertLegacyFollow =','    this.database.transaction(() => {')
legacy_loop=between(d,'      for (const follow of legacyFollows)','    })();\n  }\n\n  delete')
p=root/'features/authentication/data/follow-repository.ts';p.write_text(p.read_text()+'\nexport function importLegacyFollows(database: Database.Database, legacyFollows: readonly LocalFollow[]): void {\n'+legacy_sql.replace('this.database','database')+legacy_loop+'}\n')
dnew=d.replace(between(d,'/**\n * Source tag','export class DatabaseService'),'export type JsonReadResult =\n  { kind: "missing" } | { kind: "invalid" } | { kind: "value"; value: unknown };\n\nexport interface KeyValueMigrationEntry { key: string; value: unknown; }\nexport interface KeyValueMigration {\n  entries: readonly KeyValueMigrationEntry[];\n  deleteKeys: readonly string[];\n}\n\n')
dnew=dnew.replace(followinit,'    initializeFollowSchema(this.database);\n').replace(followmethods,'').replace('entries, deleteKeys, legacyFollows = []','entries, deleteKeys').replace(legacy_sql,'').replace(legacy_loop,'')
dnew='import { initializeFollowSchema } from "../features/authentication/data/follow-repository";\n'+dnew
write(Path('services/database-service.ts'),dnew)
# Authentication records and their storage workflows.
authhelpers=between(s,'const KICK_ACCOUNT_FOLLOWS_VERIFIED_KEY','const LEGACY_LATENCY_FIRST_BUFFER_PREFERENCES')+between(s,'function isAuthToken','function hydratePreferences')
authmethods=between(s,'  // ========== Token Management','  /**\n   * Get all preferences.')
authmethods=re.sub(r'dbService\.('+ '|'.join(re.findall(r'^  (\w+)\(',followmethods,re.M))+r')\b',r'followRepository.\1',authmethods)
write(Path('features/authentication/data/authentication-repository.ts'),imports.replace('type PendingFollowAction,','').replace('type PendingFollowWrite,','').replace('type PendingFollowWriteStatus,','')+'import { storageService, type StorageService } from "@backend/services/storage-service";\nimport type { ElectronStoreSchema } from "../../settings/data/persistent-store-schema";\nimport { followRepository, type PendingFollowAction, type PendingFollowWrite, type PendingFollowWriteStatus } from "./follow-repository";\n'+authhelpers+'\nexport class AuthenticationRepository {\n  private tokenCache = new Map<Platform, AuthToken>();\n  constructor(private readonly driver: StorageService = storageService) {}\n  private get storeInstance() { return this.driver.getStore(); }\n  private get isEncryptionAvailable(): boolean { return this.driver.encryptionAvailable; }\n'+authmethods+'}\n\nexport const authenticationRepository = new AuthenticationRepository();\n')
prefhelpers=between(s,'const LEGACY_LATENCY_FIRST_BUFFER_PREFERENCES','function isAuthToken')+between(s,'function hydratePreferences','const defaults:')
prefmethods=between(s,'  /**\n   * Get all preferences.','  // ========== Window State Management')
write(Path('features/settings/data/preferences-repository.ts'),imports+'import { storageService, type StorageService } from "@backend/services/storage-service";\nimport { defaults } from "./persistent-store-schema";\n'+prefhelpers+'\nexport class PreferencesRepository {\n  private readonly preferenceListeners = new Set<(preferences: UserPreferences) => void>();\n  constructor(private readonly driver: StorageService = storageService) {}\n  private get storeInstance() { return this.driver.getStore(); }\n'+prefmethods+'}\n\nexport const preferencesRepository = new PreferencesRepository();\n')
# Renderer key ownership and migration live with settings persistence.
policy=between(s,'const ELECTRON_STORE_KEYS','function normalizeLegacyLocalFollows')
legacy_normalizer=between(s,'function normalizeLegacyLocalFollows','const KICK_ACCOUNT_FOLLOWS_VERIFIED_KEY')
write(Path('features/authentication/data/legacy-follows.ts'),'import type { LocalFollow } from "@shared/auth-types";\n'+legacy_normalizer.replace('function normalizeLegacyLocalFollows','export function normalizeLegacyLocalFollows'))
migration=between(s,'  private migrateLegacyStore(): void {','  // ========== Token Management')
migration=migration.replace('  private migrateLegacyStore(): void {','export function migrateLegacyStore(storeInstance: Store<ElectronStoreSchema>): void {').replace('this.storeInstance','storeInstance')
legacy_arg=between(migration,'      legacyFollows:','      deleteKeys:')
migration=migration.replace(legacy_arg,'')
migration=migration.replace('    dbService.migrateKeyValues({','    const migrate = () => {\n    dbService.migrateKeyValues({').replace('    if (Object.keys(source)', '    importLegacyFollows(dbService.getConnection(), normalizeLegacyLocalFollows(sourceEntries.find(([key]) => key === "localFollows")?.[1]));\n    };\n    dbService.getConnection().transaction(migrate)();\n\n    if (Object.keys(source)')
write(Path('features/settings/data/legacy-store-migration.ts'),imports+'import { defaults, type ElectronStoreSchema } from "./persistent-store-schema";\nimport { importLegacyFollows } from "../../authentication/data/follow-repository";\nimport { normalizeLegacyLocalFollows } from "../../authentication/data/legacy-follows";\n'+policy.replace('function rendererStoreKey','export function rendererStoreKey').replace('function assertRendererStoreKey','export function assertRendererStoreKey')+migration)
# Operational persistence already extracted for media. Extract Kick continuity too.
operational=between(s,'  // ========== Kick API continuity','  // ========== Downloads Queue')
write(Path('features/authentication/data/kick-continuity-repository.ts'),'import { dbService } from "@backend/services/database-service";\n'+between(s,'interface KickApiRateLimitState','const ELECTRON_STORE_KEYS')+'const OPERATIONAL_KEYS = { kickApiRateLimit: "operational:kickApiRateLimit", kickFollowedStreamsCache: "operational:kickFollowedStreamsCache" };\n\nclass KickContinuityRepository {\n'+operational+'}\nexport const kickContinuityRepository = new KickContinuityRepository();\n')
start=between(s,'  initialize()','  private migrateLegacyStore')
start=start.replace('this.migrateLegacyStore();','migrateLegacyStore(this.storeInstance);')
window=between(s,'  // ========== Window State Management','  // ========== Kick API continuity')
generic=between(s,'  // ========== Generic Renderer Storage','// ========== Export Singleton')
generic=generic.replace('dbService.clearFollows();','followRepository.clearFollows();')
write(Path('services/storage-service.ts'),'import { safeStorage } from "electron";\nimport Store from "electron-store";\nimport { logger } from "@shared/utils/cross-logger";\nimport { DEFAULT_WINDOW_BOUNDS } from "@shared/auth-types";\nimport { dbService } from "./database-service";\nimport { followRepository } from "../features/authentication/data/follow-repository";\nimport { defaults, type ElectronStoreSchema } from "../features/settings/data/persistent-store-schema";\nimport { migrateLegacyStore, assertRendererStoreKey, rendererStoreKey } from "../features/settings/data/legacy-store-migration";\n\nexport class StorageService {\n  private store: Store<ElectronStoreSchema> | null = null;\n  private isEncryptionAvailable = false;\n  get encryptionAvailable(): boolean { return this.isEncryptionAvailable; }\n  getStore(): Store<ElectronStoreSchema> { return this.storeInstance; }\n'+start+window+generic+'export const storageService = new StorageService();\n')
# Record method ownership for an idempotent caller codemod.
methodmap={}
for txt,repo,module in [(authmethods,'authenticationRepository','authentication/data/authentication-repository'),(prefmethods,'preferencesRepository','settings/data/preferences-repository'),(operational,'kickContinuityRepository','authentication/data/kick-continuity-repository'),(between(s,'  // ========== Downloads Queue','  // ========== Generic Renderer Storage'),'mediaLibraryPersistence','media-library/data/media-library-persistence')]:
 for name in re.findall(r'^  (\w+)\(',txt,re.M):methodmap[name]=[repo,'@backend/features/'+module]
(out/'storage-method-map.json').write_text(json.dumps(methodmap,indent=2))
(out/'follow-method-map.json').write_text(json.dumps(re.findall(r'^  (\w+)\(',followmethods,re.M)))
