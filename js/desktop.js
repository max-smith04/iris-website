/* ============================================================
   desktop.js — the shell: boot, windows, taskbar, Start menu,
   clock, dialogs. Vanilla, no build step.
   ============================================================ */
(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var desktop  = $('#desktop');
  var winLayer = $('#windows');
  var taskbar  = $('#taskbar');
  var tasks    = $('#tasks');
  var startBtn = $('#startbtn');
  var startMenu= $('#startmenu');
  var isSmall  = function () { return window.innerWidth <= 760; };

  /* ---------- the app catalogue ---------- */
  var APPS = {
    iris:  { title: 'IRIS',          icon: '#ic-car',    tpl: '#tpl-iris',  w: 720, h: 560, status: 'Iris · 2022 Suzuki Swift GL' },
    about: { title: 'About Me',      icon: '#ic-folder', tpl: '#tpl-about', w: 660, h: 540, status: '8 objects' },
    rate:  { title: 'Rate Me',       icon: '#ic-star',   tpl: '#tpl-rate',  w: 640, h: 580, status: 'Connected to iris-db' },
    pics:  { title: 'My Pictures',   icon: '#ic-pics',   tpl: '#tpl-pics',  w: 700, h: 520, status: '3 objects' },
    viewer:{ title: 'Picture Viewer',icon: '#ic-pics',   tpl: '#tpl-viewer',w: 720, h: 620, status: '' },
    notes: { title: 'Glovebox.txt',  icon: '#ic-note',   tpl: '#tpl-notes', w: 440, h: 420, status: 'Plain text' },
    bin:   { title: 'Recycle Bin',   icon: '#ic-bin',    tpl: '#tpl-bin',   w: 420, h: 300, status: '0 objects' }
  };

  var open = {};        /* id -> {el, task, prev} */
  var zTop = 10;
  var spawn = 0;

  /* ============================================================
     MODAL DIALOG
     ============================================================ */
  var modalLayer = $('#modal-layer');
  var lastFocus = null;

  function dialog(caption, html, kind) {
    $('#modal-cap').textContent = caption;
    $('#modal-msg').innerHTML = html;
    $('#modal-ico use').setAttribute('href', kind === 'info' ? '#ic-help' : '#ic-error');
    lastFocus = document.activeElement;
    modalLayer.hidden = false;
    var ok = $('#modal .xp-btn');
    if (ok) ok.focus();
    if (kind !== 'info') window.Sound.error();
  }
  function closeDialog() {
    modalLayer.hidden = true;
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }
  modalLayer.addEventListener('click', function (e) {
    if (e.target.closest('[data-modal-close]') || e.target.id === 'modal-scrim') closeDialog();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modalLayer.hidden) { closeDialog(); return; }
    if (e.key === 'Escape' && !startMenu.hidden) closeStart();
  });
  /* keep tab focus inside the dialog while it is up */
  document.addEventListener('focusin', function (e) {
    if (modalLayer.hidden) return;
    if (!$('#modal').contains(e.target)) $('#modal .xp-btn').focus();
  });

  window.IrisDialog = dialog;

  /* ============================================================
     WINDOWS
     ============================================================ */
  function deskRect() {
    return { w: window.innerWidth, h: window.innerHeight - taskbar.offsetHeight };
  }

  function focusWin(id) {
    Object.keys(open).forEach(function (k) {
      var o = open[k];
      var active = (k === id);
      o.el.classList.toggle('inactive', !active);
      o.task.classList.toggle('active', active && !o.el.classList.contains('minimised'));
    });
    if (open[id]) {
      open[id].el.style.zIndex = ++zTop;
      open[id].el.classList.remove('minimised');
      open[id].task.classList.add('active');
    }
  }

  function openWin(id) {
    var app = APPS[id];
    if (!app) return;
    if (open[id]) { focusWin(id); return; }

    var d = deskRect();
    var small = isSmall();
    var w = Math.min(app.w, d.w - 24);
    var h = Math.min(app.h, d.h - 24);
    var offset = (spawn++ % 6) * 26;
    var x = Math.max(8, Math.round((d.w - w) / 2 - 60) + offset);
    var y = Math.max(8, Math.round((d.h - h) / 2 - 30) + offset);

    var el = document.createElement('section');
    el.className = 'win';
    el.dataset.win = id;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.zIndex = ++zTop;
    el.innerHTML =
      '<div class="win-title">' +
        '<span class="win-icon"><svg><use href="' + app.icon + '"/></svg></span>' +
        '<span class="win-caption"></span>' +
        '<div class="win-btns">' +
          '<button class="tb min" title="Minimize" aria-label="Minimize"></button>' +
          '<button class="tb max" title="Maximize" aria-label="Maximize"></button>' +
          '<button class="tb close" title="Close" aria-label="Close"></button>' +
        '</div>' +
      '</div>' +
      '<div class="win-menubar"><span>File</span><span>Edit</span><span>View</span><span>Favourites</span><span>Help</span></div>' +
      '<div class="win-body"></div>' +
      '<div class="win-status"><span></span><span>My Computer</span></div>' +
      '<div class="win-grip" title="Resize"></div>';

    $('.win-caption', el).textContent = app.title;
    $('.win-status span', el).textContent = app.status;
    $('.win-body', el).appendChild(document.querySelector(app.tpl).content.cloneNode(true));
    winLayer.appendChild(el);

    var task = document.createElement('button');
    task.className = 'task';
    task.innerHTML = '<svg><use href="' + app.icon + '"/></svg><span></span>';
    $('span', task).textContent = app.title;
    task.addEventListener('click', function () {
      var o = open[id];
      if (!o) return;
      var isActive = o.task.classList.contains('active') && !o.el.classList.contains('minimised');
      if (isActive) { minimise(id); } else { focusWin(id); }
    });
    tasks.appendChild(task);

    open[id] = { el: el, task: task, prev: null };

    $('.tb.min', el).addEventListener('click', function (e) { e.stopPropagation(); minimise(id); });
    $('.tb.max', el).addEventListener('click', function (e) { e.stopPropagation(); toggleMax(id); });
    $('.tb.close', el).addEventListener('click', function (e) { e.stopPropagation(); closeWin(id); });
    $('.win-title', el).addEventListener('dblclick', function (e) {
      if (!e.target.closest('.tb')) toggleMax(id);
    });
    el.addEventListener('pointerdown', function () { focusWin(id); }, true);

    dragify(el, $('.win-title', el), id);
    resizify(el, $('.win-grip', el));

    if (small) toggleMax(id, true);
    focusWin(id);
    el.dispatchEvent(new CustomEvent('iris:opened', { bubbles: true, detail: { id: id } }));
    document.dispatchEvent(new CustomEvent('iris:windowopened', { detail: { id: id, el: el } }));
    return el;
  }

  function minimise(id) {
    var o = open[id]; if (!o) return;
    o.el.classList.add('minimised');
    o.task.classList.remove('active');
  }

  function toggleMax(id, force) {
    var o = open[id]; if (!o) return;
    var el = o.el;
    if (!el.classList.contains('maximised') || force === true) {
      if (el.classList.contains('maximised')) return;
      o.prev = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
      var d = deskRect();
      el.classList.add('maximised');
      el.style.left = '0px'; el.style.top = '0px';
      el.style.width = d.w + 'px'; el.style.height = d.h + 'px';
      $('.tb.max', el).title = 'Restore';
    } else {
      el.classList.remove('maximised');
      if (o.prev) {
        el.style.left = o.prev.left; el.style.top = o.prev.top;
        el.style.width = o.prev.width; el.style.height = o.prev.height;
      }
      $('.tb.max', el).title = 'Maximize';
    }
    focusWin(id);
  }

  function closeWin(id) {
    var o = open[id]; if (!o) return;
    o.el.remove(); o.task.remove();
    delete open[id];
    var rest = Object.keys(open);
    if (rest.length) focusWin(rest[rest.length - 1]);
  }

  /* ---------- dragging ---------- */
  function dragify(el, handle, id) {
    var sx, sy, ox, oy, dragging = false;
    handle.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.tb')) return;
      if (el.classList.contains('maximised')) return;
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      ox = parseInt(el.style.left, 10) || 0;
      oy = parseInt(el.style.top, 10) || 0;
      handle.setPointerCapture(e.pointerId);
      focusWin(id);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var d = deskRect();
      var nx = ox + (e.clientX - sx);
      var ny = oy + (e.clientY - sy);
      /* keep at least a corner of the title bar reachable */
      nx = Math.max(-(el.offsetWidth - 90), Math.min(d.w - 90, nx));
      ny = Math.max(0, Math.min(d.h - 28, ny));
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      handle.addEventListener(ev, function () { dragging = false; });
    });
  }

  /* ---------- resizing ---------- */
  function resizify(el, grip) {
    var sx, sy, ow, oh, sizing = false;
    grip.addEventListener('pointerdown', function (e) {
      sizing = true;
      sx = e.clientX; sy = e.clientY;
      ow = el.offsetWidth; oh = el.offsetHeight;
      grip.setPointerCapture(e.pointerId);
      e.preventDefault(); e.stopPropagation();
    });
    grip.addEventListener('pointermove', function (e) {
      if (!sizing) return;
      var d = deskRect();
      var w = Math.max(280, Math.min(d.w, ow + (e.clientX - sx)));
      var h = Math.max(180, Math.min(d.h, oh + (e.clientY - sy)));
      el.style.width = w + 'px';
      el.style.height = h + 'px';
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      grip.addEventListener(ev, function () { sizing = false; });
    });
  }

  /* keep windows on screen when the viewport changes */
  window.addEventListener('resize', function () {
    var d = deskRect();
    Object.keys(open).forEach(function (id) {
      var el = open[id].el;
      if (el.classList.contains('maximised')) {
        el.style.width = d.w + 'px'; el.style.height = d.h + 'px';
        return;
      }
      el.style.left = Math.max(-(el.offsetWidth - 90), Math.min(d.w - 90, parseInt(el.style.left, 10) || 0)) + 'px';
      el.style.top  = Math.max(0, Math.min(d.h - 28, parseInt(el.style.top, 10) || 0)) + 'px';
    });
  });

  window.IrisOpen = openWin;

  /* ============================================================
     DESKTOP ICONS
     ============================================================ */
  var lastTap = { el: null, t: 0 };

  $$('.dicon').forEach(function (ic) {
    ic.addEventListener('click', function () {
      $$('.dicon').forEach(function (o) {
        o.classList.toggle('selected', o === ic);
        o.setAttribute('aria-selected', o === ic ? 'true' : 'false');
      });
      /* touch has no dblclick worth relying on: fake it */
      var now = Date.now();
      if (lastTap.el === ic && now - lastTap.t < 450) {
        openWin(ic.dataset.open);
        lastTap = { el: null, t: 0 };
      } else {
        lastTap = { el: ic, t: now };
      }
    });
    ic.addEventListener('dblclick', function () { openWin(ic.dataset.open); });
    ic.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWin(ic.dataset.open); }
    });
  });

  desktop.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.dicon') || e.target.closest('.win')) return;
    $$('.dicon').forEach(function (o) { o.classList.remove('selected'); o.setAttribute('aria-selected', 'false'); });
  });

  /* any [data-open] anywhere (buttons inside documents, Start menu) opens a window */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-open]');
    if (!t || t.classList.contains('dicon')) return;
    var id = t.dataset.open;
    if (id === 'all') {
      dialog('All Programs', '<strong>That is all of them.</strong>There are five. It is a small car.', 'info');
    } else {
      openWin(id);
    }
    closeStart();
  });

  /* double-click a thumbnail to open it in the picture viewer */
  var PICTURES = {
    'iris-driveway':     'Home, on the bricks, guarded by a guineafowl.',
    'iris-delivery-day': 'Day one. The bow was not my idea, but I wore it well.',
    'iris-cederberg':    'Cederberg. I was not designed for this. I did it anyway.'
  };
  function openPicture(key, caption) {
    if (!PICTURES[key]) return;
    var el = open.viewer ? (focusWin('viewer'), open.viewer.el) : openWin('viewer');
    var img = el.querySelector('#viewer-img');
    var cap = el.querySelector('#viewer-cap');
    img.src = 'assets/pictures/' + key + '.jpg';
    img.alt = caption || PICTURES[key];
    cap.textContent = PICTURES[key];
    el.querySelector('.win-caption').textContent = key + '.jpg';
    el.querySelector('.win-status span').textContent = key + '.jpg';
    open.viewer.task.querySelector('span').textContent = key + '.jpg';
    el.querySelector('.win-body').scrollTop = 0;
  }
  document.addEventListener('dblclick', function (e) {
    var t = e.target.closest('.thumb');
    if (t) openPicture(t.dataset.pic, t.dataset.caption);
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest('.thumb');
    if (!t) return;
    Array.prototype.forEach.call(document.querySelectorAll('.thumb'), function (o) {
      o.classList.toggle('selected', o === t);
    });
    var now = Date.now();
    if (lastThumb.el === t && now - lastThumb.t < 450) {      /* touch double-tap */
      openPicture(t.dataset.pic, t.dataset.caption);
      lastThumb = { el: null, t: 0 };
    } else {
      lastThumb = { el: t, t: now };
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = document.activeElement && document.activeElement.closest
          ? document.activeElement.closest('.thumb') : null;
    if (t) { e.preventDefault(); openPicture(t.dataset.pic, t.dataset.caption); }
  });
  var lastThumb = { el: null, t: 0 };

  /* the decorative Start-menu entries */
  var JOKES = {
    control:  ['Control Panel', '<strong>Access denied.</strong>The only controls are a steering wheel, three pedals and a gear lever. Please use those.'],
    printers: ['Printers and Faxes', '<strong>No printers installed.</strong>There is a parking ticket in the door pocket if you need something on paper.'],
    help:     ['Help and Support', '<strong>Have you tried turning her off and on again?</strong>It works. It always works. Clutch in, key round, wait for the rattle to settle.'],
    search:   ['Search', '<strong>Nothing found.</strong>Whatever you are looking for is under the passenger seat. It is always under the passenger seat.'],
    run:      ['Run', '<strong>Run where?</strong>Give me half a tank and a Tuesday and I will take you anywhere.']
  };
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-msg]');
    if (!t) return;
    var j = JOKES[t.dataset.msg];
    if (j) dialog(j[0], j[1], 'info');
    closeStart();
  });

  /* ============================================================
     START MENU
     ============================================================ */
  function openStart() {
    startMenu.hidden = false;
    startBtn.setAttribute('aria-expanded', 'true');
  }
  function closeStart() {
    startMenu.hidden = true;
    startBtn.setAttribute('aria-expanded', 'false');
  }
  startBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (startMenu.hidden) openStart(); else closeStart();
  });
  document.addEventListener('pointerdown', function (e) {
    if (startMenu.hidden) return;
    if (e.target.closest('#startmenu') || e.target.closest('#startbtn')) return;
    closeStart();
  });

  $('#sm-logoff').addEventListener('click', function () {
    closeStart();
    dialog('Log Off', '<strong>You cannot log off.</strong>You have the keys. That is a commitment.', 'info');
  });
  $('#sm-shutdown').addEventListener('click', function () {
    closeStart();
    window.Sound.shutdown();
    Object.keys(open).forEach(closeWin);
    $('#shutdown').hidden = false;
  });
  $('#sd-restart').addEventListener('click', function () {
    $('#shutdown').hidden = true;
    runBoot(true);
  });

  /* ============================================================
     TRAY
     ============================================================ */
  var clock = $('#clock');
  function tick() {
    var now = new Date();
    clock.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    clock.dateTime = now.toISOString();
    clock.title = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  tick();
  setInterval(tick, 1000);

  var vol = $('#volume');
  document.body.classList.toggle('muted', window.Sound.isMuted());
  vol.addEventListener('click', function () {
    window.Sound.unlock();
    var m = window.Sound.toggleMute();
    vol.title = m ? 'Sound is off' : 'Sound is on';
    vol.setAttribute('aria-label', vol.title);
  });
  vol.title = window.Sound.isMuted() ? 'Sound is off' : 'Sound is on';

  /* ============================================================
     BOOT — no splash and no progress bar: half a second of black, then
     the desktop. Nothing opens on its own; the icons are the way in.
     ============================================================ */
  var boot = $('#boot');
  var bootTimer = null;
  var bootDone = false;

  function finishBoot() {
    if (bootDone) return;
    bootDone = true;
    clearTimeout(bootTimer);
    boot.classList.add('gone');
    document.body.classList.add('booted');
    desktop.setAttribute('aria-hidden', 'false');
  }

  function runBoot(restart) {
    bootDone = false;
    boot.classList.remove('gone');
    document.body.classList.remove('booted');
    desktop.setAttribute('aria-hidden', 'true');
    if (restart) window.Sound.startup();
    bootTimer = setTimeout(finishBoot, 500);
  }

  /* Try the startup sound the moment the page loads. Most browsers block audio
     until the visitor has interacted with the page, so if that attempt is
     refused we arm it on the first click or keypress instead — the sound is
     never muted, it just waits for permission. */
  window.Sound.unlock();
  window.Sound.startup(function blocked() {
    function firstGesture() {
      window.Sound.unlock();
      window.Sound.startup();
      document.removeEventListener('pointerdown', firstGesture, true);
      document.removeEventListener('keydown', firstGesture, true);
    }
    document.addEventListener('pointerdown', firstGesture, true);
    document.addEventListener('keydown', firstGesture, true);
  });

  boot.addEventListener('click', finishBoot);

  bootTimer = setTimeout(finishBoot, 500);
})();
