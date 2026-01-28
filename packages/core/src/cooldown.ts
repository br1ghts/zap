const cooldowns = new Map<string, number>();

export function isCooldownActive(broadcasterId: string): boolean {
  const expiresAt = cooldowns.get(broadcasterId);
  return !!expiresAt && expiresAt > Date.now();
}

export function remainingCooldown(broadcasterId: string): number {
  const expiresAt = cooldowns.get(broadcasterId);
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}

export function markCooldown(broadcasterId: string, seconds: number): void {
  cooldowns.set(broadcasterId, Date.now() + seconds * 1000);
}

export function checkAndMark(broadcasterId: string, seconds: number): boolean {
  if (isCooldownActive(broadcasterId)) {
    return false;
  }

  markCooldown(broadcasterId, seconds);
  return true;
}
