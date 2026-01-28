import tmi, { Client } from 'tmi.js';
import { env } from './env';

export function createChatClient(channels: string[]): Client {
  return new tmi.Client({
    identity: {
      username: env.BOT_USERNAME,
      password: env.BOT_OAUTH_TOKEN
    },
    channels,
    options: { debug: false }
  });
}
