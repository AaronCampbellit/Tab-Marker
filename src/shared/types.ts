export interface IconSpec {
  color: string;
  glyph: string;
}
export interface Customization {
  title: string | null;
  icon: IconSpec | null;
}
export type RuleScope = 'exact' | 'pattern' | 'domain';
export interface Rule extends Customization {
  id: string;
  enabled: boolean;
  scope: RuleScope;
  match: string;
  createdAt: number;
  updatedAt: number;
}
export interface StoredState {
  version: 4;
  rules: Rule[];
}
export interface TabState {
  id: number;
  /** Sanitized URL; only reviewed Autotask view values survive. Never a page title. */
  url: string;
  unsupportedReason: string | null;
  customization: Customization | null;
  matchedRuleId: string | null;
  temporary: boolean;
}
export interface AppState {
  rules: Rule[];
  tab: TabState | null;
  nativeTabMenu: boolean;
}
export interface Diagnostics {
  formatVersion: 1;
  siteKind: 'autotask' | 'ordinary';
  protocol: 'http:' | 'https:';
  pathSegmentKinds: ('text' | 'number' | 'uuid' | 'opaque')[];
  queryKeyCategories: string[];
  hasFragment: boolean;
  approvedModuleId: string | null;
  approvedSignals: Record<string, boolean>;
  matchingScope: RuleScope | 'tab' | null;
  nativeTabMenu: boolean;
  note: string;
  recognizedView: { id: string; label: string } | null;
  application?: {
    titleRequested: boolean;
    titleApplied: boolean;
    iconRequested: boolean;
    iconLinksApplied: boolean;
  };
  extensionVersion?: string;
  matchingRules?: { id: string; scope: RuleScope; selected: boolean }[];
  recommendation?: string;
}
export interface BackupStatus {
  state: 'off' | 'synced' | 'pending' | 'permission' | 'error';
  fileName: string | null;
  lastSyncedAt: number | null;
  message: string;
}
export interface BackupOverview {
  file: BackupStatus;
  snapshots: { id: string; createdAt: number; ruleCount: number }[];
}
export interface RequestMap {
  GET_STATE: { input: { tabId?: number }; output: AppState };
  PREVIEW_PATTERN: {
    input: { tabId: number; pattern: string };
    output: { matches: boolean; normalizedPattern: string; exactRuleTakesPriority: boolean };
  };
  SAVE_CUSTOMIZATION: {
    input: { tabId: number; scope: RuleScope | 'tab'; match?: string } & Customization;
    output: AppState;
  };
  REMOVE_APPLIED: { input: { tabId: number }; output: AppState };
  UPSERT_RULE: { input: { rule: Rule }; output: AppState };
  DELETE_RULE: { input: { id: string }; output: AppState };
  TOGGLE_RULE: { input: { id: string; enabled: boolean }; output: AppState };
  GET_DIAGNOSTICS: { input: { tabId: number }; output: Diagnostics };
  GET_BACKUPS: { input: Record<never, never>; output: BackupOverview };
  EXPORT_BACKUP: { input: Record<never, never>; output: string };
  IMPORT_BACKUP: { input: { text: string; mode: 'merge' | 'replace' }; output: AppState };
  RESTORE_SNAPSHOT: { input: { id: string }; output: AppState };
  SYNC_BACKUP: { input: { newConnection?: boolean }; output: BackupOverview };
  DISCONNECT_BACKUP: { input: Record<never, never>; output: BackupOverview };
}
export type Request = {
  [K in keyof RequestMap]: { type: K } & RequestMap[K]['input'];
}[keyof RequestMap];
export type Response<T> = { ok: true; data: T } | { ok: false; error: string };
export type ContentMessage =
  | { type: 'TM_APPLY'; customization: Customization | null; url: string }
  | { type: 'TM_DIAGNOSTICS' };
