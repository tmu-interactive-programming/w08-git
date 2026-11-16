/*
 * A tiny in-browser Git simulator (no DOM). Used by the story player and the sandbox.
 *
 * Model: every commit stores a full snapshot (tree = {path: content}). The working tree and
 * the index are snapshots too, so status/diff are just snapshot comparisons. Merges are real
 * three-way merges (line-level diff3), so they can fast-forward, auto-merge or conflict.
 * "origin" is simulated by a second set of branch refs sharing the same commit store.
 */
(function (root) {
  'use strict';

  var MARK_OURS = '<<<<<<< ';
  var MARK_SEP = '=======';
  var MARK_THEIRS = '>>>>>>> ';

  function clone(obj) { return Object.assign({}, obj); }
  function keys(obj) { return Object.keys(obj).sort(); }
  function has(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

  function shortHash(seed) {
    var h = 0x811c9dc5;
    for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    var h2 = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    return ((h >>> 0).toString(16).padStart(8, '0') + h2.toString(16)).slice(0, 7);
  }

  /* ---------- diff helpers ---------- */

  // For each line of `a`, the index of the matching line in `b` (LCS), or -1.
  function lcsMatch(a, b) {
    var n = a.length, m = b.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var match = new Array(n).fill(-1);
    i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { match[i] = j; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return match;
  }

  function sameLines(x, y) {
    if (x.length !== y.length) return false;
    for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  // Line-level three-way merge. Returns {text, conflict}.
  function mergeText(base, ours, theirs, theirsLabel) {
    var o = base.split('\n'), a = ours.split('\n'), b = theirs.split('\n');
    var ma = lcsMatch(o, a), mb = lcsMatch(o, b);
    var out = [], conflict = false;
    var i = 0, j = 0, k = 0;
    for (;;) {
      var i2 = i;
      while (i2 < o.length && !(ma[i2] >= j && mb[i2] >= k)) i2++;
      var stable = i2 < o.length;
      var j2 = stable ? ma[i2] : a.length;
      var k2 = stable ? mb[i2] : b.length;
      var oSeg = o.slice(i, i2), aSeg = a.slice(j, j2), bSeg = b.slice(k, k2);
      if (sameLines(aSeg, oSeg)) out.push.apply(out, bSeg);
      else if (sameLines(bSeg, oSeg) || sameLines(aSeg, bSeg)) out.push.apply(out, aSeg);
      else {
        conflict = true;
        out.push(MARK_OURS + 'HEAD');
        out.push.apply(out, aSeg);
        out.push(MARK_SEP);
        out.push.apply(out, bSeg);
        out.push(MARK_THEIRS + theirsLabel);
      }
      if (!stable) break;
      out.push(o[i2]);
      i = i2 + 1; j = j2 + 1; k = k2 + 1;
    }
    return { text: out.join('\n'), conflict: conflict };
  }

  function lineStats(before, after) {
    var a = before == null ? [] : before.split('\n');
    var b = after == null ? [] : after.split('\n');
    if (a.length && a[a.length - 1] === '') a.pop();
    if (b.length && b[b.length - 1] === '') b.pop();
    var common = lcsMatch(a, b).filter(function (x) { return x >= 0; }).length;
    return { add: b.length - common, del: a.length - common };
  }

  function diffTrees(from, to) {
    var out = [];
    var all = {};
    keys(from).concat(keys(to)).forEach(function (p) { all[p] = true; });
    Object.keys(all).sort().forEach(function (p) {
      var x = has(from, p) ? from[p] : null, y = has(to, p) ? to[p] : null;
      if (x === y) return;
      var st = lineStats(x, y);
      out.push({ path: p, status: x == null ? 'added' : y == null ? 'deleted' : 'modified', add: st.add, del: st.del });
    });
    return out;
  }

  function hasMarkers(text) {
    return /^(<{7} |={7}$|>{7} )/m.test(text || '');
  }

  /* ---------- argument parsing ---------- */

  function tokenize(line) {
    var tokens = [], cur = '', quote = null, started = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (quote) {
        if (c === quote) quote = null;
        else if (c === '\\' && quote === '"' && i + 1 < line.length && '"\\n'.indexOf(line[i + 1]) >= 0) {
          var nx = line[++i];
          cur += nx === 'n' ? '\n' : nx;
        } else cur += c;
      } else if (c === '"' || c === "'" || c === '“' || c === '”') {
        quote = c === '“' ? '”' : c; started = true;
      } else if (/\s/.test(c)) {
        if (started) { tokens.push(cur); cur = ''; started = false; }
      } else if (c === '>' ) {
        if (started) { tokens.push(cur); cur = ''; started = false; }
        if (line[i + 1] === '>') { tokens.push('>>'); i++; } else tokens.push('>');
      } else { cur += c; started = true; }
    }
    if (quote) throw new Error('引號沒有成對（少了一個 ' + quote + '）');
    if (started) tokens.push(cur);
    return tokens;
  }

  /* ---------- the simulator ---------- */

  function GitSim(opts) {
    opts = opts || {};
    this.user = opts.user || '@you';
    this.repoName = opts.repoName || 'your-team/linebot';
    this.protectedBranches = opts.protectedBranches || [];
    this.seed = opts.seed || 'w08';
    this.initialAuthor = opts.initialAuthor || this.user;
    this.init(opts.files || { 'README.md': '# 我們的 LINE Bot\n' }, opts.initialMessage || 'Initial commit');
  }

  GitSim.MARKERS = { ours: MARK_OURS, sep: MARK_SEP, theirs: MARK_THEIRS };
  GitSim.mergeText = mergeText;
  GitSim.diffTrees = diffTrees;
  GitSim.tokenize = tokenize;
  GitSim.hasMarkers = hasMarkers;

  GitSim.prototype.init = function (files, message) {
    this.commits = {};
    this.order = [];
    this.branches = {};
    this.remote = {};
    this.laneOf = { main: 0 };
    this.nextLane = 1;
    this.head = 'main';
    this.mergeState = null;
    this.prs = [];
    this.clock = 0;
    var id = this._makeCommit([], message, clone(files), 'main', this.initialAuthor);
    this.branches.main = id;
    this.remote.main = id;
    this.index = clone(files);
    this.work = clone(files);
  };

  GitSim.prototype._lane = function (branch) {
    if (!has(this.laneOf, branch)) this.laneOf[branch] = this.nextLane++;
    return this.laneOf[branch];
  };

  GitSim.prototype._makeCommit = function (parents, message, tree, branch, author) {
    var id;
    var n = 0;
    do { id = shortHash(this.seed + '|' + this.order.length + '|' + message + '|' + parents.join(',') + '|' + (n++)); }
    while (has(this.commits, id));
    this.commits[id] = {
      id: id, parents: parents.slice(), message: message, tree: tree, author: author,
      lane: this._lane(branch), branch: branch, seq: this.order.length, time: this.clock++
    };
    this.order.push(id);
    return id;
  };

  GitSim.prototype.headId = function () { return this.branches[this.head]; };
  GitSim.prototype.headTree = function () { return this.commits[this.headId()].tree; };

  GitSim.prototype.ancestors = function (id) {
    var seen = {}, stack = [id];
    while (stack.length) {
      var c = stack.pop();
      if (!c || seen[c]) continue;
      seen[c] = true;
      stack.push.apply(stack, this.commits[c].parents);
    }
    return seen;
  };

  GitSim.prototype.isAncestor = function (a, b) { return !!this.ancestors(b)[a]; };

  GitSim.prototype.mergeBase = function (a, b) {
    var A = this.ancestors(a), B = this.ancestors(b), best = null;
    for (var id in A) {
      if (B[id] && (!best || this.commits[id].time > this.commits[best].time)) best = id;
    }
    return best;
  };

  GitSim.prototype.resolveRef = function (ref) {
    if (!ref) return null;
    if (ref === 'HEAD') return this.headId();
    if (has(this.branches, ref)) return this.branches[ref];
    var m = /^origin\/(.+)$/.exec(ref);
    if (m && has(this.remote, m[1])) return this.remote[m[1]];
    if (has(this.commits, ref)) return ref;
    var found = this.order.filter(function (id) { return ref.length >= 4 && id.indexOf(ref) === 0; });
    return found.length === 1 ? found[0] : null;
  };

  GitSim.prototype.status = function () {
    var head = this.headTree();
    var staged = diffTrees(head, this.index);
    var unstaged = diffTrees(this.index, this.work).filter(function (d) { return d.status !== 'added'; });
    var idx = this.index, work = this.work, head2 = head;
    var untracked = keys(work).filter(function (p) { return !has(idx, p) && !has(head2, p); });
    return { staged: staged, unstaged: unstaged, untracked: untracked };
  };

  GitSim.prototype.isDirty = function () {
    var s = this.status();
    return s.staged.length + s.unstaged.length + s.untracked.length > 0;
  };

  GitSim.prototype.writeFile = function (path, content) { this.work[path] = content; };
  GitSim.prototype.readFile = function (path) { return has(this.work, path) ? this.work[path] : null; };

  /* ---------- core operations (return arrays of [cls, text] lines) ---------- */

  GitSim.prototype.add = function (paths) {
    var self = this, out = [];
    if (!paths.length) throw new Error('要加入哪個檔案？例如：git add features/weather.py 或 git add .');
    paths.forEach(function (p) {
      if (p === '.' || p === '-A' || p === '--all') {
        self.index = clone(self.work);
        if (self.mergeState) self.mergeState.conflicts = [];
        return;
      }
      p = p.replace(/^\.\//, '');
      var dirMatches = keys(self.work).concat(keys(self.index)).filter(function (k) { return k.indexOf(p.replace(/\/$/, '') + '/') === 0; });
      if (has(self.work, p)) self.index[p] = self.work[p];
      else if (has(self.index, p)) delete self.index[p];
      else if (dirMatches.length) {
        dirMatches.forEach(function (k) { if (has(self.work, k)) self.index[k] = self.work[k]; else delete self.index[k]; });
      } else throw new Error("fatal: pathspec '" + p + "' did not match any files");
      if (self.mergeState) {
        self.mergeState.conflicts = self.mergeState.conflicts.filter(function (c) { return c !== p && c.indexOf(p + '/') !== 0; });
      }
    });
    if (self.mergeState) {
      var stillMarked = keys(self.index).filter(function (k) { return hasMarkers(self.index[k]); });
      stillMarked.forEach(function (k) { out.push(['warn', '⚠️ ' + k + ' 裡還有衝突標記（<<<<<<< ======= >>>>>>>），記得刪掉再 commit']); });
    }
    return out;
  };

  GitSim.prototype.commit = function (message, opts) {
    opts = opts || {};
    if (!message) throw new Error('請用 -m 寫 commit 訊息，例如：git commit -m "新增天氣功能"');
    if (opts.all) {
      var self = this;
      keys(this.index).forEach(function (p) {
        if (has(self.work, p)) self.index[p] = self.work[p]; else delete self.index[p];
      });
    }
    var ms = this.mergeState;
    if (ms && ms.conflicts.length) {
      throw new Error('error: Committing is not possible because you have unmerged files.\n' +
        ms.conflicts.map(function (c) { return '  ' + c; }).join('\n') +
        '\nhint: 修好衝突後先 git add <檔案>，再 git commit');
    }
    var marked = keys(this.index).filter(function (k) { return hasMarkers(this.index[k]); }, this);
    if (marked.length) {
      throw new Error('🛑（模擬器提醒）' + marked.join(', ') + ' 還有衝突標記 <<<<<<< ======= >>>>>>>。\n' +
        '   用 edit ' + marked[0] + ' 把它們刪掉、留下正確內容，再 git add 一次。');
    }
    var changes = diffTrees(this.headTree(), this.index);
    if (!changes.length && !ms) {
      var s = this.status();
      if (s.unstaged.length || s.untracked.length) {
        throw new Error('no changes added to commit\nhint: 先用 git add <檔案> 把修改放進暫存區（staging area）');
      }
      throw new Error('nothing to commit, working tree clean');
    }
    var parents = [this.headId()].concat(ms ? [ms.theirs] : []);
    var id = this._makeCommit(parents, message, clone(this.index), this.head, opts.author || this.user);
    this.branches[this.head] = id;
    this.mergeState = null;
    var adds = 0, dels = 0;
    changes.forEach(function (c) { adds += c.add; dels += c.del; });
    return [['ok', '[' + this.head + ' ' + id + '] ' + message.split('\n')[0]],
      ['dim', ' ' + changes.length + ' file' + (changes.length === 1 ? '' : 's') + ' changed, ' + adds + ' insertions(+), ' + dels + ' deletions(-)']]
      .concat(changes.filter(function (c) { return c.status !== 'modified'; }).map(function (c) {
        return ['dim', ' ' + (c.status === 'added' ? 'create' : 'delete') + ' mode 100644 ' + c.path];
      }));
  };

  GitSim.prototype._checkClean = function (what) {
    if (this.mergeState) throw new Error('error: 正在合併中，請先解決衝突並 commit，或 git merge --abort');
    if (this.isDirty()) throw new Error('error: 你還有沒 commit 的修改，請先 commit 再' + what + '\nhint: git add . → git commit -m "..."');
  };

  GitSim.prototype.createBranch = function (name, start) {
    if (!/^[A-Za-z0-9._\/-]+$/.test(name) || /(^[-\/.]|\/$|\.\.|\/\/)/.test(name)) {
      throw new Error("fatal: '" + name + "' is not a valid branch name\nhint: 用英文、數字、- 和 /，例如 feature/weather");
    }
    if (has(this.branches, name)) throw new Error("fatal: a branch named '" + name + "' already exists");
    this.branches[name] = start || this.headId();
    this._lane(name);
  };

  GitSim.prototype.switchTo = function (name, create) {
    var out = [];
    if (this.mergeState) throw new Error('error: 正在合併中，請先解決衝突並 commit，或 git merge --abort');
    if (create) this.createBranch(name);
    else if (!has(this.branches, name)) {
      if (has(this.remote, name)) {
        this.branches[name] = this.remote[name];
        this._lane(name);
        out.push(['dim', "branch '" + name + "' set up to track 'origin/" + name + "'."]);
      } else throw new Error("fatal: invalid reference: " + name + "\nhint: 要建立新分支請用 git switch -c " + name);
    }
    if (name === this.head) return [['dim', "Already on '" + name + "'"]];
    var from = this.headTree(), to = this.commits[this.branches[name]].tree;
    var dirty = {}, self = this;
    keys(from).concat(keys(this.index), keys(this.work)).forEach(function (p) {
      if (self.index[p] !== from[p] || self.work[p] !== from[p]) dirty[p] = true;
    });
    var blocked = Object.keys(dirty).filter(function (p) { return from[p] !== to[p]; });
    if (blocked.length) {
      if (create) { delete this.branches[name]; }
      throw new Error('error: Your local changes to the following files would be overwritten by checkout:\n' +
        blocked.map(function (p) { return '\t' + p; }).join('\n') + '\nPlease commit your changes before you switch branches.');
    }
    var work = clone(to), index = clone(to);
    Object.keys(dirty).forEach(function (p) {
      if (has(self.work, p)) work[p] = self.work[p]; else delete work[p];
      if (has(self.index, p)) index[p] = self.index[p]; else delete index[p];
    });
    this.work = work; this.index = index; this.head = name;
    out.push(['ok', (create ? "Switched to a new branch '" : "Switched to branch '") + name + "'"]);
    return out;
  };

  // Three-way merge of trees. Returns {tree, conflicts:[path], notes:[line]}.
  GitSim.prototype._mergeTrees = function (baseId, oursId, theirsId, theirsLabel) {
    var base = this.commits[baseId].tree, ours = this.commits[oursId].tree, theirs = this.commits[theirsId].tree;
    var all = {}, tree = {}, conflicts = [], notes = [];
    [base, ours, theirs].forEach(function (t) { Object.keys(t).forEach(function (p) { all[p] = true; }); });
    Object.keys(all).sort().forEach(function (p) {
      var o = has(base, p) ? base[p] : null, a = has(ours, p) ? ours[p] : null, b = has(theirs, p) ? theirs[p] : null;
      var result;
      if (a === b) result = a;
      else if (a === o) result = b;
      else if (b === o) result = a;
      else if (a == null || b == null) {
        conflicts.push(p);
        notes.push(['err', 'CONFLICT (modify/delete): ' + p + ' 一邊刪除、一邊修改']);
        result = a == null ? b : a;
      } else {
        notes.push(['dim', 'Auto-merging ' + p]);
        var m = mergeText(o == null ? '' : o, a, b, theirsLabel);
        result = m.text;
        if (m.conflict) {
          conflicts.push(p);
          notes.push(['err', 'CONFLICT (content): Merge conflict in ' + p]);
        }
      }
      if (result != null) tree[p] = result;
    });
    return { tree: tree, conflicts: conflicts, notes: notes };
  };

  GitSim.prototype.merge = function (ref, opts) {
    opts = opts || {};
    if (!ref) throw new Error('要合併哪個分支？例如：git merge feature/weather');
    this._checkClean('合併');
    var theirs = this.resolveRef(ref);
    if (!theirs) throw new Error('merge: ' + ref + ' - not something we can merge');
    var ours = this.headId();
    if (this.isAncestor(theirs, ours)) return [['dim', 'Already up to date.']];
    if (this.isAncestor(ours, theirs) && !opts.noFF) {
      var changes = diffTrees(this.headTree(), this.commits[theirs].tree);
      this.branches[this.head] = theirs;
      this.work = clone(this.commits[theirs].tree);
      this.index = clone(this.work);
      return [['dim', 'Updating ' + ours + '..' + theirs], ['ok', 'Fast-forward']].concat(changes.map(function (c) {
        return ['dim', ' ' + c.path + ' | ' + (c.add + c.del) + ' ' + '+'.repeat(Math.min(c.add, 20)) + '-'.repeat(Math.min(c.del, 20))];
      }));
    }
    var base = this.mergeBase(ours, theirs);
    var res = this._mergeTrees(base, ours, theirs, ref);
    var message = opts.message || "Merge branch '" + ref + "'" + (this.head === 'main' ? '' : ' into ' + this.head);
    if (res.conflicts.length) {
      var oursTree = this.headTree();
      this.mergeState = { theirs: theirs, ref: ref, conflicts: res.conflicts.slice(), message: message };
      this.work = clone(res.tree);
      this.index = clone(res.tree);
      var self = this;
      res.conflicts.forEach(function (p) { if (has(oursTree, p)) self.index[p] = oursTree[p]; else delete self.index[p]; });
      return res.notes.concat([['err', 'Automatic merge failed; fix conflicts and then commit the result.'],
        ['hint', '💡 用 cat ' + res.conflicts[0] + ' 看衝突、edit ' + res.conflicts[0] + ' 修改，然後 git add → git commit']]);
    }
    this.mergeState = { theirs: theirs, ref: ref, conflicts: [], message: message };
    this.index = clone(res.tree);
    this.work = clone(res.tree);
    var out = this.commit(message, { author: opts.author });
    return res.notes.concat([['ok', "Merge made by the 'ort' strategy."]], out.slice(1));
  };

  GitSim.prototype.abortMerge = function () {
    if (!this.mergeState) throw new Error('fatal: There is no merge to abort (MERGE_HEAD missing).');
    this.mergeState = null;
    this.work = clone(this.headTree());
    this.index = clone(this.work);
    return [['ok', '已取消合併，回到合併前的狀態。']];
  };

  GitSim.prototype.checkoutSide = function (side, paths) {
    var ms = this.mergeState;
    if (!ms) throw new Error('error: --' + side + ' 只能在合併衝突時使用');
    if (!paths.length) throw new Error('要用哪個檔案？例如：git checkout --' + side + ' README.md');
    var tree = side === 'ours' ? this.headTree() : this.commits[ms.theirs].tree, self = this;
    paths.forEach(function (p) {
      if (has(tree, p)) self.work[p] = tree[p]; else delete self.work[p];
    });
    return [['ok', 'Updated ' + paths.length + ' path' + (paths.length > 1 ? 's' : '') + ' from ' + (side === 'ours' ? 'HEAD（我的版本）' : ms.ref + '（對方的版本）')],
      ['hint', '💡 接著 git add ' + paths.join(' ') + ' → git commit']];
  };

  GitSim.prototype.push = function (branch, setUpstream) {
    branch = branch || this.head;
    if (!has(this.branches, branch)) throw new Error("error: src refspec " + branch + " does not match any");
    var local = this.branches[branch], remote = this.remote[branch];
    var url = 'https://github.com/' + this.repoName;
    if (this.protectedBranches.indexOf(branch) >= 0 && remote !== local) {
      return [['dim', 'To ' + url + '.git'],
        ['err', 'remote: error: GH006: Protected branch update failed for refs/heads/' + branch + '.'],
        ['err', 'remote: error: Changes must be made through a pull request.'],
        ['err', ' ! [remote rejected] ' + branch + ' -> ' + branch + ' (protected branch hook declined)'],
        ['hint', '💡 main 受保護：請在 feature 分支上 push，再開 Pull Request']];
    }
    if (remote === local) return [['dim', 'Everything up-to-date']];
    if (remote && !this.isAncestor(remote, local)) {
      return [['dim', 'To ' + url + '.git'],
        ['err', ' ! [rejected]        ' + branch + ' -> ' + branch + ' (fetch first)'],
        ['err', "error: failed to push some refs to '" + url + ".git'"],
        ['hint', '💡 遠端有你還沒拿到的 commit：先 git pull 再 push']];
    }
    this.remote[branch] = local;
    var out = [['dim', 'To ' + url + '.git'],
      ['ok', (remote ? '   ' + remote + '..' + local + '  ' : ' * [new branch]      ') + branch + ' -> ' + branch]];
    if (setUpstream) out.push(['dim', "branch '" + branch + "' set up to track 'origin/" + branch + "'."]);
    if (!remote && branch !== 'main') {
      out.unshift(['dim', 'remote: Create a pull request for \'' + branch + '\' on GitHub by visiting:'],
        ['link', 'remote:      ' + url + '/pull/new/' + branch]);
      out.push(['hint', '💡 下一步：gh pr create 開 Pull Request']);
    }
    return out;
  };

  GitSim.prototype.pull = function (branch) {
    branch = branch || this.head;
    if (!has(this.remote, branch)) throw new Error("fatal: couldn't find remote ref " + branch);
    var out = [['dim', 'From https://github.com/' + this.repoName], ['dim', ' * branch            ' + branch + ' -> FETCH_HEAD']];
    return out.concat(this.merge('origin/' + branch));
  };

  GitSim.prototype.prCreate = function (title) {
    var branch = this.head;
    if (branch === 'main') throw new Error('你現在在 main。請先切到 feature 分支（git switch -c feature/...）');
    if (!has(this.remote, branch)) throw new Error('遠端還沒有 ' + branch + '：請先 git push -u origin ' + branch);
    var open = this.prs.filter(function (p) { return p.branch === branch && p.state === 'open'; })[0];
    if (open) return [['dim', '這個分支已經有 PR #' + open.number + ' 了：'], ['link', open.url]];
    var pr = { number: this.prs.length + 1, branch: branch, title: title || this.commits[this.remote[branch]].message, state: 'open' };
    pr.url = 'https://github.com/' + this.repoName + '/pull/' + pr.number;
    this.prs.push(pr);
    return [['ok', '✔ Created pull request #' + pr.number + '：' + pr.title + '（' + branch + ' → main）'], ['link', pr.url],
      ['hint', '💡 等隊友 Review，再由 PO 合併。在這個模擬器裡可以用 gh pr merge 代替']];
  };

  GitSim.prototype.prMerge = function (number) {
    var pr = number ? this.prs.filter(function (p) { return p.number === number; })[0]
      : this.prs.filter(function (p) { return p.state === 'open'; }).slice(-1)[0];
    if (!pr) throw new Error(number ? '找不到 PR #' + number : '沒有開著的 PR。先 git push，再 gh pr create');
    if (pr.state !== 'open') throw new Error('PR #' + pr.number + ' 已經合併過了');
    var head = this.remote[pr.branch], base = this.remote.main;
    if (this.isAncestor(head, base)) { pr.state = 'merged'; return [['dim', 'PR #' + pr.number + ' 沒有新的變更']]; }
    var res = this._mergeTrees(this.mergeBase(base, head), base, head, pr.branch);
    if (res.conflicts.length) {
      return [['err', 'X Pull request #' + pr.number + ' is not mergeable: the merge commit cannot be cleanly created.'],
        ['err', '  This branch has conflicts that must be resolved: ' + res.conflicts.join(', ')],
        ['hint', '💡 在 ' + pr.branch + ' 上 git pull origin main，解完衝突再 git push，PR 會自動更新']];
    }
    var msg = 'Merge pull request #' + pr.number + ' from ' + pr.branch;
    var id = this._makeCommit([base, head], msg, res.tree, 'main', '@product-owner');
    this.remote.main = id;
    pr.state = 'merged';
    return [['dim', '✓ Checks passed（pytest ✅）'], ['dim', '✓ Approved by @teammate'],
      ['ok', '✔ Merged pull request #' + pr.number + '（' + pr.branch + ' → main）'],
      ['hint', '💡 GitHub 上的 main 更新了！回到 main 用 git pull 把它拿回來']];
  };

  GitSim.prototype.log = function (oneline) {
    var seen = this.ancestors(this.headId()), self = this;
    var ids = this.order.filter(function (id) { return seen[id]; }).reverse();
    var labels = {};
    Object.keys(this.branches).forEach(function (b) {
      (labels[self.branches[b]] = labels[self.branches[b]] || []).push(b === self.head ? 'HEAD -> ' + b : b);
    });
    Object.keys(this.remote).forEach(function (b) {
      (labels[self.remote[b]] = labels[self.remote[b]] || []).push('origin/' + b);
    });
    var out = [];
    ids.forEach(function (id) {
      var c = self.commits[id], deco = labels[id] ? ' (' + labels[id].join(', ') + ')' : '';
      if (oneline) { out.push(['commit', id + deco + ' ' + c.message.split('\n')[0]]); return; }
      out.push(['commit', 'commit ' + id + deco]);
      if (c.parents.length > 1) out.push(['dim', 'Merge: ' + c.parents.join(' ')]);
      out.push(['dim', 'Author: ' + c.author]);
      out.push(['', '']);
      out.push(['', '    ' + c.message]);
      out.push(['', '']);
    });
    return out;
  };

  GitSim.prototype.statusLines = function () {
    var s = this.status(), out = [['', 'On branch ' + this.head]];
    var remote = this.remote[this.head], local = this.headId();
    if (remote) {
      if (remote === local) out.push(['dim', "Your branch is up to date with 'origin/" + this.head + "'."]);
      else if (this.isAncestor(remote, local)) out.push(['dim', "Your branch is ahead of 'origin/" + this.head + "'（還沒 push）."]);
      else if (this.isAncestor(local, remote)) out.push(['dim', "Your branch is behind 'origin/" + this.head + "'（可以 git pull）."]);
    }
    if (this.mergeState) {
      var ms = this.mergeState;
      if (ms.conflicts.length) {
        out.push(['warn', 'You have unmerged paths.'], ['dim', '  (fix conflicts and run "git commit")'], ['dim', '  (use "git merge --abort" to abort the merge)'], ['', ''], ['', 'Unmerged paths:']);
        ms.conflicts.forEach(function (p) { out.push(['err', '\tboth modified:   ' + p]); });
      } else out.push(['warn', 'All conflicts fixed but you are still merging.'], ['dim', '  (use "git commit" to conclude merge)']);
    }
    var label = { added: 'new file:   ', modified: 'modified:   ', deleted: 'deleted:    ' };
    var conflicts = this.mergeState ? this.mergeState.conflicts : [];
    var staged = s.staged.filter(function (d) { return conflicts.indexOf(d.path) < 0; });
    var unstaged = s.unstaged.filter(function (d) { return conflicts.indexOf(d.path) < 0; });
    if (staged.length) {
      out.push(['', 'Changes to be committed:'], ['dim', '  （已經 git add，會進入下一個 commit）']);
      staged.forEach(function (d) { out.push(['ok', '\t' + label[d.status] + d.path]); });
    }
    if (unstaged.length) {
      out.push(['', 'Changes not staged for commit:'], ['dim', '  （改了但還沒 git add）']);
      unstaged.forEach(function (d) { out.push(['err', '\t' + label[d.status] + d.path]); });
    }
    if (s.untracked.length) {
      out.push(['', 'Untracked files:'], ['dim', '  （新檔案，git add 之後才會被追蹤）']);
      s.untracked.forEach(function (p) { out.push(['err', '\t' + p]); });
    }
    if (!staged.length && !unstaged.length && !s.untracked.length && !this.mergeState) {
      out.push(['dim', 'nothing to commit, working tree clean']);
    }
    return out;
  };

  /* ---------- command line ---------- */

  GitSim.HELP = [
    ['hint', '📖 支援的指令'],
    ['', '  git status                    看目前狀態'],
    ['', '  git add <檔案> | git add .     放進暫存區'],
    ['', '  git commit -m "訊息"           存成一個 commit'],
    ['', '  git branch [名稱]              列出 / 建立分支'],
    ['', '  git switch [-c] <分支>         切換（-c 建立並切換）'],
    ['', '  git checkout [-b] <分支>       舊版的切換寫法'],
    ['', '  git merge <分支> [--no-ff]      合併到目前分支'],
    ['', '  git merge --abort             放棄這次合併'],
    ['', '  git checkout --ours/--theirs <檔案>   衝突時選一邊'],
    ['', '  git log [--oneline]           看歷史'],
    ['', '  git push [-u] [origin <分支>]  上傳到 GitHub'],
    ['', '  git pull [origin <分支>]       從 GitHub 拿最新'],
    ['', '  gh pr create / gh pr merge     開 PR / 合併 PR（模擬）'],
    ['', '  ls  cat <檔案>  edit <檔案>  echo "文字" > <檔案>  rm <檔案>'],
    ['', '  clear  reset  help']
  ];

  GitSim.prototype.run = function (line, opts) {
    opts = opts || {};
    line = (line || '').trim();
    if (!line) return { out: [], ok: true };
    var out;
    try {
      out = this._dispatch(tokenize(line), opts) || [];
      return { out: out, ok: true };
    } catch (e) {
      return { out: String(e.message || e).split('\n').map(function (l) { return [/^(hint|💡)/.test(l) ? 'hint' : 'err', l]; }), ok: false };
    }
  };

  GitSim.prototype._dispatch = function (t, opts) {
    var cmd = t[0], self = this;
    var redirect = t.indexOf('>') >= 0 ? t.indexOf('>') : t.indexOf('>>');
    if (cmd === 'echo') {
      if (redirect < 0) return [['', t.slice(1).join(' ')]];
      var file = t[redirect + 1];
      if (!file) throw new Error('要寫到哪個檔案？例如：echo "hi" > hello.txt');
      file = file.replace(/^\.\//, '');
      var text = t.slice(1, redirect).join(' ') + '\n';
      this.work[file] = t[redirect] === '>>' && has(this.work, file) ? this.work[file] + text : text;
      return [];
    }
    if (cmd === 'ls') {
      var paths = keys(this.work);
      return paths.length ? paths.map(function (p) {
        var st = self.status(), cls = st.untracked.indexOf(p) >= 0 ? 'err' :
          st.unstaged.some(function (d) { return d.path === p; }) ? 'warn' : '';
        return [cls, p];
      }) : [['dim', '（空的）']];
    }
    if (cmd === 'cat') {
      if (!t[1]) throw new Error('要看哪個檔案？例如：cat README.md');
      var p = t[1].replace(/^\.\//, '');
      if (!has(this.work, p)) throw new Error('cat: ' + p + ': No such file or directory');
      return this.work[p].replace(/\n$/, '').split('\n').map(function (l) {
        return [/^(<{7}|={7}$|>{7})/.test(l) ? 'conflict' : '', l];
      });
    }
    if (cmd === 'rm') {
      if (!t[1] || !has(this.work, t[1])) throw new Error('rm: ' + (t[1] || '') + ': No such file');
      delete this.work[t[1]];
      return [];
    }
    if (cmd === 'touch') {
      if (!t[1]) throw new Error('touch <檔案>');
      if (!has(this.work, t[1])) this.work[t[1]] = '';
      return [];
    }
    if (cmd === 'help' || cmd === '?') return GitSim.HELP;
    if (cmd === 'gh') {
      if (t[1] === 'pr' && t[2] === 'create') {
        var ti = t.indexOf('--title') >= 0 ? t.indexOf('--title') : t.indexOf('-t');
        return this.prCreate(ti >= 0 ? t[ti + 1] : null);
      }
      if (t[1] === 'pr' && t[2] === 'merge') return this.prMerge(t[3] ? parseInt(t[3].replace('#', ''), 10) : null);
      if (t[1] === 'pr' && t[2] === 'list') {
        return this.prs.length ? this.prs.map(function (p) { return [p.state === 'open' ? 'ok' : 'dim', '#' + p.number + '  ' + p.title + '  ' + p.branch + '  ' + p.state.toUpperCase()]; }) : [['dim', '沒有 PR']];
      }
      throw new Error('模擬器只支援 gh pr create / gh pr merge / gh pr list');
    }
    if (cmd !== 'git') throw new Error(cmd + ': command not found（輸入 help 看支援的指令）');

    var sub = t[1], args = t.slice(2);
    var flags = args.filter(function (a) { return a[0] === '-'; });
    var pos = args.filter(function (a, i) { return a[0] !== '-' && !(i > 0 && /^-(m|am|-message)$/.test(args[i - 1])); });
    function flag() { for (var i = 0; i < arguments.length; i++) if (flags.indexOf(arguments[i]) >= 0) return true; return false; }
    function msgArg() {
      for (var i = 0; i < args.length; i++) {
        if (/^-(m|am|-message)$/.test(args[i])) return args[i + 1];
        if (/^-am?./.test(args[i]) && !/^-am$/.test(args[i])) return args[i].replace(/^-a?m/, '');
      }
      return null;
    }

    switch (sub) {
      case undefined: case 'help': case '--help': return GitSim.HELP;
      case 'init': return [['dim', '這個 repo 已經初始化好了（Reinitialized existing Git repository）']];
      case 'status': return this.statusLines();
      case 'add': return this.add(pos);
      case 'commit':
        return this.commit(msgArg(), { all: flag('-a', '-am', '--all'), author: opts.author });
      case 'branch':
        if (flag('-d', '-D', '--delete')) {
          var name = pos[0];
          if (!has(this.branches, name)) throw new Error("error: branch '" + name + "' not found.");
          if (name === this.head) throw new Error("error: Cannot delete branch '" + name + "' checked out");
          if (!flag('-D') && !this.isAncestor(this.branches[name], this.headId())) {
            throw new Error("error: The branch '" + name + "' is not fully merged.\nhint: 確定要刪掉就用 git branch -D " + name);
          }
          var was = this.branches[name];
          delete this.branches[name];
          return [['ok', 'Deleted branch ' + name + ' (was ' + was + ').']];
        }
        if (pos[0]) { this.createBranch(pos[0]); return [['dim', '已建立分支 ' + pos[0] + '（還沒切換過去，用 git switch ' + pos[0] + '）']]; }
        return keys(this.branches).map(function (b) { return [b === self.head ? 'ok' : '', (b === self.head ? '* ' : '  ') + b]; })
          .concat(flag('-a') ? keys(this.remote).map(function (b) { return ['err', '  remotes/origin/' + b]; }) : []);
      case 'switch':
        if (flag('-c', '-C', '--create')) return this.switchTo(pos[0] || '', true);
        if (!pos[0]) throw new Error('要切到哪個分支？例如：git switch main');
        return this.switchTo(pos[0], false);
      case 'checkout':
        if (flag('--ours')) return this.checkoutSide('ours', pos);
        if (flag('--theirs')) return this.checkoutSide('theirs', pos);
        if (flag('-b')) return this.switchTo(pos[0] || '', true);
        if (!pos[0]) throw new Error('要切到哪個分支？例如：git checkout main');
        if (has(this.branches, pos[0]) || has(this.remote, pos[0])) return this.switchTo(pos[0], false);
        throw new Error("error: pathspec '" + pos[0] + "' did not match any file(s) known to git" +
          '\nhint: （模擬器只支援切換分支：git checkout <分支>）');
      case 'merge':
        if (flag('--abort')) return this.abortMerge();
        return this.merge(pos[0], { noFF: flag('--no-ff'), message: msgArg(), author: opts.author });
      case 'log': return this.log(flag('--oneline'));
      case 'push': {
        var target = pos[0] === 'origin' ? pos[1] : pos[0];
        if (pos[0] && pos[0] !== 'origin') throw new Error("fatal: '" + pos[0] + "' does not appear to be a git repository\nhint: git push origin " + pos[0]);
        return this.push(target, flag('-u', '--set-upstream'));
      }
      case 'pull': {
        if (pos[0] && pos[0] !== 'origin') throw new Error("fatal: '" + pos[0] + "' does not appear to be a git repository");
        return this.pull(pos[1]);
      }
      case 'fetch': return [['dim', 'From https://github.com/' + this.repoName + '（已是最新）']];
      case 'diff': {
        var st = this.status(), list = flag('--staged', '--cached') ? st.staged : st.unstaged;
        if (!list.length) return [['dim', '（沒有差異）']];
        return list.map(function (d) { return ['', d.path + '  ' + '+' + d.add + ' -' + d.del]; });
      }
      case 'remote': return [['', 'origin\thttps://github.com/' + this.repoName + '.git']];
      case 'clone': return [['dim', '（這個沙盒已經 clone 好了）']];
      case 'reset': case 'rebase': case 'stash': case 'revert': case 'cherry-pick':
        throw new Error('git ' + sub + ' 不在今天的範圍內（模擬器沒有實作）');
      default: throw new Error("git: '" + sub + "' is not a git command. See 'help'.");
    }
  };

  root.GitSim = GitSim;
  if (typeof module !== 'undefined' && module.exports) module.exports = GitSim;
})(typeof window !== 'undefined' ? window : globalThis);
