import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useReelComments } from '../../hooks/useReelComments';
import type { ReelCommentDTO } from '../../lib/api';

interface Props {
  reelId: string;
  onClose: () => void;
  onCommentAdded?: () => void;
  onCommentRemoved?: () => void;
}

function timeAgo(iso: string): string {
  const created = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - created);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(created).toLocaleDateString();
}

function authorName(c: ReelCommentDTO): string {
  return c.author?.display_name?.trim() || c.author?.email?.split('@')[0] || 'unknown';
}

type CommentRow =
  | { kind: 'comment'; comment: ReelCommentDTO }
  | { kind: 'reply'; comment: ReelCommentDTO; parent: ReelCommentDTO };

export default function ReelCommentSheet({
  reelId,
  onClose,
  onCommentAdded,
  onCommentRemoved,
}: Props) {
  const {
    comments,
    loading,
    loadingMore,
    hasMore,
    error,
    postError,
    posting,
    post,
    remove,
    loadMore,
  } = useReelComments(reelId);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ReelCommentDTO | null>(null);

  const rows = useMemo(() => {
    const byId = new Map(comments.map((c) => [c.id, c]));
    const topLevel = comments.filter((c) => !c.parent_id);
    const result: CommentRow[] = [];
    for (const parent of topLevel) {
      result.push({ kind: 'comment', comment: parent });
      const replies = comments
        .filter((c) => c.parent_id === parent.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      for (const reply of replies) {
        result.push({ kind: 'reply', comment: reply, parent });
      }
    }
    for (const orphan of comments.filter((c) => c.parent_id && !byId.has(c.parent_id))) {
      result.push({ kind: 'comment', comment: orphan });
    }
    return result;
  }, [comments]);

  const send = async () => {
    if (!text.trim()) return;
    const { comment, error: postErr } = await post(text, replyTo?.id);
    if (comment) {
      setText('');
      setReplyTo(null);
      onCommentAdded?.();
    } else {
      Alert.alert(
        'Could not post comment',
        postErr ??
          'Replies require database migration 020_reel_comment_replies.sql on Supabase.'
      );
    }
  };

  const askDelete = (commentId: string) => {
    Alert.alert('Delete comment?', '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await remove(commentId);
          onCommentRemoved?.();
        },
      },
    ]);
  };

  const renderRow = ({ item }: { item: CommentRow }) => {
    const c = item.comment;
    const avatar = c.author?.avatar_url;
    const name = authorName(c);
    const isReply = item.kind === 'reply';

    return (
      <TouchableOpacity onLongPress={() => askDelete(c.id)} delayLongPress={500} activeOpacity={0.85}>
        <View style={[styles.commentItem, isReply && styles.replyItem]}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={[styles.commentAvatar, isReply && styles.replyAvatar]} />
          ) : (
            <View style={[styles.commentAvatar, styles.avatarFallback, isReply && styles.replyAvatar]}>
              <Text style={styles.avatarFallbackText}>{name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.commentContent}>
            <View style={styles.commentHeader}>
              <Text style={styles.commentUser}>@{name}</Text>
              <Text style={styles.commentTime}>{timeAgo(c.created_at)}</Text>
            </View>
            {isReply && (
              <Text style={styles.replyTo}>Replying to @{authorName(item.parent)}</Text>
            )}
            <Text style={styles.commentText}>{c.content}</Text>
            {!isReply && (
              <TouchableOpacity onPress={() => setReplyTo(c)} style={styles.replyBtn}>
                <Text style={styles.replyBtnText}>Reply</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.handle} />
      <View style={styles.header}>
        <Text style={styles.title}>
          Comments {comments.length ? `(${comments.length}${hasMore ? '+' : ''})` : ''}
        </Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : error && comments.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="chatbubble-ellipses-outline" size={40} color="#666" />
          <Text style={styles.emptyText}>Be the first to comment</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.comment.id}
          renderItem={renderRow}
          style={styles.commentList}
          contentContainerStyle={{ paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
          onEndReached={() => {
            if (hasMore && !loadingMore) loadMore();
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <View style={{ paddingVertical: 16 }}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : null
          }
        />
      )}

      {postError ? (
        <Text style={styles.postErrorText}>{postError}</Text>
      ) : null}

      {replyTo && (
        <View style={styles.replyBanner}>
          <Text style={styles.replyBannerText} numberOfLines={1}>
            Replying to @{authorName(replyTo)}
          </Text>
          <TouchableOpacity onPress={() => setReplyTo(null)}>
            <Ionicons name="close" size={18} color="#aaa" />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
          placeholderTextColor="#888"
          value={text}
          onChangeText={setText}
          editable={!posting}
          maxLength={1000}
          multiline
        />
        <TouchableOpacity onPress={send} disabled={!text.trim() || posting}>
          <Text style={[styles.sendText, (!text.trim() || posting) && styles.sendTextDisabled]}>
            {posting ? '...' : 'Post'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#444',
    alignSelf: 'center',
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 0.5,
    borderColor: '#333',
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '600' },
  commentList: { flex: 1, paddingHorizontal: 16 },
  commentItem: { flexDirection: 'row', marginVertical: 12 },
  replyItem: { marginLeft: 28, marginVertical: 6 },
  commentAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 12 },
  replyAvatar: { width: 28, height: 28, borderRadius: 14 },
  avatarFallback: { backgroundColor: '#1976d2', justifyContent: 'center', alignItems: 'center' },
  avatarFallbackText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  commentContent: { flex: 1 },
  commentHeader: { flexDirection: 'row', alignItems: 'center' },
  commentUser: { color: '#fff', fontWeight: '600', fontSize: 14 },
  commentTime: { color: '#888', fontSize: 12, marginLeft: 8 },
  replyTo: { color: '#888', fontSize: 11, marginTop: 2 },
  commentText: { color: '#fff', marginTop: 4, lineHeight: 18 },
  replyBtn: { marginTop: 6 },
  replyBtnText: { color: '#9eb4c7', fontSize: 12, fontWeight: '600' },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1a1a1a',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#333',
  },
  replyBannerText: { color: '#aaa', flex: 1, marginRight: 8, fontSize: 13 },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 0.5,
    borderColor: '#333',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    backgroundColor: '#222',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    borderRadius: 20,
    fontSize: 15,
    maxHeight: 120,
  },
  sendText: { color: '#1e90ff', fontWeight: '600', marginLeft: 12, paddingVertical: 10 },
  sendTextDisabled: { color: '#666' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#aaa', marginTop: 12 },
  errorText: { color: '#ff6b6b', marginHorizontal: 24, textAlign: 'center' },
  postErrorText: {
    color: '#ff6b6b',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
});
