export interface DbRef {
  connectionId: string;
  database: string;
  schema?: string;
}
export interface Workspace {
  id: string;
  name: string;
  description: string;
  connectionIds?: string[];
}
export interface ConnectionInfo {
  databaseType?: 'mysql' | 'postgresql';
  driverId?: string;
  driverVersion?: string;
  initialDatabase?: string;
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  group: string;
  sortOrder?: number;
  databases: string[];
  workspaceIds: string[];
  ssl: boolean;
  ca: string;
  clientCert: string;
  hasPassword: boolean;
  password?: string;
  certificatePassword?: string;
}
export interface ConnectionGroup {
  id: string;
  name: string;
  sortOrder: number;
}
export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  extra: string;
  comment: string;
  ordinal: number;
  definition: string;
  generation?: string;
  collation?: string;
}
export interface Table {
  databaseType?: 'mysql' | 'postgresql';
  primaryKeyColumns?: string[];
  attributes?: Record<string, unknown>;
  name: string;
  exists: boolean;
  createSql: string;
  engine: string;
  charset: string;
  collation: string;
  comment: string;
  columns: Column[];
  indexes: { name: string; unique: boolean; type: string; columns: string[]; definition: string }[];
  foreignKeys: { name: string; definition: string; referencedTable: string }[];
  rows: Record<string, unknown>[];
  supported: boolean;
  issues: string[];
}
export interface TableChoice {
  name: string;
  structure: boolean;
  data: boolean;
  keyColumns: string[];
  keyText?: string;
  structureOptions?: StructureOptions;
}
export interface StructureOptions {
  columns: boolean;
  columnOrder: boolean;
  tableComment: boolean;
  columnComments: boolean;
  indexes: boolean;
  foreignKeys: boolean;
  tableCollation: boolean;
}
export interface CompareProgress {
  ref?: DbRef;
  table: string;
  phase: string;
  completed: number;
  total: number;
  rows: number;
}
export interface CompareTask {
  compareId: string;
  status: 'RUNNING' | 'CANCELLING' | 'CANCELLED' | 'COMPLETED' | 'FAILED';
  progress: CompareProgress;
  error?: string;
  plan?: SyncPlan;
}
export interface Change {
  statements?: string[];
  matchColumns?: string[];
  id: string;
  targetKey: string;
  table: string;
  kind: string;
  label: string;
  sql: string;
  rollbackSql: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  risk: boolean;
  selected: boolean;
  blocked: boolean;
  reason: string;
  changedParts?: string[];
}
export interface TargetPlan {
  ref: DbRef;
  label: string;
  error: string;
  serverVersion: string;
  connectionIdentity?: Record<string, unknown>;
  before: Record<string, Table>;
  changes: Change[];
  skippedTables?: string[];
}
export interface SyncPlan {
  formatVersion?: number;
  databaseType?: 'mysql' | 'postgresql';
  adapterVersion?: string;
  sourceDriverId?: string;
  sourceDriverVersion?: string;
  id: string;
  workspaceId: string;
  createdAt: string;
  source: DbRef;
  tables: TableChoice[];
  sourceSnapshot: Record<string, Table>;
  targets: TargetPlan[];
}
export interface Step {
  changeId: string;
  status: string;
  error: string;
  startedAt: string;
  finishedAt: string;
}
export interface TargetResult {
  ref: DbRef;
  status: string;
  error: string;
  steps: Step[];
  backups: Record<string, string>;
  expected: Record<string, string>;
  recoveryRows?: Record<string, Record<string, unknown>[]>;
  recoveryDigests?: Record<string, string>;
}
export interface SyncRecord {
  id: string;
  workspaceId: string;
  createdAt: string;
  mode: string;
  status: string;
  remark: string;
  parentId: string;
  archivePath: string;
  recoveryFormat?: string;
  plan?: SyncPlan;
  source?: DbRef;
  tables?: TableChoice[];
  targetCount?: number;
  selectedIds: string[];
  results: TargetResult[];
}
export interface SyncTemplate {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  source: DbRef;
  targets: DbRef[];
  tables: TableChoice[];
}
export interface Version {
  id: string;
  workspaceId: string;
  number: string;
  description: string;
  createdAt: string;
}
export interface Settings {
  id: string;
  concurrency: number;
  perHost: number;
  batchSize: number;
  archivePath: string;
  retention: string;
}
export interface State {
  workspaces: Workspace[];
  connections: ConnectionInfo[];
  connectionGroups: ConnectionGroup[];
  templates: SyncTemplate[];
  records: SyncRecord[];
  versions: Version[];
  versionLinks: Record<string, string>;
  settings: Settings;
  external: Record<string, unknown>[];
}
export interface RollbackItem {
  id: string;
  targetKey: string;
  table: string;
  label: string;
  reason: string;
  eligible: boolean;
  selected: boolean;
  sql: string[];
}
export interface RollbackPlan {
  id: string;
  recordId: string;
  items: RollbackItem[];
}
export interface DesktopBridge {
  invoke<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  onEvent(fn: (event: Record<string, unknown>) => void): () => void;
  window(action: string): void;
}
export type ThemeMode = 'light' | 'dark' | 'system';
export interface UpdateState {
  version: string;
  enabled: boolean;
  revision: number;
  status:
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'current'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'error';
  nextVersion?: string;
  percent?: number;
  message: string;
}
export interface Appearance {
  themeMode: ThemeMode;
  resolvedTheme: 'light' | 'dark';
}
export interface DriverState {
  id: string;
  databaseType: string;
  name: string;
  version: string;
  builtin: boolean;
  license: string;
  licenseUrl: string;
  status: 'missing' | 'downloading' | 'installed' | 'error' | 'cancelled';
  revision: number;
  bytes: number;
  message: string;
}
declare global {
  interface Window {
    dbAligner?: DesktopBridge;
  }
}
