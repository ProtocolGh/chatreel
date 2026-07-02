import { supabaseAdmin } from '../lib/supabaseAdmin';
import {
  getAuthUserIdByProfileId,
  sendPushToUserSafe,
} from './push.service';

export type MomentAudienceMode = 'friends' | 'only' | 'except';

export type MomentRow = {
  id: string;
  author_id: string;
  media_url: string | null;
  media_type: 'image' | 'video' | 'text' | 'reel';
  caption: string | null;
  text_background: string | null;
  thumbnail_url: string | null;
  duration_minutes: number;
  expires_at: string;
  view_once: boolean;
  audience_mode: MomentAudienceMode;
  group_id: string | null;
  position: number;
  reel_id: string | null;
  created_at: string;
};

export type MomentReelRefDTO = {
  id: string;
  caption: string | null;
  thumbnail_url: string | null;
  author_name: string;
};

export type MomentAuthorDTO = {
  id: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export type MomentSlideDTO = {
  id: string;
  media_url: string | null;
  media_type: 'image' | 'video' | 'text' | 'reel';
  caption: string | null;
  text_background: string | null;
  thumbnail_url: string | null;
  view_once: boolean;
  expires_at: string;
  duration_minutes: number;
  created_at: string;
  viewed_by_me: boolean;
  group_id: string | null;
  position: number;
  view_count?: number;
  reel_id?: string | null;
  reel?: MomentReelRefDTO | null;
};

export type MomentViewerDTO = {
  profile_id: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  viewed_at: string;
};

export type MomentReplyDTO = {
  id: string;
  author_id: string;
  author_user_id: string;
  author_name: string;
  author_avatar_url: string | null;
  body: string;
  created_at: string;
};

export type MomentAuthorFeedDTO = {
  author: MomentAuthorDTO;
  slides: MomentSlideDTO[];
  has_unseen: boolean;
  latest_at: string;
};

export async function getAcceptedFriendIds(profileId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('friendships')
    .select('user_id, friend_id')
    .eq('status', 'accepted')
    .or(`user_id.eq.${profileId},friend_id.eq.${profileId}`);

  if (error) throw new Error(error.message);

  const set = new Set<string>();
  for (const row of data ?? []) {
    if (row.user_id === profileId) set.add(row.friend_id);
    else if (row.friend_id === profileId) set.add(row.user_id);
  }
  return set;
}

async function getViewedSet(
  viewerProfileId: string,
  momentIds: string[]
): Promise<Set<string>> {
  if (!momentIds.length) return new Set();

  const { data, error } = await supabaseAdmin
    .from('moment_views')
    .select('moment_id')
    .eq('viewer_id', viewerProfileId)
    .in('moment_id', momentIds);

  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.moment_id));
}

export function canViewerSeeMoment(
  moment: MomentRow,
  viewerProfileId: string,
  authorFriendIds: Set<string>,
  audienceInclude: Set<string>,
  audienceExclude: Set<string>,
  viewedByMe: boolean
): boolean {
  if (moment.author_id === viewerProfileId) return true;
  if (new Date(moment.expires_at).getTime() <= Date.now()) return false;
  if (moment.view_once && viewedByMe) return false;
  if (!authorFriendIds.has(viewerProfileId)) return false;

  if (moment.audience_mode === 'friends') return true;
  if (moment.audience_mode === 'only') return audienceInclude.has(viewerProfileId);
  if (moment.audience_mode === 'except') return !audienceExclude.has(viewerProfileId);
  return false;
}

export function sortMomentSlides(slides: MomentSlideDTO[]): MomentSlideDTO[] {
  return [...slides].sort((a, b) => {
    const groupA = a.group_id ?? a.id;
    const groupB = b.group_id ?? b.id;
    if (groupA !== groupB) {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    return a.position - b.position;
  });
}

export async function getMomentViewCounts(momentIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!momentIds.length) return counts;

  const { data, error } = await supabaseAdmin
    .from('moment_views')
    .select('moment_id')
    .in('moment_id', momentIds);

  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    counts.set(row.moment_id, (counts.get(row.moment_id) ?? 0) + 1);
  }
  return counts;
}

async function loadMomentAccessRow(momentId: string): Promise<MomentRow> {
  const { data: moment, error } = await supabaseAdmin
    .from('moments')
    .select('*')
    .eq('id', momentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!moment) throw new Error('Moment not found');
  return moment as MomentRow;
}

async function assertCanViewMoment(momentId: string, viewerProfileId: string): Promise<MomentRow> {
  const moment = await loadMomentAccessRow(momentId);
  if (moment.author_id === viewerProfileId) return moment;

  const viewedSet = await getViewedSet(viewerProfileId, [momentId]);
  const friends = await getAcceptedFriendIds(moment.author_id);

  const { data: audienceRows } = await supabaseAdmin
    .from('moment_audience')
    .select('profile_id, rule')
    .eq('moment_id', momentId);

  const include = new Set<string>();
  const exclude = new Set<string>();
  for (const row of audienceRows ?? []) {
    if (row.rule === 'include') include.add(row.profile_id as string);
    else exclude.add(row.profile_id as string);
  }

  if (
    !canViewerSeeMoment(
      moment,
      viewerProfileId,
      friends,
      include,
      exclude,
      viewedSet.has(momentId)
    )
  ) {
    throw new Error('Not allowed');
  }

  return moment;
}

async function fetchMomentReplies(momentId: string): Promise<MomentReplyDTO[]> {
  const { data: replyRows, error: repliesError } = await supabaseAdmin
    .from('moment_replies')
    .select(
      `id, body, created_at, author_id,
       author:profiles!moment_replies_author_id_fkey(id, user_id, display_name, email, avatar_url)`
    )
    .eq('moment_id', momentId)
    .order('created_at', { ascending: true });

  if (repliesError) throw new Error(repliesError.message);

  return (replyRows ?? []).map((row) => {
    const author = row.author as unknown as {
      user_id?: string;
      display_name: string | null;
      email: string | null;
      avatar_url: string | null;
    } | null;
    const name =
      author?.display_name?.trim() || author?.email?.split('@')[0] || 'User';
    return {
      id: row.id as string,
      author_id: row.author_id as string,
      author_user_id: author?.user_id ?? '',
      author_name: name,
      author_avatar_url: author?.avatar_url ?? null,
      body: row.body as string,
      created_at: row.created_at as string,
    };
  });
}

async function enrichReplyUserIds(replies: MomentReplyDTO[]): Promise<MomentReplyDTO[]> {
  const missing = replies.filter((r) => !r.author_user_id);
  if (!missing.length) return replies;

  const profileIds = [...new Set(missing.map((r) => r.author_id))];
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, user_id')
    .in('id', profileIds);

  const userIdByProfile = new Map(
    (profiles ?? []).map((p) => [p.id as string, p.user_id as string])
  );

  return replies.map((r) =>
    r.author_user_id
      ? r
      : { ...r, author_user_id: userIdByProfile.get(r.author_id) ?? '' }
  );
}

export async function getMomentActivity(
  momentId: string,
  requesterProfileId: string
): Promise<{ view_count: number; viewers: MomentViewerDTO[]; replies: MomentReplyDTO[] }> {
  const moment = await assertCanViewMoment(momentId, requesterProfileId);
  const isOwner = moment.author_id === requesterProfileId;
  const replies = await enrichReplyUserIds(await fetchMomentReplies(momentId));

  if (!isOwner) {
    return { view_count: 0, viewers: [], replies };
  }

  const { data: views, error: viewsError } = await supabaseAdmin
    .from('moment_views')
    .select(
      `viewed_at,
       viewer:profiles!moment_views_viewer_id_fkey(id, user_id, display_name, email, avatar_url)`
    )
    .eq('moment_id', momentId)
    .order('viewed_at', { ascending: false });

  if (viewsError) throw new Error(viewsError.message);

  const viewers: MomentViewerDTO[] = (views ?? [])
    .map((row) => {
      const viewer = row.viewer as unknown as {
        id: string;
        user_id: string;
        display_name: string | null;
        email: string | null;
        avatar_url: string | null;
      } | null;
      if (!viewer) return null;
      return {
        profile_id: viewer.id,
        user_id: viewer.user_id,
        display_name: viewer.display_name,
        email: viewer.email,
        avatar_url: viewer.avatar_url,
        viewed_at: row.viewed_at as string,
      };
    })
    .filter((v): v is MomentViewerDTO => Boolean(v));

  return { view_count: viewers.length, viewers, replies };
}

export async function createMomentReply(
  momentId: string,
  authorProfileId: string,
  body: string,
  recipientUserId?: string,
  toChat = false
): Promise<MomentReplyDTO> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Reply cannot be empty');

  const normalizedRecipient = recipientUserId?.trim() || undefined;

  await assertCanViewMoment(momentId, authorProfileId);

  const { data: moment, error: momentError } = await supabaseAdmin
    .from('moments')
    .select(
      `id, author_id, expires_at, media_url, media_type, caption, thumbnail_url, reel_id,
       author:profiles!moments_author_id_fkey(user_id, display_name, email)`
    )
    .eq('id', momentId)
    .maybeSingle();

  if (momentError) throw new Error(momentError.message);
  if (!moment) throw new Error('Moment not found');
  if (new Date(moment.expires_at as string).getTime() <= Date.now()) {
    throw new Error('Moment expired');
  }

  const momentAuthor = moment.author as unknown as {
    user_id: string;
    display_name: string | null;
    email: string | null;
  } | null;
  const momentAuthorUserId = momentAuthor?.user_id;
  if (!momentAuthorUserId) throw new Error('Moment author not found');

  const senderUserId = await getAuthUserIdByProfileId(authorProfileId);
  if (!senderUserId) throw new Error('Sender profile not found');

  const isMomentOwner = moment.author_id === authorProfileId;
  const shouldSendChat = toChat && (!isMomentOwner || Boolean(normalizedRecipient));
  let chatReceiverUserId = normalizedRecipient ?? momentAuthorUserId;

  if (normalizedRecipient) {
    if (!isMomentOwner) {
      throw new Error('Only the moment author can reply to a specific person');
    }
    if (normalizedRecipient === senderUserId) {
      throw new Error('Cannot reply to yourself');
    }
    const { data: recipientProfile } = await supabaseAdmin
      .from('profiles')
      .select('user_id')
      .eq('user_id', normalizedRecipient)
      .maybeSingle();
    if (!recipientProfile?.user_id) {
      throw new Error('Recipient not found');
    }
  } else if (!isMomentOwner) {
    if (senderUserId === momentAuthorUserId) {
      throw new Error('Cannot reply to your own moment');
    }
    chatReceiverUserId = momentAuthorUserId;
  }

  const { data: row, error } = await supabaseAdmin
    .from('moment_replies')
    .insert({
      moment_id: momentId,
      author_id: authorProfileId,
      body: trimmed,
    })
    .select(
      `id, body, created_at, author_id,
       author:profiles!moment_replies_author_id_fkey(user_id, display_name, email, avatar_url)`
    )
    .single();

  if (error || !row) throw new Error(error?.message ?? 'Failed to post reply');

  if (shouldSendChat) {
    const previewUrl =
      (moment.thumbnail_url as string | null) ??
      (moment.media_type === 'image' ? (moment.media_url as string | null) : null) ??
      (moment.media_type === 'reel' ? (moment.media_url as string | null) : null);

    const momentChatRow = {
      sender_id: senderUserId,
      receiver_id: chatReceiverUserId,
      content: trimmed,
      message_type: 'moment' as const,
      moment_id: momentId,
      file_url: previewUrl,
      plaintext: true,
    };

    let chatMessage: { id: string } | null = null;
    let chatError: { message: string } | null = null;

    const primary = await supabaseAdmin
      .from('messages')
      .insert(momentChatRow)
      .select('id')
      .single();

    if (primary.error) {
      if (/moment_id/i.test(primary.error.message)) {
        const fallback = await supabaseAdmin
          .from('messages')
          .insert({
            sender_id: senderUserId,
            receiver_id: chatReceiverUserId,
            content: trimmed,
            message_type: 'text',
            file_url: previewUrl,
            plaintext: true,
          })
          .select('id')
          .single();
        chatMessage = fallback.data;
        chatError = fallback.error;
      } else {
        chatError = primary.error;
      }
    } else {
      chatMessage = primary.data;
    }

    if (chatError || !chatMessage) {
      await supabaseAdmin.from('moment_replies').delete().eq('id', row.id);
      throw new Error(chatError?.message ?? 'Failed to send chat message');
    }

    const { data: senderProfile } = await supabaseAdmin
      .from('profiles')
      .select('display_name, email')
      .eq('user_id', senderUserId)
      .maybeSingle();

    const senderName =
      senderProfile?.display_name || senderProfile?.email?.split('@')[0] || 'New message';

    sendPushToUserSafe(chatReceiverUserId, {
      title: senderName,
      body: trimmed.slice(0, 120),
      data: {
        type: 'message',
        chat_id: senderUserId,
        message_id: chatMessage?.id,
      },
    });
  }

  const author = row.author as unknown as {
    user_id: string;
    display_name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null;
  const name =
    author?.display_name?.trim() || author?.email?.split('@')[0] || 'User';

  let authorUserId = author?.user_id ?? '';
  if (!authorUserId) {
    authorUserId = (await getAuthUserIdByProfileId(row.author_id as string)) ?? '';
  }

  return {
    id: row.id as string,
    author_id: row.author_id as string,
    author_user_id: authorUserId,
    author_name: name,
    author_avatar_url: author?.avatar_url ?? null,
    body: row.body as string,
    created_at: row.created_at as string,
  };
}

export async function buildMomentsFeed(viewerProfileId: string): Promise<MomentAuthorFeedDTO[]> {
  const now = new Date().toISOString();

  const { data: rows, error } = await supabaseAdmin
    .from('moments')
    .select(
      `id, author_id, media_url, media_type, caption, text_background, thumbnail_url, duration_minutes, expires_at, view_once, audience_mode, group_id, position, reel_id, created_at,
       author:profiles!moments_author_id_fkey(id, user_id, display_name, email, avatar_url)`
    )
    .gt('expires_at', now)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  const moments = (rows ?? []) as unknown as Array<
    MomentRow & { author: MomentAuthorDTO | null }
  >;

  const momentIds = moments.map((m) => m.id);
  const viewedSet = await getViewedSet(viewerProfileId, momentIds);

  const audienceRows = await supabaseAdmin
    .from('moment_audience')
    .select('moment_id, profile_id, rule')
    .in('moment_id', momentIds);

  if (audienceRows.error) throw new Error(audienceRows.error.message);

  const includeMap = new Map<string, Set<string>>();
  const excludeMap = new Map<string, Set<string>>();
  for (const row of audienceRows.data ?? []) {
    const target = row.rule === 'include' ? includeMap : excludeMap;
    if (!target.has(row.moment_id)) target.set(row.moment_id, new Set());
    target.get(row.moment_id)!.add(row.profile_id);
  }

  const friendCache = new Map<string, Set<string>>();
  const visibleByAuthor = new Map<string, MomentSlideDTO[]>();

  for (const moment of moments) {
    if (!moment.author) continue;

    let friends = friendCache.get(moment.author_id);
    if (!friends) {
      friends = await getAcceptedFriendIds(moment.author_id);
      friendCache.set(moment.author_id, friends);
    }

    const viewed = viewedSet.has(moment.id);
    const visible = canViewerSeeMoment(
      moment,
      viewerProfileId,
      friends,
      includeMap.get(moment.id) ?? new Set(),
      excludeMap.get(moment.id) ?? new Set(),
      viewed
    );

    if (!visible) continue;

    const slide: MomentSlideDTO = {
      id: moment.id,
      media_url: moment.media_url,
      media_type: moment.media_type,
      caption: moment.caption,
      text_background: moment.text_background ?? null,
      thumbnail_url: moment.thumbnail_url ?? null,
      view_once: moment.view_once,
      expires_at: moment.expires_at,
      duration_minutes: moment.duration_minutes,
      created_at: moment.created_at,
      viewed_by_me: viewed,
      group_id: moment.group_id ?? null,
      position: moment.position ?? 0,
      reel_id: moment.reel_id ?? null,
    };

    if (!visibleByAuthor.has(moment.author_id)) visibleByAuthor.set(moment.author_id, []);
    visibleByAuthor.get(moment.author_id)!.push(slide);
  }

  const authorById = new Map<string, MomentAuthorDTO>();
  for (const moment of moments) {
    if (moment.author) authorById.set(moment.author_id, moment.author);
  }

  const ownMomentIds = moments
    .filter((m) => m.author_id === viewerProfileId)
    .map((m) => m.id);
  const viewCounts = await getMomentViewCounts(ownMomentIds);

  const reelIds = [
    ...new Set(
      moments.map((m) => m.reel_id).filter((id): id is string => Boolean(id))
    ),
  ];
  const reelRefMap = new Map<string, MomentReelRefDTO>();
  if (reelIds.length) {
    const { data: reelRows } = await supabaseAdmin
      .from('reels')
      .select(
        `id, caption, thumbnail_url,
         author:profiles!reels_author_id_fkey(display_name, email)`
      )
      .in('id', reelIds);
    for (const row of reelRows ?? []) {
      const author = row.author as unknown as { display_name: string | null; email: string | null } | null;
      const authorName =
        author?.display_name?.trim() || author?.email?.split('@')[0] || 'Creator';
      reelRefMap.set(row.id as string, {
        id: row.id as string,
        caption: (row.caption as string | null) ?? null,
        thumbnail_url: (row.thumbnail_url as string | null) ?? null,
        author_name: authorName,
      });
    }
  }

  const authors: MomentAuthorFeedDTO[] = [];
  for (const [authorId, slides] of visibleByAuthor) {
    if (!slides.length) continue;
    const author = authorById.get(authorId);
    if (!author) continue;

    const sortedSlides = sortMomentSlides(slides).map((slide) => {
      const base =
        authorId === viewerProfileId
          ? { ...slide, view_count: viewCounts.get(slide.id) ?? 0 }
          : slide;
      if (slide.reel_id && reelRefMap.has(slide.reel_id)) {
        return { ...base, reel: reelRefMap.get(slide.reel_id) ?? null };
      }
      return base;
    });

    authors.push({
      author,
      slides: sortedSlides,
      has_unseen: sortedSlides.some((s) => !s.viewed_by_me),
      latest_at: sortedSlides[sortedSlides.length - 1]?.created_at ?? '',
    });
  }

  authors.sort((a, b) => {
    if (a.has_unseen !== b.has_unseen) return a.has_unseen ? -1 : 1;
    return new Date(b.latest_at).getTime() - new Date(a.latest_at).getTime();
  });

  return authors;
}
