// What a person's phones are told when their ring is over
// (src/utils/ringOutcome.js): the call screen's CallEndedReason, the data
// push for apps that ring themselves, and whether it was a missed call.
// No server or database needed: node test/ringOutcome.js
const { ringOutcome } = require('../src/utils/ringOutcome');

async function run() {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)); }
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const expect = (memberStatus, callStatus, wanted, name) => {
    const got = ringOutcome(memberStatus, callStatus);
    check(same(got, wanted), name, { memberStatus, callStatus, got, wanted });
  };

  console.log('\n--- what the phones are told when a ring is over ---');
  const answered = { native: null, data: 'call_ended', reason: 'answered', missed: false };
  expect('joined', 'accepted', answered, 'answered: no "call ended" for the call screen (it would hang up), the other phones stop');
  expect('left', 'ended', answered, 'answered, then the call ended: the same');
  expect('left', 'accepted', answered, 'answered and left a call still going: the same');

  expect('declined', 'declined', { native: 'declinedElsewhere', data: 'call_ended', reason: 'declined', missed: false }, 'declined a one-to-one call');
  expect('declined', 'ringing', { native: 'declinedElsewhere', data: 'call_ended', reason: 'declined', missed: false }, 'declined while others still ring');
  expect('declined', 'accepted', { native: 'declinedElsewhere', data: 'call_ended', reason: 'declined', missed: false }, 'declined a group call others are in');
  expect('declined', 'ended', { native: 'remoteEnded', data: 'call_ended', reason: 'declined', missed: false }, 'declined, seen only once the call was over');
  expect('declined', 'cancelled', { native: 'remoteEnded', data: 'call_ended', reason: 'declined', missed: false }, 'declined, then the caller hung up');

  expect('missed', 'missed', { native: 'unanswered', data: 'call_missed', reason: 'missed', missed: true }, 'nobody answered within the minute: a missed call');
  expect('missed', 'cancelled', { native: 'remoteEnded', data: 'call_missed', reason: 'missed', missed: true }, 'the caller hung up while it rang: a missed call');
  expect('missed', 'accepted', { native: 'unanswered', data: 'call_missed', reason: 'missed', missed: true }, 'their minute ran out in a group call still going: a missed call');
  expect('missed', 'ended', { native: 'unanswered', data: 'call_missed', reason: 'missed', missed: true }, 'still ringing when the group call ended: a missed call');

  expect(undefined, 'ended', { native: 'remoteEnded', data: 'call_ended', reason: 'ended', missed: false }, 'no longer in the call: it ended for them');
  expect(undefined, 'missed', { native: 'unanswered', data: 'call_ended', reason: 'ended', missed: false }, 'no longer in a call nobody answered');
  expect('ringing', 'cancelled', { native: 'remoteEnded', data: 'call_ended', reason: 'ended', missed: false }, 'still marked ringing in a call that is over');

  const first = ringOutcome('missed', 'missed');
  first.missed = false;
  check(ringOutcome('missed', 'missed').missed === true, 'every call gets its own answer (changing one changes no other)', ringOutcome('missed', 'missed'));

  console.log(`\nring outcome: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

if (require.main === module) {
  run().then(({ fail }) => process.exit(fail ? 1 : 0));
}

module.exports = { run };
