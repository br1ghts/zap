import { z } from 'zod';

const envSchema = z.object({
  TWITCH_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_SECRET: z.string().min(1),
  TWITCH_REDIRECT_URI: z.string().url(),
  WEB_PORT: z.string().default('3000'),
  SESSION_SECRET: z.string().min(8),
  DATABASE_URL: z.string().min(1)
});

export const env = envSchema.parse(process.env);
export type AppEnv = z.infer<typeof envSchema>;
