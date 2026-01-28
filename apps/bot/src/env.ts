import { z } from 'zod';

const envSchema = z.object({
  TWITCH_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_SECRET: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  BOT_USERNAME: z.string().min(1),
  BOT_OAUTH_TOKEN: z.string().min(1),
  BOT_CHANNELS: z.string().optional()
});

export const env = envSchema.parse(process.env);
