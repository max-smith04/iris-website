/* ============================================================
   photos.js — "Add pictures" in the My Pictures window.

   Phone photos are 4-6 MB and 4000px wide. Sending that at a
   Postgres row would be rude, so everything is re-drawn onto a
   canvas here first: 1600px long edge for the full version, 420px
   for the thumbnail, both JPEG. A 5 MB original lands as roughly
   300 KB, which bytea handles happily.
   ============================================================ */
(function () {
  'use strict';

  var API = '/api/photos';
  var FULL = 1600;
  var THUMB = 420;
  var QUALITY = 0.82;
  var THUMB_QUALITY = 0.78;

  document.addEventListener('iris:windowopened', function (e) {
    if (e.detail.id === 'pics') init(e.detail.el);
  });

  /* draw an image onto a canvas at a bounded size and return base64 JPEG */
  function shrink(img, max, quality) {
    var w = img.width, h = img.height;
    var s = Math.min(1, max / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    var ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    var url = c.toDataURL('image/jpeg', quality);
    return url.slice(url.indexOf(',') + 1);
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('not an image')); };
      img.src = url;
    });
  }

  function init(win) {
    var $ = function (s) { return win.querySelector(s); };

    var thumbs = $('.thumbs');
    var input  = $('#pic-file');
    var addB   = $('#pic-add');
    var nameI  = $('#pic-name');
    var status = $('#pic-status');
    if (!thumbs || !input) return;

    var builtIn = thumbs.children.length;

    function setStatus(text, kind) {
      status.textContent = text || '';
      status.className = 'pic-status' + (kind ? ' ' + kind : '');
    }

    function countObjects() {
      win.querySelector('.win-status span').textContent =
        thumbs.children.length + ' objects';
    }

    function addThumb(p) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'thumb';
      btn.dataset.full = API + '?id=' + p.id;
      btn.dataset.name = p.name;
      btn.dataset.caption = p.caption
        ? (p.uploader ? p.caption + ' — ' + p.uploader : p.caption)
        : (p.uploader ? 'added by ' + p.uploader : 'added by a visitor');

      var frame = document.createElement('span');
      frame.className = 'thumb-frame';
      var img = document.createElement('img');
      img.src = API + '?id=' + p.id + '&t=1';
      img.loading = 'lazy';
      img.alt = p.caption ? decodeEntities(p.caption) : 'A photo added by a visitor';
      frame.appendChild(img);

      var nm = document.createElement('span');
      nm.className = 'thumb-name';
      nm.textContent = p.name;

      btn.appendChild(frame);
      btn.appendChild(nm);
      li.appendChild(btn);
      thumbs.appendChild(li);
    }

    /* captions arrive HTML-escaped, same contract as the other endpoints */
    function decodeEntities(s) {
      var d = document.createElement('div');
      d.innerHTML = s;
      return d.textContent || '';
    }

    function render(data) {
      while (thumbs.children.length > builtIn) thumbs.removeChild(thumbs.lastChild);
      (data.photos || []).slice().reverse().forEach(addThumb);
      countObjects();
    }

    function load() {
      fetch(API, { headers: { 'Accept': 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(render)
        .catch(function () {
          setStatus('could not load the added pictures', 'err');
        });
    }
    load();

    addB.addEventListener('click', function () { input.click(); });

    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      if (!files.length) return;

      var images = files.filter(function (f) { return /^image\//.test(f.type); });
      if (!images.length) {
        window.IrisDialog('My Pictures',
          '<strong>That is not a picture.</strong>She only takes image files &mdash; JPEG, PNG, HEIC, whatever your phone makes.');
        return;
      }

      addB.disabled = true;
      var done = 0, failed = 0;

      function next(i) {
        if (i >= images.length) {
          addB.disabled = false;
          setStatus(done + (done === 1 ? ' picture added' : ' pictures added') +
                    (failed ? ', ' + failed + ' would not go' : ''));
          load();
          if (failed && !done) {
            window.IrisDialog('My Pictures',
              '<strong>None of those went in.</strong>They may be too large, or in a format this browser cannot open.');
          }
          return;
        }

        setStatus('shrinking ' + (i + 1) + ' of ' + images.length + '…');
        loadImage(images[i])
          .then(function (img) {
            var payload = {
              data: shrink(img, FULL, QUALITY),
              thumb: shrink(img, THUMB, THUMB_QUALITY),
              name: nameI.value.trim(),
              caption: ''
            };
            setStatus('uploading ' + (i + 1) + ' of ' + images.length + '…');
            return fetch(API, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
          })
          .then(function (r) {
            return r.json().then(function (b) { return { ok: r.ok, body: b }; });
          })
          .then(function (res) {
            if (!res.ok) throw new Error(res.body && res.body.error ? res.body.error : 'upload failed');
            done++;
          })
          .catch(function () { failed++; })
          .then(function () { next(i + 1); });
      }

      next(0);
    });
  }
})();
