import pino from 'pino';
import { ChatUserstate } from 'tmi.js';
import prisma from './db';
import { createChatClient } from './twitchChat';
import { env } from './env';
import { handleClipCommand } from './commands/clip';

const logger = pino({ name: 'zap-bot', level: 'info' });

const bootstrap = async () => {
  const channels = await prisma.channel.findMany();
  const loginToChannel = new Map<string, { login: string; broadcasterId: string }>();
  channels.forEach((channel) => {
    loginToChannel.set(channel.login.toLowerCase(), {
      login: channel.login,
      broadcasterId: channel.broadcasterId
    });
  });

  const extraChannels = (env.BOT_CHANNELS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const channelNames = Array.from(new Set([...loginToChannel.keys(), ...extraChannels]));
  if (channelNames.length === 0) {
    logger.warn('No channels configured for the bot to join');
    return;
  }

  const client = createChatClient(channelNames);

  client.on('message', (channel: string, tags: ChatUserstate, message: string, self: boolean) => {
    if (self) return;
    const trimmed = message?.trim();
    if (!trimmed) return;

    const [command, ...rest] = trimmed.split(/\s+/);
    if (command.toLowerCase() !== '!clip') {
      return;
    }

    const login = channel.replace('#', '').toLowerCase();
    const channelEntry = loginToChannel.get(login);
    if (!channelEntry) {
      client.say(channel, 'Authorize this channel via the Zap dashboard first.');
      return;
    }

    const isBroadcaster = tags.badges?.broadcaster === '1';
    if (!tags.mod && !isBroadcaster) {
      return;
    }

    const note = rest.join(' ');
    handleClipCommand(
      {
        client,
        channel,
        tags,
        broadcasterId: channelEntry.broadcasterId
      },
      note
    ).catch((error) => logger.error({ error }, 'Clip command failed'));
  });

  client.on('connected', () => {
    logger.info({ channels: channelNames }, 'Bot connected');
  });

  client.on('disconnected', (reason: string) => {
    logger.warn({ reason }, 'Bot disconnected, retrying');
  });

  client.on('reconnect', () => {
    logger.info('Reconnecting to Twitch chat');
  });
console.log({ channelNames })
  await client.connect();
};

bootstrap().catch((error) => {
  logger.error(error, 'Failed to start bot');
  process.exit(1);
});
