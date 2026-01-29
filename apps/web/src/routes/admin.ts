import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { Channel, Prisma } from '@prisma/client';
import prisma from '../db';
import { adminAllowlistConfigured, isAdminChannel } from '../services/admin';

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'short',
  timeStyle: 'short'
});

const statusLabelMap: Record<string, string> = {
  ok: 'Ready',
  failed: 'Failed',
  pending: 'Pending'
};

const statusToneMap: Record<string, string> = {
  ok: 'ready',
  failed: 'failed',
  pending: 'pending'
};

const normalizeStatusKey = (status?: string) => {
  if (!status) {
    return undefined;
  }

  const normalized = status.toLowerCase();
  if (normalized === 'ready') {
    return 'ok';
  }
  if (normalized === 'ok' || normalized === 'failed' || normalized === 'pending') {
    return normalized;
  }
  return undefined;
};

const toMetricKey = (raw: string): 'ready' | 'failed' | 'pending' => {
  if (raw === 'ok') return 'ready';
  if (raw === 'failed') return 'failed';
  return 'pending';
};

const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
  const broadcasterId = request.session.get('broadcasterId');

  if (!broadcasterId) {
    return reply.status(403).send('Forbidden');
  }

  const channel = await prisma.channel.findUnique({ where: { broadcasterId } });
  if (!channel) {
    request.session.delete();
    return reply.status(403).send('Forbidden');
  }

  if (!adminAllowlistConfigured) {
    return reply.status(403).send('Admin access not configured');
  }

  if (!isAdminChannel(channel)) {
    return reply.status(403).send('Forbidden');
  }

  return channel;
};

const buildStatusCounts = (groups: { status: string; _count: { id: number } }[]) => {
  const counts = {
    ready: 0,
    failed: 0,
    pending: 0
  };

  for (const group of groups) {
    const key = toMetricKey(group.status);
    counts[key] = group._count.id;
  }

  return counts;
};

const buildAdminSummary = async () => {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [totalUsers, totalClips, statusGroups, last24hGroups, topChannelGroups, recentClips] = await Promise.all([
    prisma.channel.count(),
    prisma.clip.count(),
    prisma.clip.groupBy({
      by: ['status'],
      _count: { id: true }
    }),
    prisma.clip.groupBy({
      by: ['status'],
      where: {
        createdAt: {
          gte: since24h
        }
      },
      _count: { id: true }
    }),
    prisma.clip.groupBy({
      by: ['broadcasterId'],
      orderBy: {
        _count: {
          id: 'desc'
        }
      },
      take: 10,
      _count: { id: true }
    }),
    prisma.clip.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20
    })
  ]);

  const channelIds = Array.from(
    new Set([
      ...topChannelGroups.map((group) => group.broadcasterId),
      ...recentClips.map((clip) => clip.broadcasterId)
    ])
  );

  let channelMap = new Map<string, Channel>();
  if (channelIds.length) {
    const channels = await prisma.channel.findMany({
      where: {
        broadcasterId: { in: channelIds }
      }
    });
    channelMap = new Map(channels.map((channel) => [channel.broadcasterId, channel]));
  }

  const statusCounts = buildStatusCounts(statusGroups);
  const last24hCounts = buildStatusCounts(last24hGroups);

  const failureRate = totalClips
    ? Number(((statusCounts.failed / totalClips) * 100).toFixed(1))
    : 0;

  const topChannels = topChannelGroups.map((group) => {
    const channel = channelMap.get(group.broadcasterId);
    return {
      broadcasterId: group.broadcasterId,
      clipCount: group._count.id,
      displayName: channel?.displayName ?? group.broadcasterId,
      login: channel?.login ?? channel?.displayName ?? group.broadcasterId
    };
  });

  const recentClipViews = recentClips.map((clip) => {
    const channel = channelMap.get(clip.broadcasterId);
    const status = clip.status;
    return {
      id: clip.id,
      clipId: clip.clipId,
      url: clip.url,
      requestedBy: clip.requestedBy,
      error: clip.error,
      status,
      statusLabel: statusLabelMap[status] ?? 'Unknown',
      statusTone: statusToneMap[status] ?? 'pending',
      channel: {
        displayName: channel?.displayName ?? clip.broadcasterId,
        login: channel?.login ?? clip.broadcasterId
      },
      createdAtLabel: DATE_FORMATTER.format(clip.createdAt),
      createdAtMs: clip.createdAt.getTime()
    };
  });

  return {
    totalUsers,
    totalClips,
    failureRate,
    statusCounts,
    last24h: {
      total: last24hCounts.ready + last24hCounts.failed + last24hCounts.pending,
      ready: last24hCounts.ready,
      failed: last24hCounts.failed,
      pending: last24hCounts.pending
    },
    topChannels,
    recentClips: recentClipViews
  };
};

const buildAdminUsers = async () => {
  const tokenByChannel = new Map(
    (await prisma.token.findMany()).map((token) => [token.broadcasterId, token])
  );

  return (
    await prisma.channel.findMany({
      orderBy: { displayName: 'asc' }
    })
  ).map((channel) => {
    const token = tokenByChannel.get(channel.broadcasterId);
    const now = new Date();
    const tokenHealth = token
      ? token.expiresAt > now
        ? 'valid'
        : 'expired'
      : 'unknown';
    return {
      broadcasterId: channel.broadcasterId,
      displayName: channel.displayName,
      login: channel.login,
      connectedAt: DATE_FORMATTER.format(channel.createdAt),
      lastSeenAt: DATE_FORMATTER.format(channel.updatedAt),
      tokenHealth,
      tokenExpiresAt: token ? DATE_FORMATTER.format(token.expiresAt) : null
    };
  });
};

type ClipPageParams = {
  page?: number;
  pageSize?: number;
  status?: string;
  channelId?: string;
  search?: string;
};

type AdminClipsQuery = ClipPageParams & {
  page?: string;
  pageSize?: string;
};

const parsePageValue = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
};

const buildClipPage = async ({ page = 1, pageSize = 12, status, channelId, search }: ClipPageParams) => {
  const normalizedStatus = normalizeStatusKey(status);

  const where: Prisma.ClipWhereInput = {};

  if (normalizedStatus) {
    where.status = normalizedStatus;
  }

  if (channelId) {
    where.broadcasterId = channelId;
  }

  const trimmedSearch = search?.trim();
  if (trimmedSearch) {
    where.OR = [
      {
        clipId: {
          contains: trimmedSearch
        }
      },
      {
        url: {
          contains: trimmedSearch
        }
      }
    ];
  }

  const totalMatches = await prisma.clip.count({ where });
  const clips = await prisma.clip.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * pageSize,
    take: pageSize
  });

  const clipChannelIds = Array.from(new Set(clips.map((clip) => clip.broadcasterId)));
  let channelMap = new Map<string, Channel>();
  if (clipChannelIds.length) {
    const clipChannels = await prisma.channel.findMany({
      where: {
        broadcasterId: { in: clipChannelIds }
      }
    });
    channelMap = new Map(clipChannels.map((channel) => [channel.broadcasterId, channel]));
  }

  const clipRows = clips.map((clip) => {
    const channel = channelMap.get(clip.broadcasterId);
    const status = clip.status;
    return {
      id: clip.id,
      clipId: clip.clipId,
      url: clip.url,
      requestedBy: clip.requestedBy,
      error: clip.error,
      status,
      statusLabel: statusLabelMap[status] ?? 'Unknown',
      statusTone: statusToneMap[status] ?? 'pending',
      channel: {
        displayName: channel?.displayName ?? clip.broadcasterId,
        login: channel?.login ?? clip.broadcasterId
      },
      createdAtLabel: DATE_FORMATTER.format(clip.createdAt)
    };
  });

  return {
    page,
    pageSize,
    total: totalMatches,
    clips: clipRows
  };
};

const adminApiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/summary', async (request, reply) => {
    const allowed = await requireAdmin(request, reply);
    if (!allowed) {
      return;
    }
    return reply.send(await buildAdminSummary());
  });

  fastify.get('/users', async (request, reply) => {
    const allowed = await requireAdmin(request, reply);
    if (!allowed) {
      return;
    }
    return reply.send(await buildAdminUsers());
  });

  fastify.get('/clips', async (request, reply) => {
    const allowed = await requireAdmin(request, reply);
    if (!allowed) {
      return;
    }
    const query = request.query as AdminClipsQuery;
    const page = parsePageValue(query.page, 1);
    const pageSize = Math.min(40, parsePageValue(query.pageSize, 12));
    return reply.send(
      await buildClipPage({
        page,
        pageSize,
        status: query.status,
        channelId: query.channelId,
        search: query.search
      })
    );
  });
};

const adminRoute: FastifyPluginAsync = async (fastify) => {
  fastify.register(adminApiRoutes, { prefix: '/api/admin' });

  fastify.get('/admin', async (request, reply) => {
    const channel = await requireAdmin(request, reply);
    if (!channel) {
      return;
    }

    const [summary, users] = await Promise.all([buildAdminSummary(), buildAdminUsers()]);
    return reply.view('admin', {
      title: 'Admin',
      summary,
      users,
      sessionActive: true,
      showAdminLink: true
    });
  });
};

export default adminRoute;
