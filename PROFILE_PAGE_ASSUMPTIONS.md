# CosQuest Profile Page — Product Assumptions

This note records the agreed assumptions for the Profile page. It is kept outside `cosquest-backend` so it is product documentation, not application code.

## What the profile represents

- Profiles are public for now. Anyone can view a profile, its public posts, follower list, following list, and registered-quest history. A visitor does **not** need to log in to read those items.
- The profile owner can edit their own display details: name, username, bio, profile category, avatar/photo, and public contact details.
- The account-login email is private and is never changed by the public contact-email field.
- The selected preset avatar and an uploaded profile photo are alternatives. Choosing a preset avatar clears the uploaded photo URL; uploading a photo becomes the profile photo.

## Header and profile information

| Screen item | Current backend meaning |
| --- | --- |
| Display name | `firstName` + `lastName`, saved on the profile. |
| Username | Unique, case-insensitive, 3–20 characters using letters, numbers, or underscores. |
| Bio / About | Public text, editable by the owner, maximum 500 characters. |
| Category | Optional public profile category, such as Digital creator. The owner can hide the category without deleting it. |
| Contact options | Optional public contact email, international-format phone, and business address. All supplied contact values are public; there are no individual contact visibility toggles yet. |
| Faction badge | One required faction: Ascendants, Icons, Controllers, Blockbusters, Everborns, or Celestials. `none` is not an option. |

## Counts and points

| Displayed count | Source and meaning |
| --- | --- |
| Followers | Number of other accounts following this profile. |
| Following | Number of accounts this profile follows. |
| Posts | Number of posts made by this user. |
| Quests | Number of quests the user registered for, including a registration later cancelled. |
| Wins | Number of the user’s quest registrations whose quest system status is `winner`. The quest system decides winners; the profile does not decide them. |
| Points | The user’s in-app `pointsBalance`. It starts at `0` and is currently read-only through the profile API. A later rewards/quest-points system should change the balance through a controlled ledger/service, not directly from the frontend. |

## Posts: images, reels, and thoughts

- **Image post:** at least 1 and at most 8 uploaded images. Each image must be JPEG, PNG, WEBP, or GIF and no larger than 10 MB. A caption is optional and limited to 2,200 characters.
- **Reel:** exactly one uploaded MP4, MOV, or WEBM video. It must be 30 seconds or less. Its caption is optional and limited to 2,200 characters.
- **Thought:** text only, no uploaded media. It must contain 1–300 characters.
- Post media uploads are stored in Cloudinary. The database stores each returned Cloudinary URL and public ID, enabling the frontend to fetch the media and the backend to delete it when its post is deleted.
- Posts, comments, and like counts are visible publicly. The post owner may edit its caption/text and delete their own post. A comment author may delete only their own comment.
- The current public feed is chronological with paging. There is no ranking, private post audience, post saving, reposting, sharing counter, reporting, or moderation queue yet.

## Likes, comments, and follows

- A completed, logged-in user can like a post once and can unlike it later. The public `likeCount` changes with those actions.
- A completed, logged-in user can add a public comment of 1–500 characters.
- A completed, logged-in user can follow or unfollow another profile, but cannot follow themself.
- A successful follow creates a notification for the followed user. The notification page can display it and mark notifications read.
- Moderation was intentionally deferred. Before launch, add reporting, blocking, rate limits suitable for social interactions, content review, and administrative tools.

## Location and notifications

- Enabling location, with real device coordinates, is a **required** onboarding step (CosQuest is played in the real world) - onboarding cannot complete without it, the same enforcement level as faction/interests/avatar. Users choose a discovery radius between 5 and 100 miles (default 50) and can change both the coordinates and the radius afterward via `PATCH /api/users/me/preferences/location`. Server environment settings (`DASHBOARD_DEFAULT_LAT`, `DASHBOARD_DEFAULT_LNG`, and radius) are now only a fallback, for an account that somehow reaches the dashboard before this existed.
- Users choose whether notifications are enabled during onboarding and can later change that notification preference. Device push tokens can be registered after login.

## Items intentionally not implemented yet

1. A points ledger, point-award endpoint, deductions, transactions, and reward history.
2. Quest winner-selection logic and admin controls. The profile only reads the `winner` registration status.
3. Social moderation: reports, blocks, content review, hidden/deleted-by-moderator states, and admin actions.
4. Profile visibility controls, private accounts, individual contact toggles, and a search endpoint for followers/following.
5. Post sharing, bookmarks, pinning, drafts, notifications for likes/comments, and video thumbnails/transcoding rules beyond Cloudinary’s stored media data.

