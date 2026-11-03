// When someone's ring is over, native is the CallEndedReason sent to a phone
// ringing on its own call screen (null when they answered, because it would
// hang that phone up), data is the data-only push type for apps that ring
// themselves, missed says whether to show 'Missed call'.
function ringOutcome(memberStatus, callStatus) {
  if (memberStatus === 'joined' || memberStatus === 'left') {
    return { native: null, data: 'call_ended', reason: 'answered', missed: false };
  }

  if (memberStatus === 'declined') {
    const native = ['ringing', 'accepted', 'declined'].includes(callStatus)
      ? 'declinedElsewhere'
      : 'remoteEnded';
    return { native, data: 'call_ended', reason: 'declined', missed: false };
  }

  if (memberStatus === 'missed') {
    const native = callStatus === 'cancelled' ? 'remoteEnded' : 'unanswered';
    return { native, data: 'call_missed', reason: 'missed', missed: true };
  }

  // No longer in the call, or still marked ringing in one that is over.
  const native = callStatus === 'missed' ? 'unanswered' : 'remoteEnded';
  return { native, data: 'call_ended', reason: 'ended', missed: false };
}

module.exports = { ringOutcome };
