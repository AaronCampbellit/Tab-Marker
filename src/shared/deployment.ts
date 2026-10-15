export interface DeploymentStatus {
  schemaVersion: 1;
  product: 'TabMarker';
  state: 'applying' | 'ready';
  version: string;
}

export type UpdateState =
  | { kind: 'current'; running: string }
  | { kind: 'applying'; running: string }
  | { kind: 'ready'; running: string; installed: string }
  | { kind: 'unavailable'; running: string };

export function validVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(\.\d+){0,3}$/.test(value)
    && value.split('.').every(part => Number(part) <= 65535);
}

// A different version may also be an intentional RMM rollback.
export function deploymentState(running: string, manifest: unknown, marker: unknown): UpdateState {
  const disk = manifest as { name?: unknown; version?: unknown; manifest_version?: unknown } | null;
  const status = marker as Partial<DeploymentStatus> | null;
  if (status?.schemaVersion !== 1 || status.product !== 'TabMarker') return { kind: 'unavailable', running };
  if (status.state === 'applying') return { kind: 'applying', running };
  if (!disk || disk.name !== 'TabMarker' || disk.manifest_version !== 3 || !validVersion(disk.version)
    || status.state !== 'ready' || status.version !== disk.version) return { kind: 'unavailable', running };
  return disk.version === running ? { kind: 'current', running } : { kind: 'ready', running, installed: disk.version };
}

export async function readDeployment(): Promise<UpdateState> {
  const running = chrome.runtime.getManifest().version;
  try {
    const read = async (file: string) => {
      const response = await fetch(`${chrome.runtime.getURL(file)}?check=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Deployment file unavailable');
      return response.json() as Promise<unknown>;
    };
    // Check the marker again after reading the manifest to avoid offering a
    // reload while an RMM deployment has begun between those reads.
    const manifest = await read('manifest.json');
    const marker = await read('update-status.json');
    return deploymentState(running, manifest, marker);
  } catch { return { kind: 'unavailable', running }; }
}
