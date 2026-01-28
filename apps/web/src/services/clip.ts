import { ClipRecord, ClipStore, TokenStore, createClip, TokenRow } from '@zap/core';
import { env } from '../env';
import prisma from '../db';

const clipStore: ClipStore = {
  async saveClip(entry: ClipRecord) {
    await prisma.clip.create({
      data: {
        broadcasterId: entry.broadcasterId,
        clipId: entry.clipId,
        url: entry.url,
        requestedBy: entry.requestedBy,
        requestedById: entry.requestedById,
        note: entry.note,
        status: entry.status,
        error: entry.error
      }
    });
  }
};

const tokenStore: TokenStore = {
  async getToken(broadcasterId) {
    const token = await prisma.token.findUnique({ where: { broadcasterId } });
    if (!token) {
      return null;
    }

    return {
      broadcasterId: token.broadcasterId,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scopes: token.scopes,
      tokenType: token.tokenType
    };
  },
  async upsertToken(token) {
    await prisma.token.upsert({
      where: { broadcasterId: token.broadcasterId },
      update: {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        scopes: token.scopes,
        tokenType: token.tokenType
      },
      create: {
        broadcasterId: token.broadcasterId,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        scopes: token.scopes,
        tokenType: token.tokenType
      }
    });
  }
};

export async function requestClip(payload: {
  broadcasterId: string;
  requestedBy: string;
  requestedById?: string;
  note?: string;
}) {
  return createClip(
    {
      clientId: env.TWITCH_CLIENT_ID,
      clientSecret: env.TWITCH_CLIENT_SECRET,
      tokenStore,
      clipStore
    },
    payload
  );
}
