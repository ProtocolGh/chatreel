import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { ProgressBar } from 'react-native-paper';
import { ReelPlayer, type ReelPlaybackStatus, type ReelPlayerHandle } from '../../components/ReelPlayer';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { USE_NATIVE_DRIVER } from '../../lib/animation';
import { api, ApiError, type ReelDTO } from '../../lib/api';
import { useReelsFeed } from '../../hooks/useReelsFeed';
import { useReelUploadQueue } from '../../hooks/useReelUploadQueue';
import { useCurrentProfileId } from '../../hooks/useCurrentProfileId';
import { retryReelUploadTask } from '../../lib/reelUploadQueue';
import {
  registerBeforeChatNavigate,
  unregisterBeforeChatNavigate,
} from '../../navigation/chatNavigationBridge';
import ReelCommentSheet from './ReelCommentSheet';
import ReelShareSheet from './ReelShareSheet';
import ReelProfileSheet from './ReelProfileSheet';
import { SCREEN_HEIGHT, SCREEN_WIDTH, REEL_ACTION_RAIL_WIDTH, REEL_BOTTOM_INSET, getReelFrameDimensions } from './reelVideoLayout';
import { useReelVideoPrefetch } from './useReelVideoPrefetch';
import { ReelFeedMedia } from './ReelFeedMedia';
import { reelTabBarOffset } from './ReelsTabBar';

const WINDOW_HEIGHT = SCREEN_HEIGHT;

function ActionIcon({
  name,
  size = 28,
  color = '#fff',
  active,
}: {
  name: keyof typeof Ionicons.glyphMap;
  size?: number;
  color?: string;
  active?: boolean;
}) {
  return (
    <View style={[styles.actionIconWrap, active && styles.actionIconWrapActive]}>
      <Ionicons name={name} size={size} color={color} />
    </View>
  );
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`.replace('.0K', 'K');
  return `${(n / 1_000_000).toFixed(1)}M`.replace('.0M', 'M');
}

function authorLabel(reel: ReelDTO): string {
  return (
    reel.author?.display_name?.trim() ||
    reel.author?.email?.split('@')[0] ||
    'unknown'
  );
}

function avatarFor(reel: ReelDTO): string | null {
  return reel.author?.avatar_url ?? null;
}

export default function ReelsScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { frameWidth: reelWidth, frameHeight: reelHeight, usePhoneFrame } = useMemo(
    () => getReelFrameDimensions(windowWidth, windowHeight),
    [windowWidth, windowHeight]
  );
  const navigation = useNavigation<any>();
  const isReelTabFocused = useIsFocused();
  const [isMainAppTabFocused, setIsMainAppTabFocused] = useState(true);
  const isFocused = isReelTabFocused && isMainAppTabFocused;
  const bottomNavOffset = reelTabBarOffset(insets.bottom);

  const [feedMode, setFeedMode] = useState<'forYou' | 'following'>('forYou');
  const feedSource = feedMode === 'forYou' ? 'feed' : 'following';

  const {
    reels,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    error,
    refresh,
    loadMore,
    reload,
    applyLocalLikeChange,
    applyLocalCommentChange,
    removeReelLocally,
  } = useReelsFeed(feedSource);
  const { tasks: uploadTasks, activeCount, activeProgress, summary } = useReelUploadQueue();
  const myProfileId = useCurrentProfileId();
  const [showUploadPanel, setShowUploadPanel] = useState(false);

  const { resolveUri, prefetchAround, warmReel } = useReelVideoPrefetch();
  const prefetchAroundRef = useRef(prefetchAround);
  const reelsRef = useRef(reels);
  prefetchAroundRef.current = prefetchAround;
  reelsRef.current = reels;

  const flatListRef = useRef<FlatList<ReelDTO>>(null);
  const videos = useRef<Record<string, ReelPlayerHandle | null>>({});
  const activeReelIdRef = useRef<string | null>(null);
  const activeMediaIndexRef = useRef<Record<string, number>>({});
  const durationMillisRef = useRef(1);
  const isScrubbingRef = useRef(false);
  const viewedReelIds = useRef<Set<string>>(new Set());
  const [readyReelIds, setReadyReelIds] = useState<Set<string>>(new Set());

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [playbackIcon, setPlaybackIcon] = useState<'play' | 'pause' | null>(null);

  const [openComments, setOpenComments] = useState<ReelDTO | null>(null);
  const [openShare, setOpenShare] = useState<ReelDTO | null>(null);
  const [openProfile, setOpenProfile] = useState<ReelDTO | null>(null);
  const [followedAuthorIds, setFollowedAuthorIds] = useState<Set<string>>(new Set());
  const [followBusyAuthorIds, setFollowBusyAuthorIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    const onFocus = () => setIsMainAppTabFocused(true);
    const onBlur = () => {
      setIsMainAppTabFocused(false);
      void Promise.all(Object.values(videos.current).map((v) => v?.pauseAsync()));
      setIsPlaying(false);
    };
    const unsubFocus = parent.addListener('focus', onFocus);
    const unsubBlur = parent.addListener('blur', onBlur);
    return () => {
      unsubFocus();
      unsubBlur();
    };
  }, [navigation]);

  useEffect(() => {
    registerBeforeChatNavigate(() => {
      void Promise.all(Object.values(videos.current).map((v) => v?.pauseAsync()));
      setIsPlaying(false);
    });
    return () => unregisterBeforeChatNavigate();
  }, []);

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

  const handleVideoReady = useCallback(
    (reelId: string) => {
      setReadyReelIds((prev) => {
        if (prev.has(reelId)) return prev;
        const next = new Set(prev);
        next.add(reelId);
        return next;
      });
      if (reelId === activeReelIdRef.current) {
        const key = activePlayerKey(reelId);
        void (key ? videos.current[key] : null)?.playAsync();
      }
    },
    []
  );

  const handlePlaybackStatus = useCallback(
    (reelId: string, status: ReelPlaybackStatus, isCurrent: boolean) => {
      if (!status.isLoaded || !isCurrent) return;
      if (status.didJustFinish) {
        const key = activePlayerKey(reelId);
        void (key ? videos.current[key] : null)?.replayAsync();
      }
      if (status.positionMillis != null && status.durationMillis != null && status.durationMillis > 0) {
        if (!isScrubbingRef.current) {
          setProgress(status.positionMillis / status.durationMillis);
        }
        durationMillisRef.current = status.durationMillis;
      }
    },
    []
  );

  const refreshFollowedAuthors = useCallback(async () => {
    try {
      const [{ profile }, { friendships }] = await Promise.all([
        api.profiles.me() as Promise<{ profile: { id?: string } }>,
        api.friendships.list('accepted') as Promise<{
          friendships: Array<{ user_id?: string; friend_id?: string }>;
        }>,
      ]);
      const myProfileId = profile?.id;
      if (!myProfileId) return;
      const set = new Set<string>();
      for (const f of friendships ?? []) {
        if (f.user_id === myProfileId && f.friend_id) set.add(f.friend_id);
        if (f.friend_id === myProfileId && f.user_id) set.add(f.user_id);
      }
      setFollowedAuthorIds(set);
    } catch {
      /* ignore */
    }
  }, []);


  const resetFeedScroll = useCallback(() => {
    setCurrentIndex(0);
    setProgress(0);
    activeReelIdRef.current = null;
    viewedReelIds.current.clear();
    setReadyReelIds(new Set());
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    void Promise.all(Object.values(videos.current).map((v) => v?.pauseAsync()));
  }, []);

  const switchFeedMode = useCallback(
    (mode: 'forYou' | 'following') => {
      if (mode === feedMode) return;
      setFeedMode(mode);
      resetFeedScroll();
    },
    [feedMode, resetFeedScroll]
  );

  const heartScale = useRef(new Animated.Value(0)).current;
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const tapCount = useRef(0);
  const lastTap = useRef(0);

  const animateHeart = useCallback(() => {
    heartScale.setValue(0);
    heartOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(heartScale, {
        toValue: 1.3,
        duration: 200,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(heartOpacity, {
        toValue: 1,
        duration: 100,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start(() => {
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(heartScale, {
            toValue: 1.0,
            duration: 200,
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.timing(heartOpacity, {
            toValue: 0,
            duration: 400,
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
        ]).start();
      }, 300);
    });
  }, [heartScale, heartOpacity]);

  const toggleLike = useCallback(
    async (reel: ReelDTO, viaDoubleTap = false) => {
      const next = !reel.liked_by_me;
      // Optimistic
      applyLocalLikeChange(reel.id, next);
      if (next || viaDoubleTap) animateHeart();
      try {
        if (next) await api.reels.like(reel.id);
        else await api.reels.unlike(reel.id);
      } catch (e) {
        applyLocalLikeChange(reel.id, !next);
        const message = e instanceof ApiError ? e.message : 'Failed to update like';
        Alert.alert('Reels', message);
      }
    },
    [applyLocalLikeChange, animateHeart]
  );

  const playActiveReel = useCallback(
    async (reelId: string | null) => {
      activeReelIdRef.current = reelId;
      const slideIndex = reelId ? (activeMediaIndexRef.current[reelId] ?? 0) : 0;
      const activeSlideKey = reelId ? `${reelId}:${slideIndex}` : null;
      await Promise.all(
        Object.entries(videos.current).map(async ([id, player]) => {
          if (!player) return;
          try {
            const isActive =
              reelId != null && (id === reelId || id === activeSlideKey || id.startsWith(`${reelId}:`));
            if (isActive && (id === reelId || id === activeSlideKey)) {
              const status = await player.getStatusAsync();
              if (status.isLoaded) {
                await player.playAsync();
              }
            } else {
              await player.pauseAsync();
            }
          } catch {
            /* ignore transient av errors */
          }
        })
      );
    },
    []
  );

  const togglePlayPause = useCallback(async () => {
    const reelId = activeReelIdRef.current;
    const v = getActivePlayer(reelId);
    if (v) {
      if (isPlaying) {
        await v.pauseAsync();
      } else {
        await v.playAsync();
      }
    }
    setPlaybackIcon(isPlaying ? 'play' : 'pause');
    if (!isPlaying) {
      setTimeout(() => setPlaybackIcon((prev) => (prev === 'pause' ? null : prev)), 700);
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
        if (tapCount.current === 1) {
          void togglePlayPause();
        }
        tapCount.current = 0;
      }, 300);
    },
    [animateHeart, toggleLike, togglePlayPause]
  );

  // Pause every video when screen blurs.
  useEffect(() => {
    if (!isFocused) {
      void Promise.all(Object.values(videos.current).map((v) => v?.pauseAsync()));
      setIsPlaying(false);
    } else if (activeReelIdRef.current) {
      void playActiveReel(activeReelIdRef.current);
      setIsPlaying(true);
    }
  }, [isFocused, playActiveReel]);

  // Keep playback in sync when play state toggles.
  useEffect(() => {
    if (!isFocused || !activeReelIdRef.current) return;
    if (isPlaying) {
      void playActiveReel(activeReelIdRef.current);
    } else {
      const v = getActivePlayer(activeReelIdRef.current);
      void v?.pauseAsync();
    }
  }, [isPlaying, isFocused, playActiveReel, getActivePlayer]);

  // Pause when a sheet is open
  useEffect(() => {
    if (openComments || openShare || openProfile) {
      const v = getActivePlayer(activeReelIdRef.current);
      void v?.pauseAsync();
      setIsPlaying(false);
    } else if (isFocused && activeReelIdRef.current) {
      void playActiveReel(activeReelIdRef.current);
      setIsPlaying(true);
    }
  }, [openComments, openShare, openProfile, isFocused, playActiveReel]);

  useEffect(() => {
    void refreshFollowedAuthors();
  }, [refreshFollowedAuthors]);

  useEffect(() => {
    if (!isFocused || reels.length === 0) return;
    if (!activeReelIdRef.current) {
      const first = reels[0];
      if (!first) return;
      activeReelIdRef.current = first.id;
      setCurrentIndex(0);
      warmReel(first);
      prefetchAround(reels, 0);
      void playActiveReel(first.id);
      return;
    }
    prefetchAround(reels, currentIndex);
  }, [isFocused, reels, currentIndex, warmReel, prefetchAround, playActiveReel]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: { index: number | null; item: ReelDTO }[] }) => {
      if (viewableItems.length === 0) return;
      const v = viewableItems[0];
      if (v.index == null || !v.item?.id) return;
      setCurrentIndex(v.index);
      setProgress(0);
      setIsPlaying(true);
      setPlaybackIcon(null);
      void playActiveReel(v.item.id);

      const reel = v.item;
      if (reel && !viewedReelIds.current.has(reel.id)) {
        viewedReelIds.current.add(reel.id);
        api.reels.view(reel.id).catch(() => undefined);
      }
      void prefetchAroundRef.current(reelsRef.current, v.index);
    }
  ).current;

  const viewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: 51, minimumViewTime: 80 }),
    []
  );

  const getItemLayout = useCallback(
    (_data: ArrayLike<ReelDTO> | null | undefined, index: number) => ({
      length: reelHeight,
      offset: reelHeight * index,
      index,
    }),
    [reelHeight]
  );

  const seekToProgress = useCallback((ratio: number) => {
    const player = getActivePlayer(activeReelIdRef.current);
    if (!player) return;
    const duration = durationMillisRef.current || 1;
    const clamped = Math.max(0, Math.min(1, ratio));
    void player.setPositionAsync(clamped * duration);
    setProgress(clamped);
  }, [getActivePlayer]);

  const progressPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (_, gesture) => {
          isScrubbingRef.current = true;
          const v = getActivePlayer(activeReelIdRef.current);
          void v?.pauseAsync();
          setIsPlaying(false);
          seekToProgress(gesture.x0 / reelWidth);
        },
        onPanResponderMove: (_, gesture) => {
          seekToProgress(gesture.moveX / reelWidth);
        },
        onPanResponderRelease: () => {
          isScrubbingRef.current = false;
          const v = getActivePlayer(activeReelIdRef.current);
          void v?.playAsync();
          setIsPlaying(true);
        },
        onPanResponderTerminate: () => {
          isScrubbingRef.current = false;
        },
      }),
    [reelWidth, seekToProgress, getActivePlayer]
  );

  const handleDelete = useCallback(
    (reel: ReelDTO) => {
      Alert.alert('Delete reel?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            removeReelLocally(reel.id);
            try {
              await api.reels.delete(reel.id);
            } catch (e) {
              const message = e instanceof ApiError ? e.message : 'Delete failed';
              Alert.alert('Reels', message);
              reload();
            }
          },
        },
      ]);
    },
    [removeReelLocally, reload]
  );

  const quickFollow = useCallback(
    async (reel: ReelDTO) => {
      const authorId = reel.author_id;
      if (!authorId) return;
      if (followedAuthorIds.has(authorId) || followBusyAuthorIds.has(authorId)) return;
      setFollowBusyAuthorIds((prev) => new Set(prev).add(authorId));
      setFollowedAuthorIds((prev) => new Set(prev).add(authorId));
      try {
        await api.friendships.request(authorId);
      } catch {
        // rollback optimistic check on failure
        setFollowedAuthorIds((prev) => {
          const next = new Set(prev);
          next.delete(authorId);
          return next;
        });
      } finally {
        setFollowBusyAuthorIds((prev) => {
          const next = new Set(prev);
          next.delete(authorId);
          return next;
        });
      }
    },
    [followBusyAuthorIds, followedAuthorIds]
  );

  const renderReel = useCallback(
    ({ item, index }: { item: ReelDTO; index: number }) => {
      const isLiked = item.liked_by_me;
      const isCurrent = index === currentIndex;
      const avatar = avatarFor(item);
      const videoUri = resolveUri(item);
      const isFollowing = followedAuthorIds.has(item.author_id);
      const isReady = readyReelIds.has(item.id);

      return (
        <View style={[styles.reelContainer, { width: reelWidth, height: reelHeight }]}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => handleVideoPress(item)}
            onLongPress={() => handleDelete(item)}
            delayLongPress={700}
            style={styles.videoTouchLayer}
          >
            <ReelFeedMedia
              reel={item}
              reelIndex={index}
              currentReelIndex={currentIndex}
              videoUri={videoUri}
              isFocused={isFocused}
              isPlaying={isPlaying}
              isMuted={isMuted}
              isReady={isReady}
              onReady={handleVideoReady}
              onPlaybackStatus={handlePlaybackStatus}
              onRef={registerVideoRef}
              onMediaIndexChange={(reelId, mediaIndex) => {
                activeMediaIndexRef.current[reelId] = mediaIndex;
                if (reelId === activeReelIdRef.current) {
                  void playActiveReel(reelId);
                }
              }}
            />
            {isCurrent && (
              <Animated.View
                style={[
                  styles.heartAnimation,
                  { transform: [{ scale: heartScale }], opacity: heartOpacity },
                ]}
                pointerEvents="none"
              >
                <Ionicons name="heart" size={100} color="#ff3b30" />
              </Animated.View>
            )}
            {isCurrent && playbackIcon && (
              <View style={styles.playbackIconOverlay} pointerEvents="none">
                <Ionicons
                  name={playbackIcon === 'play' ? 'play' : 'pause'}
                  size={56}
                  color="#fff"
                />
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.muteButton, { top: insets.top + 56 }]}
            onPress={() => setIsMuted((m) => !m)}
          >
            <Ionicons
              name={isMuted ? 'volume-mute' : 'volume-medium'}
              size={22}
              color="#fff"
            />
          </TouchableOpacity>

          {isCurrent && (
            <View
              style={[styles.progressContainer, { bottom: bottomNavOffset }]}
              {...progressPan.panHandlers}
            >
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
              </View>
            </View>
          )}

          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.85)']}
            style={styles.bottomGradient}
            pointerEvents="box-none"
          >
            <View
              style={[
                styles.captionContainer,
                {
                  marginBottom: REEL_BOTTOM_INSET + bottomNavOffset,
                  paddingRight: REEL_ACTION_RAIL_WIDTH + 8,
                },
              ]}
            >
              <View style={styles.userInfo}>
                <TouchableOpacity onPress={() => setOpenProfile(item)}>
                  {avatar ? (
                    <Image source={{ uri: avatar }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarFallback]}>
                      <Text style={styles.avatarFallbackText}>
                        {authorLabel(item).charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
                <Text style={styles.username}>@{authorLabel(item)}</Text>
                {item.visibility !== 'public' && (
                  <View style={styles.visibilityPill}>
                    <Ionicons
                      name={
                        item.visibility === 'friends'
                          ? 'people'
                          : item.visibility === 'group'
                            ? 'chatbubbles'
                            : 'lock-closed'
                      }
                      size={11}
                      color="#fff"
                    />
                  </View>
                )}
              </View>
              {!!item.caption && (
                <Text style={styles.caption} numberOfLines={2}>
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

          <View style={[styles.actionButtons, { bottom: REEL_BOTTOM_INSET + bottomNavOffset }]}>
            <View style={styles.profileActionWrap}>
              <TouchableOpacity style={styles.profileButton} onPress={() => setOpenProfile(item)}>
                {avatar ? (
                  <Image source={{ uri: avatar }} style={styles.profileAvatar} />
                ) : (
                  <View style={[styles.profileAvatar, styles.avatarFallback]}>
                    <Text style={styles.avatarFallbackText}>
                      {authorLabel(item).charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.profileFollowPlus}
                onPress={() => void quickFollow(item)}
              >
                <Ionicons name={isFollowing ? 'checkmark' : 'add'} size={13} color="#fff" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.actionButton} onPress={() => toggleLike(item)}>
              <ActionIcon
                name={isLiked ? 'heart' : 'heart-outline'}
                size={26}
                color={isLiked ? '#ff375f' : '#fff'}
                active={isLiked}
              />
              <Text style={styles.actionText}>{formatCount(item.like_count)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => setOpenComments(item)}>
              <ActionIcon name="chatbubble-ellipses-outline" size={26} />
              <Text style={styles.actionText}>{formatCount(item.comment_count)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => setOpenShare(item)}>
              <ActionIcon name="paper-plane-outline" size={24} />
              <Text style={styles.actionText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton}>
              <ActionIcon name="eye-outline" size={22} />
              <Text style={styles.actionText}>{formatCount(item.view_count)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [
      currentIndex,
      handleDelete,
      handleVideoPress,
      heartOpacity,
      heartScale,
      reelHeight,
      reelWidth,
      bottomNavOffset,
      insets.bottom,
      isFocused,
      isMuted,
      isPlaying,
      progress,
      progressPan.panHandlers,
      handleVideoReady,
      handlePlaybackStatus,
      registerVideoRef,
      resolveUri,
      readyReelIds,
      playbackIcon,
      followedAuthorIds,
      quickFollow,
      toggleLike,
      myProfileId,
      navigation,
    ]
  );

  if (loading && reels.length === 0) {
    return (
      <View style={[styles.container, styles.center]}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.emptyText}>Loading reels…</Text>
      </View>
    );
  }

  if (error && reels.length === 0) {
    return (
      <View style={[styles.container, styles.center]}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <Ionicons name="cloud-offline-outline" size={48} color="#fff" />
        <Text style={styles.emptyText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={reload}>
          <Text style={styles.retryButtonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, usePhoneFrame && styles.containerPhoneFrame]}>
      <StatusBar barStyle="light-content" backgroundColor="#000" translucent />

      <View style={[styles.feedColumn, usePhoneFrame && styles.feedColumnPhone, { width: reelWidth }]}>

      <LinearGradient
        colors={['rgba(0,0,0,0.55)', 'transparent']}
        style={[styles.topGradient, { paddingTop: insets.top + 8 }]}
        pointerEvents="box-none"
      >
        <View style={styles.topBar}>
          <View style={styles.topIconBtnSpacer} />

          <View style={styles.feedPills}>
            <TouchableOpacity
              style={feedMode === 'forYou' ? styles.feedPillActive : styles.feedPill}
              onPress={() => switchFeedMode('forYou')}
            >
              <Text style={feedMode === 'forYou' ? styles.feedPillActiveText : styles.feedPillText}>
                For You
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={feedMode === 'following' ? styles.feedPillActive : styles.feedPill}
              onPress={() => switchFeedMode('following')}
            >
              <Text style={feedMode === 'following' ? styles.feedPillActiveText : styles.feedPillText}>
                Following
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.topIconBtnSpacer} />
        </View>
      </LinearGradient>

      {(activeCount > 0 || summary.error > 0) && (
        <TouchableOpacity
          onPress={() => setShowUploadPanel(true)}
          style={[styles.uploadStatusChip, { top: insets.top + 56 }]}
          activeOpacity={0.85}
        >
          <Ionicons
            name={summary.error > 0 ? 'alert-circle' : 'cloud-upload-outline'}
            size={14}
            color="#fff"
          />
          <Text style={styles.uploadStatusText}>
            {summary.error > 0
              ? `${summary.error} upload failed`
              : `Uploading ${activeProgress}%`}
          </Text>
          <Ionicons name="chevron-forward" size={14} color="#fff" />
        </TouchableOpacity>
      )}

      <FlatList
        ref={flatListRef}
        data={reels}
        extraData={currentIndex}
        renderItem={renderReel}
        keyExtractor={(item) => item.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={getItemLayout}
        snapToInterval={reelHeight}
        snapToAlignment="start"
        decelerationRate="fast"
        removeClippedSubviews={Platform.OS === 'android' ? false : undefined}
        windowSize={5}
        maxToRenderPerBatch={2}
        initialNumToRender={2}
        onEndReached={() => {
          if (hasMore && !loadingMore) loadMore();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor="#fff"
            colors={['#fff']}
          />
        }
        ListEmptyComponent={
          <View style={[styles.emptyContainer, { height: reelHeight, width: reelWidth }]}>
            <Ionicons
              name={feedMode === 'following' ? 'people-outline' : 'film-outline'}
              size={56}
              color="#666"
            />
            <Text style={styles.emptyText}>
              {feedMode === 'following'
                ? 'No reels from people you follow'
                : 'No reels yet'}
            </Text>
            {feedMode === 'following' ? (
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => navigation.navigate('ReelSearch')}
              >
                <Text style={styles.retryButtonText}>Find friends to follow</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => navigation.navigate('PostReel' as never)}
              >
                <Text style={styles.retryButtonText}>Post the first reel</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : null
        }
      />
      </View>

      <Modal
        visible={!!openComments}
        animationType="slide"
        transparent
        onRequestClose={() => setOpenComments(null)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setOpenComments(null)}
          />
          <View style={[styles.sheetWrapper, { paddingBottom: insets.bottom }]}>
            {openComments && (
              <ReelCommentSheet
                reelId={openComments.id}
                onClose={() => setOpenComments(null)}
                onCommentAdded={() => applyLocalCommentChange(openComments.id, 1)}
                onCommentRemoved={() => applyLocalCommentChange(openComments.id, -1)}
              />
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!openShare}
        animationType="slide"
        transparent
        onRequestClose={() => setOpenShare(null)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setOpenShare(null)}
          />
          <View style={[styles.sheetWrapper, { paddingBottom: insets.bottom }]}>
            {openShare && (
              <ReelShareSheet reel={openShare} onClose={() => setOpenShare(null)} />
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!openProfile}
        animationType="slide"
        transparent
        onRequestClose={() => setOpenProfile(null)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setOpenProfile(null)}
          />
          <View style={[styles.profileSheetWrapper, { paddingBottom: insets.bottom }]}>
            {openProfile && (
              <ReelProfileSheet
                reel={openProfile}
                onClose={() => setOpenProfile(null)}
                onFollowStateChange={(authorId, state) => {
                  setFollowedAuthorIds((prev) => {
                    const next = new Set(prev);
                    if (state === 'following' || state === 'pending') next.add(authorId);
                    else next.delete(authorId);
                    return next;
                  });
                }}
              />
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={showUploadPanel}
        transparent
        animationType="slide"
        onRequestClose={() => setShowUploadPanel(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowUploadPanel(false)}
          />
          <View style={[styles.sheetWrapper, styles.uploadPanelWrapper, { paddingBottom: insets.bottom }]}>
            <View style={styles.uploadPanelHeader}>
              <Text style={styles.uploadPanelTitle}>Background uploads</Text>
              <TouchableOpacity onPress={() => setShowUploadPanel(false)}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.uploadPanelList}>
              {uploadTasks.length === 0 ? (
                <Text style={styles.uploadPanelEmpty}>No uploads yet.</Text>
              ) : (
                uploadTasks.map((task) => (
                  <View key={task.id} style={styles.uploadItem}>
                    <View style={styles.uploadItemLeft}>
                      <Text style={styles.uploadItemTitle}>Reel upload</Text>
                      <Text style={styles.uploadItemStage}>{task.stage}</Text>
                      {(task.status === 'uploading' ||
                        task.status === 'publishing' ||
                        task.status === 'queued') && (
                        <ProgressBar
                          progress={(task.progress ?? 0) / 100}
                          color="#1e90ff"
                          style={styles.uploadItemProgress}
                        />
                      )}
                      {task.error ? <Text style={styles.uploadItemError}>{task.error}</Text> : null}
                    </View>
                    {task.status === 'error' ? (
                      <TouchableOpacity
                        style={styles.uploadRetryBtn}
                        onPress={() => {
                          const ok = retryReelUploadTask(task.id);
                          if (!ok) Alert.alert('Uploads', 'Unable to retry this upload.');
                        }}
                      >
                        <Ionicons name="refresh" size={14} color="#fff" />
                        <Text style={styles.uploadRetryText}>Retry</Text>
                      </TouchableOpacity>
                    ) : task.status === 'done' ? (
                      <Text style={styles.uploadItemDone}>Done</Text>
                    ) : (
                      <Text style={styles.uploadItemStatus}>{task.progress ?? 0}%</Text>
                    )}
                  </View>
                ))
              )}
            </ScrollView>
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
  center: { justifyContent: 'center', alignItems: 'center' },
  reelContainer: { position: 'relative', backgroundColor: '#000', overflow: 'hidden' },
  videoTouchLayer: StyleSheet.absoluteFillObject,
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    elevation: 20,
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topIconBtnSpacer: {
    width: 40,
    height: 40,
  },
  feedPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  feedPillActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#fff',
    paddingBottom: 4,
  },
  feedPillActiveText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  feedPill: { paddingBottom: 4 },
  feedPillText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 16,
    fontWeight: '600',
  },
  uploadStatusChip: {
    position: 'absolute',
    left: 64,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '60%',
  },
  uploadStatusText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  uploadPanelWrapper: { height: '62%' },
  uploadPanelHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a2a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  uploadPanelTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  uploadPanelList: { padding: 12, gap: 10 },
  uploadPanelEmpty: { color: '#9ca3af', textAlign: 'center', marginTop: 16 },
  uploadItem: {
    backgroundColor: '#1b1b1b',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  uploadItemLeft: { flex: 1 },
  uploadItemTitle: { color: '#fff', fontSize: 13, fontWeight: '600' },
  uploadItemStage: { color: '#cbd5e1', fontSize: 12, marginTop: 4 },
  uploadItemProgress: { marginTop: 8, height: 4, borderRadius: 2, backgroundColor: '#333' },
  uploadItemError: { color: '#f87171', fontSize: 11, marginTop: 4 },
  uploadItemDone: { color: '#4ade80', fontSize: 12, fontWeight: '700' },
  uploadItemStatus: { color: '#93c5fd', fontSize: 12, fontWeight: '600' },
  uploadRetryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  uploadRetryText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  muteButton: {
    position: 'absolute',
    left: 14,
    zIndex: 18,
    elevation: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    padding: 8,
  },
  progressContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 28,
    zIndex: 17,
    elevation: 17,
    justifyContent: 'flex-end',
    paddingHorizontal: 0,
  },
  scrubArea: {
    position: 'absolute',
    left: 0,
    right: REEL_ACTION_RAIL_WIDTH,
    zIndex: 17,
    elevation: 17,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  compactMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  compactUser: { flexShrink: 1, maxWidth: '42%' },
  compactUsername: { color: '#fff', fontSize: 12, fontWeight: '800' },
  compactStats: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 },
  compactStat: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '700' },
  captionStrip: {
    position: 'absolute',
    left: 12,
    right: REEL_ACTION_RAIL_WIDTH + 8,
    zIndex: 16,
  },
  captionSmall: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '500' },
  progressBg: { height: 4, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },
  playbackIconOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -34,
    marginTop: -34,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 11,
  },
  heartAnimation: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -50,
    marginTop: -50,
    zIndex: 10,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 260,
    justifyContent: 'flex-end',
    paddingHorizontal: 14,
    zIndex: 15,
    elevation: 15,
  },
  captionContainer: { marginBottom: 0 },
  userInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 },
  avatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: '#fff' },
  avatarFallback: {
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarFallbackText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  username: { color: '#fff', fontWeight: '700', fontSize: 15 },
  visibilityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 10,
  },
  caption: { color: '#fff', fontSize: 14, marginBottom: 8, lineHeight: 19, fontWeight: '500' },
  musicContainer: { flexDirection: 'row', alignItems: 'center', maxWidth: '92%' },
  music: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginLeft: 6, flex: 1 },
  actionButtons: {
    position: 'absolute',
    right: 6,
    width: REEL_ACTION_RAIL_WIDTH - 8,
    alignItems: 'center',
    zIndex: 25,
    elevation: 25,
  },
  actionIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(0,0,0,0.32)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconWrapActive: {
    backgroundColor: 'rgba(255,55,95,0.25)',
    borderColor: 'rgba(255,55,95,0.45)',
  },
  profileActionWrap: { marginBottom: 14, alignItems: 'center', position: 'relative' },
  profileButton: { alignItems: 'center' },
  profileAvatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: '#fff' },
  profileFollowPlus: {
    position: 'absolute',
    bottom: -5,
    backgroundColor: '#ff375f',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  actionButton: { alignItems: 'center', marginBottom: 12 },
  actionText: { color: '#fff', fontSize: 11, marginTop: 4, fontWeight: '700' },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: SCREEN_WIDTH,
  },
  emptyText: { color: '#fff', marginTop: 16, fontSize: 16 },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#1976d2',
    borderRadius: 22,
  },
  retryButtonText: { color: '#fff', fontWeight: '600' },
  footerLoader: { paddingVertical: 32, alignItems: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheetWrapper: {
    height: '78%',
    backgroundColor: '#111',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  profileSheetWrapper: {
    height: '100%',
    backgroundColor: '#111',
    overflow: 'hidden',
  },
});
