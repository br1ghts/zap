import { fetch } from 'undici';
import { z } from 'zod';

const HELIX_BASE = 'https://api.twitch.tv/helix';

const helixResponseSchema = z.object({
  data: z.array(z.record(z.string(), z.any()))
});

export class HelixError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HelixError';
  }
}

export type HelixUser = {
  id: string;
  login: string;
  display_name: string;
};

async function helixRequest<T extends z.ZodTypeAny>(
  path: string,
  accessToken: string,
  clientId: string,
  schema: T,
  query?: Record<string, string | undefined>
): Promise<z.infer<T>> {
  const url = new URL(`${HELIX_BASE}${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': clientId
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new HelixError(res.status, body);
  }

  const data = await res.json();
  return schema.parse(data);
}

export async function createHelixClip(
  clientId: string,
  accessToken: string,
  broadcasterId: string
): Promise<{ clipId: string }> {
  const response = await fetch(`${HELIX_BASE}/clips?broadcaster_id=${encodeURIComponent(
    broadcasterId
  )}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': clientId,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new HelixError(response.status, body);
  }

  const parsed = await response.json();
  const { data } = helixResponseSchema.parse(parsed);
  const clipId = data[0]?.id;
  if (!clipId) {
    throw new Error('Clip ID missing from Twitch response');
  }

  return { clipId };
}

export async function getClipById(
  clientId: string,
  accessToken: string,
  clipId: string
): Promise<{ clipId: string; url?: string }> {
  const response = await helixRequest(
    '/clips',
    accessToken,
    clientId,
    helixResponseSchema,
    { id: clipId }
  );
  const clip = response.data[0];
  return {
    clipId: clip?.id,
    url: clip?.url
  };
}

export async function getUsersById(
  clientId: string,
  accessToken: string,
  userId: string
): Promise<HelixUser | null> {
  const response = await helixRequest(
    '/users',
    accessToken,
    clientId,
    helixResponseSchema,
    { id: userId }
  );
  return (response.data[0] ?? null) as HelixUser | null;
}

export async function getUsersByLogin(
  clientId: string,
  accessToken: string,
  login: string
): Promise<HelixUser | null> {
  const response = await helixRequest(
    '/users',
    accessToken,
    clientId,
    helixResponseSchema,
    { login }
  );
  return (response.data[0] ?? null) as HelixUser | null;
}
