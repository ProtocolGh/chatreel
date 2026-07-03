import type { Session } from '@supabase/supabase-js';
import { config } from './config';
import { ensureSupabaseSession } from './ensureSupabaseSession';
import { sessionStorage } from './sessionStorage';

export type ReelAuthorDTO = {
  id: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export type ReelMediaDTO = {
  id: string;
  reel_id: string;
  position: number;
  media_url: string;
  media_type: 'image' | 'video';
  thumbnail_url: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  hls_url: string | null;
  transcode_status?: 'pending' | 'processing' | 'ready' | 'failed' | 'skipped';
  playback_url?: string;
};

export type ReelDTO = {
  id: string;
  author_id: string;
  video_url: string;
  hls_url: string | null;
  playback_url?: string;
  transcode_status?: 'pending' | 'processing' | 'ready' | 'failed' | 'skipped';
  thumbnail_url: string | null;
  caption: string | null;
  duration: number | null;
  visibility: 'public' | 'friends' | 'private' | 'group';
  group_id?: string | null;
  width: number | null;
  height: number | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  created_at: string;
  author: ReelAuthorDTO | null;
  liked_by_me: boolean;
  media?: ReelMediaDTO[];
};

export type ReelCommentDTO = {
  id: string;
  reel_id: string;
  user_id: string;
  parent_id?: string | null;
  content: string;
  created_at: string;
  author: ReelAuthorDTO | null;
  reply_count?: number;
};

export type ReelInboxItemDTO = {
  id: string;
  type: 'like' | 'comment';
  created_at: string;
  actor: ReelAuthorDTO | null;
  reel: Pick<ReelDTO, 'id' | 'thumbnail_url' | 'caption' | 'video_url'> | null;
  comment?: { id: string; content: string };
};

export type MomentAudienceMode = 'friends' | 'only' | 'except';

export type MomentSlideDTO = {
  id: string;
  media_url: string | null;
  media_type: 'image' | 'video' | 'text' | 'reel';
  caption: string | null;
  text_background?: string | null;
  thumbnail_url?: string | null;
  view_once: boolean;
  expires_at: string;
  duration_minutes: number;
  created_at: string;
  viewed_by_me: boolean;
  group_id?: string | null;
  position?: number;
  view_count?: number;
  reel_id?: string | null;
  reel?: {
    id: string;
    caption: string | null;
    thumbnail_url: string | null;
    author_name: string;
  } | null;
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
  author: ReelAuthorDTO;
  slides: MomentSlideDTO[];
  has_unseen: boolean;
  latest_at: string;
};

export type CallType = 'voice' | 'video';
export type CallScope = 'direct' | 'group';
export type CallStatus =
  | 'ringing'
  | 'accepted'
  | 'declined'
  | 'missed'
  | 'ended'
  | 'cancelled';

export type CallDTO = {
  id: string;
  room_name: string;
  call_type: CallType;
  scope: CallScope;
  caller_id: string;
  callee_id: string | null;
  group_id: string | null;
  status: CallStatus;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  metadata: Record<string, unknown> | null;
};

export type CallHistoryItemDTO = CallDTO & {
  direction: 'incoming' | 'outgoing';
  peer: {
    display_name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null;
  group: { name: string; avatar_url: string | null } | null;
};

export type LiveKitTokenDTO = {
  token: string;
  url: string;
  expiresAt: string;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
};

async function getAccessToken(): Promise<string | null> {
  const session = await ensureSupabaseSession();
  if (session?.access_token) return session.access_token;
  // Fallback so auth-protected calls still try with cached token if refresh races.
  const stored = await sessionStorage.load();
  return stored?.access_token ?? null;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options;

  const doFetch = async (token: string | null) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (auth && token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };

  let token = auth ? await getAccessToken() : null;
  let { res, data } = await doFetch(token);

  if (auth && res.status === 401 && path !== '/api/auth/refresh') {
    const session = await ensureSupabaseSession();
    token = session?.access_token ?? null;
    if (token) {
      ({ res, data } = await doFetch(token));
    }
  }

  if (!res.ok) {
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  }

  return data as T;
}

export const api = {
  auth: {
    register: (email: string, password: string, display_name?: string) =>
      apiRequest<{ user: Session['user']; session: Session | null }>('/api/auth/register', {
        method: 'POST',
        body: { email, password, display_name },
        auth: false,
      }),

    login: (email: string, password: string) =>
      apiRequest<{ user: Session['user']; session: Session | null }>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
        auth: false,
      }),

    refresh: (refresh_token: string) =>
      apiRequest<{ user: Session['user']; session: Session | null }>('/api/auth/refresh', {
        method: 'POST',
        body: { refresh_token },
        auth: false,
      }),
  },

  profiles: {
    me: () => apiRequest<{ profile: Record<string, unknown> }>('/api/profiles/me'),
    updateMe: (data: Record<string, unknown>) =>
      apiRequest<{ profile: Record<string, unknown> }>('/api/profiles/me', {
        method: 'PATCH',
        body: data,
      }),
    search: (q: string) =>
      apiRequest<{ profiles: Record<string, unknown>[] }>(
        `/api/profiles/search?q=${encodeURIComponent(q)}`
      ),
    batch: (userIds: string[]) =>
      apiRequest<{ profiles: Record<string, unknown>[] }>(
        `/api/profiles/batch?user_ids=${userIds.join(',')}`
      ),
    getByUserId: (userId: string) =>
      apiRequest<{ profile: Record<string, unknown> }>(`/api/profiles/${userId}`),
    suggestions: () =>
      apiRequest<{
        mutual: Record<string, unknown>[];
        location: Record<string, unknown>[];
        new_users: Record<string, unknown>[];
      }>('/api/profiles/suggestions'),
  },

  friendships: {
    list: (status?: string) =>
      apiRequest<{ friendships: Record<string, unknown>[] }>(
        `/api/friendships${status ? `?status=${status}` : ''}`
      ),
    requests: () =>
      apiRequest<{
        incoming: Record<string, unknown>[];
        outgoing: Record<string, unknown>[];
        profile_id: string;
      }>('/api/friendships/requests'),
    request: (friend_profile_id: string) =>
      apiRequest<{ friendship: Record<string, unknown> }>('/api/friendships/request', {
        method: 'POST',
        body: { friend_profile_id },
      }),
    accept: (id: string) => apiRequest(`/api/friendships/${id}/accept`, { method: 'PATCH' }),
    reject: (id: string) => apiRequest(`/api/friendships/${id}/reject`, { method: 'PATCH' }),
    cancel: (id: string) => apiRequest(`/api/friendships/${id}`, { method: 'DELETE' }),
    block: (user_id: string) =>
      apiRequest('/api/friendships/block', { method: 'POST', body: { user_id } }),
    followerCount: (profileId: string) =>
      apiRequest<{ count: number }>(`/api/friendships/profile/${profileId}/followers/count`),
  },

  chats: {
    individual: () =>
      apiRequest<{ chats: Record<string, unknown>[] }>('/api/chats/individual'),
    groups: () => apiRequest<{ groups: Record<string, unknown>[] }>('/api/chats/groups'),
  },

  groups: {
    list: () => apiRequest<{ groups: Record<string, unknown>[] }>('/api/groups'),
    create: (data: Record<string, unknown>) =>
      apiRequest<{ group: Record<string, unknown>; invite?: Record<string, unknown> }>(
        '/api/groups',
        { method: 'POST', body: data }
      ),
    get: (groupId: string) =>
      apiRequest<{ group: Record<string, unknown> }>(`/api/groups/${groupId}`),
    details: (groupId: string) =>
      apiRequest<{
        group: Record<string, unknown>;
        members: Record<string, unknown>[];
        invites: Record<string, unknown>[];
      }>(`/api/groups/${groupId}/details`),
    update: (groupId: string, data: Record<string, unknown>) =>
      apiRequest<{ group: Record<string, unknown> }>(`/api/groups/${groupId}`, {
        method: 'PATCH',
        body: data,
      }),
    members: (groupId: string) =>
      apiRequest<{ members: Record<string, unknown>[] }>(`/api/groups/${groupId}/members`),
    addMembers: (groupId: string, user_ids: string[]) =>
      apiRequest(`/api/groups/${groupId}/members`, {
        method: 'POST',
        body: { user_ids },
      }),
    updateMemberRole: (groupId: string, memberId: string, role: 'admin' | 'member') =>
      apiRequest(`/api/groups/${groupId}/members/${memberId}`, {
        method: 'PATCH',
        body: { role },
      }),
    removeMember: (groupId: string, memberId: string) =>
      apiRequest(`/api/groups/${groupId}/members/${memberId}`, { method: 'DELETE' }),
    leave: (groupId: string) =>
      apiRequest(`/api/groups/${groupId}/leave`, { method: 'POST' }),
    delete: (groupId: string) =>
      apiRequest(`/api/groups/${groupId}`, { method: 'DELETE' }),
    createInvite: (groupId: string) =>
      apiRequest<{ invite: Record<string, unknown> }>(`/api/groups/${groupId}/invites`, {
        method: 'POST',
      }),
    revokeInvite: (groupId: string, inviteId: string) =>
      apiRequest(`/api/groups/${groupId}/invites/${inviteId}/revoke`, { method: 'PATCH' }),
    getInvite: (token: string) =>
      apiRequest<{ invite: Record<string, unknown>; group: Record<string, unknown> }>(
        `/api/groups/invites/${token}`
      ),
    joinByToken: (token: string) =>
      apiRequest<{ group_id: string; already_member?: boolean }>(
        `/api/groups/invites/${token}/join`,
        { method: 'POST' }
      ),
  },

  messages: {
    list: (
      chatId: string,
      isGroup: boolean,
      limit = 100,
      before?: string,
      since?: string
    ) => {
      const params = new URLSearchParams({
        chat_id: chatId,
        is_group: String(isGroup),
        limit: String(limit),
      });
      if (before) params.set('before', before);
      if (since) params.set('since', since);
      return apiRequest<{ messages: Record<string, unknown>[] }>(
        `/api/messages?${params.toString()}`
      );
    },
    send: (data: Record<string, unknown>) =>
      apiRequest<{ message: Record<string, unknown> }>('/api/messages', {
        method: 'POST',
        body: data,
      }),
    edit: (id: string, content: string) =>
      apiRequest<{ message: Record<string, unknown> }>(`/api/messages/${id}`, {
        method: 'PATCH',
        body: { content },
      }),
    delete: (id: string, forEveryone = false) =>
      apiRequest<{ success: boolean }>(
        `/api/messages/${id}?for_everyone=${forEveryone}`,
        { method: 'DELETE' }
      ),
    react: (id: string, emoji: string) =>
      apiRequest<{ toggled: boolean; emoji: string }>(`/api/messages/${id}/reactions`, {
        method: 'POST',
        body: { emoji },
      }),
    markRead: (data: Record<string, unknown>) =>
      apiRequest('/api/messages/read', { method: 'PATCH', body: data }),
    markViewed: (id: string) =>
      apiRequest<{ success: boolean }>(`/api/messages/${id}/view`, { method: 'POST' }),
    reads: (id: string) =>
      apiRequest<{
        readers: Array<{
          user_id: string;
          read_at: string;
          display_name: string;
          avatar_url: string | null;
        }>;
      }>(`/api/messages/${id}/reads`),
  },

  chatSettings: {
    get: (chatType: 'individual' | 'group', chatId: string) =>
      apiRequest<{ preferences: Record<string, unknown> }>(
        `/api/chat-settings/${chatType}/${chatId}`
      ),
    update: (
      chatType: 'individual' | 'group',
      chatId: string,
      data: Record<string, unknown>
    ) =>
      apiRequest<{ preferences: Record<string, unknown> }>(
        `/api/chat-settings/${chatType}/${chatId}`,
        { method: 'PATCH', body: data }
      ),
    pin: (chatId: string, messageId: string) =>
      apiRequest(`/api/chat-settings/group/${chatId}/pin/${messageId}`, { method: 'POST' }),
    unpin: (chatId: string, messageId: string) =>
      apiRequest(`/api/chat-settings/group/${chatId}/pin/${messageId}`, { method: 'DELETE' }),
    pinned: (chatId: string) =>
      apiRequest<{ pinned: Record<string, unknown>[] }>(
        `/api/chat-settings/group/${chatId}/pinned`
      ),
  },

  keys: {
    getIdentity: (userId: string) =>
      apiRequest<{ public_key: string }>(`/api/keys/${userId}/identity`),
    register: (public_key: string, type: 'identity' | 'signed_prekey') =>
      apiRequest('/api/keys', { method: 'POST', body: { public_key, type } }),
    registerPrekeys: (public_keys: string[]) =>
      apiRequest('/api/keys/prekeys', { method: 'POST', body: { public_keys } }),
    prekeyCount: () => apiRequest<{ count: number }>('/api/keys/prekeys/count'),
  },

  qr: {
    createSession: () =>
      apiRequest<{ session: Record<string, unknown>; ref: string }>('/api/qr/sessions', {
        method: 'POST',
      }),
    link: (ref: string) => apiRequest('/api/qr/link', { method: 'POST', body: { ref } }),
  },

  uploads: {
    uploadBase64: (data: {
      bucket: 'avatars' | 'group_avatar' | 'chat-files' | 'reels';
      path: string;
      content_base64: string;
      content_type?: string;
      upsert?: boolean;
    }) =>
      apiRequest<{ publicUrl: string; path: string }>('/api/uploads/upload', {
        method: 'POST',
        body: data,
      }),
    sign: (data: {
      bucket: 'avatars' | 'group_avatar' | 'chat-files' | 'reels';
      path: string;
    }) =>
      apiRequest<{ signedUrl: string; path: string; token: string }>(
        '/api/uploads/sign',
        { method: 'POST', body: data }
      ),
    publicUrl: (bucket: string, path: string) =>
      apiRequest<{ publicUrl: string }>(
        `/api/uploads/public-url?bucket=${bucket}&path=${encodeURIComponent(path)}`
      ),
  },

  reels: {
    feed: (params?: { cursor?: string; limit?: number }) => {
      const search = new URLSearchParams();
      if (params?.cursor) search.set('cursor', params.cursor);
      if (params?.limit) search.set('limit', String(params.limit));
      const qs = search.toString();
      return apiRequest<{ reels: ReelDTO[]; next_cursor: string | null }>(
        `/api/reels/feed${qs ? `?${qs}` : ''}`
      );
    },
    followingFeed: (params?: { cursor?: string; limit?: number }) => {
      const search = new URLSearchParams();
      if (params?.cursor) search.set('cursor', params.cursor);
      if (params?.limit) search.set('limit', String(params.limit));
      const qs = search.toString();
      return apiRequest<{ reels: ReelDTO[]; next_cursor: string | null }>(
        `/api/reels/feed/following${qs ? `?${qs}` : ''}`
      );
    },
    me: (limit = 30) =>
      apiRequest<{ reels: ReelDTO[] }>(`/api/reels/me?limit=${limit}`),
    inbox: (limit = 40) =>
      apiRequest<{ items: ReelInboxItemDTO[] }>(`/api/reels/inbox?limit=${limit}`),
    search: (q: string, opts?: { signal?: AbortSignal }) =>
      apiRequest<{ reels: ReelDTO[]; profiles: ReelAuthorDTO[] }>(
        `/api/reels/search?q=${encodeURIComponent(q)}`,
        { signal: opts?.signal }
      ),
    byUser: (profileId: string, limit = 30) =>
      apiRequest<{ reels: ReelDTO[] }>(`/api/reels/user/${profileId}?limit=${limit}`),
    get: (id: string) => apiRequest<{ reel: ReelDTO }>(`/api/reels/${id}`),
    create: (data: {
      video_url?: string;
      thumbnail_url?: string;
      caption?: string;
      duration?: number;
      visibility?: 'public' | 'friends' | 'private' | 'group';
      group_id?: string;
      width?: number;
      height?: number;
      trim_start_sec?: number;
      trim_end_sec?: number;
      media?: Array<{
        media_url: string;
        media_type: 'image' | 'video';
        thumbnail_url?: string;
        duration?: number;
        width?: number;
        height?: number;
        trim_start_sec?: number;
        trim_end_sec?: number;
      }>;
    }) =>
      apiRequest<{ reel: ReelDTO }>('/api/reels', { method: 'POST', body: data }),
    delete: (id: string) =>
      apiRequest<{ success: boolean }>(`/api/reels/${id}`, { method: 'DELETE' }),
    like: (id: string) =>
      apiRequest<{ success: boolean }>(`/api/reels/${id}/like`, { method: 'POST' }),
    unlike: (id: string) =>
      apiRequest<{ success: boolean }>(`/api/reels/${id}/like`, { method: 'DELETE' }),
    view: (id: string) =>
      apiRequest<{ success: boolean }>(`/api/reels/${id}/view`, { method: 'POST' }),
    comments: (id: string, params?: { cursor?: string; limit?: number }) => {
      const search = new URLSearchParams();
      if (params?.cursor) search.set('cursor', params.cursor);
      if (params?.limit) search.set('limit', String(params.limit));
      const qs = search.toString();
      return apiRequest<{ comments: ReelCommentDTO[]; next_cursor: string | null }>(
        `/api/reels/${id}/comments${qs ? `?${qs}` : ''}`
      );
    },
    postComment: (id: string, content: string, parentId?: string) =>
      apiRequest<{ comment: ReelCommentDTO }>(`/api/reels/${id}/comments`, {
        method: 'POST',
        body: { content, ...(parentId ? { parent_id: parentId } : {}) },
      }),
    deleteComment: (commentId: string) =>
      apiRequest<{ success: boolean }>(`/api/reels/comments/${commentId}`, {
        method: 'DELETE',
      }),
    fromMoment: (momentId: string, data?: { caption?: string }) =>
      apiRequest<{ reel: ReelDTO }>(`/api/reels/from-moment/${momentId}`, {
        method: 'POST',
        body: data ?? {},
      }),
  },

  moments: {
    feed: () => apiRequest<{ authors: MomentAuthorFeedDTO[] }>('/api/moments/feed'),
    me: () =>
      apiRequest<{ moments: Record<string, unknown>[] }>('/api/moments/me'),
    create: (data: {
      media_url?: string;
      media_type?: 'image' | 'video' | 'text';
      media_items?: Array<{
        media_url?: string;
        media_type: 'image' | 'video' | 'text';
        caption?: string;
        text_background?: string;
        thumbnail_url?: string;
      }>;
      caption?: string;
      text_background?: string;
      duration_minutes: number;
      view_once?: boolean;
      audience_mode?: MomentAudienceMode;
      audience_ids?: string[];
    }) =>
      apiRequest<{ moment: Record<string, unknown>; moments?: Record<string, unknown>[] }>(
        '/api/moments',
        {
          method: 'POST',
          body: data,
        }
      ),
    activity: (id: string) =>
      apiRequest<{
        view_count: number;
        viewers: MomentViewerDTO[];
        replies: MomentReplyDTO[];
      }>(`/api/moments/${id}/activity`),
    reply: (
      id: string,
      body: string,
      recipient_user_id?: string,
      options?: { to_chat?: boolean }
    ) => {
      const payload: Record<string, unknown> = {
        body,
        to_chat: options?.to_chat ?? false,
      };
      const recipient = recipient_user_id?.trim();
      if (recipient) payload.recipient_user_id = recipient;
      return apiRequest<{ reply: MomentReplyDTO }>(`/api/moments/${id}/replies`, {
        method: 'POST',
        body: payload,
      });
    },
    view: (id: string) =>
      apiRequest<{ success: boolean }>(`/api/moments/${id}/view`, { method: 'POST' }),
    get: (id: string) =>
      apiRequest<{ moment: Record<string, unknown>; author: Record<string, unknown> | null }>(
        `/api/moments/${id}`
      ),
    delete: (id: string) =>
      apiRequest<{ success: boolean }>(`/api/moments/${id}`, { method: 'DELETE' }),
    fromReel: (
      reelId: string,
      data?: {
        caption?: string;
        duration_minutes?: number;
        view_once?: boolean;
        audience_mode?: MomentAudienceMode;
        audience_ids?: string[];
      }
    ) =>
      apiRequest<{ moment: Record<string, unknown> }>(`/api/moments/from-reel/${reelId}`, {
        method: 'POST',
        body: data ?? {},
      }),
  },

  calls: {
    config: () => apiRequest<{ enabled: boolean }>('/api/calls/config'),
    start: (data: { type: CallType; callee_id?: string; group_id?: string }) =>
      apiRequest<{ call: CallDTO; live_kit: LiveKitTokenDTO }>('/api/calls', {
        method: 'POST',
        body: data,
      }),
    accept: (id: string) =>
      apiRequest<{ call: CallDTO; live_kit: LiveKitTokenDTO }>(
        `/api/calls/${id}/accept`,
        { method: 'POST' }
      ),
    decline: (id: string) =>
      apiRequest<{ success: boolean }>(`/api/calls/${id}/decline`, { method: 'POST' }),
    end: (id: string) =>
      apiRequest<{ success: boolean }>(`/api/calls/${id}/end`, { method: 'POST' }),
    missed: (id: string) =>
      apiRequest<{ success: boolean }>(`/api/calls/${id}/missed`, { method: 'POST' }),
    noAnswer: (id: string) =>
      apiRequest<{ success: boolean }>(`/api/calls/${id}/no-answer`, { method: 'POST' }),
    history: (limit = 50) =>
      apiRequest<{ calls: CallHistoryItemDTO[] }>(`/api/calls/history?limit=${limit}`),
    incoming: () => apiRequest<{ call: CallDTO | null }>('/api/calls/incoming'),
    get: (id: string) => apiRequest<{ call: CallDTO }>(`/api/calls/${id}`),
  },

  notifications: {
    registerToken: (data: { token: string; platform?: string }) =>
      apiRequest<{ success: boolean }>('/api/notifications/register', {
        method: 'POST',
        body: data,
      }),
    unregisterToken: (token: string) =>
      apiRequest<{ success: boolean }>('/api/notifications/register', {
        method: 'DELETE',
        body: { token },
      }),
  },
};
