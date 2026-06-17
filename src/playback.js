// Playback controller. Owns the currentEpisode index and drives an injected
// audio adapter. Episodes are newest-first: index 0 = newest episode.
//
// episodes: Array | () => Array — newest-first episode list or a getter (pass
//   a getter so main.js can share the live reference that changes after RSS load)
// audio:    AudioAdapter — { src, play(), pause(), paused, currentTime, duration,
//                            addEventListener(event, fn) }
// callbacks (all optional):
//   onPlay(ep, idx)        — new episode started; paint the player UI
//   onProgress(cur, dur)   — timeupdate; update the seek bar and time display
//   onDuration(dur)        — loadedmetadata; paint the duration label
//   onPauseChange(paused)  — play/pause toggled; update the play-pause button
//   onClose()              — player dismissed; hide the player shell
export function createPlayback(episodes, audio, callbacks = {}) {
  const getEpisodes = typeof episodes === 'function' ? episodes : () => episodes;
  let currentIdx = null;
  let listenersAttached = false;

  function attachOnce() {
    if (listenersAttached) return;
    listenersAttached = true;
    audio.addEventListener('timeupdate', () => {
      callbacks.onProgress?.(audio.currentTime, audio.duration || 1);
    });
    audio.addEventListener('loadedmetadata', () => {
      callbacks.onDuration?.(audio.duration);
    });
    // newest-first: lower index = newer episode. Auto-advance toward newer.
    // At index 0 (the newest) stop naturally — no wrap.
    audio.addEventListener('ended', () => {
      if (currentIdx === null) return;
      const nextIdx = currentIdx - 1;
      if (nextIdx >= 0) play(nextIdx);
    });
  }

  function play(idx) {
    const eps = getEpisodes();
    const ep = eps?.[idx];
    if (!ep || !ep.audioUrl) return;
    currentIdx = idx;
    attachOnce();
    audio.src = ep.audioUrl;
    audio.play();
    callbacks.onPlay?.(ep, idx);
  }

  function togglePlayPause() {
    if (currentIdx === null) return;
    if (audio.paused) {
      audio.play();
      callbacks.onPauseChange?.(false);
    } else {
      audio.pause();
      callbacks.onPauseChange?.(true);
    }
  }

  // older episode = higher index in newest-first list
  function prev() {
    if (currentIdx === null) return;
    const eps = getEpisodes();
    const prevIdx = currentIdx + 1;
    if (prevIdx < (eps?.length ?? 0)) play(prevIdx);
  }

  // newer episode = lower index in newest-first list
  function next() {
    if (currentIdx === null) return;
    const nextIdx = currentIdx - 1;
    if (nextIdx >= 0) play(nextIdx);
  }

  function close() {
    audio.pause();
    audio.src = '';
    currentIdx = null;
    callbacks.onClose?.();
  }

  function seek(pct) {
    const dur = audio.duration;
    if (!dur || isNaN(dur)) return;
    audio.currentTime = (pct / 100) * dur;
  }

  // Repaints the player UI after a DOM re-render without creating a new Audio
  // element or re-attaching audio event listeners.
  function restore() {
    if (currentIdx === null) return;
    const eps = getEpisodes();
    const ep = eps?.[currentIdx];
    if (!ep) return;
    callbacks.onPlay?.(ep, currentIdx);
    callbacks.onPauseChange?.(audio.paused);
    callbacks.onProgress?.(audio.currentTime, audio.duration || 1);
    if (!isNaN(audio.duration)) callbacks.onDuration?.(audio.duration);
  }

  function getCurrentIndex() { return currentIdx; }

  return { play, togglePlayPause, prev, next, close, seek, restore, getCurrentIndex };
}
