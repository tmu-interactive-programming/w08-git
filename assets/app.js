/*
 * W08 Git 協作 — page logic. Plain script (no modules) so it also works from file://.
 * Sections: utils · theme/nav · hero · why · story · commit popover · sandbox · wall · lab · TA mode.
 */
(function () {
  'use strict';

  /* =====================================================================
     Utils
     ===================================================================== */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var store = {
    get: function (key, fallback) {
      try { var v = localStorage.getItem('w08-' + key); return v == null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem('w08-' + key, JSON.stringify(value)); } catch (e) { /* private mode etc. */ }
    },
    del: function (key) { try { localStorage.removeItem('w08-' + key); } catch (e) { /* ignore */ } }
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  function toast(text, kind) {
    var box = $('#toasts');
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = text;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 3700);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); } catch (e) { reject(e); }
      ta.remove();
    });
  }

  /* ---------- confetti ---------- */
  var confetti = (function () {
    var canvas = $('#confetti'), ctx = canvas.getContext && canvas.getContext('2d'), parts = [], raf = null;
    function colors() {
      var cs = getComputedStyle(document.documentElement);
      return [0, 1, 2, 3, 4, 5].map(function (i) { return cs.getPropertyValue('--lane-' + i).trim() || '#6d4aff'; });
    }
    function frame() {
      var dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      parts = parts.filter(function (p) { return p.y < innerHeight + 40 && p.life > 0; });
      parts.forEach(function (p) {
        p.vy += 0.22; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 1;
        ctx.save();
        ctx.translate(p.x * dpr, p.y * dpr);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.globalAlpha = Math.min(1, p.life / 40);
        ctx.fillRect(-p.w * dpr / 2, -p.h * dpr / 2, p.w * dpr, p.h * dpr);
        ctx.restore();
      });
      raf = parts.length ? requestAnimationFrame(frame) : null;
      if (!parts.length) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    return function burst(x, y, n) {
      if (!ctx || reduceMotion) return;
      var dpr = window.devicePixelRatio || 1;
      canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
      x = x == null ? innerWidth / 2 : x; y = y == null ? innerHeight / 3 : y;
      var cs = colors();
      for (var i = 0; i < (n || 160); i++) {
        var a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 9;
        parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6, w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: cs[i % cs.length], life: 120 + Math.random() * 60 });
      }
      if (!raf) raf = requestAnimationFrame(frame);
    };
  })();

  /* ---------- config: org / repo ---------- */
  var CFG = Object.assign({ org: 'your-org', siteRepo: 'w08-git', teams: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'], teamRepo: '{team}', classSize: 42, wallPollSeconds: 20, wallMaxLength: 80 }, window.W08_CONFIG || {});
  (function detect() {
    var host = location.hostname;
    if (/\.github\.io$/i.test(host)) {
      CFG.org = host.split('.')[0];
      var seg = location.pathname.split('/').filter(Boolean)[0];
      if (seg && !/\.html?$/i.test(seg)) CFG.siteRepo = seg;
    }
    try {
      var q = new URLSearchParams(location.search);
      if (q.get('org')) CFG.org = q.get('org');
      if (q.get('repo')) CFG.siteRepo = q.get('repo');
    } catch (e) { /* old browser */ }
  })();
  var GH = 'https://github.com/';
  function teamRepo(team) { return CFG.teamRepo.replace('{team}', team); }

  /* =====================================================================
     Theme, nav, scroll, reveal
     ===================================================================== */
  $('#theme-toggle').addEventListener('click', function () {
    var root = document.documentElement;
    var dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('w08-theme', root.dataset.theme); } catch (e) { /* ignore */ }
  });

  var bar = $('#scroll-bar'), ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var h = document.documentElement.scrollHeight - innerHeight;
      bar.style.width = (h > 0 ? (scrollY / h) * 100 : 0) + '%';
      ticking = false;
    });
  }, { passive: true });

  if ('IntersectionObserver' in window) {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); revealObs.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    $$('.reveal').forEach(function (el) { revealObs.observe(el); });

    var navLinks = $$('.nav a');
    var navObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        navLinks.forEach(function (a) { a.classList.toggle('active', a.dataset.nav === e.target.id); });
        var act = $('.nav a.active');
        if (act && act.scrollIntoView && innerWidth < 700) act.scrollIntoView({ block: 'nearest', inline: 'center' });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    $$('section[data-seg]').forEach(function (s) { navObs.observe(s); });
  } else {
    $$('.reveal').forEach(function (el) { el.classList.add('in'); });
  }

  /* =====================================================================
     Hero art: an animated branch graph in the background
     ===================================================================== */
  (function heroArt() {
    var svg = $('#hero-art');
    if (!svg) return;
    var NS = 'http://www.w3.org/2000/svg';
    var y0 = 400;
    var lines = [
      { d: 'M-20,' + y0 + ' L1220,' + y0, c: 0, len: 1300, delay: 0 },
      { d: 'M180,' + y0 + ' C260,' + y0 + ' 260,300 340,300 L560,300 C640,300 640,' + y0 + ' 720,' + y0, c: 1, len: 700, delay: 0.5 },
      { d: 'M420,' + y0 + ' C500,' + y0 + ' 500,220 580,220 L860,220 C940,220 940,' + y0 + ' 1020,' + y0, c: 2, len: 820, delay: 0.9 },
      { d: 'M640,300 C700,300 700,140 760,140 L980,140', c: 3, len: 480, delay: 1.4 }
    ];
    var dots = [[60, y0, 0, 0.2], [180, y0, 0, 0.4], [300, 300, 1, 0.9], [440, 300, 1, 1.1], [420, y0, 0, 0.7], [560, 300, 1, 1.3],
      [560, 220, 2, 1.4], [700, 220, 2, 1.6], [720, y0, 0, 1.7], [840, 220, 2, 1.9], [800, 140, 3, 2.0], [920, 140, 3, 2.2],
      [1020, y0, 0, 2.4], [1140, y0, 0, 2.6]];
    lines.forEach(function (l) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', l.d);
      p.setAttribute('class', 'hero-art-line');
      p.style.stroke = 'var(--lane-' + l.c + ')';
      p.style.setProperty('--len', l.len);
      p.style.setProperty('--d', l.delay + 's');
      svg.appendChild(p);
    });
    dots.forEach(function (d) {
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', d[0]); c.setAttribute('cy', d[1]); c.setAttribute('r', 9);
      c.setAttribute('class', 'hero-art-dot');
      c.style.fill = 'var(--lane-' + d[2] + ')';
      c.style.setProperty('--d', d[3] + 's');
      svg.appendChild(c);
    });
  })();

  /* =====================================================================
     1 · Why: chaotic file list + flip cards
     ===================================================================== */
  var CHAOS = [
    ['📓', 'linebot.ipynb', '組長 · 10/13'],
    ['📓', 'linebot_final.ipynb', '組長 · 10/15'],
    ['📓', 'linebot_final_v2.ipynb', '小美 · 10/16'],
    ['📓', 'linebot_final_v2(1).ipynb', '阿明 · 10/16'],
    ['📓', 'linebot_阿明改過_不要動.ipynb', '阿明 · 10/18'],
    ['📓', 'linebot_final_v3_真的最終.ipynb', '小美 · 10/19', 'bad'],
    ['📄', '天氣功能_複製貼上用.txt', 'LINE 群組 · 10/20'],
    ['📓', 'linebot_合併版_跑不動.ipynb', '組長 · 10/26', 'bad'],
    ['😱', '??? 誰把垃圾車功能刪掉了', '11/17 上課前', 'bad']
  ];
  function playChaos() {
    var ul = $('#chaos-files');
    ul.innerHTML = '';
    CHAOS.forEach(function (f, i) {
      var li = document.createElement('li');
      if (f[3]) li.className = f[3] + ' shake';
      li.style.animationDelay = (i * 0.28) + 's' + (f[3] ? ', ' + (i * 0.28 + 0.4) + 's' : '');
      li.innerHTML = '<span>' + f[0] + '</span><span class="fn">' + esc(f[1]) + '</span><small>' + esc(f[2]) + '</small>';
      ul.appendChild(li);
    });
  }
  (function () {
    var started = false, box = $('#file-chaos');
    function start() { if (!started) { started = true; playChaos(); } }
    if ('IntersectionObserver' in window) {
      var o = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { start(); o.disconnect(); } }, { threshold: 0.3 });
      o.observe(box);
    } else start();
    $('#chaos-replay').addEventListener('click', playChaos);
    $$('.flip').forEach(function (card) {
      function flip() { card.classList.toggle('flipped'); }
      card.addEventListener('click', flip);
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    });
  })();

  /* =====================================================================
     Commit popover (shared by story + sandbox graphs)
     ===================================================================== */
  var pop = $('#commit-pop'), popBody = $('#pop-body'), popState = null;
  function openCommit(sim, id, container, onSelect) {
    var c = sim.commits[id];
    if (!c) return;
    var parentTree = c.parents.length ? sim.commits[c.parents[0]].tree : {};
    var changes = GitSim.diffTrees(parentTree, c.tree);
    var refs = [];
    Object.keys(sim.branches).forEach(function (b) { if (sim.branches[b] === id) refs.push(b); });
    Object.keys(sim.remote).forEach(function (b) { if (sim.remote[b] === id) refs.push('origin/' + b); });
    var html = '<h4 id="pop-title">' + esc(c.message) + '</h4>' +
      '<div class="meta"><code>' + id + '</code><span>' + esc(c.author) + '</span>' +
      (refs.length ? '<span>· ' + refs.map(esc).join('、') + '</span>' : '') + '</div>';
    if (c.parents.length) {
      html += '<div class="meta parents">parent：' + c.parents.map(function (p) { return '<button type="button" data-goto="' + p + '">' + p + '</button>'; }).join(' ') + '</div>';
    }
    html += '<ul>' + (changes.length ? changes.map(function (d) {
      var label = { added: '新增', modified: '修改', deleted: '刪除' }[d.status];
      return '<li><span class="fs ' + d.status + '">' + label + '</span><span>' + esc(d.path) + '</span><span class="stat"><span class="a">+' + d.add + '</span> <span class="d">−' + d.del + '</span></span></li>';
    }).join('') : '<li class="muted">（沒有檔案變更）</li>') + '</ul>';
    var explain = !c.parents.length ? '這是第一個 commit（root commit），沒有 parent。'
      : c.parents.length > 1 ? '🔀 這是「合併 commit」：它有兩個 parent，把兩條分支的歷史接在一起。上面列的是相對於第一個 parent（合併前的 main）多了什麼。'
      : '每個 commit 都記得它的 parent（上一個 commit），所以 Git 能一路往回追整段歷史。';
    html += '<p class="explain">' + explain + '</p>';
    popBody.innerHTML = html;
    pop.hidden = false;
    popScrollY = scrollY;
    popState = { sim: sim, container: container, onSelect: onSelect, id: id };
    $$('[data-goto]', popBody).forEach(function (b) {
      b.addEventListener('click', function () { onSelect(b.dataset.goto); });
    });
    // position near the node
    var node = container.querySelector('.node.selected') || container;
    var r = node.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    var left = Math.min(Math.max(12, r.left + r.width / 2 - pw / 2), innerWidth - pw - 12);
    var top = r.bottom + 12;
    if (top + ph > innerHeight - 12) top = Math.max(12, r.top - ph - 12);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function closePop() {
    if (pop.hidden) return;
    pop.hidden = true;
    if (popState && popState.onSelect) popState.onSelect(null);
    popState = null;
  }
  $('.pop-close', pop).addEventListener('click', closePop);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePop(); });
  document.addEventListener('pointerdown', function (e) {
    if (!pop.hidden && !pop.contains(e.target) && !(e.target.closest && e.target.closest('.node'))) closePop();
  });
  var popScrollY = 0;
  window.addEventListener('scroll', function () { if (!pop.hidden && Math.abs(scrollY - popScrollY) > 120) closePop(); }, { passive: true });

  function graphController(container, getSim) {
    var selected = null;
    function select(id) {
      selected = id;
      draw(false);
      if (id) openCommit(getSim(), id, container, select);
    }
    function draw(autoScroll) {
      renderGraph(container, getSim(), { selected: selected, onSelect: select, autoScroll: autoScroll });
    }
    return { draw: function (autoScroll) { if (selected && !getSim().commits[selected]) selected = null; draw(autoScroll); }, reset: function () { selected = null; resetGraphMemory(container); } };
  }

  /* =====================================================================
     2 · Concept story
     ===================================================================== */
  var STORY_FILES = {
    'README.md': '# 六張犁好鄰居 Bot\n\nBot 名稱：鄰居小幫手\n指令：輸入「功能」看選單\n',
    'app.py': '# LINE webhook（不用改）\n',
    'router.py': '# 自動載入 features/ 裡的每個功能\n',
    'features/example_parrot.py': "NAME = '鸚鵡'\n"
  };
  var ACTORS = { po: '👑 PO 組長 @leader', mei: '👩 小美 @mei', ming: '👨 阿明 @ming' };
  var USERS = { po: '@leader', mei: '@mei', ming: '@ming' };
  function readme(name) { return '# 六張犁好鄰居 Bot\n\nBot 名稱：' + name + '\n指令：輸入「功能」看選單\n'; }

  var STORY = [
    { actor: 'po', terms: ['repo', 'commit'], title: 'Repo：專案資料夾＋完整歷史',
      body: '組長把 Bot 的樣板放上 GitHub。這個資料夾，連同每一次修改的紀錄，就叫做 <b>repository（repo）</b>。圖上每個圓點是一個 <b>commit</b>，藍色那條線是 <b>main</b> 分支。點圓點看看裡面有什麼！',
      ops: [], note: '# repo 建好了，裡面已經有第一個 commit' },
    { actor: 'po', terms: ['commit'], title: 'Commit：一個存檔點',
      body: 'Commit 就像遊戲存檔：記下「這一刻所有檔案的樣子」，加上<b>作者</b>和<b>說明</b>。組長在 README 加上小組資訊後存了一個 commit（之後 main 會被保護，大家都要走 PR）。',
      ops: [['po', { edit: 'README.md', content: readme('鄰居小幫手') + '小組：G0（範例）\n' }], ['po', 'git add README.md'], ['po', 'git commit -m "README 加上小組資訊"'], ['po', 'git push']] },
    { actor: 'mei', terms: ['branch'], title: 'Branch：開一條自己的路',
      body: '小美要做「天氣查詢」。她不直接改 main，而是開一個分支 <code>feature/weather</code>。分支就是一張<b>指向某個 commit 的標籤</b>，開一條幾乎不用成本。',
      ops: [['mei', 'git switch -c feature/weather']] },
    { actor: 'mei', terms: ['commit', 'branch'], title: '在分支上 commit',
      body: '小美新增 <code>features/weather.py</code> 並 commit。這個 commit 只在 <code>feature/weather</code> 上 —— main 完全沒被影響，Bot 照常運作。',
      ops: [['mei', 'echo "NAME = \'天氣查詢\'" > features/weather.py'], ['mei', 'git add features/weather.py'], ['mei', 'git commit -m "新增天氣查詢"']] },
    { actor: 'ming', terms: ['branch'], title: '大家同時開工',
      body: '同一時間，阿明從 main 開了另一條分支做「垃圾車提醒」。兩條分支互不干擾，各做各的。',
      ops: [['ming', 'git switch main'], ['ming', 'git switch -c feature/garbage'], ['ming', 'echo "NAME = \'垃圾車提醒\'" > features/garbage.py'], ['ming', 'git add .'], ['ming', 'git commit -m "新增垃圾車提醒"']] },
    { actor: 'mei', terms: ['pr', 'review'], title: 'Pull Request + Review',
      body: '小美把分支 push 上 GitHub，開一個 <b>Pull Request</b>：「請把我的分支合併進 main」。CI 自動跑測試 ✅，隊友阿明 <b>Review</b> 後按下 Approve。',
      ops: [['mei', 'git switch feature/weather'], ['mei', 'git push -u origin feature/weather'], ['mei', 'gh pr create']],
      side: { pr: 1, review: ['@ming', 'Approve ✅ 關鍵字很清楚！建議「明天天氣」也能查 👍'] } },
    { actor: 'po', terms: ['merge'], title: 'Merge：合併回 main',
      body: '組長確認 CI ✅、有人 Approve，按下 <b>Merge pull request</b>。GitHub 產生一個<b>合併 commit</b>（有兩個 parent 的圓點），main 現在有天氣功能了。',
      ops: [['po', 'gh pr merge 1'], ['po', 'git switch main'], ['po', 'git pull']],
      side: { pr: 1, review: ['@ming', 'Approve ✅'] } },
    { actor: 'ming', terms: ['pr', 'merge'], title: '不同檔案 → 沒有衝突',
      body: '阿明的 PR 也合併了。雖然他開分支之後 main 變了，但兩人改的是<b>不同檔案</b>（weather.py、garbage.py），Git 自動合併。<b>這就是每個功能放在自己檔案的原因！</b>',
      ops: [['ming', 'git switch feature/garbage'], ['ming', 'git push -u origin feature/garbage'], ['ming', 'gh pr create'], ['po', 'gh pr merge 2'], ['po', 'git switch main'], ['po', 'git pull']],
      side: { pr: 2, review: ['@mei', 'Approve ✅ 長輩應該看得懂 👵'] } },
    { actor: 'ming', terms: ['branch'], title: '兩個人改了同一行…',
      body: '這次兩人都想改 README 的「Bot 名稱」。阿明改成「六張犁小管家」，小美改成「好鄰居 LINE 君」。小美的 PR 先被合併了。',
      ops: [['ming', 'git switch -c feature/name-ming'], ['ming', { edit: 'README.md', content: readme('六張犁小管家') + '小組：G0（範例）\n' }], ['ming', 'git commit -am "Bot 改名：六張犁小管家"'], ['ming', 'git push -u origin feature/name-ming'], ['ming', 'gh pr create'],
        ['mei', 'git switch main'], ['mei', 'git switch -c feature/name-mei'], ['mei', { edit: 'README.md', content: readme('好鄰居 LINE 君') + '小組：G0（範例）\n' }], ['mei', 'git commit -am "Bot 改名：好鄰居 LINE 君"'], ['mei', 'git push -u origin feature/name-mei'], ['mei', 'gh pr create'], ['po', 'gh pr merge 4']],
      side: { pr: 4, review: ['@leader', 'Approve ✅'] } },
    { actor: 'ming', terms: ['conflict'], title: 'Conflict：Git 不知道要聽誰的',
      body: '阿明的 PR 出現「<b>This branch has conflicts</b>」。他把最新的 main 拉進自己的分支，Git 在檔案裡用 <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> <code>=======</code> <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code> 標出兩個版本，等人來決定。<b>衝突不是錯誤</b>，只是 Git 在問問題。',
      ops: [['po', 'gh pr merge 3'], ['ming', 'git switch feature/name-ming'], ['ming', 'git pull origin main']],
      side: { pr: 3, conflict: true, file: 'README.md' } },
    { actor: 'ming', terms: ['conflict', 'merge'], title: '解決衝突',
      body: '阿明和小美討論後決定用新名字。刪掉三行標記、留下正確內容 → add → commit → push，PR 自動更新，組長就能合併了。',
      ops: [['ming', { edit: 'README.md', content: readme('六張犁好鄰居（小美＋阿明）') + '小組：G0（範例）\n' }], ['ming', 'git add README.md'], ['ming', 'git commit -m "解決 Bot 名稱衝突"'], ['ming', 'git push'], ['po', 'gh pr merge 3'], ['po', 'git switch main'], ['po', 'git pull']],
      side: { pr: 3, file: 'README.md', review: ['@mei', 'Approve ✅ 這個名字很棒！'] } },
    { actor: 'po', terms: ['repo', 'commit', 'branch', 'pr', 'review', 'merge', 'conflict'], title: '五條黃金守則 🏆',
      body: '① 每個功能一個檔案：<code>features/自己的.py</code><br>② 開新分支前，先拿最新的 main<br>③ 小步 commit，訊息寫清楚「做了什麼」<br>④ 一律透過 PR 合併，CI ✅ 後由 PO 合併<br>⑤ 永遠不要把 token / 密碼放進程式碼',
      ops: [], note: '# 接下來：自己在沙盒裡試試看 👇' }
  ];

  var story = { i: 0, sim: null, timer: null };
  var storyGraph = graphController($('#story-graph'), function () { return story.sim; });

  function buildStory(upto) {
    var sim = new GitSim({ files: STORY_FILES, user: USERS.po, seed: 'story', repoName: 'g0/linebot', initialMessage: '建立 Bot 樣板' });
    var lastCmds = [];
    for (var s = 0; s <= upto; s++) {
      STORY[s].ops.forEach(function (op) {
        var who = op[0], what = op[1], line;
        if (typeof what === 'object') { sim.writeFile(what.edit, what.content); line = 'edit ' + what.edit; }
        else { sim.run(what, { author: USERS[who] }); line = what; }
        if (s === upto) lastCmds.push([who, line]);
      });
    }
    return { sim: sim, cmds: lastCmds };
  }

  function prCard(sim, side) {
    var pr = sim.prs[side.pr - 1];
    if (!pr) return '';
    var state = side.conflict ? '<span class="pill conflict">⚠ Conflicts</span>' : pr.state === 'merged' ? '<span class="pill merged">⇄ Merged</span>' : '<span class="pill open">⇅ Open</span>';
    var checks = '<li>✅ <span>CI：pytest — All checks have passed</span></li>';
    if (side.conflict) checks += '<li>⚠️ <span><b>This branch has conflicts that must be resolved</b><br><small class="muted">README.md</small></span></li>';
    var html = '<div class="pr-card"><div class="pr-top">' + state + '<h4>' + esc(pr.title) + ' <span class="muted">#' + pr.number + '</span></h4></div>' +
      '<div class="pr-branches">想把 <code>' + esc(pr.branch) + '</code> 合併到 <code>main</code></div><ul class="pr-checks">' + checks + '</ul>';
    if (side.review) html += '<div class="pr-comment"><b>' + esc(side.review[0]) + '</b> reviewed：' + esc(side.review[1]) + '</div>';
    return html + '</div>';
  }

  function fileView(sim, path) {
    var text = sim.readFile(path);
    if (text == null) return '';
    var zone = null;
    var lines = text.replace(/\n$/, '').split('\n').map(function (l) {
      var cls = '';
      if (/^<{7}/.test(l)) { cls = 'mk'; zone = 'ours'; }
      else if (/^={7}$/.test(l)) { cls = 'mk'; zone = 'theirs'; }
      else if (/^>{7}/.test(l)) { cls = 'mk'; zone = null; }
      else if (zone) cls = zone;
      return '<div class="fv-line ' + cls + '">' + (esc(l) || ' ') + '</div>';
    });
    return '<div class="file-view"><div class="fv-name">📄 ' + esc(path) + (GitSim.hasMarkers(text) ? '　— 衝突中' : '') + '</div>' + lines.join('') + '</div>';
  }

  function showStory(i, animate) {
    story.i = Math.max(0, Math.min(STORY.length - 1, i));
    var step = STORY[story.i];
    var built = buildStory(story.i);
    story.sim = built.sim;
    if (!animate) storyGraph.reset();
    storyGraph.draw(true);
    closePop();

    $('#story-count').textContent = (story.i + 1) + ' / ' + STORY.length;
    $('#story-actor').textContent = ACTORS[step.actor];
    var title = $('#story-title'), body = $('#story-body');
    title.textContent = step.title;
    body.innerHTML = step.body;
    [title, body].forEach(function (el) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; });

    var cmd = $('#story-cmd');
    if (built.cmds.length) {
      cmd.innerHTML = built.cmds.map(function (c) {
        return '<span class="n">' + esc(USERS[c[0]].slice(1)) + ' $</span> <span class="c">' + esc(c[1]) + '</span>';
      }).join('\n');
    } else cmd.innerHTML = '<span class="n">' + esc(step.note || '') + '</span>';

    var side = '';
    if (step.side) {
      if (step.side.pr) side += prCard(story.sim, step.side);
      if (step.side.file) side += fileView(story.sim, step.side.file);
    }
    $('#story-side').innerHTML = side;

    $$('#story-dots button').forEach(function (b, k) { b.setAttribute('aria-selected', String(k === story.i)); b.tabIndex = k === story.i ? 0 : -1; });
    $('#story-prev').disabled = story.i === 0;
    $('#story-next').textContent = story.i === STORY.length - 1 ? '到沙盒試試 →' : '下一步 →';
    $$('#glossary button').forEach(function (b) { b.classList.toggle('lit', step.terms.indexOf(b.dataset.term) >= 0); });
  }

  (function initStory() {
    var dots = $('#story-dots');
    STORY.forEach(function (s, k) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-label', '第 ' + (k + 1) + ' 步：' + s.title);
      b.addEventListener('click', function () { stopAuto(); showStory(k, k === story.i + 1); });
      dots.appendChild(b);
    });
    $('#story-prev').addEventListener('click', function () { stopAuto(); showStory(story.i - 1, false); });
    $('#story-next').addEventListener('click', function () {
      if (story.i === STORY.length - 1) { stopAuto(); $('#sandbox').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); return; }
      stopAuto(); showStory(story.i + 1, true);
    });
    $('#story-play').addEventListener('click', function () {
      if (story.timer) { stopAuto(); return; }
      if (story.i === STORY.length - 1) showStory(0, false);
      $('#story-play').textContent = '❚❚';
      $('#story-play').setAttribute('aria-label', '暫停');
      story.timer = setInterval(function () {
        if (story.i >= STORY.length - 1) { stopAuto(); return; }
        showStory(story.i + 1, true);
      }, 4200);
    });
    $('#story').addEventListener('keydown', function (e) {
      if (e.target.matches('input, textarea')) return;
      if (e.key === 'ArrowRight') { stopAuto(); showStory(story.i + 1, true); }
      if (e.key === 'ArrowLeft') { stopAuto(); showStory(story.i - 1, false); }
    });
    $$('#glossary button').forEach(function (b) {
      b.addEventListener('click', function () {
        stopAuto();
        var k = 0;
        for (var j = 0; j < STORY.length; j++) if (STORY[j].terms.indexOf(b.dataset.term) >= 0) { k = j; break; }
        showStory(k, false);
      });
    });
    showStory(0, false);
  })();
  function stopAuto() {
    if (story.timer) clearInterval(story.timer);
    story.timer = null;
    $('#story-play').textContent = '▶';
    $('#story-play').setAttribute('aria-label', '自動播放');
  }

  /* =====================================================================
     3 · Sandbox
     ===================================================================== */
  var SANDBOX_FILES = {
    'README.md': '# 我們的 LINE Bot\n\nBot 名稱：鄰居小幫手\n指令：輸入「功能」看選單\n',
    'app.py': '# LINE webhook 伺服器（不用改）\n',
    'router.py': '# 自動載入 features/ 裡的每個功能（不用改）\n',
    'features/example_parrot.py': "NAME = '鸚鵡'\nKEYWORDS = ['鸚鵡']\n"
  };
  var ME = '@you';

  function freshSim(protectMain) {
    return new GitSim({ files: SANDBOX_FILES, user: ME, initialAuthor: '@leader', initialMessage: '建立 Bot 樣板', seed: 'sandbox' + Date.now(), repoName: 'your-team/linebot', protectedBranches: protectMain ? ['main'] : [] });
  }

  var CHALLENGES = [
    { id: 'c1', title: '第一個 commit', goal: '在 features/ 新增一個檔案，存成一個 commit。',
      hints: ['echo "NAME = \'天氣\'" > features/weather.py', 'git status', 'git add .', 'git commit -m "新增天氣功能"', 'git log --oneline'],
      check: function (s) { return s.order.some(function (id) { return s.commits[id].author === ME; }); } },
    { id: 'c2', title: '開一個分支', goal: '建立 feature/… 分支，在上面 commit（main 不受影響）。',
      hints: ['git switch -c feature/garbage', 'echo "NAME = \'垃圾車\'" > features/garbage.py', 'git add .', 'git commit -m "新增垃圾車功能"', 'git switch main', 'ls'],
      check: function (s) {
        return Object.keys(s.branches).some(function (b) {
          return b !== 'main' && s.commits[s.branches[b]].author === ME && !s.isAncestor(s.branches[b], s.branches.main);
        });
      } },
    { id: 'c3', title: '合併回 main', goal: '回到 main，把你的 feature 分支 merge 進來。',
      hints: ['git switch main', 'git branch', 'git merge feature/garbage', 'git log --oneline'],
      check: function (s) {
        return Object.keys(s.branches).some(function (b) {
          var tip = s.branches[b];
          return b !== 'main' && s.commits[tip].author === ME && s.isAncestor(tip, s.branches.main);
        });
      } },
    { id: 'c4', title: '解決衝突', goal: '兩位隊友都改了 README 的 Bot 名稱。把 feature/bot-name 合併進 main 並解決衝突。', scenario: 'conflict',
      hints: ['git merge feature/bot-name', 'cat README.md', 'edit README.md', 'git add README.md', 'git commit -m "解決 Bot 名稱衝突"'],
      check: function (s) {
        var tip = s.commits[s.branches.main], feat = s.branches['feature/bot-name'];
        return sandbox.scenario === 'conflict' && tip.parents.length === 2 && tip.parents.indexOf(feat) >= 0 && !GitSim.hasMarkers(tip.tree['README.md']);
      } },
    { id: 'c5', title: 'Push 與 PR', goal: 'main 受保護 🔒。用分支 push → 開 PR → 合併 → 把最新的 main pull 回來。', scenario: 'github',
      hints: ['git switch -c feature/hello', 'echo "NAME = \'hello\'" > features/hello.py', 'git add .', 'git commit -m "新增 hello 功能"', 'git push origin main', 'git push -u origin feature/hello', 'gh pr create', 'gh pr merge', 'git switch main', 'git pull'],
      check: function (s) {
        return sandbox.scenario === 'github' && s.prs.some(function (p) { return p.state === 'merged'; }) && s.branches.main === s.remote.main && s.head === 'main';
      } }
  ];

  var sandbox = { sim: freshSim(false), scenario: null, active: 0, done: store.get('challenges', {}), history: [], hIndex: 0 };
  var sbGraph = graphController($('#sb-graph'), function () { return sandbox.sim; });
  var termOut = $('#term-out'), termInput = $('#term-input');

  function printLines(lines) {
    var frag = document.createDocumentFragment();
    lines.forEach(function (l) {
      var div = document.createElement('div');
      div.className = 'ln ' + (l[0] || '');
      if (l[0] === 'link') {
        var m = /(https?:\/\/\S+)/.exec(l[1]);
        div.textContent = l[1];
        if (m) div.title = m[1];
      } else div.textContent = l[1];
      frag.appendChild(div);
    });
    termOut.appendChild(frag);
    while (termOut.childNodes.length > 600) termOut.removeChild(termOut.firstChild);
    termOut.scrollTop = termOut.scrollHeight;
  }
  function printCmd(line) {
    var div = document.createElement('div');
    div.className = 'ln cmd';
    div.innerHTML = '<span class="ps">' + esc(promptText()) + '</span> ' + esc(line);
    termOut.appendChild(div);
  }
  function promptText() {
    var s = sandbox.sim;
    return '(' + s.head + (s.mergeState ? '|MERGING' : '') + ') $';
  }

  function scenarioSim(kind) {
    var s;
    if (kind === 'conflict') {
      s = freshSim(false);
      s.run('git switch -c feature/bot-name');
      s.writeFile('README.md', SANDBOX_FILES['README.md'].replace('鄰居小幫手', '好鄰居 LINE 君'));
      s.run('git commit -am "Bot 改名：好鄰居 LINE 君"', { author: '@mei' });
      s.run('git switch main');
      s.writeFile('README.md', SANDBOX_FILES['README.md'].replace('鄰居小幫手', '六張犁小管家'));
      s.run('git commit -am "Bot 改名：六張犁小管家"', { author: '@ming' });
      return s;
    }
    if (kind === 'github') return freshSim(true);
    return freshSim(false);
  }

  function loadScenario(kind, quiet) {
    sandbox.sim = scenarioSim(kind);
    sandbox.scenario = kind || null;
    sbGraph.reset();
    termOut.innerHTML = '';
    if (kind === 'conflict') {
      printLines([['hint', '🎬 情境：@ming 已經在 main 把 Bot 改名為「六張犁小管家」；@mei 在 feature/bot-name 改成「好鄰居 LINE 君」。'], ['hint', '   你是 PO：把 feature/bot-name merge 進 main，然後解決衝突（選一個名字，或兩個合起來）。']]);
    } else if (kind === 'github') {
      printLines([['hint', '🎬 情境：這個 repo 的 main 在 GitHub 上受保護 🔒（和你們小組的 repo 一樣）。'], ['hint', '   不能直接 push 到 main —— 試試看會發生什麼，再用 PR 的方式完成。']]);
    } else if (!quiet) {
      printLines([['ok', '👋 歡迎來到 Git 沙盒！這是一個模擬的 repo：your-team/linebot'], ['dim', '   輸入 help 看所有指令；點上面的挑戰卡看提示。打錯不會怎樣，放心玩 😄'], ['dim', '   檔案可以用 echo "文字" > 檔名 建立，或用 edit 檔名 / 點右邊的檔案來編輯。']]);
    }
    refreshSandbox(true);
  }

  function renderFiles() {
    var s = sandbox.sim, st = s.status(), ul = $('#sb-files');
    var conflicts = s.mergeState ? s.mergeState.conflicts : [];
    ul.innerHTML = '';
    Object.keys(s.work).sort().forEach(function (p) {
      var badge = '';
      if (conflicts.indexOf(p) >= 0) badge = '<span class="st conflict">衝突</span>';
      else if (st.untracked.indexOf(p) >= 0) badge = '<span class="st untracked">新檔案</span>';
      else if (st.unstaged.some(function (d) { return d.path === p; })) badge = '<span class="st modified">已修改</span>';
      else if (st.staged.some(function (d) { return d.path === p; })) badge = '<span class="st staged">已 add</span>';
      var li = document.createElement('li');
      li.innerHTML = '<button type="button"><span>📄</span><span>' + esc(p) + '</span>' + badge + '</button>';
      li.firstChild.addEventListener('click', function () { openEditor(p); });
      ul.appendChild(li);
    });
  }

  function refreshSandbox(autoScroll) {
    sbGraph.draw(autoScroll !== false);
    renderFiles();
    $('#term-prompt').textContent = promptText();
    checkChallenges();
  }

  function runCommand(line) {
    line = line.trim();
    printCmd(line);
    if (!line) return;
    sandbox.history.push(line);
    sandbox.hIndex = sandbox.history.length;
    var first = line.split(/\s+/)[0];
    if (first === 'clear') { termOut.innerHTML = ''; return; }
    if (first === 'reset') {
      loadScenario(CHALLENGES[sandbox.active].scenario || null);
      return;
    }
    if (/^(edit|nano|vim|vi|code)$/.test(first)) {
      var path = line.split(/\s+/)[1];
      if (!path) { printLines([['err', '要編輯哪個檔案？例如：edit README.md']]); return; }
      openEditor(path.replace(/^\.\//, ''));
      return;
    }
    var res = sandbox.sim.run(line);
    printLines(res.out);
    refreshSandbox(true);
  }

  $('#term-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = termInput.value;
    termInput.value = '';
    runCommand(v);
  });
  termInput.addEventListener('keydown', function (e) {
    var h = sandbox.history;
    if (e.key === 'ArrowUp') {
      if (sandbox.hIndex > 0) { sandbox.hIndex--; termInput.value = h[sandbox.hIndex]; }
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      if (sandbox.hIndex < h.length - 1) { sandbox.hIndex++; termInput.value = h[sandbox.hIndex]; }
      else { sandbox.hIndex = h.length; termInput.value = ''; }
      e.preventDefault();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      termOut.innerHTML = '';
    }
  });
  function complete() {
    var v = termInput.value, parts = v.split(' '), last = parts[parts.length - 1];
    var s = sandbox.sim, pool;
    if (parts.length === 1) pool = ['git', 'gh', 'ls', 'cat', 'edit', 'echo', 'help', 'clear', 'reset'];
    else if (parts[0] === 'git' && parts.length === 2) pool = ['status', 'add', 'commit', 'branch', 'switch', 'checkout', 'merge', 'log', 'push', 'pull'];
    else pool = Object.keys(s.branches).concat(Object.keys(s.work), ['origin']);
    var hits = pool.filter(function (x) { return x.indexOf(last) === 0; });
    if (hits.length === 1) { parts[parts.length - 1] = hits[0]; termInput.value = parts.join(' ') + (hits[0].slice(-1) === '/' ? '' : ' '); }
    else if (hits.length > 1) printLines([['dim', hits.join('   ')]]);
  }
  $$('#quick-keys button').forEach(function (b) {
    b.addEventListener('click', function () { insertCommand(b.dataset.insert, b.dataset.caret ? parseInt(b.dataset.caret, 10) : 0); });
  });
  function insertCommand(text, caretFromEnd) {
    termInput.value = text;
    termInput.focus();
    var pos = text.length + (caretFromEnd || 0);
    try { termInput.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
  }
  $('#sb-reset').addEventListener('click', function () { loadScenario(CHALLENGES[sandbox.active].scenario || null); termInput.focus(); });
  termOut.addEventListener('click', function () { if (!window.getSelection || !String(window.getSelection())) termInput.focus(); });

  /* ---------- file editor modal ---------- */
  var editor = $('#editor'), editorPath = null, lastFocus = null;
  function openEditor(path) {
    var s = sandbox.sim, text = s.readFile(path);
    editorPath = path;
    lastFocus = document.activeElement;
    $('#editor-title').textContent = path + (text == null ? '（新檔案）' : '');
    var conflict = text && GitSim.hasMarkers(text);
    $('#editor-hint').textContent = conflict
      ? '⚠️ 這個檔案有衝突：留下你要的內容，把 <<<<<<<、=======、>>>>>>> 三行標記刪掉，然後儲存。'
      : '修改後按「儲存」。記得之後要 git add 和 git commit 才會存進歷史。';
    $('#editor-text').value = text == null ? '' : text;
    editor.hidden = false;
    setTimeout(function () { $('#editor-text').focus(); }, 30);
  }
  function closeEditor() {
    editor.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $('#editor-save').addEventListener('click', function () {
    var text = $('#editor-text').value;
    if (text && !/\n$/.test(text)) text += '\n';
    sandbox.sim.writeFile(editorPath, text);
    printLines([['dim', '（已儲存 ' + editorPath + (GitSim.hasMarkers(text) ? '，但裡面還有衝突標記喔' : '') + '）']]);
    closeEditor();
    refreshSandbox(false);
  });
  $$('[data-close]', editor).forEach(function (b) { b.addEventListener('click', closeEditor); });
  editor.addEventListener('click', function (e) { if (e.target === editor) closeEditor(); });
  editor.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); closeEditor(); }
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#editor-save').click(); }
  });

  /* ---------- challenges ---------- */
  function renderChallenges() {
    var box = $('#challenges');
    box.innerHTML = '';
    CHALLENGES.forEach(function (c, i) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'chal' + (i === sandbox.active ? ' active' : '') + (sandbox.done[c.id] ? ' done' : '');
      card.setAttribute('aria-pressed', String(i === sandbox.active));
      card.innerHTML = '<span class="chal-no">挑戰 ' + (i + 1) + '</span><span class="chal-title">' + esc(c.title) + '</span>';
      card.addEventListener('click', function () {
        if (sandbox.active !== i) { sandbox.active = i; store.set('chal-active', i); renderChallenges(); }
      });
      box.appendChild(card);
    });
    var c = CHALLENGES[sandbox.active], needsLoad = c.scenario && sandbox.scenario !== c.scenario;
    var detail = document.createElement('div');
    detail.className = 'chal-detail';
    detail.innerHTML = '<p class="chal-goal"><b>🎯 挑戰 ' + (sandbox.active + 1) + '：</b>' + esc(c.goal) + (sandbox.done[c.id] ? ' <span class="chal-ok">✓ 已完成</span>' : '') + '</p>' +
      (needsLoad ? '<button class="btn btn-small btn-primary chal-start" type="button">載入情境 ▶</button>' : '') +
      '<div class="chal-hints"><span class="muted small">提示（點一下顯示，再點一下填入）：</span>' + c.hints.map(function (h) {
        return '<button type="button" class="hint-cmd masked" aria-label="提示（點擊顯示）">' + esc(h) + '</button>';
      }).join('') + '</div>';
    var startBtn = $('.chal-start', detail);
    if (startBtn) startBtn.addEventListener('click', function () { loadScenario(c.scenario); renderChallenges(); termInput.focus(); });
    $$('.hint-cmd', detail).forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.classList.contains('masked')) { b.classList.remove('masked'); b.removeAttribute('aria-label'); return; }
        insertCommand(b.textContent);
      });
    });
    box.appendChild(detail);
  }

  function checkChallenges() {
    var c = CHALLENGES[sandbox.active];
    if (!c || sandbox.done[c.id] || (c.scenario && sandbox.scenario !== c.scenario)) return;
    var ok = false;
    try { ok = c.check(sandbox.sim); } catch (e) { ok = false; }
    if (!ok) return;
    sandbox.done[c.id] = true;
    store.set('challenges', sandbox.done);
    printLines([['success', '🎉 挑戰 ' + (sandbox.active + 1) + '「' + c.title + '」完成！']]);
    var all = CHALLENGES.every(function (x) { return sandbox.done[x.id]; });
    toast(all ? '🏆 五個挑戰全部完成！你已經會 Git 了！' : '🎉 挑戰完成：' + c.title, 'ok');
    var r = $('#challenges .chal-detail');
    var rect = r ? r.getBoundingClientRect() : null;
    confetti(rect ? rect.left + rect.width / 2 : null, rect ? rect.top + 20 : null, all ? 260 : 140);
    var next = CHALLENGES.findIndex(function (x) { return !sandbox.done[x.id]; });
    if (next >= 0 && next !== sandbox.active) {
      sandbox.active = next;
      store.set('chal-active', next);
      if (!CHALLENGES[next].scenario) printLines([['hint', '👉 下一個：挑戰 ' + (next + 1) + '「' + CHALLENGES[next].title + '」— ' + CHALLENGES[next].goal]]);
      else printLines([['hint', '👉 下一個：挑戰 ' + (next + 1) + '「' + CHALLENGES[next].title + '」— 按挑戰卡上的「載入情境」開始']]);
    }
    renderChallenges();
  }

  (function initSandbox() {
    var a = store.get('chal-active', 0);
    sandbox.active = typeof a === 'number' && a >= 0 && a < CHALLENGES.length ? a : 0;
    renderChallenges();
    loadScenario(null);
  })();

  /* =====================================================================
     4 · Class wall
     ===================================================================== */
  var USER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
  var INLINE_SAMPLE = { sample: true, entries: [
    { user: 'octocat', message: '大家好！我負責天氣查詢功能 ☀️' },
    { user: 'mona-lisa', message: '第一次開 PR，好緊張 😆' },
    { user: 'hubot', message: '垃圾車提醒 coming soon 🚛' }
  ] };
  var wall = { known: null, timer: null, sample: false };

  function wallMessageProblem(msg) {
    var m = msg.trim();
    if (!m) return '請寫一句話';
    if (m.length > CFG.wallMaxLength) return '太長了，最多 ' + CFG.wallMaxLength + ' 個字';
    if (/https?:\/\/|www\./i.test(m)) return '請不要放網址';
    if (/\d{7,}/.test(m)) return '看起來像學號或電話，請不要放個人資料';
    return '';
  }

  function avatarColor(user) {
    var h = 0;
    for (var i = 0; i < user.length; i++) h = (h * 31 + user.charCodeAt(i)) >>> 0;
    return 'var(--lane-' + (h % 6) + ')';
  }

  function wallCard(entry, opts) {
    opts = opts || {};
    var li = document.createElement(opts.tag || 'li');
    li.className = 'wall-card' + (opts.fresh ? ' fresh' : '');
    var h = 0;
    for (var i = 0; i < entry.user.length; i++) h = (h * 17 + entry.user.charCodeAt(i)) % 1000;
    li.style.setProperty('--tilt', ((h % 7) - 3) * 0.6 + 'deg');
    li.style.setProperty('--delay', (opts.delay || 0) + 's');
    var av = document.createElement('span');
    av.className = 'av';
    av.style.setProperty('--c', avatarColor(entry.user));
    av.textContent = entry.user.slice(0, 1).toUpperCase();
    if (opts.avatar) {
      var img = new Image();
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.onload = function () { av.textContent = ''; av.appendChild(img); };
      img.src = GH + encodeURIComponent(entry.user) + '.png?size=80';
    }
    var who = document.createElement('span');
    who.className = 'who';
    who.textContent = '@' + entry.user;
    var msg = document.createElement('p');
    msg.className = 'msg';
    msg.textContent = entry.message;
    li.appendChild(av); li.appendChild(who); li.appendChild(msg);
    return li;
  }

  function renderWall(data, sample) {
    var entries = (data && Array.isArray(data.entries) ? data.entries : []).filter(function (e) {
      return e && typeof e.user === 'string' && USER_RE.test(e.user) && typeof e.message === 'string';
    });
    var ul = $('#wall-cards');
    var first = wall.known === null;
    var known = wall.known || {};
    var fresh = [];
    if (first || sample !== wall.sample) {
      ul.innerHTML = '';
      known = {};
      entries.forEach(function (e, i) { ul.appendChild(wallCard(e, { delay: Math.min(i * 0.04, 1.2), avatar: !sample })); known[e.user.toLowerCase()] = true; });
    } else {
      entries.forEach(function (e) {
        if (known[e.user.toLowerCase()]) return;
        known[e.user.toLowerCase()] = true;
        fresh.push(e);
        ul.insertBefore(wallCard(e, { fresh: true, avatar: !sample }), ul.firstChild);
      });
    }
    wall.known = known;
    wall.sample = sample;
    if (!entries.length) ul.innerHTML = '<li class="wall-empty">還沒有人上牆 —— 你要當第一個嗎？ 🚀</li>';
    var n = entries.length;
    $('#wall-n').textContent = n;
    $('#wall-ring').style.setProperty('--p', Math.min(100, Math.round(n / CFG.classSize * 100)));
    $('#wall-ring small').textContent = '/ ' + CFG.classSize;
    var time = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('#wall-status').innerHTML = sample
      ? '本機預覽：目前顯示<span class="sample-badge">範例資料</span>。部署到 GitHub Pages 後會顯示真正的簽名。'
      : '每 ' + CFG.wallPollSeconds + ' 秒自動更新 · 最後更新 ' + time;
    fresh.forEach(function (e, i) {
      setTimeout(function () { toast('🎉 @' + e.user + ' 上牆了！', 'ok'); }, i * 600);
    });
    if (fresh.length) confetti(null, null, 80);
  }

  function fetchJSON(url) {
    return fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }
  var LIVE_WALL = /\.github\.io$/i.test(location.hostname) || /[?&]wall=live\b/.test(location.search);
  function pollWall() {
    if (location.protocol === 'file:') { renderWall(INLINE_SAMPLE, true); return; }
    if (!LIVE_WALL) {
      fetchJSON('wall.sample.json').then(function (d) { renderWall(d, true); }, function () { renderWall(INLINE_SAMPLE, true); });
      return;
    }
    fetchJSON('wall.json')
      .then(function (d) { renderWall(d, false); })
      .catch(function () {
        return fetchJSON('wall.sample.json').then(function (d) { renderWall(d, true); })
          .catch(function () { renderWall(INLINE_SAMPLE, true); });
      });
  }
  function startWallPolling() {
    if (wall.timer) return;
    pollWall();
    if (!LIVE_WALL) return;  // sample data never changes
    wall.timer = setInterval(function () { if (!document.hidden) pollWall(); }, CFG.wallPollSeconds * 1000);
  }
  if ('IntersectionObserver' in window) {
    var wo = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { startWallPolling(); wo.disconnect(); } }, { rootMargin: '400px' });
    wo.observe($('#wall'));
  } else startWallPolling();

  (function wallForm() {
    var user = $('#wall-user'), msg = $('#wall-msg'), go = $('#wall-go'), hint = $('#wall-hint');
    user.value = store.get('gh-user', '') || '';
    msg.maxLength = CFG.wallMaxLength;
    function update() {
      var u = user.value.trim().replace(/^@/, ''), m = msg.value;
      $('#wall-count').textContent = m.trim().length + ' / ' + CFG.wallMaxLength;
      var problem = '';
      if (u && !USER_RE.test(u)) problem = 'GitHub 帳號只能有英文、數字和 -（不是 Email 喔）';
      else if (m) problem = wallMessageProblem(m);
      user.setAttribute('aria-invalid', String(!!(u && !USER_RE.test(u))));
      var ok = u && USER_RE.test(u) && m.trim() && !problem;
      hint.textContent = problem || (ok ? '✓ 看起來沒問題！' : '');
      hint.classList.toggle('ok', !!ok);
      var prev = $('#wall-preview');
      prev.innerHTML = '';
      if (u && USER_RE.test(u) && m.trim()) prev.appendChild(wallCard({ user: u, message: m.trim() }, { tag: 'div' }));
      if (ok) {
        go.href = GH + CFG.org + '/' + CFG.siteRepo + '/new/main/wall?filename=' + encodeURIComponent(u + '.txt') + '&value=' + encodeURIComponent(m.trim() + '\n');
        go.setAttribute('aria-disabled', 'false');
        store.set('gh-user', u);
      } else {
        go.href = '#';
        go.setAttribute('aria-disabled', 'true');
      }
    }
    user.addEventListener('input', update);
    msg.addEventListener('input', update);
    $('#wall-form').addEventListener('submit', function (e) { e.preventDefault(); if (go.getAttribute('aria-disabled') === 'false') window.open(go.href, '_blank', 'noopener'); });
    go.addEventListener('click', function (e) { if (go.getAttribute('aria-disabled') !== 'false') e.preventDefault(); });
    update();
  })();

  /* =====================================================================
     5 · Team lab
     ===================================================================== */
  var lab = { team: store.get('team', null) };
  if (CFG.teams.indexOf(lab.team) < 0) lab.team = null;

  function updateLinks() {
    var repo = lab.team ? teamRepo(lab.team) : null;
    var base = repo ? GH + CFG.org + '/' + repo : null;
    var links = {
      repo: base, pulls: base && base + '/pulls', actions: base && base + '/actions',
      dev: repo && 'https://github.dev/' + CFG.org + '/' + repo,
      colab: repo && 'https://colab.research.google.com/github/' + CFG.org + '/' + repo + '/blob/main/run_in_colab.ipynb',
      invitation: GH + 'orgs/' + CFG.org + '/invitation',
      'site-repo': GH + CFG.org + '/' + CFG.siteRepo
    };
    $$('[data-link]').forEach(function (a) {
      var url = links[a.dataset.link];
      if (url) a.href = url; else a.removeAttribute('href');
    });
    $('#team-links').classList.toggle('disabled', !lab.team);
    $$('[data-team-template]').forEach(function (code) {
      if (!code.dataset.tpl) code.dataset.tpl = code.textContent;
      code.textContent = code.dataset.tpl.replace(/\{org\}/g, CFG.org).replace(/\{repo\}/g, repo || 'G?');
    });
    updateGenerator();
  }

  (function teamPicker() {
    var box = $('#team-picker');
    CFG.teams.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.textContent = t;
      b.addEventListener('click', function () {
        lab.team = t;
        store.set('team', t);
        $$('button', box).forEach(function (x) { x.setAttribute('aria-checked', String(x.textContent === t)); x.tabIndex = x.textContent === t ? 0 : -1; });
        updateLinks();
      });
      b.addEventListener('keydown', function (e) {
        var i = CFG.teams.indexOf(t);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          var next = box.children[(i + (e.key === 'ArrowRight' ? 1 : CFG.teams.length - 1)) % CFG.teams.length];
          next.focus(); next.click();
        }
      });
      b.setAttribute('aria-checked', String(t === lab.team));
      b.tabIndex = t === lab.team || (!lab.team && t === CFG.teams[0]) ? 0 : -1;
      box.appendChild(b);
    });
  })();

  /* ---------- tabs (ARIA) ---------- */
  (function tabs() {
    var list = $('.track-card [role="tablist"]'), tabs = $$('[role="tab"]', list);
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
      if (focus) tab.focus();
      store.set('track', tab.id);
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t, false); });
      t.addEventListener('keydown', function (e) {
        var k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (k) { e.preventDefault(); select(tabs[(i + k + tabs.length) % tabs.length], true); }
        if (e.key === 'Home') { e.preventDefault(); select(tabs[0], true); }
        if (e.key === 'End') { e.preventDefault(); select(tabs[tabs.length - 1], true); }
      });
    });
    var saved = document.getElementById(store.get('track', 'tab-browser'));
    if (saved && tabs.indexOf(saved) >= 0) select(saved, false);
  })();

  /* ---------- role checklists ---------- */
  var ROLES = [
    { id: 'author', label: '✍️ 作者', items: [
      ['打開小組 repo，看得到 README 和 features/ 資料夾', '看不到？先接受組織邀請（見下方「卡住了？」）'],
      ['用功能檔產生器做出 features/你的功能.py', 'AUTHOR 要填自己的 GitHub 帳號'],
      ['建立檔案，commit 到新分支 feature/你的功能', 'main 受保護，網頁會自動要你開新分支'],
      ['開 Pull Request，把 PR 樣板填完', 'AI 使用聲明必填！'],
      ['CI 出現綠色 ✅', '❌ 就點 Details 看是哪一條規則沒過'],
      ['在組內告訴 PO：我的 PR 好了', '要修改就 commit 到同一個分支，PR 會自動更新'],
      ['PR 被合併，在 main 的 features/ 看到自己的檔案 🎉', '']
    ] },
    { id: 'po', label: '👑 PO', items: [
      ['到 Pull requests 分頁，打開隊友的 PR → Files changed', ''],
      ['確認只動到 features/ 裡他自己的檔案、沒有 token／個資', '動到別人的檔案 → 留言請他改'],
      ['只合併 CI ✅ 的 PR', '（加分）合併前留一則留言或按 Approve'],
      ['Merge pull request → Confirm merge → Delete branch', '刪掉已合併的分支，保持整齊'],
      ['遇到「This branch has conflicts」：和作者一起解決', '見下方「卡住了？」'],
      ['全部合併後：Colab 跑 run_in_colab.ipynb 步驟 0～2', '輸入「功能」，確認每個人的功能都在'],
      ['在 Sprint Backlog 把完成的項目移到 Done', '']
    ] }
  ];
  var roleState = store.get('roles', {});
  var currentRole = store.get('role', 'author');
  if (!ROLES.some(function (r) { return r.id === currentRole; })) currentRole = 'author';

  function renderRoles() {
    var tabs = $('#role-tabs'), list = $('#role-list');
    tabs.innerHTML = '';
    ROLES.forEach(function (r) {
      var st = roleState[r.id] || [], n = st.filter(Boolean).length;
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(r.id === currentRole));
      b.innerHTML = esc(r.label) + '<span class="cnt">' + n + '/' + r.items.length + '</span>';
      b.addEventListener('click', function () { currentRole = r.id; store.set('role', r.id); renderRoles(); });
      tabs.appendChild(b);
    });
    var role = ROLES.filter(function (r) { return r.id === currentRole; })[0];
    var st = roleState[role.id] || [];
    list.innerHTML = '';
    role.items.forEach(function (it, i) {
      var li = document.createElement('li');
      var id = 'chk-' + role.id + '-' + i;
      li.innerHTML = '<label for="' + id + '"><input type="checkbox" id="' + id + '"' + (st[i] ? ' checked' : '') + '><span>' + esc(it[0]) + (it[1] ? '<small>' + esc(it[1]) + '</small>' : '') + '</span></label>';
      $('input', li).addEventListener('change', function (e) {
        var s = roleState[role.id] = (roleState[role.id] || []).slice();
        s[i] = e.target.checked;
        store.set('roles', roleState);
        var done = role.items.every(function (_, k) { return s[k]; });
        renderRolesProgress();
        $$('#role-tabs .cnt')[ROLES.indexOf(role)].textContent = s.filter(Boolean).length + '/' + role.items.length;
        if (e.target.checked && done) {
          toast('🏅 ' + role.label.replace(/^\S+\s/, '') + '任務全部完成！', 'ok');
          var r = e.target.getBoundingClientRect();
          confetti(r.left, r.top, 180);
        }
      });
      list.appendChild(li);
    });
    renderRolesProgress();
  }
  function renderRolesProgress() {
    var role = ROLES.filter(function (r) { return r.id === currentRole; })[0];
    var st = roleState[role.id] || [];
    var n = role.items.filter(function (_, i) { return st[i]; }).length;
    $('#roles-bar').style.width = (n / role.items.length * 100) + '%';
    $('#roles-progress').textContent = role.label + '：' + n + ' / ' + role.items.length + ' 完成';
  }
  $('#roles-reset').addEventListener('click', function () {
    if (!window.confirm('要清除所有角色的勾選紀錄嗎？')) return;
    roleState = {};
    store.del('roles');
    renderRoles();
  });
  renderRoles();

  /* ---------- feature file generator ---------- */
  var HELP_WORDS = ['help', '幫助', '功能', '選單', '?', '？'];
  var PY_KW = /\b(from|import|def|return|if|elif|else|for|in|not|and|or|True|False|None)\b/g;
  function pyStr(s) { return JSON.stringify(s); }
  function highlightPy(code) {
    return code.split('\n').map(function (line) {
      var out = '', rest = line, m;
      // strings and comments first, then keywords on the remaining plain text
      var re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#.*$)/g, last = 0;
      while ((m = re.exec(line))) {
        out += plain(line.slice(last, m.index));
        out += m[1] ? '<span class="str">' + esc(m[1]) + '</span>' : '<span class="com">' + esc(m[2]) + '</span>';
        last = re.lastIndex;
      }
      rest = line.slice(last);
      return out + plain(rest);
    }).join('\n');
    function plain(s) {
      return esc(s).replace(PY_KW, '<span class="kw">$1</span>').replace(/\b(handle|TextMessage)\b/g, '<span class="fn">$1</span>');
    }
  }

  function updateGenerator() {
    var f = $('#gen-form');
    if (!f) return;
    var name = f.name.value.trim();
    if (!f.author.value.trim() && store.get('gh-user', '')) f.author.value = store.get('gh-user', '');
    var author = f.author.value.trim().replace(/^@/, '');
    var file = f.file.value.trim().replace(/\.py$/, '');
    var keywords = f.keywords.value.split(/[,，、]/).map(function (k) { return k.trim(); }).filter(Boolean);
    var replies = f.reply.value.split('\n').map(function (r) { return r.trim(); }).filter(Boolean);

    var checks = [
      [!!name, 'NAME 功能名稱不能是空的'],
      [USER_RE.test(author), 'AUTHOR 要是你的 GitHub 帳號（@ 後面那一段）'],
      [/^[a-z][a-z0-9_]*$/.test(file) && file.indexOf('example_') !== 0, '檔名用小寫英文、數字、底線，例如 garbage_truck'],
      [keywords.length > 0, 'KEYWORDS 至少一個關鍵字'],
      [!keywords.some(function (k) { return HELP_WORDS.indexOf(k) >= 0; }), 'KEYWORDS 不能用系統保留字（功能、選單、help…）'],
      [replies.length >= 1 && replies.length <= 5, '回覆 1～5 則訊息']
    ];
    $('#gen-checks').innerHTML = checks.map(function (c) { return '<li class="' + (c[0] ? '' : 'bad') + '">' + esc(c[1]) + '</li>'; }).join('');

    var code = [
      '"""',
      (name || '功能名稱') + ' — W07 的功能，W08 合併進小組 Bot',
      '"""',
      'from linebot.v3.messaging import TextMessage',
      '',
      'NAME = ' + pyStr(name || '功能名稱'),
      'AUTHOR = ' + pyStr('@' + (author || 'your-github-username')),
      'KEYWORDS = [' + (keywords.length ? keywords : ['關鍵字']).map(pyStr).join(', ') + ']',
      '',
      '',
      'def handle(text, user_id):',
      '    # text 是使用者輸入的文字；把你 W07 的程式邏輯放在這裡',
      '    return [',
    ].concat((replies.length ? replies.slice(0, 5) : ['回覆內容']).map(function (r) { return '        TextMessage(text=' + pyStr(r) + '),'; }), ['    ]', '']).join('\n');

    var pre = $('#gen-code');
    pre.dataset.raw = code;
    pre.firstChild.innerHTML = highlightPy(code);

    var ok = checks.every(function (c) { return c[0]; });
    var a = $('#gen-github');
    if (!lab.team) {
      a.setAttribute('aria-disabled', 'true'); a.href = '#';
      a.textContent = '先在上方選擇組別 ↑';
    } else if (!ok) {
      a.setAttribute('aria-disabled', 'true'); a.href = '#';
      a.textContent = '先修正上面紅色的項目';
    } else {
      a.setAttribute('aria-disabled', 'false');
      a.href = GH + CFG.org + '/' + teamRepo(lab.team) + '/new/main/features?filename=' + encodeURIComponent(file + '.py') + '&value=' + encodeURIComponent(code);
      a.textContent = '在 ' + lab.team + ' 的 repo 建立這個檔案 ↗';
    }
  }
  (function initGenerator() {
    var f = $('#gen-form');
    var saved = store.get('gh-user', '');
    if (saved) f.author.value = saved;
    var last = store.get('gen', null);
    if (last && typeof last === 'object') ['name', 'file', 'keywords', 'reply'].forEach(function (k) { if (typeof last[k] === 'string') f[k].value = last[k]; });
    f.addEventListener('input', function () {
      var a = f.author.value.trim().replace(/^@/, '');
      if (USER_RE.test(a)) store.set('gh-user', a);
      store.set('gen', { name: f.name.value, file: f.file.value, keywords: f.keywords.value, reply: f.reply.value });
      updateGenerator();
    });
    f.addEventListener('submit', function (e) { e.preventDefault(); });
    $('#gen-github').addEventListener('click', function (e) { if (this.getAttribute('aria-disabled') === 'true') e.preventDefault(); });
  })();

  /* ---------- copy buttons ---------- */
  $$('pre.code[data-copy]').forEach(function (pre) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'copy-btn'; b.textContent = '複製';
    pre.appendChild(b);
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.copy-btn');
    if (!b) return;
    var pre = b.dataset.copyTarget ? document.getElementById(b.dataset.copyTarget) : b.closest('pre');
    var text = pre.dataset.raw || $('code', pre).textContent;
    copyText(text).then(function () {
      b.textContent = '已複製 ✓'; b.classList.add('copied');
      setTimeout(function () { b.textContent = '複製'; b.classList.remove('copied'); }, 1600);
    }, function () { toast('複製失敗，請手動選取文字'); });
  });

  updateLinks();

  /* =====================================================================
     TA mode: segment timer, speaker notes, prep checklist
     ===================================================================== */
  var SEGMENTS = [
    { id: 'why', name: '1 為什麼要 Git', min: 3 },
    { id: 'concepts', name: '2 概念動畫', min: 7 },
    { id: 'lab', name: '3 小組實作', min: 20 }
  ];
  var TOTAL_MS = SEGMENTS.reduce(function (a, s) { return a + s.min * 60000; }, 0);
  var PREP = [
    '組織已建立；學生都接受邀請（Org → People 數人數）',
    'G1～G6 repo 已從 template 建立，main 有保護（要 PR + pytest）',
    '每組 repo 的 Actions 至少跑過一次（CI 會出現 pytest）',
    'w08-git 網站已部署；自己用測試帳號在 G1 跑過一次 PR → 合併',
    '教室電腦能開 github.com 與 github.dev，並可登入',
    '請學生把 W07 程式碼放在容易複製的地方（雲端／Email）',
    '每組確認誰有筆電、誰的 LINE channel 用來跑整組 Bot',
    '投影機開好這個頁面（#ta），助教模式計時器歸零'
  ];
  var ta = store.get('ta-timer', { seg: 0, accum: 0, since: null, doneTotal: 0 });
  if (typeof ta.seg !== 'number' || ta.seg < 0 || ta.seg >= SEGMENTS.length) ta = { seg: 0, accum: 0, since: null, doneTotal: 0 };
  var taTick = null, audioCtx = null, beeped = {};

  function segElapsed() { return ta.accum + (ta.since ? Date.now() - ta.since : 0); }
  function fmt(ms) {
    var neg = ms < 0, s = Math.floor(Math.abs(ms) / 1000);
    return (neg ? '+' : '') + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function saveTa() { store.set('ta-timer', ta); }
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18].forEach(function (t) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t + 0.15);
        o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.16);
      });
    } catch (e) { /* no audio */ }
  }
  function renderTa() {
    var seg = SEGMENTS[ta.seg], el = segElapsed(), left = seg.min * 60000 - el;
    $('#ta-seg-name').textContent = seg.name + '（' + seg.min + ' 分）';
    var time = $('#ta-time');
    time.textContent = fmt(left);
    time.classList.toggle('warn', left <= 60000 && left > 0);
    time.classList.toggle('over', left <= 0);
    var total = ta.doneTotal + el;
    $('#ta-total').textContent = '總計 ' + fmt(total).replace('+', '') + ' / ' + fmt(TOTAL_MS);
    $('#ta-bar').style.width = Math.min(100, total / TOTAL_MS * 100) + '%';
    $('#ta-start').textContent = ta.since ? '暫停' : (el > 0 ? '繼續' : '開始');
    $$('#ta-segs button').forEach(function (b, i) {
      b.classList.toggle('cur', i === ta.seg);
      b.classList.toggle('past', i < ta.seg);
    });
    if (ta.since && left <= 0 && !beeped[ta.seg]) { beeped[ta.seg] = true; beep(); toast('⏰ 「' + seg.name + '」時間到'); }
  }
  function startStop() {
    if (ta.since) { ta.accum = segElapsed(); ta.since = null; }
    else ta.since = Date.now();
    saveTa(); renderTa();
  }
  function goSeg(i, scroll) {
    if (i < 0 || i >= SEGMENTS.length) return;
    if (i !== ta.seg) {
      var running = !!ta.since;
      // moving on by one keeps the real time spent; jumping around assumes planned timings
      ta.doneTotal = i === ta.seg + 1 ? ta.doneTotal + segElapsed()
        : SEGMENTS.slice(0, i).reduce(function (a, s) { return a + s.min * 60000; }, 0);
      ta.seg = i; ta.accum = 0; ta.since = running ? Date.now() : null;
      beeped[i] = false;
      saveTa(); renderTa();
    }
    if (scroll) document.getElementById(SEGMENTS[i].id).scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  function setTa(on) {
    document.body.classList.toggle('ta', on);
    $('#ta-panel').hidden = !on;
    $('#ta-toggle').setAttribute('aria-pressed', String(on));
    store.set('ta', on);
    if (on && !taTick) taTick = setInterval(renderTa, 250);
    if (!on && taTick) { clearInterval(taTick); taTick = null; }
    if (on) renderTa();
  }
  (function initTa() {
    var segs = $('#ta-segs');
    SEGMENTS.forEach(function (s, i) {
      var li = document.createElement('li');
      li.innerHTML = '<button type="button"><span>' + esc(s.name) + '</span><span>' + s.min + '′</span></button>';
      li.firstChild.addEventListener('click', function () { goSeg(i, true); });
      segs.appendChild(li);
    });
    var prepState = store.get('ta-prep', []);
    var prep = $('#ta-prep');
    function prepCount() { $('#ta-prep-n').textContent = '（' + prepState.filter(Boolean).length + '/' + PREP.length + '）'; }
    PREP.forEach(function (p, i) {
      var li = document.createElement('li');
      li.innerHTML = '<label><input type="checkbox"' + (prepState[i] ? ' checked' : '') + '><span>' + esc(p) + '</span></label>';
      $('input', li).addEventListener('change', function (e) { prepState[i] = e.target.checked; store.set('ta-prep', prepState); prepCount(); });
      prep.appendChild(li);
    });
    prepCount();
    $('#ta-start').addEventListener('click', startStop);
    $('#ta-next').addEventListener('click', function () { goSeg(Math.min(ta.seg + 1, SEGMENTS.length - 1), true); });
    $('#ta-reset').addEventListener('click', function () {
      ta = { seg: 0, accum: 0, since: null, doneTotal: 0 }; beeped = {};
      saveTa(); renderTa();
    });
    $('#ta-toggle').addEventListener('click', function () { setTa(!document.body.classList.contains('ta')); });
    $('#ta-close').addEventListener('click', function () { setTa(false); });
    $('#ta-min').addEventListener('click', function () {
      var p = $('#ta-panel'), min = p.classList.toggle('min');
      $('#ta-min').textContent = min ? '+' : '–';
    });
    $('#ta-panel').addEventListener('keydown', function (e) {
      if (e.key === ' ' && e.target === $('#ta-panel')) { e.preventDefault(); startStop(); }
    });
    $('#ta-panel').tabIndex = -1;
    setTa(/(^|[#&])ta\b/.test(location.hash.slice(1)) || store.get('ta', false) === true);
    window.addEventListener('hashchange', function () { if (location.hash === '#ta') setTa(true); });
  })();

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!editor.hidden) return;
    if (e.key === 't' || e.key === 'T') setTa(!document.body.classList.contains('ta'));
    else if ((e.key === 'n' || e.key === 'N') && document.body.classList.contains('ta')) goSeg(Math.min(ta.seg + 1, SEGMENTS.length - 1), true);
  });
})();
