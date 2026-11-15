#!/bin/sh
# Browser test queue: at most PWQ_SLOTS (default 2) browser jobs at a time on a small shared machine.
# usage: sh scripts/dev/pwq.sh <who> <command...>     waits for a free slot, runs the command, exit code = the command's
#   PWQ_DIR    folder for the lock files and pwq.log, shared by everyone who shares the machine
#              (default: $PN_SCRATCH, else ${TMPDIR:-/tmp}/pn-pwq)
#   PWQ_SLOTS  jobs at a time (default 2)        PWQ_WAIT  seconds to wait for a slot (default 14400)
# Two jobs share the CPUs: a timing check may be slower. Re-run once before you call a timing FAIL real.
D=${PWQ_DIR:-${PN_SCRATCH:-${TMPDIR:-/tmp}/pn-pwq}}; N=${PWQ_SLOTS:-2}
[ $# -ge 2 ] || { echo "usage: sh pwq.sh <who> <command...>" >&2; exit 2; }
mkdir -p "$D" || exit 2
who=$1; shift
echo "$(date +%T) WAIT $who: $*" >> "$D/pwq.log"
end=$(( $(date +%s) + ${PWQ_WAIT:-14400} ))
while [ "$(date +%s)" -lt $end ]; do
  i=1
  while [ $i -le "$N" ]; do
    L=pwq.lock; [ $i -gt 1 ] && L=pwq$i.lock   # same lock names as the first version of this script (pwq.lock, pwq2.lock)
    PWQ_D="$D" PWQ_WHO="$who" PWQ_L="$L" flock -n -E 222 -o "$D/$L" sh -c 'echo "$(date +%T) RUN  $PWQ_WHO [$PWQ_L]" >> "$PWQ_D/pwq.log"; "$@"; rc=$?; echo "$(date +%T) DONE $PWQ_WHO rc=$rc" >> "$PWQ_D/pwq.log"; exit $rc' _ "$@"
    rc=$?
    [ $rc -ne 222 ] && exit $rc
    i=$((i+1))
  done
  sleep 2
done
echo "$(date +%T) TIMEOUT $who" >> "$D/pwq.log"; exit 124
