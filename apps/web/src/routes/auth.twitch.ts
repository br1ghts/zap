import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import prisma from '../db';
import { buildTwitchAuthUrl, exchangeCode, fetchBroadcaster } from '../services/twitch';

const pendingStates = new Set<string>();

const querySchema = z.object({
  code: z.string(),
  state: z.string()
});

const authRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/auth/twitch', async (_request, reply) => {
    const state = crypto.randomUUID();
    pendingStates.add(state);
    reply.redirect(buildTwitchAuthUrl(state));
  });

  fastify.get('/auth/twitch/callback', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Missing code/state' });
    }

    const { code, state } = parsed.data;
    if (!pendingStates.has(state)) {
      return reply.status(400).send({ error: 'Invalid state' });
    }

    pendingStates.delete(state);

    const tokenPayload = await exchangeCode(code);
    const broadcaster = await fetchBroadcaster(tokenPayload.access_token);

    await prisma.channel.upsert({
      where: { broadcasterId: broadcaster.id },
      update: {
        login: broadcaster.login,
        displayName: broadcaster.display_name
      },
      create: {
        broadcasterId: broadcaster.id,
        login: broadcaster.login,
        displayName: broadcaster.display_name
      }
    });

    await prisma.token.upsert({
      where: { broadcasterId: broadcaster.id },
      update: {
        accessToken: tokenPayload.access_token,
        refreshToken: tokenPayload.refresh_token,
        expiresAt: new Date(Date.now() + tokenPayload.expires_in * 1000),
        scopes: Array.isArray(tokenPayload.scope)
          ? tokenPayload.scope.join(',')
          : tokenPayload.scope,
        tokenType: tokenPayload.token_type
      },
      create: {
        broadcasterId: broadcaster.id,
        accessToken: tokenPayload.access_token,
        refreshToken: tokenPayload.refresh_token,
        expiresAt: new Date(Date.now() + tokenPayload.expires_in * 1000),
        scopes: Array.isArray(tokenPayload.scope)
          ? tokenPayload.scope.join(',')
          : tokenPayload.scope,
        tokenType: tokenPayload.token_type
      }
    });

    request.session.set('broadcasterId', broadcaster.id);
    return reply.redirect('/');
  });

  fastify.get('/logout', async (request, reply) => {
    request.session.delete();
    return reply.redirect('/');
  });
};

export default authRoute;
