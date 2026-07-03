import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  Image,
  Modal,
  PanResponder,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { USE_NATIVE_DRIVER } from '../../lib/animation';
import { api, ApiError, type ReelDTO } from '../../lib/api';
import type { ReelPlayerHandle, ReelPlaybackStatus } from '../../components/ReelPlayer';
import { ReelFeedMedia } from './ReelFeedMedia';
import ReelCommentSheet from './ReelCommentSheet';
import ReelShareSheet from './ReelShareSheet';
import ReelProfileSheet from './ReelProfileSheet';
import { useReelVideoPrefetch } from './useReelVideoPrefetch';
import { REEL_ACTION_RAIL_WIDTH, REEL_BOTTOM_INSET, getReelFrameDimensions } from './reelVideoLayout';

type Props = {
  reels: ReelDTO[];
  initialIndex?: number;
  onClose: () => void;
  onReelsChange?: (reels: ReelDTO[]) => void;
  /** When true, avatar/username are not tappable (e.g. viewing from a profile grid). */
  disableProfileNavigation?: boolean;
};

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`.replace('.0K', 'K');
  return `${(n / 1_000_000).toFixed(1)}M`.replace('.0M', 'M');
}

function authorLabel(reel: ReelDTO): string {
  return reel.author?.display_name?.trim() || reel.author?.email?.split('@')[0] || 'unknown';
}

export function ReelImmersiveViewer({
  reels: initialReels,
  initialIndex = 0,
  onClose,
  onReelsChange,
  disableProfileNavigation = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { frameWidth: reelWidth, frameHeight: reelHeight, usePhoneFrame } = useMemo(
    () => getReelFrameDimensions(windowWidth, windowHeight),
    [windowWidth, windowHeight]
  );
  const [reels, setReels] = useState(initialReels);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [readyReelIds, setReadyReelIds] = useState<Set<string>>(new Set());
  const [openComments, setOpenComments] = useState<ReelDTO | null>(null);
  const [openShare, setOpenShare] = useState<ReelDTO | null>(null);
  const [openProfile, setOpenProfile] = useState<ReelDTO | null>(null);

  const flatListRef = useRef<FlatList<ReelDTO>>(null);
  const videos = useRef<Record<string, ReelPlayerHandle | null>>({});
  const activeReelIdRef = useRef<string | null>(null);
  const activeMediaIndexRef = useRef<Record<string, number>>({});
  const durationMillisRef = useRef(1);
  const isScrubbingRef = useRef(false);
  const viewedReelIds = useRef<Set<string>>(new Set());
  const reelsRef = useRef(reels);
  reelsRef.current = reels;

  const heartScale = useRef(new Animated.Value(0)).current;
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const tapCount = useRef(0);
  const lastTap = useRef(0);

  const { resolveUri, prefetchAround } = useReelVideoPrefetch();

  const patchReel = useCallback(
    (id: string, patch: Partial<ReelDTO>) => {
      setReels((prev) => {
        const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
        onReelsChange?.(next);
        return next;
      });
    },
    [onReelsChange]
  );

  const activePlayerKey = useCallback((reelId: string | null) => {
    if (!reelId) return null;
    const slideIndex = activeMediaIndexRef.current[reelId] ?? 0;
    const slideKey = `${reelId}:${slideIndex}`;
    if (videos.current[slideKey]) return slideKey;
    if (videos.current[reelId]) return reelId;
    return slideKey;
  }, []);

  const getActivePlayer = useCallback(
    (reelId: string | null) => {
      const key = activePlayerKey(reelId);
      return key ? videos.current[key] ?? null : null;
    },
    [activePlayerKey]
  );

  const registerVideoRef = useCallback((reelId: string, ref: ReelPlayerHandle | null) => {
    if (ref) videos.current[reelId] = ref;
    else delete videos.current[reelId];
  }, []);

  const playActiveReel = useCallback(async (reelId: string | null) => {
    activeReelIdRef.current = reelId;
    const slideIndex = reelId ? (activeMediaIndexRef.current[reelId] ?? 0) : 0;
    const activeSlideKey = reelId ? `${reelId}:${slideIndex}` : null;
    await Promise.all(
      Object.entries(videos.current).map(async ([id, player]) => {
        if (!player) return;
        const isActive =
          reelId != null && (id === reelId || id === activeSlideKey || id.startsWith(`${reelId}:`));
        if (isActive && (id === reelId || id === activeSlideKey)) {
          const status = await player.getStatusAsync();
          if (status.isLoaded) await player.playAsync();
        } else {
          await player.pauseAsync();
        }
      })
    );
  }, []);

  const seekToProgress = useCallback(
    (ratio: number) => {
      const player = getActivePlayer(activeReelIdRef.current);
      if (!player) return;
      const duration = durationMillisRef.current || 1;
      const clamped = Math.max(0, Math.min(1, ratio));
      void player.setPositionAsync(clamped * duration);
      setProgress(clamped);
    },
    [getActivePlayer]
  );

  const progressPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (_, gesture) => {
          isScrubbingRef.current = true;
          void getActivePlayer(activeReelIdRef.current)?.pauseAsync();
          setIsPlaying(false);
          seekToProgress(gesture.x0 / reelWidth);
        },
        onPanResponderMove: (_, gesture) => seekToProgress(gesture.moveX / reelWidth),
        onPanResponderRelease: () => {
          isScrubbingRef.current = false;
          void getActivePlayer(activeReelIdRef.current)?.playAsync();
          setIsPlaying(true);
        },
        onPanResponderTerminate: () => {
          isScrubbingRef.current = false;
        },
      }),
    [reelWidth, seekToProgress, getActivePlayer]
  );

  const animateHeart = useCallback(() => {
    heartScale.setValue(0);
    heartOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(heartScale, { toValue: 1.3, duration: 200, useNativeDriver: USE_NATIVE_DRIVER }),
      Animated.timing(heartOpacity, { toValue: 1, duration: 100, useNativeDriver: USE_NATIVE_DRIVER }),
    ]).start(() => {
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(heartScale, { toValue: 1, duration: 200, useNativeDriver: USE_NATIVE_DRIVER }),
          Animated.timing(heartOpacity, { toValue: 0, duration: 400, useNativeDriver: USE_NATIVE_DRIVER }),
        ]).start();
      }, 300);
    });
  }, [heartOpacity, heartScale]);

  const toggleLike = useCallback(
    async (reel: ReelDTO, viaDoubleTap = false) => {
      const next = !reel.liked_by_me;
      patchReel(reel.id, {
        liked_by_me: next,
        like_count: Math.max(0, reel.like_count + (next ? 1 : -1)),
      });
      if (next || viaDoubleTap) animateHeart();
      try {
        if (next) await api.reels.like(reel.id);
        else await api.reels.unlike(reel.id);
      } catch (e) {
        patchReel(reel.id, { liked_by_me: !next, like_count: reel.like_count });
        Alert.alert('Reels', e instanceof ApiError ? e.message : 'Failed to update like');
      }
    },
    [animateHeart, patchReel]
  );

  const handlePlaybackStatus = useCallback((reelId: string, status: ReelPlaybackStatus, isCurrent: boolean) => {
    if (!status.isLoaded || !isCurrent) return;
    if (status.didJustFinish) {
      const key = activePlayerKey(reelId);
      void (key ? videos.current[key] : null)?.replayAsync();
    }
    if (status.positionMillis != null && status.durationMillis != null && status.durationMillis > 0) {
      if (!isScrubbingRef.current) setProgress(status.positionMillis / status.durationMillis);
      durationMillisRef.current = status.durationMillis;
    }
  }, [activePlayerKey]);

  const handleVideoReady = useCallback(
    (reelId: string) => {
      setReadyReelIds((prev) => (prev.has(reelId) ? prev : new Set(prev).add(reelId)));
      if (reelId === activeReelIdRef.current) void playActiveReel(reelId);
    },
    [playActiveReel]
  );

  const togglePlayPause = useCallback(async () => {
    const v = getActivePlayer(activeReelIdRef.current);
    if (v) {
      if (isPlaying) await v.pauseAsync();
      else await v.playAsync();
    }
    setIsPlaying((p) => !p);
  }, [getActivePlayer, isPlaying]);

  const handleVideoPress = useCallback(
    (reel: ReelDTO) => {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        tapCount.current += 1;
        if (tapCount.current === 2) {
          if (!reel.liked_by_me) void toggleLike(reel, true);
          else animateHeart();
          tapCount.current = 0;
        }
      } else {
        tapCount.current = 1;
      }
      lastTap.current = now;
      setTimeout(() => {
        if (tapCount.current === 1) void togglePlayPause();
        tapCount.current = 0;
      }, 300);
    },
    [animateHeart, toggleLike, togglePlayPause]
  );

  useEffect(() => {
    if (initialIndex > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: initialIndex, animated: false });
      }, 50);
    }
  }, [initialIndex]);

  useEffect(() => {
    if (openComments || openShare || openProfile) {
      void getActivePlayer(activeReelIdRef.current)?.pauseAsync();
      setIsPlaying(false);
    } else if (activeReelIdRef.current) {
      void playActiveReel(activeReelIdRef.current);
      setIsPlaying(true);
    }
  }, [openComments, openShare, openProfile, playActiveReel, getActivePlayer]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: { index: number | null; item: ReelDTO }[] }) => {
      if (viewableItems.length === 0) return;
      const v = viewableItems[0];
      if (v.index == null || !v.item?.id) return;
      setCurrentIndex(v.index);
      setProgress(0);
      setIsPlaying(true);
      void playActiveReel(v.item.id);
      if (!viewedReelIds.current.has(v.item.id)) {
        viewedReelIds.current.add(v.item.id);
        api.reels.view(v.item.id).catch(() => undefined);
        setReels((prev) =>
          prev.map((r) => (r.id === v.item.id ? { ...r, view_count: r.view_count + 1 } : r))
        );
      }
      prefetchAround(reelsRef.current, v.index);
    }
  ).current;

  const renderReel = useCallback(
    ({ item, index }: { item: ReelDTO; index: number }) => {
      const isCurrent = index === currentIndex;
      const avatar = item.author?.avatar_url ?? null;
      const isLiked = item.liked_by_me;

      return (
        <View style={{ width: reelWidth, height: reelHeight }}>
          <TouchableOpacity activeOpacity={1} onPress={() => handleVideoPress(item)} style={styles.videoTouch}>
            <ReelFeedMedia
              reel={item}
              reelIndex={index}
              currentReelIndex={currentIndex}
              videoUri={resolveUri(item)}
              isFocused
              isPlaying={isPlaying}
              isMuted={isMuted}
              isReady={readyReelIds.has(item.id)}
              onReady={handleVideoReady}
              onPlaybackStatus={handlePlaybackStatus}
              onRef={registerVideoRef}
              onMediaIndexChange={(reelId, mediaIndex) => {
                activeMediaIndexRef.current[reelId] = mediaIndex;
                if (reelId === activeReelIdRef.current) void playActiveReel(reelId);
              }}
            />
            {isCurrent && (
              <Animated.View
                style={[styles.heartAnimation, { transform: [{ scale: heartScale }], opacity: heartOpacity }]}
                pointerEvents="none"
              >
                <Ionicons name="heart" size={100} color="#ff3b30" />
              </Animated.View>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={[styles.muteButton, { top: insets.top + 56 }]} onPress={() => setIsMuted((m) => !m)}>
            <Ionicons name={isMuted ? 'volume-mute' : 'volume-medium'} size={22} color="#fff" />
          </TouchableOpacity>

          {isCurrent && (
            <View style={[styles.progressContainer, { bottom: insets.bottom + 12 }]} {...progressPan.panHandlers}>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
              </View>
            </View>
          )}

          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.bottomGradient} pointerEvents="box-none">
            <View style={[styles.captionContainer, { marginBottom: REEL_BOTTOM_INSET + insets.bottom, paddingRight: REEL_ACTION_RAIL_WIDTH + 8 }]}>
              <View style={styles.userInfo}>
                {disableProfileNavigation ? (
                  <>
                    {avatar ? (
                      <Image source={{ uri: avatar }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, styles.avatarFallback]}>
                        <Text style={styles.avatarFallbackText}>{authorLabel(item).charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                  </>
                ) : (
                  <TouchableOpacity onPress={() => setOpenProfile(item)}>
                    {avatar ? (
                      <Image source={{ uri: avatar }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, styles.avatarFallback]}>
                        <Text style={styles.avatarFallbackText}>{authorLabel(item).charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
                <Text style={styles.username}>@{authorLabel(item)}</Text>
              </View>
              {!!item.caption && (
                <Text style={styles.caption} numberOfLines={3}>
                  {item.caption}
                </Text>
              )}
              <View style={styles.musicContainer}>
                <Ionicons name="musical-notes" size={14} color="rgba(255,255,255,0.85)" />
                <Text style={styles.music} numberOfLines={1}>
                  Original audio · @{authorLabel(item)}
                </Text>
              </View>
            </View>
          </LinearGradient>

          <View style={[styles.actionButtons, { bottom: REEL_BOTTOM_INSET + insets.bottom }]}>
            <TouchableOpacity style={styles.actionButton} onPress={() => toggleLike(item)}>
              <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={26} color={isLiked ? '#ff375f' : '#fff'} />
              <Text style={styles.actionText}>{formatCount(item.like_count)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => setOpenComments(item)}>
              <Ionicons name="chatbubble-ellipses-outline" size={26} color="#fff" />
              <Text style={styles.actionText}>{formatCount(item.comment_count)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => setOpenShare(item)}>
              <Ionicons name="paper-plane-outline" size={24} color="#fff" />
              <Text style={styles.actionText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton}>
              <Ionicons name="eye-outline" size={22} color="#fff" />
              <Text style={styles.actionText}>{formatCount(item.view_count)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [
      currentIndex,
      handlePlaybackStatus,
      handleVideoPress,
      handleVideoReady,
      heartOpacity,
      heartScale,
      insets.bottom,
      insets.top,
      isMuted,
      isPlaying,
      playActiveReel,
      progress,
      progressPan.panHandlers,
      readyReelIds,
      reelHeight,
      reelWidth,
      registerVideoRef,
      resolveUri,
      toggleLike,
      disableProfileNavigation,
    ]
  );

  return (
    <View style={[styles.container, usePhoneFrame && styles.containerPhoneFrame]}>
      <View style={[styles.feedColumn, usePhoneFrame && styles.feedColumnPhone, { width: reelWidth }]}>
      <StatusBar barStyle="light-content" />
      <FlatList
        ref={flatListRef}
        data={reels}
        keyExtractor={(r) => r.id}
        renderItem={renderReel}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={reelHeight}
        decelerationRate="fast"
        initialScrollIndex={initialIndex > 0 ? initialIndex : undefined}
        getItemLayout={(_, index) => ({ length: reelHeight, offset: reelHeight * index, index })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 51 }}
        onScrollToIndexFailed={(info) => {
          flatListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        }}
      />

      <TouchableOpacity style={[styles.closeBtn, { top: insets.top + 8 }]} onPress={onClose}>
        <Ionicons name="chevron-back" size={26} color="#fff" />
      </TouchableOpacity>
      </View>

      <Modal visible={!!openComments} animationType="slide" transparent onRequestClose={() => setOpenComments(null)}>
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setOpenComments(null)} />
          <View style={styles.sheet}>
            {openComments && (
              <ReelCommentSheet
                reelId={openComments.id}
                onClose={() => setOpenComments(null)}
                onCommentAdded={() =>
                  patchReel(openComments.id, { comment_count: openComments.comment_count + 1 })
                }
              />
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={!!openShare} animationType="slide" transparent onRequestClose={() => setOpenShare(null)}>
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setOpenShare(null)} />
          <View style={styles.sheet}>
            {openShare && <ReelShareSheet reel={openShare} onClose={() => setOpenShare(null)} />}
          </View>
        </View>
      </Modal>

      <Modal visible={!!openProfile && !disableProfileNavigation} animationType="slide" transparent onRequestClose={() => setOpenProfile(null)}>
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setOpenProfile(null)} />
          <View style={styles.sheet}>
            {openProfile && <ReelProfileSheet reel={openProfile} onClose={() => setOpenProfile(null)} />}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  containerPhoneFrame: { backgroundColor: '#0a0a0a' },
  feedColumn: { flex: 1, alignSelf: 'stretch' },
  feedColumnPhone: {
    alignSelf: 'center',
    maxWidth: '100%',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: '#1f1f1f',
    overflow: 'hidden',
  },
  videoTouch: { flex: 1 },
  closeBtn: {
    position: 'absolute',
    left: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  muteButton: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  progressContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 28,
    justifyContent: 'flex-end',
    zIndex: 15,
  },
  progressBg: { height: 4, backgroundColor: 'rgba(255,255,255,0.25)' },
  progressFill: { height: 4, backgroundColor: '#fff' },
  bottomGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 80,
    zIndex: 5,
  },
  captionContainer: { paddingHorizontal: 14 },
  userInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  avatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  avatarFallback: { backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { color: '#fff', fontWeight: '700' },
  username: { color: '#fff', fontWeight: '700', fontSize: 15 },
  caption: { color: '#fff', fontSize: 14, lineHeight: 20 },
  musicContainer: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  music: { color: 'rgba(255,255,255,0.85)', fontSize: 12, flex: 1 },
  actionButtons: {
    position: 'absolute',
    right: 8,
    alignItems: 'center',
    gap: 18,
    zIndex: 10,
  },
  actionButton: { alignItems: 'center' },
  actionText: { color: '#fff', fontSize: 11, marginTop: 4, fontWeight: '600' },
  heartAnimation: {
    position: 'absolute',
    alignSelf: 'center',
    top: '40%',
    zIndex: 8,
  },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    height: '78%',
    backgroundColor: '#111',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
});
