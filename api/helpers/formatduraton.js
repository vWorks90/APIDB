module.exports = {
    // helper: convert duration in milliseconds to { time, unit, display }
 formatDurationMs: function(durationMs) {
  // ensure number
  const msNum = Number(durationMs) || 0;
  //?? add new condition for minutes nad hours
  //?? executionTime change function name 

  if (msNum >= 1000) {
    const secs = Number((msNum / 1000).toFixed(3));
    return {
    //   time: secs,            // numeric value in seconds
    //   unit: 'sec',          // 'sec' unit
      exe_time: `${secs} sec`,
    //   rawMs: Number(msNum.toFixed(3)) // optional: always-available ms
    };
  } else {
    const ms = Number(msNum.toFixed(3));
    return {
    //   time: ms,             // numeric value in milliseconds
    //   unit: 'ms',           // 'ms' unit
      exe_time: `${ms} ms`,
    //   rawMs: Number(msNum.toFixed(3))
    };
  }
}

}