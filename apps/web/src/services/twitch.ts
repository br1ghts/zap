import { env } from '../env';
import { HelixUser } from '@zap/core';
import { z } from 'zod';

const oauthResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  scope: z.array(z.string()).or(z.string()),
  token_type: z.string()
});

export function buildTwitchAuthUrl(state: string): string {
  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.searchParams.set('client_id', env.TWITCH_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.TWITCH_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  // Needed for Helix clip downloads endpoint: editor:manage:clips or channel:manage:clips.
  url.searchParams.set('scope', 'clips:edit user:read:email channel:manage:clips editor:manage:clips');
  url.searchParams.set('state', state);
  url.searchParams.set('force_verify', 'true');

  return url.toString();
}

export async function exchangeCode(code: string) {
  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.searchParams.set('client_id', env.TWITCH_CLIENT_ID);
  url.searchParams.set('client_secret', env.TWITCH_CLIENT_SECRET);
  url.searchParams.set('code', code);
  url.searchParams.set('grant_type', 'authorization_code');
  url.searchParams.set('redirect_uri', env.TWITCH_REDIRECT_URI);

  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Twitch token exchange failed ${response.status}: ${body}`);
  }

  const json = await response.json();
  return oauthResponseSchema.parse(json);
}

export async function fetchBroadcaster(accessToken: string): Promise<HelixUser> {
  const url = new URL('https://api.twitch.tv/helix/users');
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': env.TWITCH_CLIENT_ID
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Unable to load broadcaster profile ${response.status}: ${body}`);
  }

  const payload = await response.json();
  const data = payload?.data?.[0];
  if (!data) {
    throw new Error('Unable to fetch authenticated broadcaster info');
  }

  return data as HelixUser;
}
