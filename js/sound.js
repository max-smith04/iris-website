/* ============================================================
   sound.js

   The startup and shutdown sounds are real audio files in
   assets/audio/. The error "ding" on an invalid form is still
   synthesised with the Web Audio API — no file needed for two
   blunt descending tones.

   Browsers refuse to make noise before a real gesture, so nothing
   here plays until unlock() is called from a click or keypress.
   ============================================================ */
window.Sound = (function () {
  var FILES = {
    startup:  'assets/audio/startup.mp3',
    shutdown: 'assets/audio/shutdown.mp3'
  };

  var ctx = null, master = null, verb = null;
  var muted = localStorage.getItem('iris.muted') === '1';
  var unlocked = false;
  var clips = {};

  /* ---------- files ---------- */
  function clip(name) {
    if (clips[name] !== undefined) return clips[name];
    var a = new Audio(FILES[name]);
    a.preload = 'auto';
    a.volume = muted ? 0 : 1;
    /* a missing file is not an error worth shouting about — we just fall back */
    a.addEventListener('error', function () { clips[name] = null; });
    clips[name] = a;
    return a;
  }

  /* Reports success rather than failure, deliberately. A blocked play()
     rejects with NotAllowedError on Chrome, but Safari has been known to
     throw synchronously or reject under other names, and very old browsers
     return no promise at all. Callers cannot reliably detect "blocked", so
     they stay armed for a gesture and only stand down once onPlayed fires. */
  function play(name, onMissing, onPlayed) {
    if (muted) return;
    var a = clip(name);
    if (!a) { if (onMissing) onMissing(); return; }
    a.volume = 1;
    try { a.currentTime = 0; } catch (e) {}

    var p;
    try {
      p = a.play();
    } catch (e) {
      return;                       /* refused outright; the gesture path retries */
    }
    if (p && p.then) {
      p.then(
        function () { if (onPlayed) onPlayed(); },
        function (err) {
          /* only a genuinely unusable file is worth falling back to synthesis for */
          if (err && err.name !== 'NotAllowedError' && err.name !== 'AbortError' && onMissing) onMissing();
        }
      );
    } else {
      setTimeout(function () { if (!a.paused && onPlayed) onPlayed(); }, 250);
    }
  }

  /* ---------- synthesis, for the error ding ---------- */
  function build() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);

    var secs = 2.2, len = Math.floor(ctx.sampleRate * secs);
    var ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = ir.getChannelData(c);
      for (var i = 0; i < len; i++) {
        var t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.7) * (1 - t * 0.15);
      }
    }
    var conv = ctx.createConvolver();
    conv.buffer = ir;
    verb = ctx.createGain();
    verb.gain.value = 0.28;
    conv.connect(verb);
    verb.connect(master);
    verb.input = conv;
    return ctx;
  }

  function tone(freq, at, dur, gain, type) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    g.connect(master);
    g.connect(verb.input);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  /* Fetch the startup file early. Deliberately does NOT touch the
     AudioContext: constructing one before a gesture makes Chrome log
     "The AudioContext was not allowed to start", and nothing needs it yet. */
  function preload() {
    try { clip('startup').load(); } catch (e) {}
  }

  /* Call from a real gesture. Builds the audio graph and wakes a suspended
     context, which is the only moment a browser permits either. */
  function unlock() {
    unlocked = true;
    build();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    preload();
  }

  function startup(onPlayed) {
    play('startup', synthStartup, onPlayed);
  }

  function shutdown() {
    play('shutdown', synthShutdown);
  }

  /* stand-ins for a missing file. They need the AudioContext, so they stay
     quiet until a gesture has let us build one rather than warning about it. */
  function synthStartup() {
    if (!unlocked) return;
    build();
    if (!ctx || muted) return;
    var t = ctx.currentTime + 0.05;
    [[440.00, 0.00, 0.30], [554.37, 0.26, 0.28],
     [659.25, 0.52, 0.30], [880.00, 0.80, 0.42]].forEach(function (n) {
      var at = t + n[1];
      tone(n[0], at, 2.4, n[2]);
      tone(n[0] * 2, at, 1.5, n[2] * 0.34);
      tone(n[0] * 2.76, at, 1.0, n[2] * 0.13);
    });
  }

  function synthShutdown() {
    if (!unlocked) return;
    build();
    if (!ctx || muted) return;
    var t = ctx.currentTime + 0.05;
    [[659.25, 0.00, 0.42], [523.25, 0.30, 0.40],
     [392.00, 0.60, 0.38], [261.63, 0.92, 0.36]].forEach(function (n) {
      var at = t + n[1];
      tone(n[0], at, 1.8, n[2]);
      tone(n[0] * 2, at, 1.1, n[2] * 0.28);
    });
  }

  /* the error ding: two blunt descending tones with a bit of edge */
  function error() {
    if (muted || !unlocked) return;
    build();
    if (!ctx) return;
    var t = ctx.currentTime + 0.01;
    [[466.16, 0.00, 0.16, 0.34], [349.23, 0.13, 0.42, 0.30]].forEach(function (n) {
      var at = t + n[1];
      tone(n[0], at, n[2], n[3], 'sine');
      tone(n[0] * 2.01, at, n[2] * 0.7, n[3] * 0.30, 'triangle');
      tone(n[0] * 3.02, at, n[2] * 0.4, n[3] * 0.12, 'triangle');
    });
  }

  function setMuted(v) {
    muted = !!v;
    localStorage.setItem('iris.muted', muted ? '1' : '0');
    if (master) master.gain.value = muted ? 0 : 1;
    Object.keys(clips).forEach(function (k) {
      var a = clips[k];
      if (!a) return;
      a.volume = muted ? 0 : 1;
      if (muted) { try { a.pause(); } catch (e) {} }
    });
    document.body.classList.toggle('muted', muted);
  }

  return {
    preload: preload,
    unlock: unlock,
    startup: startup,
    shutdown: shutdown,
    error: error,
    setMuted: setMuted,
    isMuted: function () { return muted; },
    toggleMute: function () { setMuted(!muted); return muted; }
  };
})();
