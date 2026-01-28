import { FastifyPluginAsync } from 'fastify';

const healthRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/healthz', async () => ({ status: 'ok' }));
};

export default healthRoute;
