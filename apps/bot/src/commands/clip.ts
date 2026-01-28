import { Client, ChatUserstate } from 'tmi.js';
import { checkAndMark, remainingCooldown } from '@zap/core';
import { requestClip } from '../services/clip';

const COOLDOWN_SECONDS = 30;

export type ClipCommandContext = {
  client: Client;
  tags: ChatUserstate;
  channel: string;
  broadcasterId: string;
};

export async function handleClipCommand(context: ClipCommandContext, note?: string) {
  const { client, channel, tags, broadcasterId } = context;
  const trimmed = note?.trim();
  const displayName = tags['display-name'] || tags.username || 'unknown';
  const requestedById = tags['user-id'] ?? undefined;

  if (!checkAndMark(broadcasterId, COOLDOWN_SECONDS)) {
    client.say(channel, `Clip is on cooldown. Try again in ${remainingCooldown(broadcasterId)}s.`);
    return;
  }

  try {
    const clip = await requestClip({
      broadcasterId,
      note: trimmed,
      requestedBy: displayName,
      requestedById
    });
    client.say(channel, `Clip ready: ${clip.url}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    client.say(channel, `Clip failed: ${message}`);
  }
}
