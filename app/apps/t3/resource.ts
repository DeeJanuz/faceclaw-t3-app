/** Legacy IDs address the primary environment; compound keys never cross the RPC wire. */
export function resourceKey(id: string, environmentId?: string): string {
  return environmentId ? JSON.stringify([environmentId, id]) : id;
}
export function resourceRef(key: string): { id: string; environmentId?: string } {
  if (key.startsWith('[')) {
    const value = JSON.parse(key);
    if (!Array.isArray(value) || value.length !== 2 || value.some(v => typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(v))) throw new Error('Invalid environment resource');
    return { id: value[1], environmentId: value[0] };
  }
  return { id: key };
}
