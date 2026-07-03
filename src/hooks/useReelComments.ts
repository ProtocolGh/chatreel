import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type ReelCommentDTO } from '../lib/api';
import { useRealtimeTopic } from './useRealtimeTopic';

type State = {
  comments: ReelCommentDTO[];
  loading: boolean;
  loadingMore: boolean;
  cursor: string | null;
  hasMore: boolean;
  error: string | null;
  postError: string | null;
  posting: boolean;
};

const PAGE_SIZE = 30;

export function useReelComments(reelId: string | null) {
  const [state, setState] = useState<State>({
    comments: [],
    loading: false,
    loadingMore: false,
    cursor: null,
    hasMore: false,
    error: null,
    postError: null,
    posting: false,
  });

  const load = useCallback(async (showSpinner = true) => {
    if (!reelId) return;
    if (showSpinner) {
      setState((s) => ({ ...s, loading: true, error: null }));
    }
    try {
      const { comments, next_cursor } = await api.reels.comments(reelId, { limit: PAGE_SIZE });
      setState({
        comments,
        loading: false,
        loadingMore: false,
        cursor: next_cursor,
        hasMore: Boolean(next_cursor),
        error: null,
        postError: null,
        posting: false,
      });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : (err as Error).message ?? 'Failed to load';
      setState((s) => ({ ...s, loading: false, error: message }));
    }
  }, [reelId]);

  const loadMore = useCallback(async () => {
    if (!reelId) return;
    setState((s) => {
      if (s.loadingMore || !s.hasMore || !s.cursor) return s;
      return { ...s, loadingMore: true };
    });
    try {
      const cursor = state.cursor;
      if (!cursor) return;
      const { comments: more, next_cursor } = await api.reels.comments(reelId, {
        cursor,
        limit: PAGE_SIZE,
      });
      setState((s) => {
        const seen = new Set(s.comments.map((c) => c.id));
        return {
          ...s,
          comments: [...s.comments, ...more.filter((c) => !seen.has(c.id))],
          loadingMore: false,
          cursor: next_cursor,
          hasMore: Boolean(next_cursor),
        };
      });
    } catch {
      setState((s) => ({ ...s, loadingMore: false }));
    }
  }, [reelId, state.cursor]);

  const post = useCallback(
    async (content: string, parentId?: string) => {
      if (!reelId || !content.trim()) return { comment: null as ReelCommentDTO | null, error: null as string | null };
      setState((s) => ({ ...s, posting: true, postError: null }));
      try {
        const { comment } = await api.reels.postComment(reelId, content.trim(), parentId);
        setState((s) => ({
          ...s,
          comments: parentId
            ? [...s.comments, comment]
            : [comment, ...s.comments.filter((c) => c.id !== comment.id)],
          posting: false,
          postError: null,
        }));
        return { comment, error: null };
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Failed to post comment';
        setState((s) => ({
          ...s,
          posting: false,
          postError: message,
        }));
        return { comment: null, error: message };
      }
    },
    [reelId]
  );

  const remove = useCallback(
    async (commentId: string) => {
      const prev = state.comments;
      setState((s) => ({ ...s, comments: s.comments.filter((c) => c.id !== commentId) }));
      try {
        await api.reels.deleteComment(commentId);
      } catch {
        // restore on failure
        setState((s) => ({ ...s, comments: prev }));
      }
    },
    [state.comments]
  );

  useEffect(() => {
    if (reelId) void load(true);
    else setState((s) => ({ ...s, comments: [], cursor: null, hasMore: false }));
  }, [reelId, load]);

  // Realtime: silently sync comments without flashing loading spinner.
  useRealtimeTopic('reelComments', () => void load(false), Boolean(reelId));

  return { ...state, reload: load, loadMore, post, remove };
}
