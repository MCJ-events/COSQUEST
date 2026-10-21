import { CreatePost } from "@/components/community/feed/CreatePost";
import { FeedEmptyState } from "@/components/community/feed/FeedEmptyState";
import { FeedRowContext, setVisiblePosts } from "@/components/community/feed/feedVisibility";
import { PostCard } from "@/components/community/feed/PostCard";
import { type ReactElement, useCallback, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
  type ViewToken,
} from "react-native";

import { useAppDispatch, useAppSelector } from "@/store/hooks";

import { fetchMorePosts, fetchPosts } from "@/store/thunks/postThunks";
import { perfMarkOnce, useRenderCount } from "@/utils/perfMarks";
import { C } from "@/theme/tokens";

// Facebook-style feed: every post is full width. (The Community screen no
// longer adds side padding around the feed — see app/(tabs)/community.tsx.)
//
// Audit B2: the feed is its own virtualised list (it was every post inside
// the screen's ScrollView), the next page loads as you near the end, only
// the videos on screen play (feedVisibility.ts), and the "5 mins ago" labels
// tick on their own instead of re-rendering the whole feed every 30 s.
export function Feeds({
  header,
  contentContainerStyle,
}: {
  /** What scrolls above the feed (the Community header and tabs). */
  header?: ReactElement;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const dispatch = useAppDispatch();

  const posts = useAppSelector((state) => state.post.posts);

  const loading = useAppSelector((state) => state.post.loading);

  const error = useAppSelector((state) => state.post.error);

  const page = useAppSelector((state) => state.post.page);
  const hasMore = useAppSelector((state) => state.post.hasMore);
  const loadingMore = useAppSelector((state) => state.post.loadingMore);

  const token = useAppSelector((state) => state.auth.token);
  useRenderCount("Feeds");

  // The first usable screen after a cold start (test builds only).
  const feedShown = posts.length > 0;
  useEffect(() => {
    if (feedShown) perfMarkOnce("interactive");
  }, [feedShown]);

  const loadPosts = useCallback(() => {
    if (!token) {
      return;
    }

    dispatch(fetchPosts(token));
  }, [dispatch, token]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  // FlatList calls onEndReached as soon as what it has rendered is short
  // (4 cards at first), which fetched pages 2 and 3 straight after opening.
  // The next page waits until the person has scrolled.
  const scrolled = useRef(false);
  const onScrollBeginDrag = useCallback(() => {
    scrolled.current = true;
  }, []);
  const loadMore = useCallback(() => {
    if (!scrolled.current || !token || !hasMore || loading || loadingMore || posts.length === 0) return;
    dispatch(fetchMorePosts({ token, page: page + 1 }));
  }, [dispatch, token, hasMore, loading, loadingMore, posts.length, page]);

  // Videos play only while at least half of their post is on screen.
  const viewability = useRef({ itemVisiblePercentThreshold: 50 }).current;
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    setVisiblePosts(viewableItems.filter((v) => v.isViewable).map((v) => String(v.key)));
  }).current;
  useEffect(() => () => setVisiblePosts([]), []);

  const renderPost = useCallback(
    ({ item }: { item: (typeof posts)[number] }) => (
      <FeedRowContext.Provider value={String(item.id)}>
        <PostCard post={item} token={token ?? ""} />
      </FeedRowContext.Provider>
    ),
    [token],
  );

  let state: ReactElement | null = null;
  if (!token) {
    state = (
      <View style={styles.centerState}>
        <Text style={styles.stateText}>
          Please sign in to view the community feed.
        </Text>
      </View>
    );
  } else if (loading && posts.length === 0) {
    state = (
      <View style={styles.centerState}>
        <ActivityIndicator size="large" color={C.brand} />

        <Text style={styles.stateText}>Loading community feed...</Text>
      </View>
    );
  } else if (error && posts.length === 0) {
    state = (
      <View style={styles.centerState}>
        <Text style={styles.stateText}>{error}</Text>

        <Pressable style={styles.retryButton} onPress={loadPosts}>
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={state ? [] : posts}
      keyExtractor={(post) => String(post.id)}
      renderItem={renderPost}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator={false}
      onEndReached={loadMore}
      onEndReachedThreshold={1.5}
      onScrollBeginDrag={onScrollBeginDrag}
      viewabilityConfig={viewability}
      onViewableItemsChanged={onViewable}
      // A 3-screen window. (A 21-screen one, tried to keep cards from being
      // built mid-fling, kept off-screen cards mounted; on the polish run
      // Android then moved the keyboard's focus onto one of them and the app
      // crashed leaving at the largest display size. Reverted.)
      initialNumToRender={4}
      maxToRenderPerBatch={4}
      windowSize={7}
      ListHeaderComponent={
        <>
          {header}
          {state ?? (
            <View style={styles.feed}>
              <CreatePost />

              {loading && posts.length > 0 ? (
                <View style={styles.refreshing}>
                  <ActivityIndicator size="small" color={C.brand} />
                </View>
              ) : null}
            </View>
          )}
        </>
      }
      ListEmptyComponent={
        state ? null : (
          <View style={styles.padded}>
            <FeedEmptyState />
          </View>
        )
      }
      ListFooterComponent={
        loadingMore ? (
          <View style={styles.refreshing}>
            <ActivityIndicator size="small" color={C.brand} />
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  feed: {
    width: "100%",
  },

  padded: {
    paddingHorizontal: 20,
  },

  centerState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 50,
    paddingHorizontal: 20,
  },

  stateText: {
    marginTop: 12,
    fontSize: 14,
    color: C.grey3,
    textAlign: "center",
  },

  retryButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: C.brand,
  },

  retryText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },

  refreshing: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 5,
  },
});
