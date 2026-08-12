/* Barracoder AI — front-end helper for the team's Cloudflare Worker assist proxy.
 *
 * Plain browser JS. No modules, no build step, no dependencies.
 *   <script src="assets/ai.js"></script>
 *   BarracoderAI.configure({ endpoint: 'https://barracoder-ai.<sub>.workers.dev' });
 *
 * Exposes a single global: window.BarracoderAI
 *   configure({ endpoint })      set the Worker origin (call once, on page load)
 *   hasPasscode()  -> boolean    is a team passcode saved on this device?
 *   setPasscode(s)               save it   (localStorage key 'bar:aiPasscode')
 *   clearPasscode()              forget it
 *   run(task, input[, opts])     -> Promise<{ok, text, usage}>; rejects with an
 *                                  Error whose .code is a contract error code
 *                                  (bad_json | bad_task | bad_passcode | too_large |
 *                                   rate_limited | refused | upstream_error |
 *                                   server_misconfigured), or 'aborted' when the
 *                                  caller cancelled. .message is always a plain
 *                                  human sentence — never a stack.
 *   panel({ title, task, input, intro })  open the modal and do the whole dance
 *
 * The Anthropic API key lives in the Worker. Nothing secret is stored here — the
 * team passcode is a shared, low-stakes gate that the coach hands out.
 */
(function (window, document) {
  'use strict';

  var STORE_KEY = 'bar:aiPasscode';
  var VALID_TASKS = { recap: true, tidy: true, ask: true };
  var MAX_BODY = 100000;   // characters of JSON — refuse locally past this
  var TIMEOUT_MS = 60000;  // give the model a full minute before giving up

  var endpoint = '';
  var stylesReady = false;
  var live = null;         // the one open panel, or null

  /* ---------------------------------------------------------------- errors */

  var FRIENDLY = {
    bad_json: 'Something went wrong packaging that request. Please try again.',
    bad_task: "That assistant action isn't available on this page.",
    bad_passcode: "That passcode didn't work. Ask Coach for the current team passcode, then try again.",
    too_large: "That's more text than the assistant can take at once. Trim it down and try again.",
    rate_limited: 'The assistant is busy right now. Wait a minute, then try again.',
    refused: "The assistant didn't answer that one. Try asking a different way, or check with Coach.",
    upstream_error: "Couldn't reach the assistant. Check your connection and try again.",
    server_misconfigured: "The assistant isn't switched on yet — Coach needs to finish setting it up.",
    disabled: "Coach has switched the assistant off for now.",
    season_over: 'The BioGlow season is over — the assistant has retired. 🐟',
    truncated: 'That answer got cut off partway through. Try again with a shorter note.'
  };

  function fail(code, friendly) {
    var message = friendly || FRIENDLY[code] || 'The assistant ran into a problem. Please try again.';
    var err = new Error(message);
    err.code = code;
    err.friendly = message;
    return err;
  }

  function friendlyOf(err) {
    if (!err) return FRIENDLY.upstream_error;
    if (err.friendly) return err.friendly;
    if (err.code && FRIENDLY[err.code]) return FRIENDLY[err.code];
    return 'The assistant ran into a problem. Please try again.';
  }

  /* --------------------------------------------------------------- storage */

  function readPasscode() {
    try {
      var v = window.localStorage.getItem(STORE_KEY);
      return typeof v === 'string' && v.trim() ? v : '';
    } catch (e) { return ''; }
  }

  function writePasscode(v) {
    try {
      if (v && String(v).trim()) window.localStorage.setItem(STORE_KEY, String(v).trim());
      else window.localStorage.removeItem(STORE_KEY);
    } catch (e) { /* private browsing — the passcode just won't stick */ }
  }

  /* ---------------------------------------------------------------- styles */

  var CSS = [
    '.bai-ov{position:fixed; inset:0; z-index:120; display:flex; align-items:center; justify-content:center;',
    '  padding:4vh 16px; background:rgba(0,0,0,.55); -webkit-backdrop-filter:blur(2px); backdrop-filter:blur(2px)}',
    '.bai-box{display:flex; flex-direction:column; width:min(680px,100%); max-height:92vh; overflow:hidden;',
    '  background:var(--card); color:var(--ink); border:1px solid var(--line); border-radius:14px;',
    '  box-shadow:var(--shadow); animation:bai-rise .16s ease-out}',
    '.bai-box:focus{outline:none}',
    '@keyframes bai-rise{from{opacity:0; transform:translateY(8px)} to{opacity:1; transform:none}}',
    '.bai-head{display:flex; align-items:center; gap:12px; padding:13px 16px; border-bottom:1px solid var(--line)}',
    '.bai-head h2{margin:0; flex:1; font-family:Futura,"Avenir Next",system-ui,sans-serif;',
    '  font-size:16px; font-weight:700; line-height:1.3}',
    '.bai-tag{font-size:10.5px; font-weight:800; letter-spacing:.12em; text-transform:uppercase;',
    '  color:var(--accent-ink); background:var(--accent); border-radius:7px; padding:4px 9px; white-space:nowrap}',
    '.bai-body{padding:16px; overflow:auto; display:grid; gap:14px}',
    '.bai-intro{margin:0; font-size:13.5px; color:var(--muted); line-height:1.5}',
    '.bai-out{margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; font-size:15px; line-height:1.62;',
    '  background:var(--paper); border:1px solid var(--line); border-radius:12px; padding:14px 16px}',
    '.bai-note{margin:0; font-size:12px; color:var(--muted)}',
    '.bai-warn{margin:0; font-size:14px; line-height:1.55; color:var(--ink); background:var(--deep);',
    '  border:1px solid var(--amber); border-left-width:4px; border-radius:12px; padding:12px 14px}',
    '.bai-field{display:grid; gap:6px}',
    '.bai-field label{font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--accent)}',
    '.bai-field input{font:inherit; font-size:15px; color:var(--ink); background:var(--paper);',
    '  border:1px solid var(--line); border-radius:10px; padding:10px 12px; width:100%}',
    '.bai-field input:focus{outline:2px solid var(--accent); outline-offset:-1px; border-color:var(--accent)}',
    '.bai-wait{display:flex; align-items:center; gap:10px; font-size:14px; color:var(--muted)}',
    '.bai-dot{width:10px; height:10px; border-radius:50%; background:var(--glow); flex:none; animation:bai-pulse 1.1s ease-in-out infinite}',
    '@keyframes bai-pulse{0%,100%{opacity:.28; transform:scale(.8)} 50%{opacity:1; transform:scale(1)}}',
    '.bai-foot{display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:12px 16px; border-top:1px solid var(--line)}',
    '.bai-foot .bai-sp{flex:1}',
    '.bai-meta{font-size:11.5px; color:var(--muted); font-variant-numeric:tabular-nums}',
    '.bai-btn{font:inherit; font-size:13.5px; font-weight:700; color:var(--ink); background:var(--deep);',
    '  border:1px solid var(--line); border-radius:10px; padding:8px 14px; cursor:pointer}',
    '.bai-btn:hover{border-color:var(--accent); color:var(--accent)}',
    '.bai-btn:focus-visible{outline:2px solid var(--glow); outline-offset:2px}',
    '.bai-btn[disabled]{opacity:.5; cursor:default}',
    '.bai-btn[disabled]:hover{border-color:var(--line); color:var(--ink)}',
    '.bai-btn.pri{background:var(--accent); color:var(--accent-ink); border-color:var(--accent)}',
    '.bai-btn.pri:hover{filter:brightness(1.08); color:var(--accent-ink)}',
    '@media (prefers-reduced-motion: reduce){',
    '  .bai-box{animation:none}',
    '  .bai-dot{animation:none; opacity:.85}',
    '}'
  ].join('\n');

  function ensureStyles() {
    if (stylesReady) return;
    stylesReady = true;
    var s = document.createElement('style');
    s.id = 'bai-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ------------------------------------------------------------- dom utils */
  /* Everything user- or model-supplied goes through textContent. No innerHTML
     anywhere in this file, on purpose — model output must not be able to
     inject markup into the page. */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),' +
    'textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

  function focusables(root) {
    var out = [];
    var all = root.querySelectorAll(FOCUSABLE);
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement) out.push(n);
    }
    return out;
  }

  /* ------------------------------------------------------------- transport */

  function assistUrl() {
    return endpoint.replace(/\/+$/, '') + '/v1/assist';
  }

  function run(task, input, opts) {
    opts = opts || {};

    if (!endpoint) return Promise.reject(fail('server_misconfigured'));
    if (!VALID_TASKS[task]) return Promise.reject(fail('bad_task'));

    var passcode = opts.passcode != null ? String(opts.passcode) : readPasscode();
    if (!passcode) return Promise.reject(fail('bad_passcode', 'Enter the team passcode to use the assistant.'));

    var body;
    try {
      body = JSON.stringify({ passcode: passcode, task: task, input: input || {} });
    } catch (e) {
      return Promise.reject(fail('bad_json'));
    }
    if (body.length > MAX_BODY) return Promise.reject(fail('too_large'));

    if (window.navigator && window.navigator.onLine === false) {
      return Promise.reject(fail('upstream_error', "You're offline right now. Reconnect and try again."));
    }

    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var timedOut = false;
    var timer = null;

    if (ctrl) {
      timer = window.setTimeout(function () { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);
      if (opts.signal) {
        if (opts.signal.aborted) ctrl.abort();
        else opts.signal.addEventListener('abort', function () { ctrl.abort(); });
      }
    }

    return window.fetch(assistUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body,
      signal: ctrl ? ctrl.signal : undefined,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store'
    }).then(function (res) {
      return res.text().then(function (raw) {
        var data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = null; }

        if (!data || typeof data !== 'object') {
          throw fail(statusCode(res.status), statusMessage(res.status));
        }
        if (res.ok && data.ok === true) {
          if (typeof data.text !== 'string' || !data.text.trim()) {
            throw fail('upstream_error', 'The assistant came back empty. Please try again.');
          }
          return {
            ok: true,
            text: data.text,
            usage: (data.usage && typeof data.usage === 'object') ? data.usage : null
          };
        }
        var code = (typeof data.error === 'string' && FRIENDLY[data.error]) ? data.error : statusCode(res.status);
        throw fail(code, FRIENDLY[code]);
      });
    }).then(function (v) {
      window.clearTimeout(timer);
      return v;
    }, function (err) {
      window.clearTimeout(timer);
      if (err && err.code) throw err;                    // already one of ours
      if (timedOut) throw fail('upstream_error', 'That took too long. Try again in a moment.');
      if (err && err.name === 'AbortError') {            // caller closed the panel
        var stopped = fail('upstream_error', 'Cancelled.');
        stopped.code = 'aborted';
        throw stopped;
      }
      throw fail('upstream_error');                      // DNS, CORS, offline, TLS…
    });
  }

  function statusCode(status) {
    if (status === 401 || status === 403) return 'bad_passcode';
    if (status === 413) return 'too_large';
    if (status === 429) return 'rate_limited';
    if (status === 400) return 'bad_json';
    return 'upstream_error';
  }

  function statusMessage(status) {
    return FRIENDLY[statusCode(status)];
  }

  /* ----------------------------------------------------------------- panel */

  function panel(opts) {
    opts = opts || {};
    if (live) return live;               // one panel at a time
    ensureStyles();

    var task = opts.task;
    var input = opts.input || {};
    var trigger = document.activeElement;
    var scrollLock = document.body.style.overflow;
    var busy = false;
    var ctrl = null;
    var titleId = 'bai-title-' + Date.now().toString(36);

    var ov = el('div', 'bai-ov');
    var box = el('div', 'bai-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', titleId);
    box.tabIndex = -1;

    var head = el('div', 'bai-head');
    var h2 = el('h2', null, opts.title || 'Barracoder assistant');
    h2.id = titleId;
    var tag = el('span', 'bai-tag', 'AI');
    var xBtn = el('button', 'bai-btn', '✕');
    xBtn.type = 'button';
    xBtn.setAttribute('aria-label', 'Close');
    xBtn.onclick = close;
    head.appendChild(h2);
    head.appendChild(tag);
    head.appendChild(xBtn);

    var bodyEl = el('div', 'bai-body');
    var foot = el('div', 'bai-foot');

    box.appendChild(head);
    box.appendChild(bodyEl);
    box.appendChild(foot);
    ov.appendChild(box);

    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });

    /* Keys that reach the dialog stop here, so the host page's global shortcuts
       (meeting.html run mode uses Space / s / f / arrows) stay quiet while the
       modal is up. Bubble phase, so our own field listeners still fire first. */
    ov.addEventListener('keydown', stopKeys);
    ov.addEventListener('keyup', stopKeys);
    ov.addEventListener('keypress', stopKeys);

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn, true);

    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';

    live = { close: close };

    if (readPasscode()) start();
    else askPasscode(null);

    return live;

    /* ---- states ---- */

    function paint(bodyNodes, footNodes, focusTarget) {
      clear(bodyEl);
      clear(foot);
      if (opts.intro) bodyEl.appendChild(el('p', 'bai-intro', opts.intro));
      bodyNodes.forEach(function (n) { bodyEl.appendChild(n); });
      footNodes.forEach(function (n) { foot.appendChild(n); });
      bodyEl.scrollTop = 0;
      (focusTarget || box).focus();
    }

    function askPasscode(warning) {
      var nodes = [];
      if (warning) nodes.push(el('p', 'bai-warn', warning));

      var field = el('div', 'bai-field');
      var label = el('label', null, 'Team passcode');
      var inputEl = document.createElement('input');
      inputEl.type = 'password';
      inputEl.id = 'bai-pass-' + Date.now().toString(36);
      inputEl.autocomplete = 'current-password';
      inputEl.spellcheck = false;
      inputEl.setAttribute('autocapitalize', 'off');
      label.setAttribute('for', inputEl.id);
      field.appendChild(label);
      field.appendChild(inputEl);
      nodes.push(field);
      nodes.push(el('p', 'bai-note', 'Coach has the passcode. It is saved on this device only, so you only type it once.'));

      var go = el('button', 'bai-btn pri', 'Continue');
      go.type = 'button';
      go.onclick = submit;
      var cancel = el('button', 'bai-btn', 'Cancel');
      cancel.type = 'button';
      cancel.onclick = close;

      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });

      function submit() {
        var v = inputEl.value.trim();
        if (!v) { inputEl.focus(); return; }
        writePasscode(v);
        start();
      }

      paint(nodes, [cancel, el('span', 'bai-sp'), go], inputEl);
    }

    function working() {
      var wait = el('div', 'bai-wait');
      wait.appendChild(el('span', 'bai-dot'));
      wait.appendChild(el('span', null, 'Working…'));
      wait.setAttribute('role', 'status');
      wait.setAttribute('aria-live', 'polite');

      var cancel = el('button', 'bai-btn', 'Cancel');
      cancel.type = 'button';
      cancel.onclick = close;

      paint([wait], [el('span', 'bai-sp'), cancel], cancel);
    }

    function showResult(res) {
      var out = el('div', 'bai-out', res.text);
      out.tabIndex = 0;
      out.setAttribute('role', 'region');
      out.setAttribute('aria-label', 'Assistant answer');

      var nodes = [out];
      nodes.push(el('p', 'bai-note', 'Written by AI from what you gave it — read it over before you share it.'));

      var copy = el('button', 'bai-btn pri', 'Copy');
      copy.type = 'button';
      copy.onclick = function () { copyText(res.text, copy); };
      var done = el('button', 'bai-btn', 'Close');
      done.type = 'button';
      done.onclick = close;

      var footNodes = [];
      if (res.usage && (res.usage['in'] != null || res.usage.out != null)) {
        footNodes.push(el('span', 'bai-meta',
          'tokens ' + (res.usage['in'] != null ? res.usage['in'] : '?') +
          ' in · ' + (res.usage.out != null ? res.usage.out : '?') + ' out'));
      }
      footNodes.push(el('span', 'bai-sp'));
      footNodes.push(done);
      footNodes.push(copy);

      paint(nodes, footNodes, copy);
    }

    function showError(err) {
      var again = el('button', 'bai-btn pri', 'Try again');
      again.type = 'button';
      again.onclick = start;
      var done = el('button', 'bai-btn', 'Close');
      done.type = 'button';
      done.onclick = close;

      var warn = el('p', 'bai-warn', friendlyOf(err));
      warn.setAttribute('role', 'alert');

      paint([warn], [done, el('span', 'bai-sp'), again], again);
    }

    /* ---- flow ---- */

    function start() {
      if (busy) return;                         // guard double-submits
      busy = true;
      ctrl = ('AbortController' in window) ? new AbortController() : null;
      working();

      run(task, input, { signal: ctrl ? ctrl.signal : undefined }).then(function (res) {
        busy = false;
        if (!live) return;                      // panel was closed mid-flight
        showResult(res);
      }, function (err) {
        busy = false;
        if (!live) return;
        if (err && err.code === 'aborted') return;
        if (err && err.code === 'bad_passcode') {
          clearPasscode();
          askPasscode(friendlyOf(err));
          return;
        }
        showError(err);
      });
    }

    function copyText(text, btn) {
      var label = btn.textContent;
      var ok = function () {
        btn.textContent = 'Copied ✓';
        window.setTimeout(function () { btn.textContent = label; }, 1600);
      };
      var no = function () {
        btn.textContent = 'Press ⌘/Ctrl+C';
        window.setTimeout(function () { btn.textContent = label; }, 2400);
      };
      if (window.navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, function () { legacyCopy(text) ? ok() : no(); });
      } else {
        legacyCopy(text) ? ok() : no();
      }
    }

    function legacyCopy(text) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        box.appendChild(ta);
        ta.select();
        var okc = document.execCommand('copy');
        box.removeChild(ta);
        return !!okc;
      } catch (e) { return false; }
    }

    /* ---- a11y plumbing ---- */

    function stopKeys(e) { e.stopPropagation(); }

    function onKey(e) {
      if (!live) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.stopPropagation();       // don't let the host page act on it too
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      var f = focusables(box);
      if (!f.length) { e.preventDefault(); box.focus(); return; }
      var first = f[0], last = f[f.length - 1], active = document.activeElement;
      var inside = box.contains(active);
      if (e.shiftKey && (!inside || active === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus(); }
    }

    function onFocusIn(e) {
      if (live && !box.contains(e.target)) box.focus();
    }

    function close() {
      if (!live) return;
      live = null;
      busy = false;
      if (ctrl) { try { ctrl.abort(); } catch (e) {} }
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn, true);
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      document.body.style.overflow = scrollLock;
      if (trigger && typeof trigger.focus === 'function' && document.contains(trigger)) trigger.focus();
    }
  }

  /* ------------------------------------------------------------------- api */

  function configure(cfg) {
    cfg = cfg || {};
    if (typeof cfg.endpoint === 'string') endpoint = cfg.endpoint.trim().replace(/\/+$/, '');
    return endpoint;
  }

  function hasPasscode() { return !!readPasscode(); }
  function setPasscode(v) { writePasscode(v); }
  function clearPasscode() { writePasscode(''); }

  window.BarracoderAI = {
    configure: configure,
    hasPasscode: hasPasscode,
    setPasscode: setPasscode,
    clearPasscode: clearPasscode,
    run: run,
    panel: panel
  };

})(window, document);
