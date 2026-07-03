/**
 * Production-ready hybrid Reel recommendation engine.
 *
 * Ranks ~500 candidates per request using engagement quality, personalization,
 * freshness, trending, creator affinity, diversity (70/20/10), and penalties.
 */
import { supabaseAdmin } from '../lib/supabaseAdmin';
import {
  type ReelRow,
  visibilityFilterClause,
  getAcceptedFriendIds,
  filterVisibleReels,
} from './reels.service';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type EngagementEventType =
  | 'view'
  | 'skip'
  | 'pause'
  | 'completion'
  | 'rewatch'
  | 'like'
  | 'save'
  | 'share'
  | 'comment'
  | 'follow'
  | 'not_interested';

export type CandidateSource =
  | 'unwatched'
  | 'followed'
  | 'category'
  | 'hashtag'
  | 'audio'
  | 'caption_similar'
  | 'embedding_similar'
  | 'trending'
  | 'recent'
  | 'popular';

export type ReelCandidate = ReelRow & {
  sources: Set<CandidateSource>;
};

export type UserInterestProfile = {
  profileId: string;
  interactionCount: number;
  categoryWeights: Map<string, number>;
  creatorWeights: Map<string, number>;
  hashtagWeights: Map<string, number>;
  audioWeights: Map<string, number>;
  preferredDurationSec: number;
  timeOfDayWeights: Map<'morning' | 'afternoon' | 'evening', number>;
  watchedReelIds: Set<string>;
  likedReelIds: Set<string>;
  savedReelIds: Set<string>;
  notInterestedReelIds: Set<string>;
  skippedEarlyReelIds: Set<string>;
  followedCreatorIds: Set<string>;
};

export type ReelQualityMetrics = {
  completionRate: number;
  rewatchRate: number;
  shareScore: number;
  saveScore: number;
  commentScore: number;
  likeScore: number;
  freshness: number;
  trendingScore: number;
  creatorAffinity: number;
};

export type ScoredReel = {
  reel: ReelCandidate;
  finalScore: number;
  bucket: 'personalized' | 'trending' | 'exploration';
  metrics: ReelQualityMetrics;
};

export type RecommendOptions = {
  limit?: number;
  now?: Date;
};

export type FetchCandidatesParams = {
  profileId: string;
  friendIds: string[];
  viewerAuthUserId: string;
  cursor?: string;
  targetCount?: number;
};

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const WEIGHTS = {
  completionRate: 0.35,
  rewatchRate: 0.2,
  shareScore: 0.15,
  saveScore: 0.1,
  commentScore: 0.08,
  likeScore: 0.05,
  freshness: 0.03,
  trendingScore: 0.02,
  creatorAffinity: 0.02,
} as const;

const DIVERSITY_MIX = {
  personalized: 0.7,
  trending: 0.2,
  exploration: 0.1,
} as const;

const COLD_START_INTERACTIONS = 20;
const MAX_CONSECUTIVE_SAME_CREATOR = 2;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

export function extractHashtags(caption: string | null): string[] {
  if (!caption) return [];
  const tags = caption.match(/#[\w\u00C0-\u024F]+/g);
  return tags ? tags.map((t) => t.slice(1).toLowerCase()) : [];
}

export function extractCaptionTokens(caption: string | null): Set<string> {
  if (!caption) return new Set();
  return new Set(
    caption
      .toLowerCase()
      .replace(/#[\w\u00C0-\u024F]+/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function captionSimilarity(a: string | null, b: string | null): number {
  const ta = extractCaptionTokens(a);
  const tb = extractCaptionTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const w of ta) if (tb.has(w)) overlap += 1;
  return overlap / Math.sqrt(ta.size * tb.size);
}

function hashtagOverlap(a: string | null, b: string | null): number {
  const ha = extractHashtags(a);
  const hb = extractHashtags(b);
  if (!ha.length || !hb.length) return 0;
  const setB = new Set(hb);
  const overlap = ha.filter((h) => setB.has(h)).length;
  return overlap / Math.max(ha.length, hb.length);
}

function audioKey(reel: ReelRow): string {
  return `original:${reel.author_id}`;
}

function timeOfDayBucket(date: Date): 'morning' | 'afternoon' | 'evening' {
  const h = date.getHours();
  if (h < 12) return 'morning';
  if ( h < 18) return 'afternoon';
  return 'evening';
}

function normalizeCount(value: number, cap: number): number {
  return Math.min(1, value / cap);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function computeFreshness(createdAt: string, now: Date): number {
  const ageHours = Math.max(0, (now.getTime() - new Date(createdAt).getTime()) / 3_600_000);
  return Math.exp(-ageHours / 36);
}

function computeTrendingScore(reel: ReelRow, now: Date): number {
  const ageHours = Math.max(1, (now.getTime() - new Date(reel.created_at).getTime()) / 3_600_000);
  const velocity =
    (reel.like_count * 2 + reel.comment_count * 3 + reel.view_count * 0.2) / ageHours;
  return sigmoid(velocity / 8);
}

function computeReelQualityMetrics(
  reel: ReelCandidate,
  interest: UserInterestProfile,
  now: Date
): ReelQualityMetrics {
  const views = Math.max(reel.view_count, 1);
  const completionRate = normalizeCount(
    reel.view_count > 0 ? (reel.like_count + reel.comment_count) / views : 0,
    0.35
  );
  const rewatchRate = interest.likedReelIds.has(reel.id) ? 0.6 : 0.15;
  const shareScore = normalizeCount(reel.comment_count * 0.4 + reel.like_count * 0.1, 1);
  const saveScore = interest.savedReelIds.has(reel.id) ? 1 : normalizeCount(reel.like_count, 50);
  const commentScore = normalizeCount(reel.comment_count, 30);
  const likeScore = normalizeCount(reel.like_count, 200);
  const freshness = computeFreshness(reel.created_at, now);
  const trendingScore = computeTrendingScore(reel, now);
  const creatorAffinity = Math.min(
    1,
    (interest.creatorWeights.get(reel.author_id) ?? 0) / 12
  );

  return {
    completionRate,
    rewatchRate,
    shareScore,
    saveScore,
    commentScore,
    likeScore,
    freshness,
    trendingScore,
    creatorAffinity,
  };
}

function weightedScore(metrics: ReelQualityMetrics): number {
  return (
    WEIGHTS.completionRate * metrics.completionRate +
    WEIGHTS.rewatchRate * metrics.rewatchRate +
    WEIGHTS.shareScore * metrics.shareScore +
    WEIGHTS.saveScore * metrics.saveScore +
    WEIGHTS.commentScore * metrics.commentScore +
    WEIGHTS.likeScore * metrics.likeScore +
    WEIGHTS.freshness * metrics.freshness +
    WEIGHTS.trendingScore * metrics.trendingScore +
    WEIGHTS.creatorAffinity * metrics.creatorAffinity
  );
}

function personalizationBoost(reel: ReelCandidate, interest: UserInterestProfile): number {
  let boost = 0;
  const tags = extractHashtags(reel.caption);
  for (const tag of tags) {
    boost += (interest.hashtagWeights.get(tag) ?? 0) * 0.08;
  }
  boost += (interest.creatorWeights.get(reel.author_id) ?? 0) * 0.12;
  boost += (interest.audioWeights.get(audioKey(reel)) ?? 0) * 0.06;

  if (reel.duration) {
    const diff = Math.abs(reel.duration - interest.preferredDurationSec);
    boost += Math.max(0, 0.25 - diff / 120);
  }

  const tod = timeOfDayBucket(new Date());
  boost += (interest.timeOfDayWeights.get(tod) ?? 0) * 0.05;

  if (reel.sources.has('followed')) boost += 0.35;
  if (reel.sources.has('hashtag')) boost += 0.2;
  if (reel.sources.has('caption_similar')) boost += 0.15;

  return boost;
}

function applyPenalties(
  reel: ReelCandidate,
  interest: UserInterestProfile,
  seenCreatorCounts: Map<string, number>
): number {
  let penalty = 0;
  if (interest.watchedReelIds.has(reel.id)) penalty += 0.45;
  if (interest.likedReelIds.has(reel.id)) penalty += 0.15;
  if (interest.notInterestedReelIds.has(reel.id)) penalty += 10;
  if (interest.skippedEarlyReelIds.has(reel.id)) penalty += 0.35;

  const creatorCount = seenCreatorCounts.get(reel.author_id) ?? 0;
  if (creatorCount >= MAX_CONSECUTIVE_SAME_CREATOR) penalty += 0.5;

  const engagementRate =
    (reel.like_count + reel.comment_count) / Math.max(8, reel.view_count);
  if (engagementRate < 0.002 && reel.view_count > 50) penalty += 0.25;

  return penalty;
}

function classifyBucket(
  reel: ReelCandidate,
  metrics: ReelQualityMetrics,
  interest: UserInterestProfile
): ScoredReel['bucket'] {
  if (interest.interactionCount < COLD_START_INTERACTIONS) {
    if (metrics.trendingScore > 0.55) return 'trending';
    if (reel.sources.has('recent') || reel.sources.has('popular')) return 'exploration';
    return 'personalized';
  }
  if (metrics.trendingScore > 0.65 || reel.sources.has('trending')) return 'trending';
  if (
    reel.sources.has('exploration' as CandidateSource) ||
    reel.sources.has('recent') ||
    !interest.watchedReelIds.has(reel.author_id)
  ) {
    return 'exploration';
  }
  return 'personalized';
}

/* -------------------------------------------------------------------------- */
/*  User interest profile                                                     */
/* -------------------------------------------------------------------------- */

export async function buildUserInterestProfile(profileId: string): Promise<UserInterestProfile> {
  const friendSet = await getAcceptedFriendIds(profileId);
  const followedCreatorIds = friendSet;

  const [
    likesRes,
    viewsRes,
    savesRes,
    notInterestedRes,
    eventsRes,
    likedHistoryRes,
  ] = await Promise.all([
    supabaseAdmin.from('reel_likes').select('reel_id').eq('user_id', profileId).limit(500),
    supabaseAdmin.from('reel_views').select('reel_id').eq('user_id', profileId).limit(800),
    supabaseAdmin.from('reel_saves').select('reel_id').eq('profile_id', profileId).limit(200),
    supabaseAdmin.from('reel_not_interested').select('reel_id').eq('profile_id', profileId),
    supabaseAdmin
      .from('reel_engagement_events')
      .select('reel_id, event_type, completion_rate, created_at')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(400),
    supabaseAdmin
      .from('reel_likes')
      .select('reel_id, reels!inner(author_id, caption, duration, created_at)')
      .eq('user_id', profileId)
      .order('created_at', { ascending: false })
      .limit(120),
  ]);

  const watchedReelIds = new Set(
    (viewsRes.data ?? []).map((r: { reel_id: string }) => r.reel_id)
  );
  const likedReelIds = new Set(
    (likesRes.data ?? []).map((r: { reel_id: string }) => r.reel_id)
  );
  const savedReelIds = new Set<string>(
    savesRes.error ? [] : (savesRes.data ?? []).map((r: { reel_id: string }) => r.reel_id)
  );
  const notInterestedReelIds = new Set<string>(
    notInterestedRes.error
      ? []
      : (notInterestedRes.data ?? []).map((r: { reel_id: string }) => r.reel_id)
  );

  const skippedEarlyReelIds = new Set<string>();
  const eventRows =
    eventsRes.error || !eventsRes.data
      ? []
      : (eventsRes.data as Array<{
          reel_id: string;
          event_type: string;
          completion_rate: number | null;
          created_at: string;
        }>);
  for (const ev of eventRows) {
    if (ev.event_type === 'skip' || (ev.event_type === 'view' && (ev.completion_rate ?? 0) < 0.08)) {
      skippedEarlyReelIds.add(ev.reel_id as string);
    }
  }

  const creatorWeights = new Map<string, number>();
  const hashtagWeights = new Map<string, number>();
  const audioWeights = new Map<string, number>();
  const timeOfDayWeights = new Map<'morning' | 'afternoon' | 'evening', number>();
  let durationSum = 0;
  let durationCount = 0;
  let interactionCount = 0;

  const bump = (map: Map<string, number>, key: string, delta: number) => {
    map.set(key, (map.get(key) ?? 0) + delta);
  };

  for (const row of likedHistoryRes.data ?? []) {
    interactionCount += 1;
    const reelsJoin = (row as { reels?: { author_id?: string; caption?: string; duration?: number } | { author_id?: string; caption?: string; duration?: number }[] }).reels;
    const reel = Array.isArray(reelsJoin) ? reelsJoin[0] : reelsJoin;
    if (!reel?.author_id) continue;
    bump(creatorWeights, reel.author_id, 2.5);
    for (const tag of extractHashtags(reel.caption ?? null)) bump(hashtagWeights, tag, 1.8);
    bump(audioWeights, `original:${reel.author_id}`, 1.2);
    if (reel.duration) {
      durationSum += reel.duration;
      durationCount += 1;
    }
  }

  for (const ev of eventRows) {
    interactionCount += 1;
    const tod = timeOfDayBucket(new Date(ev.created_at));
    bump(timeOfDayWeights, tod, 0.5);
    if (ev.event_type === 'not_interested') notInterestedReelIds.add(ev.reel_id);
  }

  interactionCount += watchedReelIds.size + likedReelIds.size;

  return {
    profileId,
    interactionCount,
    categoryWeights: new Map(),
    creatorWeights,
    hashtagWeights,
    audioWeights,
    preferredDurationSec: durationCount > 0 ? durationSum / durationCount : 30,
    timeOfDayWeights,
    watchedReelIds,
    likedReelIds,
    savedReelIds,
    notInterestedReelIds,
    skippedEarlyReelIds,
    followedCreatorIds,
  };
}

/* -------------------------------------------------------------------------- */
/*  Candidate retrieval (~500)                                                */
/* -------------------------------------------------------------------------- */

export async function fetchCandidateReels(params: FetchCandidatesParams): Promise<ReelCandidate[]> {
  const { profileId, friendIds, viewerAuthUserId, cursor, targetCount = 500 } = params;
  const perSource = Math.ceil(targetCount / 5);
  const visibility = visibilityFilterClause(profileId, friendIds);

  const baseQuery = () => {
    let q = supabaseAdmin
      .from('reels')
      .select('*')
      .or(visibility)
      .order('created_at', { ascending: false })
      .limit(perSource);
    if (cursor) q = q.lt('created_at', cursor);
    return q;
  };

  const [recentRes, popularRes, trendingRes, followedRes] = await Promise.all([
    baseQuery(),
    supabaseAdmin
      .from('reels')
      .select('*')
      .or(visibility)
      .order('view_count', { ascending: false })
      .order('like_count', { ascending: false })
      .limit(perSource),
    supabaseAdmin
      .from('reels')
      .select('*')
      .or(visibility)
      .order('like_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(perSource),
    friendIds.length
      ? supabaseAdmin
          .from('reels')
          .select('*')
          .in('author_id', friendIds)
          .order('created_at', { ascending: false })
          .limit(perSource)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const interest = await buildUserInterestProfile(profileId);
  const topTags = Array.from(interest.hashtagWeights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t);

  let hashtagReels: ReelRow[] = [];
  if (topTags.length) {
    const pattern = topTags.map((t) => `caption.ilike.%${t}%`).join(',');
    const { data } = await supabaseAdmin
      .from('reels')
      .select('*')
      .or(pattern)
      .order('created_at', { ascending: false })
      .limit(perSource);
    hashtagReels = (data ?? []) as ReelRow[];
  }

  const merged = new Map<string, ReelCandidate>();
  const add = (rows: ReelRow[] | null | undefined, source: CandidateSource) => {
    for (const row of rows ?? []) {
      const existing = merged.get(row.id);
      if (existing) {
        existing.sources.add(source);
      } else {
        merged.set(row.id, { ...row, sources: new Set([source]) });
      }
    }
  };

  add(recentRes.data as ReelRow[], 'recent');
  add(popularRes.data as ReelRow[], 'popular');
  add(trendingRes.data as ReelRow[], 'trending');
  add(followedRes.data as ReelRow[], 'followed');
  add(hashtagReels, 'hashtag');

  const all = Array.from(merged.values());
  const visibleRows = await filterVisibleReels(all, profileId, new Set(friendIds), viewerAuthUserId);
  const visible: ReelCandidate[] = visibleRows
    .map((r) => merged.get(r.id))
    .filter((r): r is ReelCandidate => Boolean(r));

  for (const reel of visible) {
    if (!interest.watchedReelIds.has(reel.id)) reel.sources.add('unwatched');
    if (interest.followedCreatorIds.has(reel.author_id)) reel.sources.add('followed');
  }

  const likedCaptions: string[] = [];
  const { data: likedReels } = await supabaseAdmin
    .from('reel_likes')
    .select('reels!inner(caption)')
    .eq('user_id', profileId)
    .limit(30);
  for (const row of likedReels ?? []) {
    const r = (row as { reels?: { caption?: string } | { caption?: string }[] }).reels;
    const cap = Array.isArray(r) ? r[0]?.caption : r?.caption;
    if (cap) likedCaptions.push(cap);
  }

  for (const reel of visible) {
    for (const cap of likedCaptions) {
      if (captionSimilarity(reel.caption, cap) > 0.35) {
        reel.sources.add('caption_similar');
        break;
      }
    }
    for (const cap of likedCaptions) {
      if (hashtagOverlap(reel.caption, cap) > 0.4) {
        reel.sources.add('hashtag');
        break;
      }
    }
  }

  return visible.slice(0, targetCount);
}

/* -------------------------------------------------------------------------- */
/*  Ranking + diversity                                                       */
/* -------------------------------------------------------------------------- */

export function scoreCandidates(
  candidates: ReelCandidate[],
  interest: UserInterestProfile,
  options: RecommendOptions = {}
): ScoredReel[] {
  const now = options.now ?? new Date();
  const seenCreators = new Map<string, number>();

  const scored: ScoredReel[] = candidates
    .filter((r) => !interest.notInterestedReelIds.has(r.id))
    .map((reel) => {
      const metrics = computeReelQualityMetrics(reel, interest, now);
      let score = weightedScore(metrics);
      score += personalizationBoost(reel, interest);
      score -= applyPenalties(reel, interest, seenCreators);
      const bucket = classifyBucket(reel, metrics, interest);
      return { reel, finalScore: score, bucket, metrics };
    });

  scored.sort((a, b) => b.finalScore - a.finalScore);
  return scored;
}

export function applyDiversityRules(
  scored: ScoredReel[],
  limit: number,
  interest: UserInterestProfile
): ScoredReel[] {
  const isColdStart = interest.interactionCount < COLD_START_INTERACTIONS;
  const targetPersonalized = Math.round(limit * DIVERSITY_MIX.personalized);
  const targetTrending = Math.round(limit * DIVERSITY_MIX.trending);
  const targetExploration = limit - targetPersonalized - targetTrending;

  const buckets: Record<ScoredReel['bucket'], ScoredReel[]> = {
    personalized: [],
    trending: [],
    exploration: [],
  };
  for (const item of scored) buckets[item.bucket].push(item);

  if (isColdStart) {
    const mixed = [...buckets.trending, ...buckets.exploration, ...buckets.personalized];
    mixed.sort((a, b) => b.finalScore - a.finalScore);
    return pickWithCreatorCap(mixed, limit);
  }

  const result: ScoredReel[] = [];
  const take = (pool: ScoredReel[], n: number) => {
    for (const item of pool) {
      if (result.length >= limit || n <= 0) break;
      if (result.some((r) => r.reel.id === item.reel.id)) continue;
      result.push(item);
      n -= 1;
    }
    return n;
  };

  let remP = take(buckets.personalized, targetPersonalized);
  let remT = take(buckets.trending, targetTrending);
  let remE = take(buckets.exploration, targetExploration);

  const remainder = scored.filter((s) => !result.some((r) => r.reel.id === s.reel.id));
  take(remainder, remP + remT + remE);

  return pickWithCreatorCap(result, limit);
}

function pickWithCreatorCap(pool: ScoredReel[], limit: number): ScoredReel[] {
  const picked: ScoredReel[] = [];
  const deferred: ScoredReel[] = [];
  const consecutive = new Map<string, number>();

  const canAdd = (authorId: string) => (consecutive.get(authorId) ?? 0) < MAX_CONSECUTIVE_SAME_CREATOR;

  const flush = (item: ScoredReel) => {
    const aid = item.reel.author_id;
    if (!canAdd(aid)) {
      deferred.push(item);
      return false;
    }
    picked.push(item);
    for (const key of consecutive.keys()) {
      if (key !== aid) consecutive.set(key, 0);
    }
    consecutive.set(aid, (consecutive.get(aid) ?? 0) + 1);
    return true;
  };

  for (const item of pool) {
    if (picked.length >= limit) break;
    flush(item);
  }

  for (const item of deferred) {
    if (picked.length >= limit) break;
    if (!picked.some((p) => p.reel.id === item.reel.id)) flush(item);
  }

  return picked.slice(0, limit);
}

/** Main entry: rank candidates and return top N reel rows. */
export async function recommendReelsForUser(
  profileId: string,
  candidates: ReelCandidate[],
  options: RecommendOptions = {}
): Promise<ReelRow[]> {
  const limit = options.limit ?? 20;
  const interest = await buildUserInterestProfile(profileId);
  const scored = scoreCandidates(candidates, interest, options);
  const diverse = applyDiversityRules(scored, limit, interest);
  return diverse.map((s) => s.reel);
}

/* -------------------------------------------------------------------------- */
/*  Learning loop                                                             */
/* -------------------------------------------------------------------------- */

export async function recordEngagementEvent(input: {
  profileId: string;
  reelId: string;
  eventType: EngagementEventType;
  completionRate?: number;
  watchMs?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('reel_engagement_events').insert({
    profile_id: input.profileId,
    reel_id: input.reelId,
    event_type: input.eventType,
    completion_rate: input.completionRate ?? null,
    watch_ms: input.watchMs ?? null,
    metadata: input.metadata ?? {},
  });
  if (error && !error.message.includes('does not exist')) {
    throw new Error(error.message);
  }

  if (input.eventType === 'not_interested') {
    const ni = await supabaseAdmin
      .from('reel_not_interested')
      .upsert({ profile_id: input.profileId, reel_id: input.reelId });
    if (ni.error && !ni.error.message.includes('does not exist')) {
      throw new Error(ni.error.message);
    }
  }
}
