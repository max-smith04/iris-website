/* ============================================================
   ratings.js — the Rate Me widget.
   Talks to /api/ratings (Vercel function -> Neon Postgres).

   Note on escaping: the API returns `name` and `comment` already
   HTML-escaped, so they are injected with innerHTML and round-trip
   exactly (a literal "<b>" comes back as "&lt;b&gt;" and renders as
   text). Never swap these for textContent without also dropping the
   escaping on the server, or entities will show up raw.
   ============================================================ */
(function () {
  'use strict';

  var API = '/api/ratings';
  var WORDS = {
    0: 'no stars yet',
    1: 'ouch',
    2: 'fair enough',
    3: 'she has been called worse',
    4: 'now we are talking',
    5: 'she is blushing'
  };

  document.addEventListener('iris:windowopened', function (e) {
    if (e.detail.id === 'rate') init(e.detail.el);
  });

  function init(win) {
    var $ = function (s) { return win.querySelector(s); };

    var form     = $('#rate-form');
    var starsBox = $('#stars');
    var starEls  = Array.prototype.slice.call(win.querySelectorAll('.star'));
    var word     = $('#stars-word');
    var comment  = $('#rate-comment');
    var name     = $('#rate-name');
    var counter  = $('#cc');
    var submit   = $('#rate-submit');
    var status   = $('#rate-status');
    var avgBox   = $('#avg');
    var listBox  = $('#rating-list');
    var refresh  = $('#rate-refresh');
    if (!form) return;

    var value = 0;

    /* ---------- stars ---------- */
    function paint(n) {
      starEls.forEach(function (s, i) {
        s.classList.toggle('on', i < n);
        s.setAttribute('aria-checked', (i + 1 === value) ? 'true' : 'false');
      });
      word.textContent = WORDS[n] || WORDS[0];
    }
    function setValue(n) {
      value = n;
      starsBox.classList.remove('bad');
      paint(n);
    }

    starEls.forEach(function (s, i) {
      s.addEventListener('click', function () { setValue(i + 1); });
      s.addEventListener('mouseenter', function () { paint(i + 1); });
      s.addEventListener('focus', function () { paint(i + 1); });
    });
    starsBox.addEventListener('mouseleave', function () { paint(value); });
    starsBox.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1
            : e.key === 'ArrowLeft'  || e.key === 'ArrowDown' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var n = Math.min(5, Math.max(1, (value || 0) + d));
      setValue(n);
      starEls[n - 1].focus();
    });
    paint(0);

    /* ---------- counter ---------- */
    comment.addEventListener('input', function () {
      counter.textContent = String(comment.value.length);
    });

    /* ---------- rendering ---------- */
    function starRow(n) {
      var frag = document.createElement('span');
      frag.className = 'avg-stars';
      for (var i = 1; i <= 5; i++) {
        var el = document.createElement('i');
        if (n >= i) el.className = 'on';
        else if (n >= i - 0.5) el.className = 'half';
        frag.appendChild(el);
      }
      return frag;
    }

    function when(iso) {
      var d = new Date(iso);
      if (isNaN(d)) return '';
      var diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 60)     return 'just now';
      if (diff < 3600)   return Math.floor(diff / 60) + ' min ago';
      if (diff < 86400)  return Math.floor(diff / 3600) + ' hr ago';
      if (diff < 604800) return Math.floor(diff / 86400) + ' days ago';
      return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function renderEmpty() {
      avgBox.innerHTML = '';
      var li = document.createElement('li');
      li.className = 'bare list-note';
      li.textContent = 'Nobody has rated her yet. Someone has to go first — it might as well be you.';
      listBox.innerHTML = '';
      listBox.appendChild(li);
    }

    function renderError(msg, retry) {
      avgBox.innerHTML = '';
      listBox.innerHTML = '';
      var li = document.createElement('li');
      li.className = 'bare list-note';
      li.textContent = msg;
      listBox.appendChild(li);
      if (retry) {
        var li2 = document.createElement('li');
        li2.className = 'bare';
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'xp-btn'; b.textContent = 'Try again';
        b.addEventListener('click', load);
        li2.appendChild(b);
        listBox.appendChild(li2);
      }
    }

    function render(data) {
      var list = data.ratings || [];
      if (!list.length) { renderEmpty(); return; }

      avgBox.innerHTML = '';
      var head = document.createElement('div');
      head.className = 'avg-big';
      var num = document.createElement('span');
      num.className = 'avg-num';
      num.textContent = Number(data.average).toFixed(1);
      var out = document.createElement('span');
      out.className = 'avg-out';
      out.textContent = 'out of 5 · ' + data.count + (data.count === 1 ? ' rating' : ' ratings');
      head.appendChild(num);
      head.appendChild(starRow(Number(data.average)));
      head.appendChild(out);
      avgBox.appendChild(head);

      listBox.innerHTML = '';
      list.forEach(function (r) {
        var li = document.createElement('li');
        var h  = document.createElement('div');
        h.className = 'r-head';
        var nm = document.createElement('span');
        nm.className = 'r-name';
        nm.innerHTML = r.name;                 /* pre-escaped by the API */
        var st = starRow(r.stars);
        var wn = document.createElement('span');
        wn.className = 'r-when';
        wn.textContent = when(r.created_at);
        h.appendChild(nm); h.appendChild(st); h.appendChild(wn);
        li.appendChild(h);
        if (r.comment) {
          var c = document.createElement('p');
          c.className = 'r-comment';
          c.innerHTML = r.comment;             /* pre-escaped by the API */
          li.appendChild(c);
        }
        listBox.appendChild(li);
      });
    }

    function skeleton() {
      avgBox.innerHTML = '';
      listBox.innerHTML = '';
      for (var i = 0; i < 3; i++) {
        var li = document.createElement('li');
        li.className = 'skeleton';
        listBox.appendChild(li);
      }
    }

    /* ---------- data ---------- */
    function load() {
      skeleton();
      fetch(API, { headers: { 'Accept': 'application/json' } })
        .then(function (r) {
          if (!r.ok) throw new Error('http ' + r.status);
          return r.json();
        })
        .then(render)
        .catch(function () {
          renderError('Could not reach the ratings service. She is probably fine — the database just is not answering.', true);
        });
    }
    refresh.addEventListener('click', load);
    load();

    /* ---------- submit ---------- */
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      status.textContent = ''; status.className = 'rate-status';

      var problems = [];
      var nameFld = name.closest('.fld');
      nameFld.classList.remove('bad');
      starsBox.classList.remove('bad');

      if (!value) { problems.push('pick a number of stars'); starsBox.classList.add('bad'); }
      if (!name.value.trim()) { problems.push('tell her your name'); nameFld.classList.add('bad'); }

      if (problems.length) {
        window.IrisDialog(
          'Rate Me',
          '<strong>She cannot file that.</strong>Please ' + problems.join(' and ') + ', then try again.'
        );
        return;
      }

      submit.disabled = true;
      submit.textContent = 'Sending…';

      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.value.trim(),
          stars: value,
          comment: comment.value.trim()
        })
      })
        .then(function (r) {
          return r.json().then(function (b) { return { ok: r.ok, body: b }; });
        })
        .then(function (res) {
          if (!res.ok) throw new Error(res.body && res.body.error ? res.body.error : 'Something went wrong.');
          quietReset = true;
          form.reset();
          setValue(0);
          counter.textContent = '0';
          status.textContent = 'Filed. She read it twice.';
          render(res.body);
        })
        .catch(function (err) {
          window.IrisDialog('Rate Me', '<strong>That did not go through.</strong>' + escapeText(err.message || 'Unknown error.'));
        })
        .then(function () {
          submit.disabled = false;
          submit.textContent = 'Submit';
        });
    });

    /* form.reset() after a successful post must not wipe the "thanks" line,
       so distinguish our own reset from the visitor pressing Clear. */
    var quietReset = false;
    form.addEventListener('reset', function () {
      var quiet = quietReset;
      quietReset = false;
      setTimeout(function () {
        setValue(0);
        counter.textContent = '0';
        if (!quiet) status.textContent = '';
        name.closest('.fld').classList.remove('bad');
      }, 0);
    });

    function escapeText(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
  }
})();
