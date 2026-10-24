/** Cooldown in ms after the given number of consecutive failed unlock attempts. */
export function cooldownFor(failures: number): number {
  if (failures < 5) return 0;
  return Math.min(15 * 60_000, 30_000 * 2 ** (failures - 5));
}

/** Whether the app should relock after spending `awayMs` in the background. */
export function shouldRelock(enabled: boolean, awayMs: number, autoLockSeconds: number): boolean {
  if (!enabled) return false;
  return awayMs >= autoLockSeconds * 1000;
}
