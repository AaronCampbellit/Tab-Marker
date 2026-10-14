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
  version: 2;
  rules: Rule[];
}
export interface TabState {
  id: number;
  /** Sanitized URL: credentials, query, and hash removed. Never a page title. */
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
}
export interface RequestMap {
  GET_STATE: { input: { tabId?: number }; output: AppState };
  SAVE_CUSTOMIZATION: {
    input: { tabId: number; scope: RuleScope | 'tab'; match?: string } & Customization;
    output: AppState;
  };
  REMOVE_APPLIED: { input: { tabId: number }; output: AppState };
  UPSERT_RULE: { input: { rule: Rule }; output: AppState };
  DELETE_RULE: { input: { id: string }; output: AppState };
  TOGGLE_RULE: { input: { id: string; enabled: boolean }; output: AppState };
  GET_DIAGNOSTICS: { input: { tabId: number }; output: Diagnostics };
}
export type Request = {
  [K in keyof RequestMap]: { type: K } & RequestMap[K]['input'];
}[keyof RequestMap];
export type Response<T> = { ok: true; data: T } | { ok: false; error: string };
export type ContentMessage =
  | { type: 'TM_APPLY'; customization: Customization | null; url: string }
  | { type: 'TM_DIAGNOSTICS' };
