// Request validation on the account routes: auth (signup, login, password
// reset, OAuth), profile, settings. Each gap the rules close is checked both
// ways: the bad input is refused, the good input still works.
const User = require('../src/models/User');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1500)); }
  }
  async function request(method, path, token, body) {
    const raw = typeof body === 'string';
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  const answers = (r, status, error) => r.status === status && r.data?.error === error;

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const user = await User.create({
    profile: { username: `Acct${suffix}`, usernameNormalized: `acct${suffix}`, firstName: 'Ac', lastName: 'Count', avatarKey: 'green-knight' },
    email: `acct_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants',
  });
  const token = signToken(user.id, user.tokenVersion);
  const longEmail = `${'a'.repeat(250)}@example.com`;

  console.log('\n--- validation: signup and login ---');
  const password = 'Valid@1234';
  const email = `login_${suffix}@example.com`;
  const signup = await request('POST', '/api/auth/signup', null, { email, password, confirmPassword: password });
  check(signup.status === 201 && signup.data.token, 'signup with an email still works', signup);
  const signupList = await request('POST', '/api/auth/signup', null, { identifier: [`listed${suffix}`.slice(0, 20)], password, confirmPassword: password });
  check(answers(signupList, 400, 'Provide a valid email address or a username with 3-20 letters, numbers, or underscores.'), 'signup: an identifier sent as a list is refused (it used to be saved as text)', signupList);
  const signupLong = await request('POST', '/api/auth/signup', null, { email: longEmail, password, confirmPassword: password });
  check(answers(signupLong, 400, 'Provide a valid email address or a username with 3-20 letters, numbers, or underscores.'), 'signup: an email longer than 254 characters is refused', signupLong);
  const signupMissing = await request('POST', '/api/auth/signup', null, { email: '', username: null, password, confirmPassword: password });
  check(answers(signupMissing, 400, 'email or username, password, and confirmPassword are required.'), 'signup: empty/null identifiers still get the controller\'s "required" answer', signupMissing);

  const numberPassword = await request('POST', '/api/auth/login', null, { email, password: 12345678 });
  check(answers(numberPassword, 401, 'Invalid email or password.'), 'login: a password that is not text -> 401, same as a wrong password (was a 500)', numberPassword);
  const listIdentifier = await request('POST', '/api/auth/login', null, { identifier: [email], password });
  check(answers(listIdentifier, 400, 'email or username, and password, are required.'), 'login: an identifier sent as a list is refused', listIdentifier);
  const objectIdentifier = await request('POST', '/api/auth/login', null, { email: { toString: 'x' }, password });
  check(answers(objectIdentifier, 400, 'email or username, and password, are required.'), 'login: an identifier sent as an object is refused', objectIdentifier);
  const longIdentifier = await request('POST', '/api/auth/login', null, { email: longEmail, password });
  check(answers(longIdentifier, 401, 'Invalid email or password.'), 'login: an identifier no account can have -> the same 401 as an unknown account', longIdentifier);
  const wrong = await request('POST', '/api/auth/login', null, { email, password: 'Wrong@1234' });
  check(answers(wrong, 401, 'Invalid email or password.'), 'login: a wrong password is unchanged', wrong);
  const login = await request('POST', '/api/auth/login', null, { identifier: email, password });
  check(login.status === 200 && login.data.token, 'login: a good request still works', login);

  console.log('\n--- validation: password reset and OAuth exchange ---');
  const forgotObject = await request('POST', '/api/auth/forgot-password', null, { email: { a: 1 } });
  check(answers(forgotObject, 400, 'email or username is required.'), 'forgot-password: an object identifier is refused', forgotObject);
  const forgot = await request('POST', '/api/auth/forgot-password', null, { email: 'nobody@example.com' });
  check(forgot.status === 200, 'forgot-password: unknown email still gets the generic 200', forgot);
  const resetNumber = await request('POST', '/api/auth/reset-password', null, { email, code: 123456, newPassword: password, confirmPassword: password });
  check(answers(resetNumber, 400, 'identifier, code, newPassword, and confirmPassword are required.'), 'reset-password: a code that is not text keeps the controller\'s answer', resetNumber);
  const resetLong = await request('POST', '/api/auth/reset-password', null, { email, code: '1'.repeat(101), newPassword: password, confirmPassword: password });
  check(answers(resetLong, 400, 'That code is invalid or has expired.'), 'reset-password: an over-long code reads as an invalid code', resetLong);
  const resetWrong = await request('POST', '/api/auth/reset-password', null, { email, code: '000000', newPassword: password, confirmPassword: password });
  check(answers(resetWrong, 400, 'That code is invalid or has expired.'), 'reset-password: a well-formed wrong code is unchanged', resetWrong);
  const exchangeList = await request('POST', '/api/auth/oauth/exchange', null, { oauthCode: ['x'] });
  check(answers(exchangeList, 400, 'This OAuth code is invalid or has expired. Please sign in again.'), 'oauth exchange: a list is refused with the same message', exchangeList);
  const exchangeMissing = await request('POST', '/api/auth/oauth/exchange', null, {});
  check(answers(exchangeMissing, 400, 'This OAuth code is invalid or has expired. Please sign in again.'), 'oauth exchange: missing code, same answer as before', exchangeMissing);

  console.log('\n--- validation: OAuth callback inputs ---');
  const saved = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_CALLBACK_URL', 'OAUTH_SUCCESS_REDIRECT_URL'].map((key) => [key, process.env[key]]);
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_OAUTH_CALLBACK_URL = 'https://api.example.test/api/auth/oauth/google/callback';
  process.env.OAUTH_SUCCESS_REDIRECT_URL = 'cosquest://onboarding/oauthGoogle';
  try {
    const start = await fetch(`${baseUrl}/api/auth/oauth/google`, { redirect: 'manual' });
    const cookie = start.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    // 43 characters like the real state, but more bytes: used to throw inside
    // the comparison and send its internal message back to the app.
    const callback = await fetch(`${baseUrl}/api/auth/oauth/google/callback?code=x&state=${encodeURIComponent('é'.repeat(43))}`, { redirect: 'manual', headers: { Cookie: cookie } });
    const location = callback.headers.get('location') || '';
    const oauthError = new URL(location).searchParams.get('oauthError');
    check(callback.status === 302 && oauthError === 'OAuth state check failed. Please try again.', 'oauth callback: a non-ASCII state fails the state check (not an internal error)', { status: callback.status, location });
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const { findOrCreateUser } = require('../src/utils/oauth');
  const apple = await findOrCreateUser('apple', { sub: `a-${suffix}`, email: `apple_${suffix}@example.com` }, { firstName: { first: 'x' }, lastName: ` ${'L'.repeat(80)} ` });
  check(apple.profile.firstName === '' && apple.profile.lastName === 'L'.repeat(50), 'oauth: provider names must be text and are cut to 50 characters', apple.profile);

  console.log('\n--- validation: profile ---');
  const listName = await request('PATCH', '/api/users/me/profile', token, { firstName: ['Al'] });
  check(answers(listName, 400, 'firstName must be text of at most 50 characters.'), 'profile: firstName must be text (a list used to be saved)', listName);
  const longName = await request('PATCH', '/api/users/me/profile', token, { lastName: 'x'.repeat(51) });
  check(answers(longName, 400, 'lastName must be text of at most 50 characters.'), 'profile: names are at most 50 characters', longName);
  const longGender = await request('PATCH', '/api/users/me/profile', token, { gender: 'x'.repeat(51) });
  check(answers(longGender, 400, 'gender must be text of at most 50 characters.'), 'profile: gender is at most 50 characters', longGender);
  const listUsername = await request('PATCH', '/api/users/me/profile', token, { username: [`Acct${suffix}`] });
  check(answers(listUsername, 400, 'username must be 3-20 characters: letters, numbers, underscore only.'), 'profile: a username sent as a list is refused', listUsername);
  const listAge = await request('PATCH', '/api/users/me/profile', token, { age: [24] });
  check(answers(listAge, 400, 'age must be a whole number between 13 and 120.'), 'profile: an age sent as a list is refused (it used to pass as 24)', listAge);
  const lowAge = await request('PATCH', '/api/users/me/profile', token, { age: 5 });
  check(answers(lowAge, 400, 'age must be a whole number between 13 and 120.'), 'profile: the age range is still the controller\'s', lowAge);
  const longBio = await request('PATCH', '/api/users/me/profile', token, { bio: 'x'.repeat(501) });
  check(answers(longBio, 400, 'bio must be text with at most 500 characters.'), 'profile: bio limit, same message', longBio);
  const badCategory = await request('PATCH', '/api/users/me/profile', token, { category: ['x'] });
  check(answers(badCategory, 400, 'category must be one of the values from GET /api/meta/profile-categories.'), 'profile: category, same message', badCategory);
  const goodProfile = await request('PATCH', '/api/users/me/profile', token, { firstName: 'Alex', lastName: 'Rivera', age: '24', gender: 'Female', bio: 'Hi', category: null, showCategoryOnProfile: false });
  check(goodProfile.status === 200 && goodProfile.data.user.profile.firstName === 'Alex' && goodProfile.data.user.profile.age === 24, 'profile: a good request still works (age as text, category null)', goodProfile);

  const longContact = await request('PATCH', '/api/users/me/contact', token, { email: longEmail });
  check(answers(longContact, 400, 'contact email must be a valid email address.'), 'contact: an email longer than 254 characters is refused (was saved)', longContact);
  const badPhone = await request('PATCH', '/api/users/me/contact', token, { phone: 2348148327836 });
  check(answers(badPhone, 400, 'phone must use international format, for example +2348148327836.'), 'contact: phone must be text, same message', badPhone);
  const goodContact = await request('PATCH', '/api/users/me/contact', token, { email: '', phone: '+2348148327836', businessAddress: '14 Way' });
  check(goodContact.status === 200 && goodContact.data.contact.phone === '+2348148327836', 'contact: a good request still works', goodContact);

  const twoNames = await request('GET', '/api/users/check-username?username=a&username=b');
  check(answers(twoNames, 400, 'username query param is required.'), 'check-username: two values, same answer as before', twoNames);
  const longCheck = await request('GET', `/api/users/check-username?username=${'a'.repeat(51)}`);
  check(answers(longCheck, 400, 'username is too long.'), 'check-username: too long, same answer', longCheck);
  const freeName = await request('GET', `/api/users/check-username?username=free${suffix}`);
  check(freeName.status === 200 && freeName.data.available === true, 'check-username: a good request still works', freeName);

  const listAvatar = await request('PATCH', '/api/users/me/avatar', token, { avatar: ['green-knight'] });
  check(answers(listAvatar, 400, 'Not a recognized avatar option. See GET /api/meta/avatars.'), 'avatar: a list is refused, same message', listAvatar);
  const goodAvatar = await request('PATCH', '/api/users/me/avatar', token, { avatar: 'green-knight' });
  check(goodAvatar.status === 200, 'avatar: a good request still works', goodAvatar);

  const privacyText = await request('PATCH', '/api/users/me/privacy', token, { showOnlineStatus: 'no' });
  check(answers(privacyText, 400, 'showOnlineStatus must be a boolean.'), 'privacy: switches must be true/false, same message', privacyText);
  const visibility = await request('PATCH', '/api/users/me/privacy', token, { profileVisibility: 'everyone' });
  check(answers(visibility, 400, 'profileVisibility must be one of: public, friends, private.'), 'privacy: visibility values, same message', visibility);
  const goodPrivacy = await request('PATCH', '/api/users/me/privacy', token, { profileVisibility: 'public', showOnlineStatus: true });
  check(goodPrivacy.status === 200, 'privacy: a good request still works', goodPrivacy);

  const twoSearches = await request('GET', '/api/users/search?search=a&search=b', token);
  check(answers(twoSearches, 400, 'search is required.'), 'search: two values, same answer as before', twoSearches);
  const twoLimits = await request('GET', '/api/users/discover?limit=1&limit=2', token);
  check(answers(twoLimits, 400, 'limit must be a single value.'), 'discover: limit must be a single value', twoLimits);
  const lenient = await request('GET', '/api/users/discover?limit=invalid&page=-1', token);
  check(lenient.status === 200, 'discover: a bad number still falls back to the default', lenient);
  const longUsername = await request('GET', `/api/users/${'a'.repeat(101)}/profile`);
  check(answers(longUsername, 404, 'Profile not found.'), 'profile page: an impossible username reads as not found', longUsername);
  const longFollow = await request('POST', `/api/users/${'a'.repeat(101)}/follow`, token);
  check(answers(longFollow, 404, 'Profile not found.'), 'follow: an impossible username reads as not found', longFollow);
  const badStatus = await request('GET', `/api/users/${user.profile.username}/quests?status=lost`);
  check(answers(badStatus, 400, 'status must be one of: registered, cancelled, completed, winner.'), 'quest history: status values, same message', badStatus);
  const quests = await request('GET', `/api/users/${user.profile.username}/quests?status=registered`);
  check(quests.status === 200, 'quest history: a good request still works', quests);
  const followers = await request('GET', `/api/users/${user.profile.username}/followers?search=a&page=1`, token);
  check(followers.status === 200, 'followers: a good request still works', followers);

  console.log('\n--- validation: settings ---');
  const listAccountName = await request('PATCH', '/api/users/me/account', token, { username: [`Acct${suffix}`] });
  check(answers(listAccountName, 400, 'username must contain 3-20 letters, numbers, or underscores.'), 'account: a username sent as a list -> 400 (was a 500)', listAccountName);
  const longAccountEmail = await request('PATCH', '/api/users/me/account', token, { email: longEmail });
  check(answers(longAccountEmail, 400, 'Provide a valid email.'), 'account: a login email longer than 254 characters is refused', longAccountEmail);
  const blankName = await request('PATCH', '/api/users/me/account', token, { displayName: '   ' });
  check(answers(blankName, 400, 'displayName must contain 1-80 characters.'), 'account: displayName, same message', blankName);
  const numberPhone = await request('PATCH', '/api/users/me/account', token, { phone: 15552345678 });
  check(answers(numberPhone, 400, 'phone must be text.'), 'account: phone must be text, same message', numberPhone);
  const badDate = await request('PATCH', '/api/users/me/account', token, { dateOfBirth: '2020-02-31' });
  check(answers(badDate, 400, 'dateOfBirth must be a valid YYYY-MM-DD date.'), 'account: impossible date still refused by the controller', badDate);
  const goodAccount = await request('PATCH', '/api/users/me/account', token, { displayName: 'Custom', phone: '+1 (555) 234-5678', dateOfBirth: '1998-10-12' });
  check(goodAccount.status === 200 && goodAccount.data.account.phone === '+15552345678', 'account: a good request still works', goodAccount);

  const proto = await request('PATCH', '/api/users/me/appearance', token, '{"__proto__": {"x": 1}}');
  check(answers(proto, 400, 'Provide supported fields: themeMode, accentColor, fontSize, reduceMotion.'), 'appearance: a "__proto__" field is refused (was a 500)', proto);
  const ctor = await request('PATCH', '/api/users/me/appearance', token, { constructor: 'x' });
  check(answers(ctor, 400, 'Provide supported fields: themeMode, accentColor, fontSize, reduceMotion.'), 'appearance: a "constructor" field is refused (it used to be accepted)', ctor);
  const emptyAppearance = await request('PATCH', '/api/users/me/appearance', token, {});
  check(answers(emptyAppearance, 400, 'Provide supported fields: themeMode, accentColor, fontSize, reduceMotion.'), 'appearance: an empty body, same message', emptyAppearance);
  const badColor = await request('PATCH', '/api/users/me/appearance', token, { accentColor: 'red' });
  check(answers(badColor, 400, 'Invalid accentColor.'), 'appearance: field values, same message', badColor);
  const goodAppearance = await request('PATCH', '/api/users/me/appearance', token, { themeMode: 'dark', accentColor: '#123abc', fontSize: 'large', reduceMotion: true });
  check(goodAppearance.status === 200 && goodAppearance.data.appearance.themeMode === 'dark', 'appearance: a good request still works', goodAppearance);
  const badQuality = await request('PATCH', '/api/users/me/data-usage', token, { imageQuality: 'ultra' });
  check(answers(badQuality, 400, 'Invalid imageQuality.'), 'data usage: field values, same message', badQuality);
  const goodData = await request('PATCH', '/api/users/me/data-usage', token, { autoPlayVideos: false });
  check(goodData.status === 200 && goodData.data.dataUsage.autoPlayVideos === false, 'data usage: a good request still works', goodData);

  const numberNewPassword = await request('PATCH', '/api/users/me/password', token, { currentPassword: 'x', newPassword: 12345678, confirmPassword: 12345678 });
  check(answers(numberNewPassword, 400, 'password must be at least 8 characters long.'), 'password: a new password that is not text, same message', numberNewPassword);

  const supportMessage = 'Provide type (support or bug), subject (1-150 characters), message (1-5000), and optional appVersion/platform.';
  const longSubject = await request('POST', '/api/users/me/support-requests', token, { type: 'bug', subject: 'x'.repeat(151), message: 'Broken' });
  check(answers(longSubject, 400, supportMessage), 'support request: subject limit, same message', longSubject);
  const nullPlatform = await request('POST', '/api/users/me/support-requests', token, { type: 'bug', subject: 'Hi', message: 'Broken', platform: null });
  check(answers(nullPlatform, 400, supportMessage), 'support request: platform values, same message', nullPlatform);
  const ticket = await request('POST', '/api/users/me/support-requests', token, { type: 'support', subject: 'Help', message: 'Please help', appVersion: '1.2.3', platform: 'ios' });
  check(ticket.status === 201, 'support request: a good request still works', ticket);

  console.log(`\nvalidationAccount: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
