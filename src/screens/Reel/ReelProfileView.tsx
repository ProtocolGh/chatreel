import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Modal,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ReelImmersiveViewer } from './ReelImmersiveViewer';
import { api, ApiError, type ReelDTO } from '../../lib/api';
import { getReelGridThumbnail } from '../../lib/reelThumbnails';
import { generateReelGridThumbnails } from '../../lib/generateReelGridThumbnails';
import { rootNavigationRef } from '../../navigation/rootNavigation';
import type { ReelsStackParamList } from '../../navigation/reelsNavigation';
import { reelTabBarOffset } from './ReelsTabBar';

const GRID_COLS = 3;
const GRID_GAP = 4;
const GRID_PAD = 6;
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const TILE_WIDTH = Math.floor((SCREEN_W - GRID_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS);
const TILE_HEIGHT = Math.round(TILE_WIDTH * 1.15);

type Props = {
  profileId: string;
  isSelf?: boolean;
  showBack?: boolean;
};

function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`.replace('.0K', 'K');
  return `${(n / 1_000_000).toFixed(1)}M`.replace('.0M', 'M');
}

function Stat({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statNumber}>{loading ? '—' : compact(value)}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function ReelProfileView({ profileId, isSelf = false, showBack = false }: Props) {
  const insets = useSafeAreaInsets();
  const bottomPad = reelTabBarOffset(insets.bottom);
  const navigation = useNavigation<NativeStackNavigationProp<ReelsStackParamList>>();

  const [profile, setProfile] = useState<{
    display_name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
  } | null>(null);
  const [posts, setPosts] = useState<ReelDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followState, setFollowState] = useState<'none' | 'pending' | 'following'>('none');
  const [friendshipId, setFriendshipId] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [generatedThumbs, setGeneratedThumbs] = useState<Record<string, string>>({});
  const [immersiveIndex, setImmersiveIndex] = useState<number | null>(null);
  const [followerCount, setFollowerCount] = useState(0);
  const [followersLoading, setFollowersLoading] = useState(true);

  const username =
    profile?.display_name?.trim() || profile?.email?.split('@')[0] || 'unknown';
  const avatar = profile?.avatar_url ?? null;

  const loadProfile = useCallback(async () => {
    if (isSelf) {
      const { profile: me } = await api.profiles.me();
      setProfile(me as typeof profile);
    }
  }, [isSelf]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([loadProfile(), api.reels.byUser(profileId, 48)])
      .then(([, reelsRes]) => {
        if (!alive) return;
        setPosts(reelsRes.reels);
        if (!isSelf && reelsRes.reels[0]?.author) {
          setProfile(reelsRes.reels[0].author);
        }
        setError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load profile');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [profileId, isSelf, loadProfile]);

  useEffect(() => {
    let alive = true;
    setFollowersLoading(true);
    api.friendships
      .followerCount(profileId)
      .then((res) => {
        if (alive) setFollowerCount(res.count);
      })
      .catch(() => {
        if (alive) setFollowerCount(0);
      })
      .finally(() => {
        if (alive) setFollowersLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [profileId]);

  useEffect(() => {
    if (isSelf) return;
    let alive = true;
    api.friendships
      .list()
      .then((res) => {
        if (!alive) return;
        const rows = res.friendships ?? [];
        const rel = rows.find((r) => {
          const a = (r as { user_id?: string }).user_id;
          const b = (r as { friend_id?: string }).friend_id;
          return a === profileId || b === profileId;
        }) as { id?: string; status?: string } | undefined;
        if (!rel) {
          setFollowState('none');
          setFriendshipId(null);
          return;
        }
        setFriendshipId(rel.id ?? null);
        if (rel.status === 'accepted') setFollowState('following');
        else if (rel.status === 'pending') setFollowState('pending');
        else setFollowState('none');
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [profileId, isSelf]);

  useEffect(() => {
    let cancelled = false;
    void generateReelGridThumbnails(posts, generatedThumbs, (id, uri) => {
      if (!cancelled) setGeneratedThumbs((prev) => ({ ...prev, [id]: uri }));
    });
    return () => {
      cancelled = true;
    };
  }, [posts]);

  const totalLikes = posts.reduce((sum, r) => sum + r.like_count, 0);
  const totalViews = posts.reduce((sum, r) => sum + r.view_count, 0);

  const onFollowPress = async () => {
    if (isSelf || followBusy) return;
    setFollowBusy(true);
    try {
      if (followState === 'none') {
        const result = (await api.friendships.request(profileId)) as {
          friendship?: { id?: string; status?: string };
        };
        setFriendshipId(result.friendship?.id ?? null);
        setFollowState(result.friendship?.status === 'accepted' ? 'following' : 'pending');
      } else if (friendshipId) {
        await api.friendships.cancel(friendshipId);
        setFriendshipId(null);
        setFollowState('none');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update follow status');
    } finally {
      setFollowBusy(false);
    }
  };

  const openPostReel = () => {
    if (rootNavigationRef.isReady()) rootNavigationRef.navigate('PostReel');
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        {showBack ? (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
        <Text style={styles.username}>@{username}</Text>
        {isSelf ? (
          <TouchableOpacity style={styles.uploadBtn} onPress={openPostReel}>
            <Ionicons name="add" size={18} color="#fff" />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
      </View>

      <View style={styles.profileHeader}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarFallbackText}>{username.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.stats}>
          <Stat label="Reels" value={posts.length} loading={loading} />
          <Stat label="Followers" value={followerCount} loading={followersLoading} />
          <Stat label="Likes" value={totalLikes} loading={loading} />
          <Stat label="Views" value={totalViews} loading={loading} />
        </View>
      </View>

      {!isSelf && (
        <TouchableOpacity
          style={[styles.followBtn, followState !== 'none' && styles.followingBtn, followBusy && { opacity: 0.6 }]}
          onPress={onFollowPress}
          disabled={followBusy}
        >
          <Ionicons
            name={followState === 'none' ? 'person-add' : 'person-remove'}
            size={16}
            color="#fff"
          />
          <Text style={styles.followText}>
            {followState === 'none'
              ? 'Follow'
              : followState === 'pending'
                ? 'Requested'
                : 'Following'}
          </Text>
        </TouchableOpacity>
      )}

      {isSelf && (
        <TouchableOpacity style={styles.followBtn} onPress={openPostReel}>
          <Ionicons name="videocam" size={16} color="#fff" />
          <Text style={styles.followText}>Post a reel</Text>
        </TouchableOpacity>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <View style={styles.loaderBox}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(r) => r.id}
          numColumns={GRID_COLS}
          contentContainerStyle={[styles.gridContainer, { paddingBottom: bottomPad + 16 }]}
          columnWrapperStyle={styles.gridRow}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => {
            const thumb = getReelGridThumbnail(item, generatedThumbs);
            return (
              <TouchableOpacity
                style={styles.gridItem}
                activeOpacity={0.85}
                onPress={() => setImmersiveIndex(index)}
              >
                {thumb ? (
                  <Image source={{ uri: thumb }} style={styles.gridImage} resizeMode="cover" />
                ) : (
                  <View style={[styles.gridImage, styles.gridPlaceholder]}>
                    <Ionicons name="film-outline" size={28} color="#666" />
                  </View>
                )}
                <View style={styles.gridOverlay}>
                  {(item.media?.length ?? 0) > 1 && (
                    <View style={styles.gridStat}>
                      <Ionicons name="layers" size={11} color="#fff" />
                      <Text style={styles.gridStatText}>{item.media!.length}</Text>
                    </View>
                  )}
                  <View style={styles.gridStat}>
                    <Ionicons name="play" size={11} color="#fff" />
                    <Text style={styles.gridStatText}>{compact(item.view_count)}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="film-outline" size={36} color="#666" />
              <Text style={styles.emptyText}>{isSelf ? 'Post your first reel' : 'No reels yet'}</Text>
            </View>
          }
        />
      )}

      <Modal visible={immersiveIndex != null} animationType="slide" onRequestClose={() => setImmersiveIndex(null)}>
        {immersiveIndex != null && (
          <ReelImmersiveViewer
            reels={posts}
            initialIndex={immersiveIndex}
            onClose={() => setImmersiveIndex(null)}
            onReelsChange={setPosts}
            disableProfileNavigation
          />
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  username: { color: '#fff', fontWeight: '700', fontSize: 17 },
  uploadBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1976d2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileHeader: { flexDirection: 'row', paddingHorizontal: 20, paddingBottom: 16, alignItems: 'center' },
  avatar: { width: 80, height: 80, borderRadius: 40, marginRight: 16 },
  avatarFallback: { backgroundColor: '#6366f1', justifyContent: 'center', alignItems: 'center' },
  avatarFallbackText: { color: '#fff', fontSize: 28, fontWeight: '700' },
  stats: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  followBtn: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: '#ff375f',
    borderRadius: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  followingBtn: { backgroundColor: '#334155' },
  followText: { color: '#fff', fontWeight: '700' },
  stat: { alignItems: 'center' },
  statNumber: { color: '#fff', fontSize: 17, fontWeight: 'bold' },
  statLabel: { color: '#888', fontSize: 11, marginTop: 2 },
  loaderBox: { padding: 32, alignItems: 'center' },
  gridContainer: { paddingHorizontal: GRID_PAD },
  gridRow: { gap: GRID_GAP, marginBottom: GRID_GAP },
  gridItem: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  gridImage: { width: '100%', height: '100%' },
  gridPlaceholder: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#222' },
  gridOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    paddingHorizontal: 6,
    paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  gridStat: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  gridStatText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  empty: { paddingVertical: 48, alignItems: 'center' },
  emptyText: { color: '#888', marginTop: 10 },
  error: { color: '#f87171', textAlign: 'center', marginBottom: 8 },
  viewerContainer: { flex: 1, backgroundColor: '#000' },
  viewerVideoShell: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  viewerVideoFrame: { backgroundColor: '#000' },
  viewerClose: {
    position: 'absolute',
    top: 48,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerActions: {
    position: 'absolute',
    right: 16,
    bottom: 48,
    gap: 16,
  },
  viewerActionBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  subModalSheet: {
    height: '78%',
    backgroundColor: '#111',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
});
