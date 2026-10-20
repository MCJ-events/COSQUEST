/**
 * Quick adb taps on the emulator for the moments Maestro is too slow for.
 *
 * After every command Maestro re-reads the screen and waits for it to go
 * idle. The game's quiz timer bar and fight scene never go idle, so each
 * Maestro step there takes 20 to 40 s: longer than a quiz question's clock.
 * While Maestro is running nothing else can read the screen either (one UI
 * automation session at a time), so these taps go to fixed spots, and the quiz
 * answer comes from the local game backend's database (test rig only).
 *
 * A flow starts these in the background through peer-server.js (args start
 * with "phone"), then taps Play or Fight itself:
 *
 *   node e2e/seed/phone.js quiz [--timeout 60]        answer the next quiz right
 *   node e2e/seed/phone.js taps <n> [--after 3] [--x .55 --y .45]   tap to strike
 *
 * Uses adb from ANDROID_HOME (default ~/cq-work/tools/android-sdk) and the
 * game Postgres container cx054-game-pg (e2e-game/game-up.sh).
 */
const { execFileSync } = require('child_process');
const path = require('path');

const ADB = path.join(process.env.ANDROID_HOME || path.join(process.env.HOME || '', 'cq-work/tools/android-sdk'), 'platform-tools/adb');
const PG = process.env.GAME_PG_CONTAINER || 'cx054-game-pg';
const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8' });
const sql = (q) => execFileSync('docker', ['exec', PG, 'psql', '-U', 'costquest', '-At', '-c', q], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Answer rows on the quiz screen (components/game/Encounter.tsx) on a
// 1080x2400 phone; x is right of centre to keep clear of the Chats bubble.
const CHOICE_Y = [910, 1096, 1282, 1468];
const CHOICE_X = 600;

function screen() {
  const m = adb('shell', 'wm', 'size').match(/(\d+)x(\d+)/);
  return { w: Number(m[1]), h: Number(m[2]) };
}

async function quiz(timeoutS) {
  const since = Date.now() / 1000 - 2;
  const until = Date.now() + timeoutS * 1000;
  let row = '';
  while (!row && Date.now() < until) {
    row = sql(`select kind || '|' || (expected->'answers')::text || '|' || extract(epoch from issued_at) from roam_attempts where issued_at > to_timestamp(${since}) and answered_at is null order by issued_at desc limit 1`);
    if (!row) await sleep(250);
  }
  if (!row) throw new Error('no quiz started');
  const [kind, answersJson, issued] = row.split('|');
  const answers = JSON.parse(answersJson);
  if (kind === 'sequence') throw new Error('sequence quizzes are not supported here');
  const { h } = screen();
  const scale = h / 2400;
  // let "The shrine is waking" pass and the card appear
  await sleep(Math.max(0, Number(issued) * 1000 + 2500 - Date.now()));
  for (const i of answers) {
    adb('shell', 'input', 'tap', String(Math.round(CHOICE_X * scale)), String(Math.round(CHOICE_Y[i] * scale)));
    await sleep(900);
  }
  console.log(`${kind}: tapped ${answers.join(',')}`);
}

async function taps(n, afterS, fx, fy) {
  await sleep(afterS * 1000);
  const { w, h } = screen();
  const x = Math.round(w * fx);
  const y = Math.round(h * fy);
  adb('shell', `for i in $(seq ${n}); do input tap ${x} ${y}; done`);
  console.log(`${n} taps at ${x},${y}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = {};
  const args = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith('--')) {
      flags[rest[i].slice(2)] = rest[i + 1];
      i += 1;
    } else args.push(rest[i]);
  }
  if (cmd === 'quiz') await quiz(Number(flags.timeout || 60));
  else if (cmd === 'taps') await taps(Number(args[0] || 60), Number(flags.after || 3), Number(flags.x || 0.55), Number(flags.y || 0.45));
  else throw new Error('phone.js quiz | taps <n>');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
