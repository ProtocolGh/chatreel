/** Chat list / room colour presets. */
export type ChatThemeId = 'blue' | 'dark' | 'teal' | 'classic';

export type ChatThemeTokens = {
  id: ChatThemeId;
  label: string;
  headerBg: string;
  headerText: string;
  chatBg: string;
  listBg: string;
  primary: string;
  accent: string;
  tabActive: string;
  outgoingBubble: string;
  incomingBubble: string;
};

export const chatThemePresets: Record<ChatThemeId, ChatThemeTokens> = {
  blue: {
    id: 'blue',
    label: 'ChatReel Blue',
    headerBg: '#007AFF',
    headerText: '#FFFFFF',
    chatBg: '#f0f0f0',
    listBg: '#FFFFFF',
    primary: '#007AFF',
    accent: '#1c6dfd',
    tabActive: '#007AFF',
    outgoingBubble: '#007AFF',
    incomingBubble: '#FFFFFF',
  },
  dark: {
    id: 'dark',
    label: 'Dark',
    headerBg: '#1a1a1a',
    headerText: '#FFFFFF',
    chatBg: '#0f0f0f',
    listBg: '#121212',
    primary: '#60a5fa',
    accent: '#3b82f6',
    tabActive: '#60a5fa',
    outgoingBubble: '#2563eb',
    incomingBubble: '#262626',
  },
  teal: {
    id: 'teal',
    label: 'Teal',
    headerBg: '#0d9488',
    headerText: '#FFFFFF',
    chatBg: '#ecfdf5',
    listBg: '#FFFFFF',
    primary: '#0d9488',
    accent: '#14b8a6',
    tabActive: '#0d9488',
    outgoingBubble: '#0d9488',
    incomingBubble: '#FFFFFF',
  },
  classic: {
    id: 'classic',
    label: 'Classic Green',
    headerBg: '#075E54',
    headerText: '#FFFFFF',
    chatBg: '#ECE5DD',
    listBg: '#FFFFFF',
    primary: '#128C7E',
    accent: '#25D366',
    tabActive: '#128C7E',
    outgoingBubble: '#DCF8C6',
    incomingBubble: '#FFFFFF',
  },
};
