import { FastifyPluginAsync } from 'fastify';
import prisma from '../db';

const dashboardRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (_request, reply) => {
    const channels = await prisma.channel.findMany({ orderBy: { displayName: 'asc' } });
    return reply.view('index', { channels });
  });

  fastify.get('/channels/:broadcasterId', async (request, reply) => {
    const { broadcasterId } = request.params as { broadcasterId: string };
    const channel = await prisma.channel.findUnique({ where: { broadcasterId } });
    if (!channel) {
      return reply.status(404).send('Channel not found');
    }

    const token = await prisma.token.findUnique({ where: { broadcasterId } });
    const clips = await prisma.clip.findMany({
      where: { broadcasterId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    return reply.view('channel', { channel, token, clips });
  });
};

export default dashboardRoute;
