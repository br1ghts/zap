import { ClipRecord, ClipStore, TokenRow, TokenStore } from './types';
import { createHelixClip, getClipById, HelixError } from './twitch';
import { refreshToken } from './token';

const POLL_ATTEMPTS = 12;
const POLL_DELAY_MS = 2500;

export type CreateClipPayload = {
  broadcasterId: string;
  requestedBy: string;
  requestedById?: string;
  note?: string;
};

export type ClipServiceOptions = {
  clientId: string;
  clientSecret: string;
  tokenStore: TokenStore;
  clipStore: ClipStore;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureToken(
  options: ClipServiceOptions,
  broadcasterId: string,
  token?: TokenRow
): Promise<TokenRow> {
  const stored = token ?? (await options.tokenStore.getToken(broadcasterId));
  if (!stored) {
    throw new Error(`No tokens found for broadcaster ${broadcasterId}`);
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    return refreshAndStoreToken(options, stored);
  }

  return stored;
}

async function refreshAndStoreToken(options: ClipServiceOptions, stored: TokenRow): Promise<TokenRow> {
  const refreshed = await refreshToken({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    refreshToken: stored.refreshToken
  });

  const refreshedRecord: TokenRow = {
    broadcasterId: stored.broadcasterId,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
    scopes: refreshed.scopes,
    tokenType: refreshed.tokenType
  };

  await options.tokenStore.upsertToken(refreshedRecord);
  return refreshedRecord;
}

export async function createClip(options: ClipServiceOptions, payload: CreateClipPayload): Promise<{ clipId: string; url: string }> {
  const { broadcasterId, requestedBy, requestedById, note } = payload;
  let token = await ensureToken(options, broadcasterId);
  const logEntry: ClipRecord = {
    broadcasterId,
    requestedBy,
    requestedById,
    note,
    status: 'pending'
  };

  let clipId: string | undefined;
  let clipUrl: string | undefined;
  let retriedAfterRefresh = false;

  try {
    while (true) {
      try {
        const result = await createHelixClip(options.clientId, token.accessToken, broadcasterId);
        clipId = result.clipId;
        break;
      } catch (error) {
        if (error instanceof HelixError && error.status === 401 && !retriedAfterRefresh) {
          token = await refreshAndStoreToken(options, token);
          retriedAfterRefresh = true;
          continue;
        }
        throw error;
      }
    }

    if (!clipId) {
      throw new Error('Failed to resolve clip ID');
    }

    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      const clipData = await getClipById(options.clientId, token.accessToken, clipId);
      if (clipData.url) {
        clipUrl = clipData.url;
        break;
      }

      await delay(POLL_DELAY_MS);
    }

    if (!clipUrl) {
      throw new Error('Clip URL unavailable after polling');
    }

    const successEntry: ClipRecord = {
      ...logEntry,
      clipId,
      url: clipUrl,
      status: 'ok'
    };

    await options.clipStore.saveClip(successEntry);

    return { clipId, url: clipUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const failureEntry: ClipRecord = {
      ...logEntry,
      clipId,
      url: clipUrl,
      status: 'failed',
      error: message
    };
    await options.clipStore.saveClip(failureEntry);
    throw error;
  }
}
