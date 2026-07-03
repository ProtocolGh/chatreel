// src/navigation/AppNavigator.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View, StatusBar, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFocusedRouteName, MOBILE_BREAKPOINT } from './navigationUtils';
import {
  registerDesktopChatOpener,
  unregisterDesktopChatOpener,
  type OpenChatParams,
} from './chatNavigationBridge';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

// === SCREENS ===
import ChatListScreen from '../screens/Chat/ChatListScreen';
import ChatRoomScreen from '../screens/Chat/ChatRoomScreen';
import EmptyChatScreen from '../screens/Chat/EmptyChatScreen';
import ProfileScreen from '../screens/Profile/ProfileScreen';
import ContactScreen from '../screens/Chat/ContactScreen';
import ExploreNavigator from './ExploreNavigator';
import CallsScreen from '../screens/Call/CallsScreen';
import ActiveCallScreen from '../screens/Call/ActiveCallScreen';
import OutgoingCallScreen from '../screens/Call/OutgoingCallScreen';
import ReelsNavigator from './ReelsNavigator';
import { WebMainPanel, WebReelsSidebarPlaceholder } from './WebMainPanel';
import PostReelScreen from '../screens/Reel/PostReelScreen';
import ReelPreviewScreen from '../screens/Reel/ReelPreviewScreen';
import NewGroupScreen from '../screens/Group/NewGroupScreen';
import ChatSettingsScreen from '../screens/Chat/ChatSettingsScreen';
import QRCodeScreen from '../screens/QR/QRCodeScreen';
import QRScannerScreen from '../screens/QR/QRScannerScreen';
import AddFriendScreen from '../screens/Friends/AddFriendScreen';
import FriendRequestsScreen from '../screens/Chat/FriendRequestsScreen';
import FriendsListScreen from '../screens/Friends/FriendsListScreen';
import InviteScreen from '../screens/Group/InviteScreen';
import GroupInfoScreen from '../screens/Group/GroupInfoScreen';
import JoinGroupScreen from '../screens/Group/JoinGroupScreen';
import { IncomingCallOverlay } from '../components/IncomingCallOverlay';

// === NAVIGATORS ===
const Tab = createMaterialTopTabNavigator();
const Stack = createNativeStackNavigator();

/* ------------------------------------------------------------------
 *  Web-only wrapper – shows the selected chat on the right panel
 * ------------------------------------------------------------------ */
const WebChatPanel = ({ selectedChat }: { selectedChat?: any }) => (
  <WebMainPanel selectedChat={selectedChat ?? null} />
);

type ChatStackProps = {
  /** Web split layout: chat room renders in the main panel, not in this stack. */
  setSelectedChat?: (chat: unknown) => void;
};

/* ------------------------------------------------------------------
 *  Unified Chat Stack (mobile + web sidebar)
 * ------------------------------------------------------------------ */
const ChatStack = ({ setSelectedChat }: ChatStackProps) => {
  return (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="ChatList">
      {(props) => <ChatListScreen {...props} setSelectedChat={setSelectedChat} />}
    </Stack.Screen>
    {!setSelectedChat && <Stack.Screen name="ChatRoom" component={ChatRoomScreen} />}
    {!setSelectedChat && <Stack.Screen name="EmptyChat" component={EmptyChatScreen} />}
    <Stack.Screen name="Profile" component={ProfileScreen} />
    <Stack.Screen name="Settings" component={ChatSettingsScreen} />
    <Stack.Screen name="Contact" component={ContactScreen} />
    <Stack.Screen name="NewGroup" component={NewGroupScreen} />
    <Stack.Screen name="QRCode" component={QRCodeScreen} />
    <Stack.Screen name="QRScanner" component={QRScannerScreen} />
    <Stack.Screen name="AddFriend" component={AddFriendScreen} />
    <Stack.Screen name="FriendRequests" component={FriendRequestsScreen} />
    <Stack.Screen name="FriendsList">
      {(props) => <FriendsListScreen {...props} setSelectedChat={setSelectedChat} />}
    </Stack.Screen>
    <Stack.Screen name="GroupInfo" component={GroupInfoScreen} />
    <Stack.Screen
      name="JoinGroup"
      component={JoinGroupScreen}
      options={{ title: 'Join Group', headerShown: true }}
    />
  </Stack.Navigator>
  );
};

/* ------------------------------------------------------------------
 *  Reels Wrapper Component - Prevents auto-initialization
 * ------------------------------------------------------------------ */
const ReelsWrapper = ({ navigation }: { navigation: any }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Handle focus events to initialize only when tab is focused
  React.useEffect(() => {
    const unsubscribeFocus = navigation.addListener('focus', () => {
      setIsFocused(true);
      if (!isInitialized) {
        setIsInitialized(true);
      }
    });

    const unsubscribeBlur = navigation.addListener('blur', () => {
      setIsFocused(false);
    });

    return () => {
      unsubscribeFocus();
      unsubscribeBlur();
    };
  }, [navigation, isInitialized]);

  // Keep navigator mounted once initialized (avoids duplicate registration on tab blur).
  if (!isInitialized) {
    return (
      <View style={styles.reelsPlaceholder}>
        {/* Loading placeholder */}
      </View>
    );
  }

  return <ReelsNavigator key="mobile-reels" />;
};

/* ------------------------------------------------------------------
 *  Main Tab Navigator (Separate component)
 * ------------------------------------------------------------------ */
const MainTabNavigator = () => {
  const insets = useSafeAreaInsets();
  const tabBarBase = useMemo(
    () => ({
      ...styles.tabBarMobile,
      height: 56 + insets.bottom,
      paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 8 : 0),
    }),
    [insets.bottom]
  );

  return (
    <Tab.Navigator
      initialRouteName="Chats"
      tabBarPosition="bottom"
      screenOptions={{
        tabBarShowLabel: true,
        tabBarActiveTintColor: '#1e73ceff',
        tabBarInactiveTintColor: '#000000ff',
        tabBarStyle: tabBarBase,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
        tabBarItemStyle: { paddingVertical: 4 },
        lazy: true,
        lazyPreloadDistance: 0,
        swipeEnabled: false,
        tabBarPressColor: 'transparent',
        tabBarIndicatorStyle: { display: 'none' },
      }}
    >
      {/* CHATS TAB */}
      <Tab.Screen
        name="Chats"
        component={ChatStack}
        options={({ navigation }) => {
          const tabState = navigation.getState();
          const currentTab = tabState.routes[tabState.index]?.name;
          const chatsRoute = tabState.routes.find((r) => r.name === 'Chats');
          const stackScreen = getFocusedRouteName(
            chatsRoute?.state as Parameters<typeof getFocusedRouteName>[0]
          );
          const hideTabBar =
            currentTab === 'Chats' && !!stackScreen && stackScreen !== 'ChatList';

          return {
            lazy: false,
            tabBarStyle: hideTabBar ? { display: 'none' } : tabBarBase,
            tabBarIcon: ({ color }) => (
              <Ionicons name="chatbubble-outline" size={20} color={color} />
            ),
          };
        }}
      />

      {/* EXPLORE TAB */}
      <Tab.Screen
        name="Explore"
        component={ExploreNavigator}
        options={{
          tabBarIcon: ({ color }) => (
            <Ionicons name="compass-outline" size={22} color={color} />
          ),
        }}
      />

      {/* CALLS TAB */}
      <Tab.Screen
        name="Calls"
        component={CallsScreen}
        options={{
          tabBarIcon: ({ color }) => (
            <Ionicons name="call-outline" size={22} color={color} />
          ),
        }}
      />

      {/* REELS TAB */}
      <Tab.Screen
        name="Reels"
        component={ReelsWrapper}
        options={{
          tabBarStyle: { display: 'none' },
          tabBarIcon: ({ color }) => (
            <Ionicons name="play-circle-outline" size={22} color={color} />
          ),
          lazy: true,
        }}
      />
    </Tab.Navigator>
  );
};

/* ------------------------------------------------------------------
 *  Web desktop: sidebar + chat panel (no call screens here — those live
 *  on the root stack so navigation works from nested chat trees).
 * ------------------------------------------------------------------ */
const WebDesktopMain = () => {
  const [selectedChat, setSelectedChat] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('Chats');

  const openDesktopChat = useCallback((params: OpenChatParams) => {
    setActiveTab('Chats');
    setSelectedChat(params);
  }, []);

  useLayoutEffect(() => {
    registerDesktopChatOpener(openDesktopChat);
    return () => unregisterDesktopChatOpener();
  }, [openDesktopChat]);

  return (
    <View style={styles.webContainer}>
      <View style={styles.sidebar}>
        <Tab.Navigator
          initialRouteName="Chats"
          tabBarPosition="bottom"
          screenListeners={{
            state: (e) => {
              const state = e.data.state;
              if (!state?.routes?.length) return;
              const name = state.routes[state.index]?.name;
              if (name) setActiveTab(name);
            },
          }}
          screenOptions={{
            tabBarShowLabel: true,
            tabBarActiveTintColor: '#007AFF',
            tabBarInactiveTintColor: '#999',
            tabBarStyle: styles.webTabBar,
            tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
            lazy: true,
            lazyPreloadDistance: 0,
          }}
        >
          <Tab.Screen name="Chats" listeners={{ focus: () => setSelectedChat(null) }}>
            {() => <ChatStack setSelectedChat={setSelectedChat} />}
          </Tab.Screen>
          <Tab.Screen name="Explore" component={ExploreNavigator} />
          <Tab.Screen name="Calls" component={CallsScreen} />
          <Tab.Screen name="Reels" component={WebReelsSidebarPlaceholder} />
        </Tab.Navigator>
      </View>
      <View style={styles.mainPanel}>
        {activeTab === 'Reels' ? (
          <ReelsNavigator key="web-desktop-reels" />
        ) : (
          <WebChatPanel selectedChat={selectedChat} />
        )}
      </View>
    </View>
  );
};

/* ------------------------------------------------------------------
 *  Root stack: Main UI + full-screen call flows (all platforms).
 * ------------------------------------------------------------------ */
type LayoutMode = 'mobile' | 'desktop';

function MainShell() {
  const { width } = useWindowDimensions();
  const targetLayout: LayoutMode =
    Platform.OS === 'web' && width >= MOBILE_BREAKPOINT ? 'desktop' : 'mobile';
  const [activeLayout, setActiveLayout] = useState<LayoutMode | null>(targetLayout);

  useEffect(() => {
    if (activeLayout === targetLayout) return;
    setActiveLayout(null);
    const timer = setTimeout(() => setActiveLayout(targetLayout), 0);
    return () => clearTimeout(timer);
  }, [targetLayout, activeLayout]);

  if (!activeLayout) {
    return <View style={styles.layoutSwapPlaceholder} />;
  }

  return activeLayout === 'desktop' ? (
    <WebDesktopMain key="web-desktop-main" />
  ) : (
    <MainTabNavigator key="mobile-main" />
  );
}

export const AppNavigator = () => {
  const { width } = useWindowDimensions();
  const isWebDesktop = Platform.OS === 'web' && width >= MOBILE_BREAKPOINT;

  return (
    <SafeAreaView
      style={isWebDesktop ? styles.webSafeArea : styles.safeArea}
      edges={isWebDesktop ? undefined : ['top', 'left', 'right']}
    >
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <View style={styles.appShell}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#fff' },
          }}
        >
          <Stack.Screen name="Main" component={MainShell} />
          <Stack.Screen
            name="Invite"
            component={InviteScreen}
            options={{
              headerShown: true,
              title: 'Group Invite',
              presentation: 'modal',
            }}
          />
          <Stack.Screen
            name="PostReel"
            component={PostReelScreen}
            options={{
              headerShown: false,
              presentation: 'modal',
              contentStyle: { backgroundColor: '#000' },
            }}
          />
          <Stack.Screen
            name="ReelPreview"
            component={ReelPreviewScreen}
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
              contentStyle: { backgroundColor: '#000' },
            }}
          />
          <Stack.Screen
            name="OutgoingCall"
            component={OutgoingCallScreen}
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
              contentStyle: { backgroundColor: '#000' },
            }}
          />
          <Stack.Screen
            name="ActiveCall"
            component={ActiveCallScreen}
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
              contentStyle: { backgroundColor: '#000' },
            }}
          />
        </Stack.Navigator>
        <View style={styles.incomingCallHost} pointerEvents="box-none">
          <IncomingCallOverlay />
        </View>
      </View>
    </SafeAreaView>
  );
};

/* ============================= STYLES ============================= */
const styles = StyleSheet.create({
  // Web styles
  webSafeArea: { 
    flex: 1, 
    backgroundColor: '#f0f2f5' 
  },
  webContainer: { 
    flex: 1, 
    flexDirection: 'row' 
  },
  sidebar: {
    width: 320,
    backgroundColor: '#fff',
    borderRightWidth: 1,
    borderColor: '#ddd',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
  },
  webTabBar: {
    backgroundColor: '#fff',
    borderTopWidth: 0.5,
    borderColor: '#eee',
    height: 60,
  },
  mainPanel: { 
    flex: 1, 
    backgroundColor: '#fafafa' 
  },

  // Mobile styles
  safeArea: { 
    flex: 1, 
    backgroundColor: '#fff'
  },
  appShell: {
    flex: 1,
  },
  incomingCallHost: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  tabBarMobile: {
    backgroundColor: '#fff',
    borderTopWidth: 0.5,
    borderColor: '#eee',
    minHeight: 56,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  reelsPlaceholder: {
    flex: 1,
    backgroundColor: '#000',
  },
  layoutSwapPlaceholder: {
    flex: 1,
    backgroundColor: '#fff',
  },
});