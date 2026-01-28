import { FastifyPluginAsync } from 'fastify';
import { Channel, Clip } from '@prisma/client';
import prisma from '../db';

const SESSION_GAP_MS = 1000 * 60 * 90; // 1.5 hours gap to split stream sessions

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short'
});
const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeStyle: 'short'
});
const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat('en-US', {
  numeric: 'auto'
});

type ClipView = {
  id: string;
  clipId: string | null;
  url: string | null;
  requestedBy: string;
  requestedById: string | null;
  note: string | null;
  status: string;
  error: string | null;
  createdAtLabel: string;
  createdAtMs: number;
};

type ClipGroupView = {
  id: string;
  label: string;
  subtitle: string;
  clips: ClipView[];
};

const toClipView = (clip: Clip): ClipView => ({
  id: clip.id,
  clipId: clip.clipId,
  url: clip.url,
  requestedBy: clip.requestedBy,
  requestedById: clip.requestedById,
  note: clip.note,
  status: clip.status,
  error: clip.error,
  createdAtLabel: DATE_FORMATTER.format(clip.createdAt),
  createdAtMs: clip.createdAt.getTime()
});

const relativeTimeFromNow = (timestamp: number | null): string | null => {
  if (timestamp === null) {
    return null;
  }
  const now = Date.now();
  const diffSeconds = Math.round((timestamp - now) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) {
    return RELATIVE_TIME_FORMATTER.format(diffSeconds, 'second');
  }
  if (abs < 3600) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(diffSeconds / 60), 'minute');
  }
  if (abs < 86400) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(diffSeconds / 3600), 'hour');
  }
  return RELATIVE_TIME_FORMATTER.format(Math.round(diffSeconds / 86400), 'day');
};

const groupClipsBySession = (clips: ClipView[]): ClipGroupView[] => {
  if (clips.length === 0) {
    return [];
  }

  const sessions: { clips: ClipView[]; endTime: number }[] = [];
  let currentSession: { clips: ClipView[]; endTime: number } | null = null;

  for (const clip of clips) {
    if (!currentSession) {
      currentSession = { clips: [clip], endTime: clip.createdAtMs };
      sessions.push(currentSession);
      continue;
    }

    const lastInSession = currentSession.clips[currentSession.clips.length - 1];
    const gapMs = lastInSession.createdAtMs - clip.createdAtMs;
    if (gapMs > SESSION_GAP_MS) {
      currentSession = { clips: [clip], endTime: clip.createdAtMs };
      sessions.push(currentSession);
      continue;
    }

    currentSession.clips.push(clip);
    currentSession.endTime = clip.createdAtMs;
  }

  return sessions.map((session) => {
    const newest = session.clips[0];
    const oldest = session.clips[session.clips.length - 1];
    const label = DATE_FORMATTER.format(new Date(oldest.createdAtMs));
    const range =
      session.clips.length === 1
        ? TIME_FORMATTER.format(new Date(newest.createdAtMs))
        : `${TIME_FORMATTER.format(new Date(oldest.createdAtMs))} — ${TIME_FORMATTER.format(
            new Date(newest.createdAtMs)
          )}`;
    const subtitle = `${session.clips.length} clip${session.clips.length === 1 ? '' : 's'} · ${range}`;

    return {
      id: `${session.clips[0].id}-${session.clips[0].createdAtMs}`,
      label,
      subtitle,
      clips: session.clips
    };
  });
};

const buildChannelViewModel = async (channel: Channel) => {
  const tokenRecord = await prisma.token.findUnique({ where: { broadcasterId: channel.broadcasterId } });
  const clips = await prisma.clip.findMany({
    where: { broadcasterId: channel.broadcasterId },
    orderBy: { createdAt: 'desc' },
    take: 80
  });

  const clipViews = clips.map(toClipView);
  const clipGroups = groupClipsBySession(clipViews);
  const lastClip = clipViews[0] ?? null;

  const stats = {
    total: clipViews.length,
    ready: clipViews.filter((clip) => clip.status === 'ok').length,
    failed: clipViews.filter((clip) => clip.status === 'failed').length,
    pending: clipViews.filter((clip) => clip.status === 'pending').length
  };

  const token = tokenRecord
    ? {
        scopes: tokenRecord.scopes,
        expiresLabel: DATE_FORMATTER.format(tokenRecord.expiresAt)
      }
    : null;

  return {
    channel,
    token,
    clipGroups,
    clipStats: stats,
    lastClipLabel: relativeTimeFromNow(lastClip ? lastClip.createdAtMs : null),
    connectedLabel: DATE_FORMATTER.format(channel.createdAt),
    sessionActive: true
  };
};

const dashboardRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    const broadcasterId = request.session.get('broadcasterId');
    if (!broadcasterId) {
      return reply.view('welcome', { sessionActive: false });
    }

    const channel = await prisma.channel.findUnique({ where: { broadcasterId } });
    if (!channel) {
      request.session.delete();
      return reply.view('welcome', {
        sessionActive: false,
        notice: 'We could not find your channel anymore. Please reconnect with your broadcaster account.'
      });
    }

    const viewModel = await buildChannelViewModel(channel);
    return reply.view('channel', viewModel);
  });

  fastify.get('/channels/:broadcasterId', async (request, reply) => {
    const { broadcasterId } = request.params as { broadcasterId: string };
    const sessionId = request.session.get('broadcasterId');
    if (!sessionId || sessionId !== broadcasterId) {
      return reply.status(403).send('Forbidden');
    }
    const channel = await prisma.channel.findUnique({ where: { broadcasterId } });
    if (!channel) {
      request.session.delete();
      return reply.status(404).send('Channel not found');
    }
    const viewModel = await buildChannelViewModel(channel);
    return reply.view('channel', viewModel);
  });
};

export default dashboardRoute;
