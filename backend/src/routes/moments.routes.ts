import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import {
  asyncHandler,
  AuthedRequest,
  getProfileIdByUserId,
  requireAuth,
} from '../middleware/auth';
import {
  buildMomentsFeed,
  createMomentReply,
  getAcceptedFriendIds,
  getMomentActivity,
  MomentAudienceMode,
} from '../services/moments.service';
import {
  canViewReel,
  enrichReels,
  getAcceptedFriendIds as getReelFriendIds,
  type ReelRow,
} from '../services/reels.service';
import { getReelPlaybackUrl } from '../lib/reelUrls';

const router = Router();

const mediaItemSchema = z
  .object({
    media_url: z.string().url().optional(),
    media_type: z.enum(['image', 'video', 'text']).default('image'),
    caption: z.string().max(2000).optional(),
    text_background: z.string().max(50).optional(),
    thumbnail_url: z.string().url().optional(),
  })
  .superRefine((item, ctx) => {
    if (item.media_type === 'text') {
      if (!item.caption?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Text moment needs content' });
      }
      if (!item.text_background?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Text moment needs a background' });
      }
    } else if (!item.media_url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'media_url required for image/video' });
    }
  });

const createMomentSchema = z
  .object({
    media_url: z.string().url().optional(),
    media_type: z.enum(['image', 'video', 'text']).default('image'),
    media_items: z.array(mediaItemSchema).min(1).max(30).optional(),
    caption: z.string().max(2000).optional(),
    text_background: z.string().max(50).optional(),
    duration_minutes: z.number().int().min(10).max(1440).default(1440),
    view_once: z.boolean().default(false),
    audience_mode: z.enum(['friends', 'only', 'except']).default('friends'),
    audience_ids: z.array(z.string().uuid()).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.media_items?.length) return;
    if (data.media_type === 'text') {
      if (!data.caption?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Text moment needs content' });
      }
      return;
    }
    if (!data.media_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide media_url or media_items',
      });
    }
  });

const replySchema = z.object({
  body: z.string().min(1).max(2000),
  recipient_user_id: z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.string().uuid().optional()
  ),
  to_chat: z.boolean().optional().default(false),
});

function assertChatFilesUrl(url: string): void {
  if (!/\/storage\/v1\/object\/public\/chat-files\//i.test(url)) {
    throw new Error('media_url must be uploaded to the chat-files bucket');
  }
}

function assertMomentThumbnailUrl(url: string): void {
  if (!/\/storage\/v1\/object\/public\/chat-files\//i.test(url)) {
    throw new Error('thumbnail_url must be uploaded to the chat-files bucket');
  }
}

function resolveMediaItems(body: z.infer<typeof createMomentSchema>) {
  if (body.media_items?.length) {
    return body.media_items.map((item) => ({
      media_url: item.media_url ?? null,
      media_type: item.media_type,
      caption: item.caption?.trim() || null,
      text_background: item.text_background?.trim() || null,
      thumbnail_url: item.thumbnail_url ?? null,
    }));
  }
  if (body.media_type === 'text') {
    return [
      {
        media_url: null,
        media_type: 'text' as const,
        caption: body.caption?.trim() || null,
        text_background: body.text_background?.trim() || 'ocean',
        thumbnail_url: null,
      },
    ];
  }
  return [
    {
      media_url: body.media_url!,
      media_type: body.media_type,
      caption: body.caption?.trim() || null,
      text_background: null,
      thumbnail_url: null,
    },
  ];
}

router.get(
  '/feed',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const profileId = await getProfileIdByUserId(req.userId!);
    if (!profileId) return res.status(404).json({ error: 'Profile not found' });

    const authors = await buildMomentsFeed(profileId);
    return res.json({ authors });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const profileId = await getProfileIdByUserId(req.userId!);
    if (!profileId) return res.status(404).json({ error: 'Profile not found' });

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('moments')
      .select('*')
      .eq('author_id', profileId)
      .gt('expires_at', now)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ moments: data ?? [] });
  })
);

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const profileId = await getProfileIdByUserId(req.userId!);
    if (!profileId) return res.status(404).json({ error: 'Profile not found' });

    const body = createMomentSchema.parse(req.body);
    const mediaItems = resolveMediaItems(body);
    for (const item of mediaItems) {
      if (item.media_type !== 'text' && item.media_url) {
        assertChatFilesUrl(item.media_url);
      }
      if (item.thumbnail_url) {
        assertMomentThumbnailUrl(item.thumbnail_url);
      }
    }

    const audienceIds = body.audience_ids ?? [];
    if (body.audience_mode !== 'friends' && audienceIds.length === 0) {
      return res.status(400).json({
        error:
          body.audience_mode === 'only'
            ? 'Select at least one friend who can view this moment'
            : 'Select at least one friend to hide this moment from',
      });
    }

    if (audienceIds.length > 0) {
      const friends = await getAcceptedFriendIds(profileId);
      const invalid = audienceIds.filter((id) => !friends.has(id) && id !== profileId);
      if (invalid.length) {
        return res.status(400).json({ error: 'Audience must be from your friends list' });
      }
    }

    const expiresAt = new Date(Date.now() + body.duration_minutes * 60_000).toISOString();
    const groupId = mediaItems.length > 1 ? randomUUID() : null;

    const rows = mediaItems.map((item, position) => ({
      author_id: profileId,
      media_url: item.media_url,
      media_type: item.media_type,
      caption: item.caption,
      text_background: item.text_background,
      thumbnail_url: item.thumbnail_url,
      duration_minutes: body.duration_minutes,
      expires_at: expiresAt,
      view_once: body.view_once,
      audience_mode: body.audience_mode as MomentAudienceMode,
      group_id: groupId,
      position,
    }));

    const { data: moments, error } = await supabaseAdmin
      .from('moments')
      .insert(rows)
      .select('*');

    if (error || !moments?.length) {
      return res.status(500).json({ error: error?.message ?? 'Failed to create moment' });
    }

    if (audienceIds.length > 0) {
      const rule = body.audience_mode === 'only' ? 'include' : 'exclude';
      const audienceRows = moments.flatMap((moment) =>
        audienceIds.map((profile_id) => ({
          moment_id: moment.id,
          profile_id,
          rule,
        }))
      );
      const { error: audError } = await supabaseAdmin.from('moment_audience').insert(audienceRows);
      if (audError) {
        await supabaseAdmin.from('moments').delete().in('id', moments.map((m) => m.id));
        return res.status(500).json({ error: audError.message });
      }
    }

    return res.status(201).json({
      moment: moments[0],
      moments,
    });
  })
);

router.get(
  '/:id/activity',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const profileId = await getProfileIdByUserId(req.userId!);
    if (!profileId) return res.status(404).json({ error: 'Profile not found' });

    const momentId = z.string().uuid().parse(req.params.id);

    try {
      const activity = await getMomentActivity(momentId, profileId);
      return res.json(activity);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load activity';
      if (message === 'Moment not found') return res.status(404).json({ error: message });
      if (message === 'Not allowed') return res.status(403).json({ error: message });
      return res.status(500).json({ error: message });
    }
  })
);

router.post(
  '/:id/replies',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const profileId = await getProfileIdByUserId(req.userId!);
    if (!profileId) return res.status(404).json({ error: 'Profile not found' });

    const momentId = z.string().uuid().parse(req.params.id);
    const {
      body,
      recipient_user_id: recipientUserId,
      to_chat: toChat,
    } = replySchema.parse(req.body);

    try {
      const reply = await createMomentReply(momentId, profileId, body, recipientUserId, toChat);
      return res.status(201).json({ reply });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to post reply';
      if (message === 'Moment not found') return res.status(404).json({ error: message });
      if (message === 'Moment expired') return res.status(410).json({ error: message });
      if (message === 'Not allowed') return res.status(403).json({ error: message });
      return res.status(400).json({ error: message });
    }
  })
);

router.post(
  '/:id/view',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const profileId = await getProfileIdByUserId(req.userId!);
    if (!profileId) return res.status(404).json({ error: 'Profile not found' });

    const momentId = z.string().uuid().parse(req.params.id);

    const { data: moment, error } = await supabaseAdmin
      .from('moments')
      .select('id, author_id, expires_at')
      .eq('id', momentId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!moment) return res.status(404).json({ error: 'Moment not found' });
    if (new Date(moment.expires_at).getTime() <= Date.now()) {
      return res.status(410).json({ error: 'Moment expired' });
    }

    if (moment.author_id !== profileId) {
      const { error: viewError } = await supabaseAdmin.from('moment_views').upsert(
        {
          moment_id: momentId,
          viewer_id: profileId,
          viewed_at: new Date().toISOString(),
        },
        { onConflict: 'moment_id,viewer_id' }
      );
      if (viewError) return res.status(500).json({ error: viewError.message });
    }

    return res.json({ success: true });
  })
);

const fromReelSchema = z.object({
  caption: z.string().max(2000).optional(),
  duration_minutes: z.number().int().min(10).max(1440).default(1440),
  view_once: z.boolean().default(false),
  audience_mode: z.enum(['friends', 'only', 'except']).default('friends'),
  audience_ids: z.array(z.string().uuid()).optional(),
});

router.post(
  '/from-reel/:reelId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const profileId = await getProfileIdByUserId(req.userId!);
    if (!profileId) return res.status(404).json({ error: 'Profile not found' });

    const reelId = z.string().uuid().parse(req.params.reelId);
    const body = fromReelSchema.parse(req.body ?? {});

    const { data: reelRow, error: reelError } = await supabaseAdmin
      .from('reels')
      .select('*')
      .eq('id', reelId)
      .maybeSingle();

    if (reelError) return res.status(500).json({ error: reelError.message });
    if (!reelRow) return res.status(404).json({ error: 'Reel not found' });

    const friendIds = await getReelFriendIds(profileId);
    const allowed = await canViewReel(
      reelRow as ReelRow,
      profileId,
      friendIds,
      req.userId!
    );
    if (!allowed) return res.status(403).json({ error: 'You cannot share this reel' });

    const [enriched] = await enrichReels([reelRow as ReelRow], profileId);
    const playbackUrl = enriched?.playback_url ?? getReelPlaybackUrl(reelRow as ReelRow);
    if (!playbackUrl) {
      return res.status(400).json({ error: 'Reel has no playable media' });
    }

    const audienceIds = body.audience_ids ?? [];
    if (body.audience_mode !== 'friends' && audienceIds.length === 0) {
      return res.status(400).json({
        error:
          body.audience_mode === 'only'
            ? 'Select at least one friend who can view this moment'
            : 'Select at least one friend to hide this moment from',
      });
    }

    if (audienceIds.length > 0) {
      const friends = await getAcceptedFriendIds(profileId);
      const invalid = audienceIds.filter((id) => !friends.has(id) && id !== profileId);
      if (invalid.length) {
        return res.status(400).json({ error: 'Audience must be from your friends list' });
      }
    }

    const expiresAt = new Date(Date.now() + body.duration_minutes * 60_000).toISOString();
    const caption =
      body.caption !== undefined
        ? body.caption.trim() || null
        : ((reelRow.caption as string | null)?.trim() || null);

    const { data: moments, error } = await supabaseAdmin
      .from('moments')
      .insert({
        author_id: profileId,
        media_url: playbackUrl,
        media_type: 'reel',
        reel_id: reelId,
        caption,
        duration_minutes: body.duration_minutes,
        expires_at: expiresAt,
        view_once: body.view_once,
        audience_mode: body.audience_mode as MomentAudienceMode,
        group_id: null,
        position: 0,
      })
      .select('*');

    if (error || !moments?.length) {
      return res.status(500).json({ error: error?.message ?? 'Failed to create moment' });
    }

    const moment = moments[0];

    if (audienceIds.length > 0) {
      const rule = body.audience_mode === 'only' ? 'include' : 'exclude';
      const audienceRows = audienceIds.map((profile_id) => ({
        moment_id: moment.id,
        profile_id,
        rule,
      }));
      const { error: audError } = await supabaseAdmin.from('moment_audience').insert(audienceRows);
      if (audError) {
        await supabaseAdmin.from('moments').delete().eq('id', moment.id);
        return res.status(500).json({ error: audError.message });
      }
    }

    return res.status(201).json({ moment });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const momentId = z.string().uuid().parse(req.params.id);

    const { data: moment, error } = await supabaseAdmin
      .from('moments')
      .select('*')
      .eq('id', momentId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!moment) return res.status(404).json({ error: 'Moment not found' });

    const { data: author } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id, display_name, avatar_url')
      .eq('id', moment.author_id)
      .maybeSingle();

    return res.json({ moment, author });
  })
);

router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const profileId = await getProfileIdByUserId(req.userId!);
    if (!profileId) return res.status(404).json({ error: 'Profile not found' });

    const momentId = z.string().uuid().parse(req.params.id);

    const { data: moment } = await supabaseAdmin
      .from('moments')
      .select('author_id')
      .eq('id', momentId)
      .maybeSingle();

    if (!moment) return res.status(404).json({ error: 'Moment not found' });
    if (moment.author_id !== profileId) {
      return res.status(403).json({ error: 'Not allowed' });
    }

    const { error } = await supabaseAdmin.from('moments').delete().eq('id', momentId);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ success: true });
  })
);

export default router;
