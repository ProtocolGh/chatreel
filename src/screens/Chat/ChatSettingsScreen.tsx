import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { chatThemePresets, type ChatThemeId } from '../../lib/chatThemes';
import { useChatSettings } from '../../context/ChatSettingsContext';

function SettingRow({
  label,
  subtitle,
  value,
  onValueChange,
}: {
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

export default function ChatSettingsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { settings, theme, updateSettings } = useChatSettings();

  const themeIds = Object.keys(chatThemePresets) as ChatThemeId[];

  return (
    <View style={[styles.container, { backgroundColor: theme.listBg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: theme.headerBg }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.headerText} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.headerText }]}>Settings</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>Theme</Text>
        <View style={styles.card}>
          {themeIds.map((id) => {
            const preset = chatThemePresets[id];
            const active = settings.themeId === id;
            return (
              <TouchableOpacity
                key={id}
                style={[styles.themeRow, active && { borderColor: preset.primary, borderWidth: 2 }]}
                onPress={() => void updateSettings({ themeId: id })}
              >
                <View style={[styles.themeSwatch, { backgroundColor: preset.headerBg }]} />
                <Text style={styles.themeLabel}>{preset.label}</Text>
                {active ? <Ionicons name="checkmark-circle" size={20} color={preset.primary} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.section}>Notifications</Text>
        <View style={styles.card}>
          <SettingRow
            label="Push notifications"
            subtitle="New messages and friend requests"
            value={settings.pushNotifications}
            onValueChange={(v) => void updateSettings({ pushNotifications: v })}
          />
          <SettingRow
            label="Message sounds"
            value={settings.messageSounds}
            onValueChange={(v) => void updateSettings({ messageSounds: v })}
          />
        </View>

        <Text style={styles.section}>Privacy</Text>
        <View style={styles.card}>
          <SettingRow
            label="Read receipts"
            subtitle="Let others see when you've read messages"
            value={settings.readReceipts}
            onValueChange={(v) => void updateSettings({ readReceipts: v })}
          />
          <SettingRow
            label="Show last seen"
            value={settings.showLastSeen}
            onValueChange={(v) => void updateSettings({ showLastSeen: v })}
          />
        </View>

        <Text style={styles.section}>Chats</Text>
        <View style={styles.card}>
          <SettingRow
            label="Media auto-download"
            subtitle="Download photos and videos on Wi-Fi"
            value={settings.mediaAutoDownload}
            onValueChange={(v) => void updateSettings({ mediaAutoDownload: v })}
          />
          <SettingRow
            label="Enter to send"
            subtitle="Press Enter to send (web)"
            value={settings.enterToSend}
            onValueChange={(v) => void updateSettings({ enterToSend: v })}
          />
          <SettingRow
            label="Compact chat list"
            value={settings.compactChatList}
            onValueChange={(v) => void updateSettings({ compactChatList: v })}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 40 },
  section: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 8,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  rowText: { flex: 1, paddingRight: 12 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: '#111' },
  rowSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    borderRadius: 8,
    marginHorizontal: 8,
    marginVertical: 4,
  },
  themeSwatch: { width: 28, height: 28, borderRadius: 14, marginRight: 12 },
  themeLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: '#111' },
});
