import { FastifyPluginAsync } from 'fastify';
import { Readable } from 'node:stream';
import prisma from '../db';
import { env } from '../env';
import { HelixError, refreshToken } from '@zap/core';

const THUMBNAIL_CACHE_TTL_MS = 1000 * 60 * 20;

const isAllowedTwitchUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return false;
    }
    const host = url.hostname.toLowerCase();
    return (
      host === 'clips.twitch.tv' ||
      host.endsWith('.twitch.tv') ||
      host === 'twitch.tv' ||
      host.endsWith('.twitchcdn.net') ||
      host.endsWith('.ttvnw.net')
    );
  } catch {
    return false;
  }
};

const isClipSlug = (value: string): boolean => /^[A-Za-z0-9_-]+$/.test(value);

const normalizeClipUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed.length) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^clips\.twitch\.tv\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  if (/^(?:www\.)?twitch\.tv\//i.test(trimmed)) {
    return `https://${trimmed.replace(/^(?:www\.)?/i, 'www.')}`;
  }

  if (isClipSlug(trimmed)) {
    return `https://clips.twitch.tv/${trimmed}`;
  }

  return null;
};

const parseClipIdFromUrl = (clipUrl: string): string | null => {
  try {
    const url = new URL(clipUrl);
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);
    if (host === 'clips.twitch.tv') {
      const slug = segments[0] ?? '';
      return slug.length ? slug : null;
    }
    const clipIndex = segments.findIndex((segment) => segment.toLowerCase() === 'clip');
    if (clipIndex >= 0 && segments[clipIndex + 1]) {
      return segments[clipIndex + 1];
    }
    const fallback = segments[segments.length - 1] ?? '';
    return fallback.length ? fallback : null;
  } catch {
    return null;
  }
};

const decodeMaybeEscapedUrl = (value: string): string => {
  return value
    .replace(/\\u0026/g, '&')
    .replace(/\\u003d/g, '=')
    .replace(/\\u002f/g, '/')
    .replace(/\\\//g, '/');
};

const deriveMp4FromThumbnail = (thumbnailUrl: string): string | null => {
  const match = thumbnailUrl.match(/^(.*?)-preview-\d+x\d+\.(?:jpg|jpeg|png)(\?.*)?$/i);
  if (!match) {
    return null;
  }
  return `${match[1]}.mp4${match[2] ?? ''}`;
};

const chooseBestQuality = (candidates: Array<{ url: string; quality: number | null }>): string | null => {
  if (candidates.length === 0) {
    return null;
  }
  const sorted = candidates
    .map((entry) => ({ ...entry, quality: entry.quality ?? -1 }))
    .sort((a, b) => b.quality - a.quality);
  return sorted[0]?.url ?? null;
};

const extractMp4FromClipHtml = (html: string): string | null => {
  const candidates: Array<{ url: string; quality: number | null }> = [];

  const metaMatch = html.match(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+\.mp4[^"']*)["'][^>]*>/i);
  if (metaMatch?.[1]) {
    const url = decodeMaybeEscapedUrl(metaMatch[1]);
    if (isAllowedTwitchUrl(url)) {
      candidates.push({ url, quality: null });
    }
  }

  const qualitySourceRegex =
    /"quality"\s*:\s*"(\d+)p"[\s\S]*?"source"\s*:\s*"(https:[^"]+?\.mp4[^"]*)"/g;
  for (const match of html.matchAll(qualitySourceRegex)) {
    const quality = match[1] ? Number(match[1]) : null;
    const url = match[2] ? decodeMaybeEscapedUrl(match[2]) : null;
    if (url && isAllowedTwitchUrl(url)) {
      candidates.push({ url, quality: Number.isFinite(quality) ? quality : null });
    }
  }

  const sourceOnlyRegex = /"source"\s*:\s*"(https:[^"]+?\.mp4[^"]*)"/g;
  for (const match of html.matchAll(sourceOnlyRegex)) {
    const url = match[1] ? decodeMaybeEscapedUrl(match[1]) : null;
    if (url && isAllowedTwitchUrl(url)) {
      candidates.push({ url, quality: null });
    }
  }

  const anyMp4Regex = /(https:\\\/\\\/[^"'\\s]+?\.mp4[^"'\\s]*)/g;
  for (const match of html.matchAll(anyMp4Regex)) {
    const url = match[1] ? decodeMaybeEscapedUrl(match[1]) : null;
    if (url && isAllowedTwitchUrl(url)) {
      candidates.push({ url, quality: null });
    }
  }

  return chooseBestQuality(candidates);
};

const parseDownloadFilename = (contentDisposition: string | null, fallbackId: string): string => {
  const fallback = `${fallbackId}.mp4`;
  if (!contentDisposition) {
    return fallback;
  }
  const match = contentDisposition.match(/filename\\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?/i);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) {
    return fallback;
  }
  try {
    const decoded = decodeURIComponent(raw);
    const safe = decoded.replace(/[\\r\\n]/g, '').replace(/[/\\\\?%*:|"<>]/g, '_').trim();
    return safe.toLowerCase().endsWith('.mp4') ? safe : `${safe}.mp4`;
  } catch {
    return fallback;
  }
};

const parseDownloadFilenameNoForceExtension = (contentDisposition: string | null, fallbackId: string): string => {
  const fallback = fallbackId;
  if (!contentDisposition) {
    return fallback;
  }
  const match = contentDisposition.match(/filename\\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?/i);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) {
    return fallback;
  }
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.replace(/[\\r\\n]/g, '').replace(/[/\\\\?%*:|"<>]/g, '_').trim() || fallback;
  } catch {
    return fallback;
  }
};

const clipsRoute: FastifyPluginAsync = async (fastify) => {
  const thumbnailCache = new Map<string, { value: string | null; expiresAt: number }>();

  const ensureAccessToken = async (broadcasterId: string): Promise<string | null> => {
    const token = await prisma.token.findUnique({ where: { broadcasterId } });
    if (!token) {
      return null;
    }

    if (token.expiresAt.getTime() > Date.now()) {
      return token.accessToken;
    }

    try {
      const refreshed = await refreshToken({
        clientId: env.TWITCH_CLIENT_ID,
        clientSecret: env.TWITCH_CLIENT_SECRET,
        refreshToken: token.refreshToken
      });

      await prisma.token.update({
        where: { broadcasterId },
        data: {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
          scopes: refreshed.scopes,
          tokenType: refreshed.tokenType
        }
      });

      return refreshed.accessToken;
    } catch {
      return null;
    }
  };

  const fetchThumbnailViaHelix = async (accessToken: string, clipId: string): Promise<string | null> => {
    const url = new URL('https://api.twitch.tv/helix/clips');
    url.searchParams.set('id', clipId);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': env.TWITCH_CLIENT_ID,
        Accept: 'application/json'
      }
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new HelixError(res.status, body);
    }
    const payload = (await res.json()) as any;
    const thumb = payload?.data?.[0]?.thumbnail_url;
    return typeof thumb === 'string' && thumb.length ? thumb : null;
  };

  const fetchDownloadUrlViaHelix = async (
    accessToken: string,
    editorId: string,
    broadcasterId: string,
    clipId: string
  ): Promise<string | null> => {
    const url = new URL('https://api.twitch.tv/helix/clips/downloads');
    url.searchParams.set('broadcaster_id', broadcasterId);
    url.searchParams.set('editor_id', editorId);
    url.searchParams.append('clip_id', clipId);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': env.TWITCH_CLIENT_ID,
        Accept: 'application/json'
      }
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new HelixError(res.status, body);
    }
    const payload = (await res.json()) as any;
    const entry = payload?.data?.[0];
    const download =
      (typeof entry?.landscape_download_url === 'string' && entry.landscape_download_url.length
        ? entry.landscape_download_url
        : null) ??
      (typeof entry?.portrait_download_url === 'string' && entry.portrait_download_url.length
        ? entry.portrait_download_url
        : null);
    return download;
  };

  fastify.get('/assets/clip-placeholder.svg', async (_request, reply) => {
    reply.type('image/svg+xml');
    return reply.send(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#0b1020"/>
      <stop offset="1" stop-color="#0a0c17"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" rx="28" fill="url(#bg)"/>
  <rect x="48" y="64" width="544" height="232" rx="18" fill="rgba(255,255,255,0.06)"/>
  <path d="M280 162v36l44-18-44-18z" fill="rgba(255,255,255,0.55)"/>
  <text x="320" y="260" text-anchor="middle" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="20" fill="rgba(255,255,255,0.55)" letter-spacing="2">CLIP</text>
</svg>`);
  });

  fastify.get('/api/clips/thumbnail', async (request, reply) => {
    const broadcasterId = request.session.get('broadcasterId');
    if (!broadcasterId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { clipUrl, clipId } = request.query as { clipUrl?: string; clipId?: string };
    const resolvedClipUrl = clipUrl && isAllowedTwitchUrl(clipUrl) ? clipUrl : null;
    const resolvedClipId =
      (clipId && clipId.trim().length ? clipId.trim() : null) ?? (resolvedClipUrl ? parseClipIdFromUrl(resolvedClipUrl) : null);

    if (!resolvedClipId && !resolvedClipUrl) {
      return reply.status(400).send({ error: 'Missing clipId/clipUrl' });
    }

    const cacheKey = resolvedClipId ?? resolvedClipUrl!;
    const cached = thumbnailCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return reply.send({ thumbnailUrl: cached.value });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    let thumbnailUrl: string | null = null;
    try {
      const accessToken = await ensureAccessToken(broadcasterId);
      if (accessToken && resolvedClipId) {
        try {
          thumbnailUrl = await fetchThumbnailViaHelix(accessToken, resolvedClipId);
        } catch (error) {
          if (error instanceof HelixError && error.status === 401) {
            const refreshed = await ensureAccessToken(broadcasterId);
            if (refreshed) {
              thumbnailUrl = await fetchThumbnailViaHelix(refreshed, resolvedClipId);
            }
          }
        }
      }

      if (!thumbnailUrl) {
        const oembedClipUrl = resolvedClipUrl ?? `https://clips.twitch.tv/${resolvedClipId}`;
        const oembed = new URL('https://clips.twitch.tv/oembed');
        oembed.searchParams.set('url', oembedClipUrl);
        oembed.searchParams.set('format', 'json');

        const res = await fetch(oembed.toString(), {
          signal: controller.signal,
          headers: { Accept: 'application/json' }
        });
        const json = res.ok ? ((await res.json()) as { thumbnail_url?: string }) : null;
        thumbnailUrl = json?.thumbnail_url ?? null;
      }
    } catch {
      thumbnailUrl = null;
    } finally {
      clearTimeout(timer);
    }

    thumbnailCache.set(cacheKey, { value: thumbnailUrl, expiresAt: Date.now() + THUMBNAIL_CACHE_TTL_MS });
    return reply.send({ thumbnailUrl });
  });

  fastify.get('/api/twitch/clips/:clipId/download-url', async (request, reply) => {
    const { clipId } = request.params as { clipId: string };
    const { broadcaster_id: queryBroadcasterId } = request.query as { broadcaster_id?: string };

    const sessionBroadcasterId = request.session.get('broadcasterId');
    if (!sessionBroadcasterId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    if (queryBroadcasterId && queryBroadcasterId !== sessionBroadcasterId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const broadcasterId = sessionBroadcasterId;
    const editorId = sessionBroadcasterId;

    if (!clipId || !clipId.trim().length) {
      return reply.status(400).send({ error: 'Missing clip_id' });
    }

    const accessToken = await ensureAccessToken(broadcasterId);
    if (!accessToken) {
      return reply.status(401).send({ error: 'Twitch token is not available. Reconnect Twitch in this app.' });
    }

    try {
      const downloadUrl = await fetchDownloadUrlViaHelix(accessToken, editorId, broadcasterId, clipId.trim());
      if (!downloadUrl) {
        return reply.status(404).send({ error: 'No download URL available' });
      }
      return reply.send({ downloadUrl });
    } catch (error) {
      if (error instanceof HelixError) {
        fastify.log.warn({ err: error, status: error.status }, 'helix clip download-url failed');
        if (error.status === 401) {
          return reply
            .status(401)
            .send({ error: 'Twitch token is not valid or missing required scope. Reconnect Twitch in this app.' });
        }
        if (error.status === 403) {
          return reply.status(403).send({
            error:
              'Twitch token missing required scope (channel:manage:clips or editor:manage:clips), or you are not an editor for this broadcaster. Reconnect Twitch in this app.'
          });
        }
        if (error.status === 400) {
          return reply.status(400).send({ error: 'Invalid clip/broadcaster/editor id' });
        }
        return reply.status(502).send({ error: 'Failed to get download URL from Twitch' });
      }

      fastify.log.error({ err: error }, 'helix clip download-url unknown error');
      return reply.status(502).send({ error: 'Failed to get download URL' });
    }
  });

  fastify.get('/api/twitch/clips/:clipId/download', async (request, reply) => {
    const { clipId } = request.params as { clipId: string };
    const { broadcaster_id: queryBroadcasterId } = request.query as { broadcaster_id?: string };

    const sessionBroadcasterId = request.session.get('broadcasterId');
    if (!sessionBroadcasterId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    if (queryBroadcasterId && queryBroadcasterId !== sessionBroadcasterId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const broadcasterId = sessionBroadcasterId;
    const editorId = sessionBroadcasterId;

    if (!clipId || !clipId.trim().length) {
      return reply.status(400).send({ error: 'Missing clip_id' });
    }

    const accessToken = await ensureAccessToken(broadcasterId);
    if (!accessToken) {
      return reply.status(401).send({ error: 'Twitch token is not available. Reconnect Twitch in this app.' });
    }

    let helixDownloadUrl: string | null = null;
    try {
      helixDownloadUrl = await fetchDownloadUrlViaHelix(accessToken, editorId, broadcasterId, clipId.trim());
    } catch (error) {
      if (error instanceof HelixError) {
        fastify.log.warn({ err: error, status: error.status }, 'helix clip download failed');
        if (error.status === 401) {
          return reply
            .status(401)
            .send({ error: 'Twitch token is not valid or missing required scope. Reconnect Twitch in this app.' });
        }
        if (error.status === 403) {
          return reply.status(403).send({
            error:
              'Twitch token missing required scope (channel:manage:clips or editor:manage:clips), or you are not an editor for this broadcaster. Reconnect Twitch in this app.'
          });
        }
        if (error.status === 400) {
          return reply.status(400).send({ error: 'Invalid clip/broadcaster/editor id' });
        }
        return reply.status(502).send({ error: 'Failed to download clip from Twitch' });
      }

      fastify.log.error({ err: error }, 'helix clip download unknown error');
      return reply.status(502).send({ error: 'Failed to download clip' });
    }

    if (!helixDownloadUrl || !isAllowedTwitchUrl(helixDownloadUrl)) {
      return reply.status(404).send({ error: 'No download URL available' });
    }

    const upstream = await fetch(helixDownloadUrl, { redirect: 'follow' });
    if (!upstream.ok || !upstream.body) {
      return reply.status(502).send({ error: `Failed to fetch mp4 (${upstream.status})` });
    }

    const filename = parseDownloadFilenameNoForceExtension(upstream.headers.get('content-disposition'), clipId);
    const contentType = upstream.headers.get('content-type') ?? 'video/mp4';
    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);

    const nodeStream = Readable.fromWeb(upstream.body as any);
    return reply.send(nodeStream);
  });

  fastify.get('/api/clips/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { clipUrl, thumbnailUrl } = request.query as { clipUrl?: string; thumbnailUrl?: string };

    const resolvedClipUrl =
      (clipUrl ? normalizeClipUrl(clipUrl) : null) ?? (isClipSlug(id) ? `https://clips.twitch.tv/${id}` : null);

    if (!resolvedClipUrl || !isAllowedTwitchUrl(resolvedClipUrl)) {
      return reply.status(400).send({ error: 'Invalid clipUrl' });
    }

    const resolvedThumbnailUrl =
      thumbnailUrl && thumbnailUrl.trim().length
        ? thumbnailUrl.startsWith('/')
          ? null
          : thumbnailUrl
        : null;

    if (resolvedThumbnailUrl && !isAllowedTwitchUrl(resolvedThumbnailUrl)) {
      return reply.status(400).send({ error: 'Invalid thumbnailUrl' });
    }

    const broadcasterId = request.session.get('broadcasterId');
    const resolvedTwitchClipId = parseClipIdFromUrl(resolvedClipUrl) ?? (isClipSlug(id) ? id : null);

    if (!broadcasterId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    if (resolvedTwitchClipId) {
      const accessToken = await ensureAccessToken(broadcasterId);
      if (accessToken) {
        try {
          const helixDownloadUrl = await fetchDownloadUrlViaHelix(accessToken, broadcasterId, broadcasterId, resolvedTwitchClipId);
          if (helixDownloadUrl && isAllowedTwitchUrl(helixDownloadUrl)) {
            const upstream = await fetch(helixDownloadUrl, { redirect: 'follow' });
            if (!upstream.ok || !upstream.body) {
              return reply.status(502).send({ error: `Failed to fetch mp4 (${upstream.status})` });
            }

            const filename = parseDownloadFilename(upstream.headers.get('content-disposition'), id);
            reply.header('Content-Type', 'video/mp4');
            reply.header('Content-Disposition', `attachment; filename="${filename}"`);

            const nodeStream = Readable.fromWeb(upstream.body as any);
            return reply.send(nodeStream);
          }
        } catch (error) {
          if (error instanceof HelixError && (error.status === 401 || error.status === 403)) {
            return reply.status(error.status).send({
              error:
                error.status === 403
                  ? 'Twitch token missing required scope (channel:manage:clips or editor:manage:clips). Reconnect Twitch in this app.'
                  : 'Twitch token is not valid. Reconnect Twitch in this app.'
            });
          }
        }
      }
    }

    // Legacy fallback (only used if Helix download URL is unavailable for other reasons).
    const derived = resolvedThumbnailUrl ? deriveMp4FromThumbnail(resolvedThumbnailUrl) : null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    let mp4Url: string | null = null;

    try {
      if (derived && isAllowedTwitchUrl(derived)) {
        try {
          const head = await fetch(derived, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
          if (head.ok) {
            mp4Url = derived;
          }
        } catch {
          mp4Url = null;
        }
      }

      if (!mp4Url) {
        const pageRes = await fetch(resolvedClipUrl, {
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Zap Clip Downloader'
          }
        });
        if (!pageRes.ok) {
          return reply.status(502).send({ error: `Failed to resolve clip page (${pageRes.status})` });
        }
        const html = await pageRes.text();
        mp4Url = extractMp4FromClipHtml(html);
      }
    } catch (error) {
      return reply.status(502).send({ error: 'Failed to resolve mp4 url' });
    } finally {
      clearTimeout(timer);
    }

    if (!mp4Url) {
      return reply.status(404).send({ error: 'Could not find mp4 url for clip' });
    }

    const upstream = await fetch(mp4Url, { redirect: 'follow' });
    if (!upstream.ok || !upstream.body) {
      return reply.status(502).send({ error: `Failed to fetch mp4 (${upstream.status})` });
    }

    const filename = parseDownloadFilename(upstream.headers.get('content-disposition'), id);
    reply.header('Content-Type', 'video/mp4');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);

    const nodeStream = Readable.fromWeb(upstream.body as any);
    return reply.send(nodeStream);
  });
};

export default clipsRoute;
