// Follows (fast, idempotent, "do I follow them"), 2,000-character thoughts,
// and post notifications: likes, comments and replies, reposts, and new
// posts/reposts by people you follow.
const User = require('../src/models/User');
const Notification = require('../src/models/Notification');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)); }
  }
  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json().catch(() => null) };
  }
  // Notifications are sent after the response: wait for them.
  async function notes(user, filter, expect = 1) {
    let found = [];
    for (let i = 0; i < 40; i++) {
      found = await Notification.find({ user: user.id, ...filter }).lean();
      if (found.length >= expect) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return found;
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const people = await Promise.all(['Author', 'Bea', 'Cal', 'Dee', 'Eve'].map((name, i) => User.create({
    profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'Social', avatarKey: 'green-knight' },
    onboardingComplete: true, faction: 'ascendants',
  })));
  const [author, bea, cal, dee, eve] = people.map((user) => ({ id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion) }));

  console.log('\n--- follows ---');
  const followed = await request('POST', `/api/users/${author.username}/follow`, cal.token);
  check(followed.status === 201 && followed.data.following === true && followed.data.followerCount === 1 && followed.data.followingCount === 1, 'follow answers with the new counts at once', followed.data);
  const again = await request('POST', `/api/users/${author.username}/follow`, cal.token);
  check(again.status === 200 && again.data.following === true && again.data.followerCount === 1, 'following again is not an error (double tap)', again);
  const asCal = await request('GET', `/api/users/${author.username}/profile`, cal.token);
  check(asCal.data.profile.relationship?.following === true && asCal.data.profile.relationship.followedBy === false, 'the profile says you follow them (and whether they follow you)', asCal.data.profile.relationship);
  check((await request('GET', `/api/users/${author.username}/profile`, author.token)).data.profile.relationship === null, 'no relationship on your own profile');
  check((await request('GET', `/api/users/${author.username}/profile`)).data.profile.relationship === null, 'no relationship when signed out');
  const list = await request('GET', `/api/users/${author.username}/followers`, bea.token);
  check(list.data.users?.[0]?.id === cal.id && list.data.users[0].relationship?.following === false, 'follower lists say whether you follow each person', list.data.users);
  const followNotes = await notes(author, { type: 'follow', actor: cal.id });
  const unfollowed = await request('DELETE', `/api/users/${author.username}/follow`, cal.token);
  check(unfollowed.status === 200 && unfollowed.data.following === false && unfollowed.data.followerCount === 0, 'unfollow answers with the new counts', unfollowed.data);
  check((await request('DELETE', `/api/users/${author.username}/follow`, cal.token)).status === 200, 'unfollowing again is not an error');
  await request('POST', `/api/users/${author.username}/follow`, cal.token);
  await settle();
  check(followNotes.length === 1 && (await Notification.countDocuments({ user: author.id, type: 'follow', actor: cal.id })) === 1, 'follow, unfollow, follow notifies once', followNotes.length);

  console.log('\n--- 2,000-character thoughts ---');
  check((await request('POST', '/api/posts', author.token, { type: 'thought', content: 'x'.repeat(2000) })).status === 201, 'a thought can be 2,000 characters');
  const tooLong = await request('POST', '/api/posts', author.token, { type: 'thought', content: 'x'.repeat(2001) });
  check(tooLong.status === 400 && /2,000/.test(tooLong.data.error), '2,001 is too long', tooLong.data);
  const short = (await request('POST', '/api/posts', author.token, { type: 'thought', content: 'short' })).data.post;
  check((await request('PATCH', `/api/posts/${short.id}`, author.token, { content: 'y'.repeat(2000) })).status === 200, 'editing a thought to 2,000 characters works');

  console.log('\n--- new posts by people you follow ---');
  await request('POST', `/api/users/${bea.username}/follow`, cal.token);
  const post = (await request('POST', '/api/posts', author.token, { type: 'thought', content: 'Meet at the mural at 10' })).data.post;
  const postNotes = await notes(cal, { type: 'post', post: post.id });
  check(postNotes.length === 1 && postNotes[0].message.includes('posted a new thought') && String(postNotes[0].actor) === author.id, 'followers hear when someone they follow posts', postNotes);
  await settle();
  check((await Notification.countDocuments({ user: bea.id, type: 'post', post: post.id })) === 0, 'people who don\'t follow them don\'t');

  console.log('\n--- likes ---');
  await request('POST', `/api/posts/${post.id}/likes`, bea.token);
  const likeNotes = await notes(author, { type: 'like', post: post.id });
  check(likeNotes.length === 1 && likeNotes[0].message.includes('liked your post'), 'a like notifies the author', likeNotes);
  await request('DELETE', `/api/posts/${post.id}/likes`, bea.token);
  await request('POST', `/api/posts/${post.id}/likes`, bea.token);
  await request('POST', `/api/posts/${post.id}/likes`, author.token);
  await settle();
  check((await Notification.countDocuments({ user: author.id, type: 'like', post: post.id })) === 1, 'like, unlike, like notifies once; liking your own post never does');

  console.log('\n--- comments and replies ---');
  const comment = (await request('POST', `/api/posts/${post.id}/comments`, bea.token, { body: 'I will be there' })).data.comment;
  const commentNotes = await notes(author, { type: 'comment', post: post.id });
  check(commentNotes.length === 1 && commentNotes[0].message.includes('commented on your post: "I will be there"') && String(commentNotes[0].postComment) === comment.id, 'a comment notifies the author, with the comment', commentNotes);
  const reply = (await request('POST', `/api/posts/${post.id}/comments`, cal.token, { body: 'Same', parentComment: comment.id })).data.comment;
  const replyNotes = await notes(bea, { type: 'comment', postComment: reply.id });
  const authorOnReply = await notes(author, { type: 'comment', postComment: reply.id });
  check(replyNotes.length === 1 && replyNotes[0].message.includes('replied to your comment'), 'a reply notifies the person replied to', replyNotes);
  check(authorOnReply.length === 1 && authorOnReply[0].message.includes('commented on your post'), '...and the post\'s author', authorOnReply);
  const ownReply = (await request('POST', `/api/posts/${post.id}/comments`, author.token, { body: 'See you', parentComment: comment.id })).data.comment;
  await notes(bea, { type: 'comment', postComment: ownReply.id });
  await settle();
  check((await Notification.countDocuments({ user: author.id, postComment: ownReply.id })) === 0, 'replying on your own post doesn\'t notify you');
  await request('POST', `/api/posts/${post.id}/comments/${comment.id}/likes`, author.token);
  const commentLikeNotes = await notes(bea, { type: 'like', postComment: comment.id });
  check(commentLikeNotes.length === 1 && commentLikeNotes[0].message.includes('liked your comment'), 'a comment like notifies the commenter', commentLikeNotes);

  console.log('\n--- reposts ---');
  const repost = await request('POST', `/api/posts/${post.id}/share-to-feed`, bea.token, { content: 'Come along' });
  const repostNotes = await notes(author, { type: 'repost', post: post.id });
  check(repost.status === 201 && repostNotes.length === 1 && repostNotes[0].message.includes('reposted your post'), 'a repost notifies the original author', repostNotes);
  const followerRepost = await notes(cal, { type: 'post', post: repost.data.post.id });
  check(followerRepost.length === 1 && followerRepost[0].message.includes(`reposted ${author.username}'s post`), 'followers of the reposter hear about the repost', followerRepost);

  console.log('\n--- privacy and blocks ---');
  await request('POST', `/api/users/${dee.username}/follow`, cal.token);
  await request('PATCH', '/api/users/me/privacy', dee.token, { profileVisibility: 'private' });
  const privatePost = (await request('POST', '/api/posts', dee.token, { type: 'thought', content: 'Private' })).data.post;
  await request('POST', `/api/users/${eve.username}/follow`, cal.token);
  await request('POST', `/api/users/${eve.username}/follow`, bea.token);
  await request('POST', `/api/users/${bea.username}/follow`, eve.token);
  await request('PATCH', '/api/users/me/privacy', eve.token, { profileVisibility: 'friends' });
  const friendsPost = (await request('POST', '/api/posts', eve.token, { type: 'thought', content: 'Friends only' })).data.post;
  await notes(bea, { type: 'post', post: friendsPost.id });
  await settle();
  check((await Notification.countDocuments({ type: 'post', post: privatePost.id })) === 0, 'a private profile\'s posts notify nobody');
  check((await Notification.countDocuments({ user: bea.id, type: 'post', post: friendsPost.id })) === 1 && (await Notification.countDocuments({ user: cal.id, type: 'post', post: friendsPost.id })) === 0, 'a friends-only profile notifies mutual followers only');
  await request('POST', `/api/users/${dee.username}/block`, author.token);
  await request('POST', `/api/posts/${post.id}/likes`, dee.token);
  await settle();
  check((await Notification.countDocuments({ user: author.id, actor: dee.id })) === 0, 'nothing across a block');

  console.log('\n--- likes and bookmarks you can see ---');
  const twice = await request('POST', `/api/posts/${post.id}/likes`, bea.token);
  check(twice.status === 200 && twice.data.liked === true, 'liking again is not an error', twice);
  const saved = await request('POST', `/api/posts/${post.id}/bookmarks`, bea.token);
  const savedAgain = await request('POST', `/api/posts/${post.id}/bookmarks`, bea.token);
  check(saved.status === 201 && savedAgain.status === 200 && savedAgain.data.bookmarked === true && savedAgain.data.bookmarkCount === 1, 'bookmarking again is not an error', savedAgain.data);
  const seen = await request('GET', `/api/posts/${post.id}`, bea.token);
  check(JSON.stringify(seen.data.post.viewer) === JSON.stringify({ liked: true, bookmarked: true, reposted: true }), 'a post says whether you liked, bookmarked and reposted it', seen.data.post.viewer);
  check((await request('GET', `/api/posts/${post.id}`)).data.post.viewer === undefined, 'no viewer state when signed out');
  const feed = await request('GET', '/api/posts?limit=50', cal.token);
  check(feed.data.posts.find((p) => p.id === post.id)?.viewer?.liked === false, 'feeds carry it too');
  const mine = await request('GET', '/api/users/me/bookmarks', bea.token);
  check(mine.data.posts?.[0]?.id === post.id && mine.data.posts[0].viewer.bookmarked === true, 'bookmarks are stored and listed (GET /api/users/me/bookmarks)', mine.data);
  await request('DELETE', `/api/posts/${post.id}/bookmarks`, bea.token);
  check((await request('DELETE', `/api/posts/${post.id}/bookmarks`, bea.token)).status === 200 && (await request('GET', '/api/users/me/bookmarks', bea.token)).data.posts.length === 0, 'removing a bookmark (twice is fine)');

  console.log('\n--- the inbox ---');
  const inbox = await request('GET', '/api/users/me/notifications', author.token);
  const fromInbox = inbox.data.notifications?.find((n) => n.type === 'comment' && n.commentId === comment.id);
  check(fromInbox?.postId === post.id && fromInbox.actor?.id === bea.id, 'the inbox gives postId and commentId to open', fromInbox);
  await request('DELETE', `/api/posts/${post.id}`, author.token);
  await settle();
  check((await Notification.countDocuments({ post: post.id })) === 0, 'deleting a post removes its notifications');

  return { pass, fail };
}

module.exports = { run };
