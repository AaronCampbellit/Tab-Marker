import type { RequestMap, Response } from './types';
export async function request<K extends keyof RequestMap>(
  type: K,
  input: RequestMap[K]['input'],
): Promise<RequestMap[K]['output']> {
  const response = (await chrome.runtime.sendMessage({ type, ...input })) as Response<RequestMap[K]['output']>;
  if (!response) throw new Error('TabMarker did not respond. Reload the extension and this page.');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}
