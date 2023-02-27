export function debounce(callback, timeout) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    const shouldCallNow = !timer;
    timer = setTimeout(() => {
      timer = undefined;
      if (!shouldCallNow) {
        callback.apply(this, args);
      }
    }, timeout);
    if (shouldCallNow) {
      callback.apply(this, args);
    }
  };
}

export function throttle(callback, limit) {
  let lastRun;
  let lastCall;
  return (...args) => {
    if (!lastRun) {
      callback.apply(this, args);
      lastRun = Date.now();
    } else {
      clearTimeout(lastCall);
      lastCall = setTimeout(() => {
        if (Date.now() - lastRun >= limit) {
          callback.apply(this, args);
          lastRun = Date.now();
        }
      }, limit - (Date.now() - lastRun));
    }
  };
}
