/* ============================================================
   glovebox.js — the editable Glovebox.txt window.
   Talks to /api/glovebox (Vercel function -> Neon Postgres).

   Note on escaping: the API returns `content` and `editor` already
   HTML-escaped, matching the ratings endpoint. The <pre> takes that
   string with innerHTML and renders it correctly. The <textarea>
   needs the real characters back, so it goes through decode() —
   which is safe precisely because the string is already escaped:
   parsing "&lt;script&gt;" can only ever produce a text node.
   ============================================================ */
(function () {
  'use strict';

  var API = '/api/glovebox';
  var MAX = 4000;

  document.addEventListener('iris:windowopened', function (e) {
    if (e.detail.id === 'notes') init(e.detail.el);
  });

  function decode(escaped) {
    var d = document.createElement('div');
    d.innerHTML = escaped;              /* already escaped: yields text, never nodes */
    return d.textContent || '';
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

  function init(win) {
    var $ = function (s) { return win.querySelector(s); };

    var view   = $('#gb-view');
    var area   = $('#gb-area');
    var name   = $('#gb-name');
    var who    = $('#gb-who');
    var editB  = $('#gb-edit');
    var saveB  = $('#gb-save');
    var cancelB= $('#gb-cancel');
    var status = $('#gb-status');
    var count  = $('#gb-count');
    if (!view) return;

    /* the text baked into the template is the fallback until the server answers */
    var current = view.textContent;
    var editing = false;
    var loaded = false;

    function setStatus(text, kind) {
      status.textContent = text;
      status.className = 'np-status' + (kind ? ' ' + kind : '');
    }

    function show(mode) {
      editing = (mode === 'edit');
      view.hidden = editing;
      area.hidden = !editing;
      who.hidden = !editing;
      editB.hidden = editing;
      saveB.hidden = !editing;
      cancelB.hidden = !editing;
      count.hidden = !editing;
      win.querySelector('.win-status span').textContent =
        editing ? 'Editing — unsaved' : 'Plain text';
      if (editing) {
        area.value = current;
        tally();
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
      }
    }

    function tally() {
      count.textContent = area.value.length + '/' + MAX;
      count.classList.toggle('over', area.value.length >= MAX);
    }
    area.addEventListener('input', tally);

    /* tab should indent the file, not jump out of the textarea */
    area.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var a = area.selectionStart, b = area.selectionEnd;
        area.value = area.value.slice(0, a) + '  ' + area.value.slice(b);
        area.selectionStart = area.selectionEnd = a + 2;
        tally();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelB.click();
      } else if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveB.click();
      }
    });

    function render(data) {
      if (data && data.content) {
        current = decode(data.content);
        view.textContent = current;
      }
      if (data && data.updated_at) {
        setStatus('last edited ' + (data.editor ? 'by ' + decode(data.editor) + ', ' : '') +
                  when(data.updated_at));
      } else {
        setStatus('never edited');
      }
    }

    function load() {
      setStatus('opening…');
      fetch(API, { headers: { 'Accept': 'application/json' } })
        .then(function (r) {
          if (!r.ok) throw new Error('http ' + r.status);
          return r.json();
        })
        .then(function (d) { loaded = true; render(d); })
        .catch(function () {
          setStatus('could not reach the glovebox — showing the paper copy', 'err');
        });
    }
    load();

    editB.addEventListener('click', function () {
      if (!loaded) {
        window.IrisDialog('Glovebox.txt',
          '<strong>Not so fast.</strong>The glovebox has not loaded yet, so saving now would overwrite whatever is really in there. Give it a moment.');
        return;
      }
      show('edit');
    });

    cancelB.addEventListener('click', function () {
      show('view');
      render(null);
      load();
    });

    saveB.addEventListener('click', function () {
      var text = area.value;
      if (!text.trim()) {
        window.IrisDialog('Glovebox.txt',
          '<strong>She will not file an empty glovebox.</strong>Put something in it — even just the chocolate.');
        return;
      }

      saveB.disabled = true;
      cancelB.disabled = true;
      saveB.textContent = 'Saving…';

      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, name: name.value.trim() })
      })
        .then(function (r) {
          return r.json().then(function (b) { return { ok: r.ok, body: b }; });
        })
        .then(function (res) {
          if (!res.ok) throw new Error(res.body && res.body.error ? res.body.error : 'Something went wrong.');
          render(res.body);
          show('view');
          setStatus('saved. ' + status.textContent);
        })
        .catch(function (err) {
          window.IrisDialog('Glovebox.txt',
            '<strong>That did not save.</strong>' + escapeText(err.message || 'Unknown error.'));
        })
        .then(function () {
          saveB.disabled = false;
          cancelB.disabled = false;
          saveB.textContent = 'Save';
        });
    });

    function escapeText(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    show('view');
  }
})();
