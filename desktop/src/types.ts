export interface DbRef {
  connectionId: string;
  database: string;
}
export interface Workspace {
  id: string;
  name: string;
  description: string;
  connectionIds?: string[];
}
export interface ConnectionInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  group: string;
  databases: string[];
  workspaceIds: string[];
  ssl: boolean;
  ca: string;
  clientCert: string;
  hasPassword: boolean;
  password?: string;
  certificatePassword?: string;
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
}
export interface Table {
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
}
export interface Change {
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
}
export interface TargetPlan {
  ref: DbRef;
  label: string;
  error: string;
  serverVersion: string;
  connectionIdentity?: Record<string, unknown>;
  before: Record<string, Table>;
  changes: Change[];
}
export interface SyncPlan {
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
declare global {
  interface Window {
    dataSync?: DesktopBridge;
  }
}
