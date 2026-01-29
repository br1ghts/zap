import { Channel } from '@prisma/client';
import { env } from '../env';

const parseCommaList = (value?: string) =>
  value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0) ?? [];

const adminIdAllowlist = new Set(parseCommaList(env.ADMIN_TWITCH_IDS));
const adminUsernameAllowlist = new Set(
  parseCommaList(env.ADMIN_USERNAMES).map((entry) => entry.toLowerCase())
);

export const adminAllowlistConfigured =
  adminIdAllowlist.size > 0 || adminUsernameAllowlist.size > 0;

export const isAdminChannel = (channel: Pick<Channel, 'broadcasterId' | 'login' | 'displayName'>) => {
  if (adminIdAllowlist.size > 0 && adminIdAllowlist.has(channel.broadcasterId)) {
    return true;
  }

  if (adminUsernameAllowlist.size === 0) {
    return false;
  }

  const login = channel.login.toLowerCase();
  const display = channel.displayName.toLowerCase();
  return adminUsernameAllowlist.has(login) || adminUsernameAllowlist.has(display);
};
