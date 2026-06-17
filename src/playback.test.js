import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayback } from './playback.js';

// newest-first: index 0 = newest, index 2 = oldest
const EP3 = { title: 'Episode 3', audioUrl: 'ep3.mp3', image: 'ep3.jpg', pubDate: '2024-01-03', episodeType: 'full', episode: '3' };
const EP2 = { title: 'Episode 2', audioUrl: 'ep2.mp3', image: 'ep2.jpg', pubDate: '2024-01-02', episodeType: 'full', episode: '2' };
const EP1 = { title: 'Episode 1', audioUrl: 'ep1.mp3', image: 'ep1.jpg', pubDate: '2024-01-01', episodeType: 'full', episode: '1' };
const EP_NO_AUDIO = { title: 'No Audio', audioUrl: null, image: 'nope.jpg', pubDate: '2024-01-04', episodeType: 'full' };

const makeEpisodes = () => [EP3, EP2, EP1];

function makeAudio() {
  const listeners = {};
  return {
    src: '',
    paused: true,
    currentTime: 0,
    duration: NaN,
    play() { this.paused = false; },
    pause() { this.paused = true; },
    addEventListener(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    emit(event) {
      if (event === 'ended') this.paused = true; // real <audio> sets paused=true on end
      (listeners[event] || []).forEach(fn => fn());
    },
  };
}

function makeCallbacks() {
  const calls = [];
  return {
    calls,
    onPlay:        (ep, idx)  => calls.push({ event: 'play', ep, idx }),
    onProgress:    (cur, dur) => calls.push({ event: 'progress', cur, dur }),
    onDuration:    (dur)      => calls.push({ event: 'duration', dur }),
    onPauseChange: (paused)   => calls.push({ event: 'pauseChange', paused }),
    onClose:       ()         => calls.push({ event: 'close' }),
  };
}

// ─── play ─────────────────────────────────────────────────────────────────────

test('play() sets audio src, starts playback, and fires onPlay', () => {
  const audio = makeAudio();
  const cb = makeCallbacks();
  const pb = createPlayback(makeEpisodes(), audio, cb);
  pb.play(1);
  assert.equal(audio.src, 'ep2.mp3');
  assert.equal(audio.paused, false);
  assert.equal(pb.getCurrentIndex(), 1);
  const playCall = cb.calls.find(c => c.event === 'play');
  assert.ok(playCall, 'onPlay must be called');
  assert.equal(playCall.ep.title, 'Episode 2');
  assert.equal(playCall.idx, 1);
});

test('play() is a no-op when episode has no audioUrl', () => {
  const audio = makeAudio();
  const cb = makeCallbacks();
  const pb = createPlayback([EP_NO_AUDIO], audio, cb);
  pb.play(0);
  assert.equal(audio.src, '', 'audio.src must not be set');
  assert.equal(pb.getCurrentIndex(), null, 'currentEpisode must stay null');
  assert.ok(!cb.calls.some(c => c.event === 'play'), 'onPlay must not fire');
});

test('play() is a no-op for out-of-bounds index', () => {
  const audio = makeAudio();
  const pb = createPlayback(makeEpisodes(), audio, makeCallbacks());
  pb.play(99);
  assert.equal(pb.getCurrentIndex(), null);
  assert.equal(audio.src, '');
});

// ─── auto-advance on track end ────────────────────────────────────────────────

test('ended event auto-advances to newer episode (lower index)', () => {
  const audio = makeAudio();
  const pb = createPlayback(makeEpisodes(), audio, makeCallbacks());
  pb.play(1); // EP2, index 1
  audio.emit('ended');
  assert.equal(pb.getCurrentIndex(), 0, 'must advance to index 0 (EP3, newer)');
  assert.equal(audio.src, 'ep3.mp3');
});

test('ended event at newest episode (index 0) stops without wrap or restart', () => {
  const audio = makeAudio();
  const pb = createPlayback(makeEpisodes(), audio, makeCallbacks());
  pb.play(0); // EP3, newest
  audio.emit('ended'); // fake sets paused=true to simulate real audio end
  assert.equal(pb.getCurrentIndex(), 0, 'index must not change');
  assert.equal(audio.paused, true, 'must not replay: audio stays paused');
});

// ─── prev/next bounds ─────────────────────────────────────────────────────────

test('next() plays the newer episode (lower index)', () => {
  const audio = makeAudio();
  const pb = createPlayback(makeEpisodes(), audio, makeCallbacks());
  pb.play(1);
  pb.next();
  assert.equal(pb.getCurrentIndex(), 0);
  assert.equal(audio.src, 'ep3.mp3');
});

test('next() at newest episode (index 0) is a no-op', () => {
  const audio = makeAudio();
  const pb = createPlayback(makeEpisodes(), audio, makeCallbacks());
  pb.play(0);
  pb.next();
  assert.equal(pb.getCurrentIndex(), 0);
  assert.equal(audio.src, 'ep3.mp3'); // unchanged
});

test('prev() plays the older episode (higher index)', () => {
  const audio = makeAudio();
  const pb = createPlayback(makeEpisodes(), audio, makeCallbacks());
  pb.play(1);
  pb.prev();
  assert.equal(pb.getCurrentIndex(), 2);
  assert.equal(audio.src, 'ep1.mp3');
});

test('prev() at oldest episode is a no-op', () => {
  const audio = makeAudio();
  const pb = createPlayback(makeEpisodes(), audio, makeCallbacks());
  pb.play(2); // EP1, oldest
  pb.prev();
  assert.equal(pb.getCurrentIndex(), 2);
  assert.equal(audio.src, 'ep1.mp3'); // unchanged
});

// ─── togglePlayPause ──────────────────────────────────────────────────────────

test('togglePlayPause() pauses when playing and fires onPauseChange(true)', () => {
  const audio = makeAudio();
  const cb = makeCallbacks();
  const pb = createPlayback(makeEpisodes(), audio, cb);
  pb.play(0);
  pb.togglePlayPause();
  assert.equal(audio.paused, true);
  const pc = cb.calls.filter(c => c.event === 'pauseChange').at(-1);
  assert.ok(pc, 'onPauseChange must be called');
  assert.equal(pc.paused, true);
});

test('togglePlayPause() resumes when paused and fires onPauseChange(false)', () => {
  const audio = makeAudio();
  const cb = makeCallbacks();
  const pb = createPlayback(makeEpisodes(), audio, cb);
  pb.play(0);
  pb.togglePlayPause(); // pause
  pb.togglePlayPause(); // resume
  assert.equal(audio.paused, false);
  const lastPc = cb.calls.filter(c => c.event === 'pauseChange').at(-1);
  assert.ok(lastPc);
  assert.equal(lastPc.paused, false);
});

test('togglePlayPause() is a no-op when no episode is loaded', () => {
  const audio = makeAudio();
  const pb = createPlayback(makeEpisodes(), audio, makeCallbacks());
  pb.togglePlayPause();
  assert.equal(audio.paused, true); // unchanged
});

// ─── restore after re-render ──────────────────────────────────────────────────

test('restore() fires onPlay and onPauseChange with current episode state', () => {
  const audio = makeAudio();
  const cb = makeCallbacks();
  const pb = createPlayback(makeEpisodes(), audio, cb);
  pb.play(1);
  cb.calls.length = 0; // clear — simulate DOM re-render
  pb.restore();
  const playCall = cb.calls.find(c => c.event === 'play');
  assert.ok(playCall, 'onPlay called on restore');
  assert.equal(playCall.idx, 1);
  const pauseCall = cb.calls.find(c => c.event === 'pauseChange');
  assert.ok(pauseCall, 'onPauseChange called on restore');
  assert.equal(pauseCall.paused, false); // was playing when restore() called
});

test('restore() is a no-op when no episode is loaded', () => {
  const audio = makeAudio();
  const cb = makeCallbacks();
  const pb = createPlayback(makeEpisodes(), audio, cb);
  pb.restore();
  assert.equal(cb.calls.length, 0);
});

// ─── no duplicate listeners ───────────────────────────────────────────────────

test('audio event listeners attached only once across multiple play() calls', () => {
  const counts = {};
  const audio = {
    src: '', paused: true, currentTime: 0, duration: NaN,
    play() { this.paused = false; },
    pause() { this.paused = true; },
    addEventListener(event) { counts[event] = (counts[event] || 0) + 1; },
  };
  const pb = createPlayback(makeEpisodes(), audio, makeCallbacks());
  pb.play(0);
  pb.play(1);
  pb.play(2);
  assert.equal(counts['ended'], 1, 'ended listener attached exactly once');
  assert.equal(counts['timeupdate'], 1, 'timeupdate listener attached exactly once');
  assert.equal(counts['loadedmetadata'], 1, 'loadedmetadata listener attached exactly once');
});

// ─── close ────────────────────────────────────────────────────────────────────

test('close() pauses audio, clears src, resets currentEpisode, fires onClose', () => {
  const audio = makeAudio();
  const cb = makeCallbacks();
  const pb = createPlayback(makeEpisodes(), audio, cb);
  pb.play(1);
  pb.close();
  assert.equal(audio.paused, true);
  assert.equal(audio.src, '');
  assert.equal(pb.getCurrentIndex(), null);
  assert.ok(cb.calls.some(c => c.event === 'close'), 'onClose must be called');
});
