import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requestClip } from '../services/clip';

const bodySchema = z.object({
  note: z.string().max(300).optional()
});

const apiClipRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/channels/:broadcasterId/clip', async (request, reply) => {
    const { broadcasterId } = request.params as { broadcasterId: string };
    const bodyParse = bodySchema.safeParse(request.body);
    if (!bodyParse.success) {
      return reply.status(400).send({ error: 'Invalid note' });
    }

    try {
      const clip = await requestClip({
        broadcasterId,
        requestedBy: 'dashboard',
        note: bodyParse.data.note
      });
      return reply.send(clip);
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Clip failed' });
    }
  });
};

export default apiClipRoute;
