import path from 'node:path';
import Fastify from 'fastify';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import healthRoute from './routes/health';
import authRoute from './routes/auth.twitch';
import dashboardRoute from './routes/dashboard';
import apiClipRoute from './routes/api.clip';
import { env } from './env';

const server = Fastify({
  logger: {
    level: 'info'
  }
});

server.register(fastifyView, {
  engine: {
    ejs
  },
  root: path.join(__dirname, 'views'),
  includeViewExtension: true
});

server.register(healthRoute);
server.register(authRoute);
server.register(apiClipRoute);
server.register(dashboardRoute);

const start = async () => {
  try {
    await server.listen({ port: Number(env.WEB_PORT), host: '0.0.0.0' });
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

start();
