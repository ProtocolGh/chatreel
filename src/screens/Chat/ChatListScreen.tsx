// src/screens/Chat/ChatListScreen.tsx
import React, { useState, useEffect, useMemo, useCallback, useLayoutEffect, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  RefreshControl,
  useWindowDimensions,
  Platform,
  Modal,
  Pressable,
  ScrollView,
  Animated,
  Easing,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { TextInput, FAB, Button } from 'react-native-paper'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAuth } from '../../hooks/useAuth'
import { TabView, SceneMap } from 'react-native-tab-view'
import { LinearGradient } from 'expo-linear-gradient'
import { useIndividualChats, type IndividualChat } from '../../hooks/useIndividualChats'
import DropdownMenu from '../../components/DropdownMenu'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { useGroupList, type Group } from '../../hooks/useGroupList'
import { useIncomingFriendRequestCount } from '../../hooks/useIncomingFriendRequestCount'
import { useCurrentProfileId } from '../../hooks/useCurrentProfileId'
import { useFriendshipsRealtime } from '../../hooks/useFriendshipsRealtime'
import { useChatSettings } from '../../context/ChatSettingsContext'
import { api } from '../../lib/api'
import FriendRequestsScreen from './FriendRequestsScreen'
import {
  registerMobileChatOpener,
  unregisterMobileChatOpener,
} from '../../navigation/chatNavigationBridge'

type Props = { setSelectedChat?: (chat: any) => void }

const APP_LOGO = require('../../../assets/favIconChat.png')
const APP_NAME = 'ChatReel'
const SEARCH_HISTORY_KEY = 'chat_list_search_history'
const MAX_SEARCH_HISTORY = 8

const ALL_FAB_ACTIONS = [
  { key: 'add-friend', label: 'Add friend', icon: 'person-add' as const, route: 'AddFriend' },
  { key: 'new-group', label: 'New group', icon: 'people' as const, route: 'NewGroup' },
  { key: 'friends-list', label: 'Friends list', icon: 'people-circle' as const, route: 'FriendsList' },
] as const

type FriendSearchRow = {
  user_id: string
  name: string
  email?: string
  avatar_url?: string
}

type SearchSuggestion =
  | {
      kind: 'chat'
      key: string
      userId: string
      name: string
      avatar?: string
      subtitle: string
    }
  | {
      kind: 'group'
      key: string
      groupId: string
      name: string
      avatar?: string | null
      subtitle: string
    }
  | {
      kind: 'friend'
      key: string
      userId: string
      name: string
      avatar?: string
      subtitle: string
    }

type IncomingRequestRow = {
  friendshipId: string
  id: string
  display_name: string
  email?: string
  avatar_url?: string
  created_at: string
}

type AllFeedItem =
  | { kind: 'chat'; key: string; sortAt: string; item: IndividualChat }
  | { kind: 'group'; key: string; sortAt: string; item: Group }
  | { kind: 'request'; key: string; sortAt: string; item: IncomingRequestRow }

export default function ChatListScreen({ setSelectedChat }: Props) {
  const { user } = useAuth()
  const { theme } = useChatSettings()
  const myProfileId = useCurrentProfileId()
  const navigation = useNavigation<any>()
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const isNarrow = width < 400
  const fabBottom = Math.max(2, insets.bottom) + (setSelectedChat ? 4 : 44)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchHistory, setSearchHistory] = useState<string[]>([])
  const [friends, setFriends] = useState<FriendSearchRow[]>([])
  const [incomingRequests, setIncomingRequests] = useState<IncomingRequestRow[]>([])
  const [requestsLoading, setRequestsLoading] = useState(false)
  const searchInputRef = useRef<React.ComponentRef<typeof TextInput>>(null)
  const fabMenuAnim = useRef(new Animated.Value(0)).current
  const [fabMenuOpen, setFabMenuOpen] = useState(false)
  const [index, setIndex] = useState(0)
  
  // Track unread counts per tab (stored in state to persist between renders)
  const [individualUnreadCount, setIndividualUnreadCount] = useState(0)
  const [groupUnreadCount, setGroupUnreadCount] = useState(0)
  const incomingRequestCount = useIncomingFriendRequestCount()
  const [requestsUnreadCount, setRequestsUnreadCount] = useState(0)

  useEffect(() => {
    if (!user?.id) return
    AsyncStorage.getItem(`${SEARCH_HISTORY_KEY}:${user.id}`)
      .then((raw) => {
        if (!raw) return
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          setSearchHistory(parsed.filter((item): item is string => typeof item === 'string'))
        }
      })
      .catch(() => undefined)
  }, [user?.id])

  const persistSearchHistory = useCallback(
    (items: string[]) => {
      setSearchHistory(items)
      if (!user?.id) return
      void AsyncStorage.setItem(`${SEARCH_HISTORY_KEY}:${user.id}`, JSON.stringify(items))
    },
    [user?.id]
  )

  const addToSearchHistory = useCallback(
    (query: string) => {
      const trimmed = query.trim()
      if (!trimmed) return
      const next = [trimmed, ...searchHistory.filter((q) => q !== trimmed)].slice(0, MAX_SEARCH_HISTORY)
      persistSearchHistory(next)
    },
    [persistSearchHistory, searchHistory]
  )

  const removeFromSearchHistory = useCallback(
    (query: string) => {
      persistSearchHistory(searchHistory.filter((q) => q !== query))
    },
    [persistSearchHistory, searchHistory]
  )

  const clearSearchHistory = useCallback(() => {
    persistSearchHistory([])
  }, [persistSearchHistory])

  const visibleSearchHistory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return searchHistory
    return searchHistory.filter((item) => item.toLowerCase().includes(q))
  }, [searchHistory, searchQuery])

  useEffect(() => {
    setRequestsUnreadCount(incomingRequestCount)
  }, [incomingRequestCount])

  // Register cross-tab chat opener (reel share, etc.).
  useLayoutEffect(() => {
    if (setSelectedChat) return;
    const tabNav = navigation.getParent();
    if (!tabNav) return;
    registerMobileChatOpener((params) => {
      tabNav.navigate('Chats', {
        screen: 'ChatRoom',
        params,
      });
    });
    return () => unregisterMobileChatOpener();
  }, [navigation, setSelectedChat]);

  const routes = useMemo(
    () => [
      { key: 'all', title: 'All' },
      { key: 'friends', title: 'Friends' },
      { key: 'group', title: 'Groups' },
      { key: 'requests', title: 'Requests' },
    ],
    []
  )

  const totalUnreadCount = individualUnreadCount + groupUnreadCount

  const getTabBadgeCount = useCallback(
    (tabKey: string) => {
      if (tabKey === 'all') return totalUnreadCount + requestsUnreadCount
      if (tabKey === 'friends') return individualUnreadCount
      if (tabKey === 'group') return groupUnreadCount
      if (tabKey === 'requests') return requestsUnreadCount
      return 0
    },
    [groupUnreadCount, individualUnreadCount, requestsUnreadCount, totalUnreadCount]
  )

  
  // Use the custom hooks
  const { 
    chats: individualChats, 
    loading: individualLoading, 
    refreshing: individualRefreshing, 
    refresh: refreshIndividuals,
    isOnline: individualOnline,
    isDataStale: individualStale,
    markMessagesAsRead 
  } = useIndividualChats(searchQuery)

  const {
    groups: groupChats,
    loading: groupsLoading,
    refreshing: groupsRefreshing,
    refresh: refreshGroups,
    isOnline: groupsOnline,
    isDataStale: groupsStale,
    markGroupMessagesAsRead
  } = useGroupList(searchQuery)

  const fetchFriends = useCallback(async () => {
    if (!myProfileId) return
    try {
      const { friendships: data } = await api.friendships.list('accepted')
      const rows =
        (data ?? [])
          .map((f: Record<string, unknown>) => {
            const isSender = f.user_id === myProfileId
            const profile = (isSender ? f.receiver_profile : f.sender_profile) as {
              user_id?: string
              display_name?: string | null
              email?: string | null
              avatar_url?: string | null
            } | null
            if (!profile?.user_id) return null
            return {
              user_id: profile.user_id,
              name:
                profile.display_name?.trim() ||
                profile.email?.split('@')[0] ||
                'Friend',
              email: profile.email ?? undefined,
              avatar_url: profile.avatar_url ?? undefined,
            }
          })
          .filter((f): f is FriendSearchRow => Boolean(f)) ?? []

      const unique = Array.from(new Map(rows.map((f) => [f.user_id, f])).values())
      setFriends(unique)
    } catch {
      /* ignore */
    }
  }, [myProfileId])

  const fetchIncomingRequests = useCallback(async () => {
    if (!myProfileId) return
    setRequestsLoading(true)
    try {
      const { incoming } = await api.friendships.requests()
      const rows =
        (incoming ?? [])
          .map((r: Record<string, unknown>) => ({
            friendshipId: String(r.friendshipId ?? r.id ?? ''),
            id: String(r.id ?? ''),
            display_name: String(r.display_name ?? r.email ?? 'User'),
            email: r.email ? String(r.email) : undefined,
            avatar_url: r.avatar_url ? String(r.avatar_url) : undefined,
            created_at: String(r.created_at ?? ''),
          }))
          .filter((r) => r.friendshipId) ?? []
      setIncomingRequests(rows)
    } catch {
      /* ignore */
    } finally {
      setRequestsLoading(false)
    }
  }, [myProfileId])

  const refreshFriendData = useCallback(() => {
    void fetchFriends()
    void fetchIncomingRequests()
  }, [fetchFriends, fetchIncomingRequests])

  useFriendshipsRealtime(myProfileId, refreshFriendData)

  const searchSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return null

    const chatUserIds = new Set(individualChats.map((c) => c.user_id))

    const chats: SearchSuggestion[] = individualChats.slice(0, 6).map((c) => ({
      kind: 'chat',
      key: `chat-${c.user_id}`,
      userId: c.user_id,
      name: c.name,
      avatar: c.avatar_url,
      subtitle: c.last_message || 'Direct chat',
    }))

    const groups: SearchSuggestion[] = groupChats.slice(0, 6).map((g) => ({
      kind: 'group',
      key: `group-${g.id}`,
      groupId: g.id,
      name: g.name,
      avatar: g.avatar_url,
      subtitle: g.last_message || `${g.member_count} members`,
    }))

    const friendRows: SearchSuggestion[] = friends
      .filter((f) => !chatUserIds.has(f.user_id))
      .filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          (f.email?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 6)
      .map((f) => ({
        kind: 'friend',
        key: `friend-${f.user_id}`,
        userId: f.user_id,
        name: f.name,
        avatar: f.avatar_url,
        subtitle: f.email || 'Friend',
      }))

    return { chats, groups, friends: friendRows }
  }, [friends, groupChats, individualChats, searchQuery])

  const filteredIncomingRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return incomingRequests
    return incomingRequests.filter(
      (r) =>
        r.display_name.toLowerCase().includes(q) ||
        (r.email?.toLowerCase().includes(q) ?? false)
    )
  }, [incomingRequests, searchQuery])

  const allFeedItems = useMemo(() => {
    const items: AllFeedItem[] = [
      ...individualChats.map((chat) => ({
        kind: 'chat' as const,
        key: `chat-${chat.user_id}`,
        sortAt: chat.last_message_at ?? '',
        item: chat,
      })),
      ...groupChats.map((group) => ({
        kind: 'group' as const,
        key: `group-${group.id}`,
        sortAt: group.last_message_at ?? '',
        item: group,
      })),
      ...filteredIncomingRequests.map((request) => ({
        kind: 'request' as const,
        key: `request-${request.friendshipId}`,
        sortAt: request.created_at,
        item: request,
      })),
    ]
    return items.sort((a, b) => b.sortAt.localeCompare(a.sortAt))
  }, [filteredIncomingRequests, groupChats, individualChats])

  const hasSearchSuggestions = Boolean(
    searchSuggestions &&
      (searchSuggestions.chats.length > 0 ||
        searchSuggestions.groups.length > 0 ||
        searchSuggestions.friends.length > 0)
  )

  const friendsTabIndex = routes.findIndex((r) => r.key === 'friends')
  const groupsTabIndex = routes.findIndex((r) => r.key === 'group')
  const requestsTabIndex = routes.findIndex((r) => r.key === 'requests')
  const allTabIndex = routes.findIndex((r) => r.key === 'all')

  useEffect(() => {
    // Calculate individual chats unread count
    const individualTotal = individualChats.reduce((sum, chat) => sum + (chat.unread_count || 0), 0)
    setIndividualUnreadCount(individualTotal)
    
    // Calculate group chats unread count
    const groupTotal = groupChats.reduce((sum, group) => sum + (group.unread_count || 0), 0)
    setGroupUnreadCount(groupTotal)
    
    // Note: For requests, you might need to fetch this separately from your friend requests hook
    // For now, we'll set it to 0 or you can integrate with your friend requests system
    // setRequestsUnreadCount(/* calculate from friend requests */)
  }, [individualChats, groupChats])

  const handleTabPress = (newIndex: number) => {
    const routeKey = routes[newIndex].key

    if (routeKey === 'friends') {
      setIndividualUnreadCount(0)
    } else if (routeKey === 'group') {
      setGroupUnreadCount(0)
    } else if (routeKey === 'requests') {
      setRequestsUnreadCount(0)
    } else if (routeKey === 'all') {
      setIndividualUnreadCount(0)
      setGroupUnreadCount(0)
      setRequestsUnreadCount(0)
    }

    setIndex(newIndex)
  }

  const refreshOnFocusRef = useRef<() => void>(() => {})
  refreshOnFocusRef.current = () => {
    refreshIndividuals()
    refreshGroups()
    void fetchFriends()
    void fetchIncomingRequests()
  }

  useFocusEffect(
    useCallback(() => {
      refreshOnFocusRef.current()
    }, [])
  )

  const onRefresh = useCallback(() => {
    if (!individualOnline || !groupsOnline) {
      console.log('Cannot refresh while offline')
      return
    }
    Promise.all([refreshIndividuals(), refreshGroups(), fetchIncomingRequests()])
  }, [fetchIncomingRequests, refreshGroups, refreshIndividuals, groupsOnline, individualOnline])

  const isRefreshing = individualRefreshing || groupsRefreshing || requestsLoading
  const isOnline = individualOnline && groupsOnline

  const closeFabMenu = useCallback(() => {
    setFabMenuOpen(false)
    Animated.timing(fabMenuAnim, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [fabMenuAnim])

  const toggleFabMenu = useCallback(() => {
    const next = !fabMenuOpen
    setFabMenuOpen(next)
    Animated.spring(fabMenuAnim, {
      toValue: next ? 1 : 0,
      friction: 7,
      tension: 120,
      useNativeDriver: true,
    }).start()
  }, [fabMenuAnim, fabMenuOpen])

  const runFabAction = useCallback(
    (route: string) => {
      closeFabMenu()
      if (!isOnline) return
      navigation.navigate(route)
    },
    [closeFabMenu, isOnline, navigation]
  )

  useEffect(() => {
    if (index !== allTabIndex && fabMenuOpen) {
      closeFabMenu()
    }
  }, [allTabIndex, closeFabMenu, fabMenuOpen, index])

  useEffect(() => {
    if (searchOpen && fabMenuOpen) {
      closeFabMenu()
    }
  }, [closeFabMenu, fabMenuOpen, searchOpen])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    requestAnimationFrame(() => {
      setTimeout(() => searchInputRef.current?.focus(), 80)
    })
  }, [])

  const closeSearchPopup = useCallback(() => {
    const trimmed = searchQuery.trim()
    if (trimmed) addToSearchHistory(trimmed)
    searchInputRef.current?.blur()
    setSearchOpen(false)
  }, [addToSearchHistory, searchQuery])

  const toggleSearch = useCallback(() => {
    if (searchOpen) closeSearchPopup()
    else openSearch()
  }, [closeSearchPopup, openSearch, searchOpen])

  const applyHistorySearch = useCallback(
    (query: string) => {
      setSearchQuery(query)
      addToSearchHistory(query)
      searchInputRef.current?.focus()
    },
    [addToSearchHistory]
  )

  const clearActiveSearch = useCallback(() => {
    setSearchQuery('')
    searchInputRef.current?.focus()
  }, [])

  const formatTime = (ts: string) => {
    if (!ts) return ''
    const date = new Date(ts)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (86400000))
    if (days === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (days === 1) return 'Yesterday'
    if (days < 7) return date.toLocaleDateString([], { weekday: 'short' })
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  const formatLastMessage = (item: any, isGroup: boolean) => {
    if (!item.last_message) return 'Start a conversation'
    
    if (isGroup && item.last_message_sender_display_name) {
      // Check if the sender is the current user
      const isCurrentUser = item.last_message_sender === user?.id
      const senderName = isCurrentUser ? 'You' : item.last_message_sender_display_name
      return `${senderName}: ${item.last_message}`
    }
    
    return item.last_message
  }

  const handleChatPress = async (item: any, isGroup = false) => {
    if (!isGroup && item.unread_count > 0) {
      await markMessagesAsRead(item.user_id)
      // Update local state immediately for better UX
      setIndividualUnreadCount(prev => Math.max(0, prev - item.unread_count))
    }
    if (isGroup && item.unread_count > 0) {
      await markGroupMessagesAsRead(item.id)
      // Update local state immediately for better UX
      setGroupUnreadCount(prev => Math.max(0, prev - item.unread_count))
    }
    
    const params = {
      chatId: isGroup ? item.id : item.user_id,
      chatType: isGroup ? 'group' : 'individual',
      chatName: item.name,
      avatarUrl: item.avatar_url,
    }

    if (setSelectedChat) {
      setSelectedChat(params)
      return
    }

    navigation.navigate('ChatRoom', params)
  }

  const selectSearchSuggestion = useCallback(
    (item: SearchSuggestion) => {
      const label = item.name.trim()
      if (label) addToSearchHistory(label)

      const params =
        item.kind === 'group'
          ? {
              chatId: item.groupId,
              chatType: 'group' as const,
              chatName: item.name,
              avatarUrl: item.avatar ?? undefined,
            }
          : {
              chatId: item.userId,
              chatType: 'individual' as const,
              chatName: item.name,
              avatarUrl: item.avatar ?? undefined,
            }

      if (setSelectedChat) {
        setSelectedChat(params)
      } else {
        navigation.navigate('ChatRoom', params)
      }

      setSearchOpen(false)
      searchInputRef.current?.blur()
    },
    [addToSearchHistory, navigation, setSelectedChat]
  )

  const suggestionIcon = (kind: SearchSuggestion['kind']) => {
    if (kind === 'group') return 'people'
    if (kind === 'friend') return 'person-add-outline'
    return 'chatbubble-outline'
  }

  const renderSuggestionSection = (title: string, items: SearchSuggestion[]) => {
    if (!items.length) return null
    return (
      <View style={styles.suggestionSection}>
        <Text style={styles.suggestionSectionTitle}>{title}</Text>
        {items.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={styles.suggestionRow}
            onPress={() => selectSearchSuggestion(item)}
            activeOpacity={0.7}
          >
            <View style={styles.suggestionAvatarWrap}>
              {item.avatar ? (
                <Image source={{ uri: item.avatar }} style={styles.suggestionAvatar} />
              ) : (
                <View style={[styles.suggestionAvatar, styles.suggestionAvatarFallback]}>
                  <Text style={styles.suggestionAvatarLetter}>
                    {item.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.suggestionMeta}>
              <Text style={styles.suggestionName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.suggestionSubtitle} numberOfLines={1}>
                {item.subtitle}
              </Text>
            </View>
            <Ionicons name={suggestionIcon(item.kind)} size={16} color="#9ca3af" />
          </TouchableOpacity>
        ))}
      </View>
    )
  }

  const AvatarComponent = ({ uri, name }: { uri?: string; name: string }) => {
    const [error, setError] = useState(false);
    
    if (error || !uri || uri.includes('placeholder.com')) {
      return (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarInitials}>
            {name ? name.charAt(0).toUpperCase() : '?'}
          </Text>
        </View>
      );
    }
    
    return (
      <Image 
        source={{ uri }} 
        style={styles.avatar}
        onError={() => setError(true)}
      />
    );
  };

  const renderChatItem = ({ item, isGroup = false }: { item: any; isGroup?: boolean }) => {
    return (
      <TouchableOpacity 
        style={styles.chatItem} 
        onPress={() => handleChatPress(item, isGroup)}
      >
        <View style={styles.avatarContainer}>
          <AvatarComponent uri={item.avatar_url} name={item.name} />
          {/* Show role badge for groups */}
          {isGroup && item.user_role && (item.user_role === 'creator' || item.user_role === 'admin') && (
            <View style={[
              styles.roleBadge, 
              item.user_role === 'creator' ? styles.creatorBadge : styles.adminBadge
            ]}>
              <Text style={styles.roleBadgeText}>
                {item.user_role === 'creator' ? '👑' : '⚡'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.chatInfo}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatName} numberOfLines={1}>
              {item.name}
              {isGroup && item.member_count > 0 && (
                <Text style={styles.memberCountText}> • {item.member_count}</Text>
              )}
            </Text>
            <View style={styles.timeContainer}>
              {item.last_message_at && <Text style={styles.time}>{formatTime(item.last_message_at)}</Text>}
            </View>
          </View>

          <View style={styles.messageContainer}>
            <Text style={[styles.lastMessage, item.unread_count > 0 && styles.unreadMessage]} numberOfLines={1}>
              {formatLastMessage(item, isGroup)}
            </Text>
            <View style={styles.rightContainer}>
              {item.unread_count > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadCount}>
                    {item.unread_count > 99 ? '99+' : item.unread_count}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const EmptyState = ({ title, subtitle, buttonText, onPress, isOnline }: any) => (
    <View style={styles.emptyContainer}>
      {!isOnline && (
        <View style={styles.offlineIndicator}>
          <Text style={styles.offlineText}>You are offline</Text>
        </View>
      )}
      <Text style={styles.emptyText}>{title}</Text>
      <Text style={styles.emptySubtext}>{subtitle}</Text>
      <Button 
        mode="contained" 
        onPress={onPress} 
        style={styles.addFriendsButton}
        disabled={!isOnline}
      >
        {buttonText}
      </Button>
    </View>
  )

  const renderAllFeedItem = ({ item }: { item: AllFeedItem }) => {
    if (item.kind === 'request') {
      const request = item.item
      return (
        <TouchableOpacity
          style={styles.chatItem}
          onPress={() => handleTabPress(requestsTabIndex)}
          activeOpacity={0.75}
        >
          <View style={styles.avatarContainer}>
            <AvatarComponent uri={request.avatar_url} name={request.display_name} />
            <View style={[styles.callTypeIcon, styles.requestIcon]}>
              <Ionicons name="person-add" size={12} color="#fff" />
            </View>
          </View>
          <View style={styles.chatInfo}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatName} numberOfLines={1}>
                {request.display_name}
              </Text>
              {request.created_at ? (
                <Text style={styles.time}>{formatTime(request.created_at)}</Text>
              ) : null}
            </View>
            <View style={styles.messageContainer}>
              <Text style={[styles.lastMessage, styles.requestPreview]} numberOfLines={1}>
                Sent you a friend request
              </Text>
              <View style={styles.requestBadge}>
                <Text style={styles.requestBadgeText}>Request</Text>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      )
    }

    if (item.kind === 'group') {
      return renderChatItem({ item: item.item, isGroup: true })
    }

    return renderChatItem({ item: item.item })
  }

  const AllRoute = () => (
    <FlatList
      data={allFeedItems}
      renderItem={({ item }) => renderAllFeedItem({ item })}
      keyExtractor={(item) => item.key}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          enabled={isOnline}
        />
      }
      ListEmptyComponent={
        individualLoading || groupsLoading || requestsLoading ? (
          <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
        ) : (
          <EmptyState
            title="Nothing here yet"
            subtitle={
              searchQuery.trim()
                ? 'No chats or requests match your search'
                : 'Start chatting, join a group, or accept a friend request'
            }
            buttonText="Add Friends"
            onPress={() => navigation.navigate('FriendsList')}
            isOnline={isOnline}
          />
        )
      }
      ListHeaderComponent={
        !isOnline ? (
          <View style={styles.offlineNotice}>
            <Text style={styles.offlineNoticeText}>📡 Offline Mode - Showing cached data</Text>
          </View>
        ) : individualStale || groupsStale ? (
          <TouchableOpacity style={styles.staleNotice} onPress={onRefresh}>
            <Text style={styles.staleNoticeText}>🔄 Data may be outdated. Tap to refresh.</Text>
          </TouchableOpacity>
        ) : null
      }
    />
  )

  const FriendsRoute = () => (
    <FlatList
      data={individualChats}
      renderItem={({ item }) => renderChatItem({ item })}
      keyExtractor={item => item.user_id}
      refreshControl={
        <RefreshControl 
          refreshing={isRefreshing} 
          onRefresh={onRefresh}
          enabled={isOnline}
        />
      }
      ListEmptyComponent={
        individualLoading ? (
          <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
        ) : (
          <EmptyState
            title="No conversations yet"
            subtitle={individualChats.length === 0 ? "Add friends to start chatting" : "No chats match your search"}
            buttonText="Add Friends"
            onPress={() => navigation.navigate('FriendsList')}
            isOnline={isOnline}
          />
        )
      }
      ListHeaderComponent={
        !isOnline ? (
          <View style={styles.offlineNotice}>
            <Text style={styles.offlineNoticeText}>📡 Offline Mode - Showing cached data</Text>
          </View>
        ) : individualStale ? (
          <TouchableOpacity style={styles.staleNotice} onPress={refreshIndividuals}>
            <Text style={styles.staleNoticeText}>🔄 Data may be outdated. Tap to refresh.</Text>
          </TouchableOpacity>
        ) : null
      }
    />
  )

  const GroupRoute = () => (
    <FlatList
      data={groupChats}
      renderItem={({ item }) => renderChatItem({ item, isGroup: true })}
      keyExtractor={item => item.id}
      refreshControl={
        <RefreshControl 
          refreshing={isRefreshing} 
          onRefresh={onRefresh}
          enabled={isOnline}
        />
      }
      ListEmptyComponent={
        groupsLoading ? (
          <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
        ) : (
          <EmptyState
            title="No groups yet"
            subtitle="Create or join a group to start chatting"
            buttonText="Create New Group"
            onPress={() => navigation.navigate('NewGroup')}
            isOnline={isOnline}
          />
        )
      }
      ListHeaderComponent={
        !isOnline ? (
          <View style={styles.offlineNotice}>
            <Text style={styles.offlineNoticeText}>📡 Offline Mode - Showing cached data</Text>
          </View>
        ) : groupsStale ? (
          <TouchableOpacity style={styles.staleNotice} onPress={refreshGroups}>
            <Text style={styles.staleNoticeText}>🔄 Data may be outdated. Tap to refresh.</Text>
          </TouchableOpacity>
        ) : null
      }
    />
  )

  const RequestsRoute = () => (
    <FriendRequestsScreen />
  )

  const renderScene = SceneMap({
    all: AllRoute,
    friends: FriendsRoute,
    group: GroupRoute,
    requests: RequestsRoute,
  })

  const renderTabBar = () => (
    <View style={styles.tabStripContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabStrip}
      >
        {routes.map((route, routeIndex) => {
          const focused = index === routeIndex
          const badge = getTabBadgeCount(route.key)
          return (
            <TouchableOpacity
              key={route.key}
              style={[styles.tabStripItem, focused && styles.tabStripItemActive]}
              onPress={() => handleTabPress(routeIndex)}
              activeOpacity={0.85}
            >
              <Text style={[styles.tabStripLabel, focused && styles.tabStripLabelActive]}>
                {route.title}
              </Text>
              {badge > 0 ? (
                <View style={[styles.tabStripBadge, focused && styles.tabStripBadgeActive]}>
                  <Text style={[styles.tabStripBadgeText, focused && styles.tabStripBadgeTextActive]}>
                    {badge > 99 ? '99+' : badge}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    </View>
  )


  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.listBg }]} edges={['left', 'right']}>
      <View
        style={[
          styles.navbar,
          isNarrow && styles.navbarNarrow,
          { backgroundColor: theme.headerBg, borderBottomColor: `${theme.accent}33` },
        ]}
      >
        <View style={styles.brandRow}>
          <Image source={APP_LOGO} style={styles.appLogo} resizeMode="contain" />
          <Text style={[styles.appName, { color: theme.headerText }]}>{APP_NAME}</Text>
        </View>

        <View style={styles.navbarSpacer} />

        <TouchableOpacity
          style={[
            styles.searchToggle,
            (searchOpen || searchQuery.length > 0) && styles.searchToggleActive,
          ]}
          onPress={toggleSearch}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Search chats"
        >
          <Ionicons
            name={searchOpen ? 'close' : 'search'}
            size={22}
            color={searchOpen || searchQuery.length > 0 ? theme.primary : theme.headerText}
          />
        </TouchableOpacity>

        <DropdownMenu triggerIcon="ellipsis-vertical" />
      </View>

      <Modal
        visible={searchOpen}
        transparent
        animationType="fade"
        onRequestClose={closeSearchPopup}
      >
        <Pressable style={styles.searchBackdrop} onPress={closeSearchPopup} />
        <View
          style={[
            styles.searchDropdown,
            {
              top: insets.top + 54,
              right: 12,
              width: Math.min(360, width - 24),
            },
          ]}
        >
          <LinearGradient colors={[theme.accent, theme.primary]} style={styles.gradientBorder}>
            <View style={styles.searchWrapper}>
              <TextInput
                ref={searchInputRef}
                placeholder="Search chats, groups & friends"
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={() => {
                  const trimmed = searchQuery.trim()
                  if (trimmed) addToSearchHistory(trimmed)
                }}
                returnKeyType="search"
                mode="flat"
                style={styles.searchBar}
                underlineColor="transparent"
                theme={{ colors: { text: '#000', background: 'transparent' } }}
                left={<TextInput.Icon icon="magnify" color="#666" />}
                right={
                  searchQuery.length > 0 ? (
                    <TextInput.Icon icon="close" color="#666" onPress={clearActiveSearch} />
                  ) : undefined
                }
              />
            </View>
          </LinearGradient>

          <ScrollView
            style={styles.searchDropdownList}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {searchQuery.trim() ? (
              hasSearchSuggestions && searchSuggestions ? (
                <>
                  {renderSuggestionSection('Chats', searchSuggestions.chats)}
                  {renderSuggestionSection('Groups', searchSuggestions.groups)}
                  {renderSuggestionSection('Friends', searchSuggestions.friends)}
                </>
              ) : (
                <Text style={styles.searchHistoryEmpty}>No chats or friends found</Text>
              )
            ) : (
              <>
                <View style={styles.searchHistoryHeader}>
                  <Text style={styles.searchHistoryTitle}>Recent searches</Text>
                  {searchHistory.length > 0 ? (
                    <TouchableOpacity
                      onPress={clearSearchHistory}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.searchHistoryClear}>Clear all</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {visibleSearchHistory.length > 0 ? (
                  visibleSearchHistory.map((item) => (
                    <View key={item} style={styles.searchHistoryRow}>
                      <TouchableOpacity
                        style={styles.searchHistoryMain}
                        onPress={() => applyHistorySearch(item)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="time-outline" size={18} color="#8e8e93" />
                        <Text style={styles.searchHistoryText} numberOfLines={1}>
                          {item}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => removeFromSearchHistory(item)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={`Remove ${item}`}
                      >
                        <Ionicons name="close" size={18} color="#b0b7c3" />
                      </TouchableOpacity>
                    </View>
                  ))
                ) : (
                  <Text style={styles.searchHistoryEmpty}>
                    Start typing to search chats and friends
                  </Text>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      <TabView
        navigationState={{ index, routes }}
        renderScene={renderScene}
        onIndexChange={handleTabPress}
        initialLayout={{ width }}
        renderTabBar={renderTabBar}
        swipeEnabled
      />

      {index === allTabIndex && !searchOpen && (
        <>
          {ALL_FAB_ACTIONS.map((action, actionIndex) => {
            const lift = (actionIndex + 1) * 64
            return (
              <Animated.View
                key={action.key}
                pointerEvents={fabMenuOpen ? 'auto' : 'none'}
                style={[
                  styles.fabActionRow,
                  {
                    bottom: fabBottom + 8,
                    opacity: fabMenuAnim.interpolate({
                      inputRange: [0, 0.35, 1],
                      outputRange: [0, 0.7, 1],
                    }),
                    transform: [
                      {
                        translateY: fabMenuAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [16, -lift],
                        }),
                      },
                      {
                        scale: fabMenuAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.6, 1],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <TouchableOpacity
                  style={styles.fabActionLabel}
                  onPress={() => runFabAction(action.route)}
                  activeOpacity={0.85}
                  disabled={!isOnline}
                >
                  <Text style={styles.fabActionLabelText}>{action.label}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.fabMini, !isOnline && styles.fabMiniDisabled]}
                  onPress={() => runFabAction(action.route)}
                  activeOpacity={0.9}
                  disabled={!isOnline}
                >
                  <Ionicons name={action.icon} size={24} color="#fff" />
                </TouchableOpacity>
              </Animated.View>
            )
          })}

          <FAB
            style={[
              styles.fab,
              { bottom: fabBottom },
              !isOnline && styles.disabledFab,
              fabMenuOpen && styles.fabOpen,
            ]}
            icon={fabMenuOpen ? 'close' : 'plus'}
            onPress={() => (isOnline ? toggleFabMenu() : undefined)}
          />
        </>
      )}

      {index === friendsTabIndex && !searchOpen && (
        <FAB
          style={[styles.fab, { bottom: fabBottom }, !isOnline && styles.disabledFab]}
          icon="account-plus"
          onPress={() => isOnline && navigation.navigate('FriendsList')}
        />
      )}
      {index === groupsTabIndex && !searchOpen && (
        <FAB
          style={[styles.fab, { bottom: fabBottom }, !isOnline && styles.disabledFab]}
          icon="account-group"
          onPress={() => isOnline && navigation.navigate('NewGroup')}
        />
      )}
      {index === requestsTabIndex && !searchOpen && (
        <FAB
          style={[styles.fab, { bottom: fabBottom }, !isOnline && styles.disabledFab]}
          icon="account-plus"
          onPress={() => isOnline && navigation.navigate('AddFriend')}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
    gap: 8,
  },
  navbarNarrow: {
    paddingHorizontal: 8,
  },
  appLogo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    flexShrink: 0,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 8,
  },
  appName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.3,
    flexShrink: 0,
  },
  searchBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  searchDropdown: {
    position: 'absolute',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    maxHeight: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 12,
    ...(Platform.OS === 'web' ? { zIndex: 100 } : {}),
  },
  searchDropdownList: {
    maxHeight: 300,
    marginTop: 10,
  },
  suggestionSection: {
    marginBottom: 8,
  },
  suggestionSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 10,
    borderRadius: 10,
  },
  suggestionAvatarWrap: {
    flexShrink: 0,
  },
  suggestionAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  suggestionAvatarFallback: {
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionAvatarLetter: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  suggestionMeta: {
    flex: 1,
    minWidth: 0,
  },
  suggestionName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  suggestionSubtitle: {
    fontSize: 13,
    color: '#8e8e93',
    marginTop: 1,
  },
  searchHistoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  searchHistoryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  searchHistoryClear: {
    fontSize: 13,
    fontWeight: '600',
    color: '#007AFF',
  },
  searchHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  searchHistoryMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  searchHistoryText: {
    flex: 1,
    fontSize: 15,
    color: '#1a1a1a',
  },
  searchHistoryEmpty: {
    fontSize: 14,
    color: '#9ca3af',
    paddingHorizontal: 4,
    paddingVertical: 12,
  },
  searchToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef2f7',
  },
  searchToggleActive: {
    backgroundColor: '#e8f2ff',
  },
  navbarSpacer: {
    flex: 1,
  },
  gradientBorder: { 
    borderRadius: 25, 
    padding: 2 
  },
  searchWrapper: { 
    borderRadius: 23, 
    backgroundColor: '#fff', 
    overflow: 'hidden' 
  },
  searchBar: { 
    height: 40, 
    backgroundColor: 'transparent', 
    fontSize: 14, 
    paddingHorizontal: 12 
  },
  chatItem: { 
    flexDirection: 'row', 
    padding: 10, 
    borderBottomWidth: 0.5, 
    borderBottomColor: '#f0f0f0', 
    alignItems: 'center' 
  },
  avatarContainer: { 
    position: 'relative', 
    width: 52, 
    height: 52, 
    marginRight: 12 
  },
  avatar: { 
    width: 52, 
    height: 52, 
    borderRadius: 26 
  },
  avatarFallback: { 
    position: 'absolute', 
    top: 0, 
    left: 0, 
    width: 52, 
    height: 52, 
    borderRadius: 26, 
    backgroundColor: '#007AFF', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  avatarInitials: { 
    color: '#fff', 
    fontSize: 20, 
    fontWeight: 'bold' 
  },
  chatInfo: { 
    flex: 1 
  },
  chatHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    marginBottom: 4 
  },
  chatName: { 
    fontSize: 16, 
    fontWeight: '600', 
    color: '#1a1a1a', 
    flex: 1 
  },
  memberCountText: {
    fontSize: 12,
    color: '#666',
    fontWeight: 'normal',
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  time: { 
    fontSize: 12, 
    color: '#666',
  },
  messageContainer: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  lastMessage: { 
    fontSize: 14, 
    color: '#666', 
    flex: 1, 
    marginRight: 8 
  },
  unreadMessage: { 
    color: '#1a1a1a', 
    fontWeight: '500' 
  },
  rightContainer: { 
    flexDirection: 'row', 
    gap: 6 
  },
  unreadBadge: { 
    backgroundColor: '#007AFF', 
    borderRadius: 12, 
    minWidth: 20, 
    height: 20, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  unreadCount: { 
    color: '#fff', 
    fontSize: 10, 
    fontWeight: 'bold',
    paddingHorizontal: 4,
  },
  tabStripContainer: {
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
    paddingVertical: 10,
  },
  tabStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  tabStripItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#eef2f7',
    gap: 6,
  },
  tabStripItemActive: {
    backgroundColor: '#007AFF',
  },
  tabStripLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4a5568',
  },
  tabStripLabelActive: {
    color: '#fff',
    fontWeight: '700',
  },
  tabStripBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabStripBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  tabStripBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  tabStripBadgeTextActive: {
    color: '#007AFF',
  },
  requestIcon: {
    backgroundColor: '#FF9500',
  },
  requestPreview: {
    color: '#FF9500',
    fontWeight: '500',
  },
  requestBadge: {
    backgroundColor: '#fff3e0',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  requestBadgeText: {
    color: '#e65100',
    fontSize: 11,
    fontWeight: '700',
  },
  emptyContainer: { 
    alignItems: 'center', 
    justifyContent: 'center', 
    paddingTop: 80, 
    paddingHorizontal: 40 
  },
  emptyText: { 
    fontSize: 16, 
    fontWeight: '500', 
    color: '#666', 
    marginBottom: 8, 
    textAlign: 'center' 
  },
  emptySubtext: { 
    fontSize: 14, 
    color: '#999', 
    textAlign: 'center', 
    marginBottom: 20, 
    lineHeight: 20 
  },
  centeredContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    paddingHorizontal: 40 
  },
  requestsText: { 
    fontSize: 16, 
    color: '#666', 
    textAlign: 'center', 
    marginBottom: 20 
  },
  addFriendsButton: { 
    backgroundColor: '#007AFF', 
    marginTop: 10 
  },
  loader: { 
    marginTop: 40 
  },
  fab: {
    position: 'absolute',
    right: 12,
    backgroundColor: '#007AFF',
    ...(Platform.OS === 'web'
      ? { zIndex: 12 }
      : {}),
  },
  fabOpen: {
    backgroundColor: '#1c1c1e',
  },
  fabActionRow: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    ...(Platform.OS === 'web' ? { zIndex: 11 } : {}),
  },
  fabActionLabel: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  fabActionLabelText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1c1c1e',
  },
  fabMini: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#007AFF',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  fabMiniDisabled: {
    backgroundColor: '#b0b7c3',
    shadowOpacity: 0,
  },
  disabledFab: {
    backgroundColor: '#ccc',
  },
  roleBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fff',
  },
  callTypeIcon: {
    position: 'absolute',
    bottom: 0,
    right: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  creatorBadge: {
    backgroundColor: '#FFD700',
  },
  adminBadge: {
    backgroundColor: '#007AFF',
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  offlineNotice: {
    backgroundColor: '#FFA500',
    padding: 8,
    alignItems: 'center',
  },
  offlineNoticeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  staleNotice: {
    backgroundColor: '#f0f7ff',
    padding: 8,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  staleNoticeText: {
    color: '#007AFF',
    fontSize: 12,
  },
  offlineIndicator: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 12,
  },
  offlineText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
});