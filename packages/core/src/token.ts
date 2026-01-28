import { fetch } from 'undici';
import { z } from 'zod';

const refreshSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  scope: z.array(z.string()).or(z.string()),
  token_type: z.string()
});

type RefreshRequest = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type TokenRefreshResult = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string;
  tokenType: string;
};

export async function refreshToken({ clientId, clientSecret, refreshToken }: RefreshRequest): Promise<TokenRefreshResult> {
  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.searchParams.set('grant_type', 'refresh_token');
  url.searchParams.set('refresh_token', refreshToken);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);

  const res = await fetch(url, {
    method: 'POST'
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Refresh token failed ${res.status}: ${text}`);
  }

  const body = await res.json();
  const data = refreshSchema.parse(body);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scopes: Array.isArray(data.scope) ? data.scope.join(',') : data.scope,
    tokenType: data.token_type
  };
}
