module.exports = {
    // helper: convert duration in milliseconds to { time, unit, display }
 executionTime: function(durationMs) {
  // ensure number
  const msNum = Number(durationMs) || 0;
  // add new condition for minutes and hours
  // executionTime change function name of executionTime

  if (msNum >= 3600000) { // 1 hour = 3600000 ms
    const hours = Number((msNum / 3600000).toFixed(3));
    return {
      exe_time: `${hours} hr`
    };
  } else if (msNum >= 60000) { // 1 minute = 60000 ms
    const mins = Number((msNum / 60000).toFixed(3));
    return {
      exe_time: `${mins} min`
    };
  } else if (msNum >= 1000) {
    const secs = Number((msNum / 1000).toFixed(3));
    return {
      exe_time: `${secs} sec`
    };
  } else {
    const ms = Number(msNum.toFixed(3));
    return {
      exe_time: `${ms} ms`
    };
  }
}

}