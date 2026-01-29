import path from 'node:path';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import fastifyView from '@fastify/view';
import fastifyCookie from '@fastify/cookie';
import fastifySecureSession from '@fastify/secure-session';
import ejs from 'ejs';
import healthRoute from './routes/health';
import authRoute from './routes/auth.twitch';
import dashboardRoute from './routes/dashboard';
import adminRoute from './routes/admin';
import clipsRoute from './routes/clips';
import { env } from './env';

const server = Fastify({
  logger: {
    level: 'info'
  }
});

const sessionKey = crypto.createHash('sha256').update(env.SESSION_SECRET).digest();
const isProd = process.env.NODE_ENV === 'production';

server.register(fastifyCookie);
server.register(fastifySecureSession, {
  key: sessionKey,
  cookie: {
    path: '/',
    sameSite: 'lax',
    secure: isProd,
    httpOnly: true
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
server.register(dashboardRoute);
server.register(adminRoute);
server.register(clipsRoute);

const start = async () => {
  try {
    await server.listen({ port: Number(env.WEB_PORT), host: '0.0.0.0' });
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

start();
