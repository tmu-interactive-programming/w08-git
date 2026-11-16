/*
 * SVG commit graph for a GitSim. Commits go left → right in creation order, one row per branch lane.
 * renderGraph(container, sim, {selected, onSelect, autoScroll}) — safe to call after every command.
 */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var LANE_COLORS = ['var(--lane-0)', 'var(--lane-1)', 'var(--lane-2)', 'var(--lane-3)', 'var(--lane-4)', 'var(--lane-5)'];
  var R = 11, DX = 66, ROW_GAP = 52, LABEL_H = 20, PAD_X = 34, PAD_TOP = 14, PAD_BOTTOM = 30;
  var seenByContainer = new WeakMap();

  function el(name, attrs, parent) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) {
      if (attrs[k] == null) continue;
      // CSS variables are reliable as style values, not as SVG presentation attributes
      if ((k === 'fill' || k === 'stroke') && String(attrs[k]).indexOf('var(') === 0) node.style[k] = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function textWidth(s) {
    var w = 0;
    for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? 11.5 : 6.7;
    return w + 16;
  }

  function color(lane) { return LANE_COLORS[lane % LANE_COLORS.length]; }

  function renderGraph(container, sim, opts) {
    opts = opts || {};
    var commits = sim.order.map(function (id) { return sim.commits[id]; });

    // Labels per commit
    var labels = {};
    function addLabel(id, label) { (labels[id] = labels[id] || []).push(label); }
    Object.keys(sim.branches).sort(function (a, b) { return a === 'main' ? -1 : b === 'main' ? 1 : a < b ? -1 : 1; })
      .forEach(function (b) {
        addLabel(sim.branches[b], { text: (b === sim.head ? 'HEAD → ' : '') + b, kind: b === sim.head ? 'head' : 'local', lane: sim.laneOf[b] || 0 });
      });
    Object.keys(sim.remote).sort().forEach(function (b) {
      addLabel(sim.remote[b], { text: 'origin/' + b, kind: 'remote', lane: sim.laneOf[b] || 0 });
    });

    // Ghost node for uncommitted work / merge in progress
    var ghost = null;
    if (sim.mergeState || sim.isDirty()) {
      ghost = {
        id: '__ghost', lane: sim.laneOf[sim.head] || 0, seq: commits.length,
        parents: [sim.headId()].concat(sim.mergeState ? [sim.mergeState.theirs] : []),
        merging: !!sim.mergeState, conflict: !!(sim.mergeState && sim.mergeState.conflicts.length)
      };
    }
    var all = ghost ? commits.concat([ghost]) : commits;

    // Rows: only lanes that are used, in lane order
    var lanesUsed = {};
    all.forEach(function (c) { lanesUsed[c.lane] = true; });
    var lanes = Object.keys(lanesUsed).map(Number).sort(function (a, b) { return a - b; });
    var rowOfLane = {};
    lanes.forEach(function (l, i) { rowOfLane[l] = i; });
    var stackPerRow = lanes.map(function () { return 0; });
    commits.forEach(function (c) {
      var n = (labels[c.id] || []).length;
      stackPerRow[rowOfLane[c.lane]] = Math.max(stackPerRow[rowOfLane[c.lane]], n);
    });
    var rowY = [], y = PAD_TOP;
    lanes.forEach(function (l, i) {
      y += stackPerRow[i] * LABEL_H + (i === 0 ? R + 4 : ROW_GAP);
      rowY.push(y);
    });
    var height = y + R + PAD_BOTTOM;

    // Columns: widen the gap when labels would collide
    var xs = [], x = PAD_X, prevHalf = 0;
    all.forEach(function (c, i) {
      var half = Math.max.apply(null, [R].concat((labels[c.id] || []).map(function (lb) { return textWidth(lb.text) / 2; })));
      if (i > 0) x += Math.max(DX, prevHalf + half + 8);
      else x = Math.max(PAD_X, half + 6);
      xs.push(x);
      prevHalf = half;
    });
    var width = (xs.length ? xs[xs.length - 1] : 0) + Math.max(prevHalf, R) + PAD_X;

    var pos = {};
    all.forEach(function (c, i) { pos[c.id] = { x: xs[i], y: rowY[rowOfLane[c.lane]] }; });

    var seen = seenByContainer.get(container) || {};
    var svg = el('svg', { class: 'git-graph', width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': 'Commit 圖：' + commits.length + ' 個 commit' });

    // lane guide lines
    var guides = el('g', { class: 'lane-guides' }, svg);
    lanes.forEach(function (l, i) {
      var name = Object.keys(sim.laneOf).filter(function (b) { return sim.laneOf[b] === l; })[0] || '';
      el('line', { x1: 0, x2: width, y1: rowY[i], y2: rowY[i], stroke: color(l) }, guides);
      if (name && i > 0) {
        var t = el('text', { x: 4, y: rowY[i] + R + 13, fill: color(l), class: 'lane-name' }, guides);
        t.textContent = name;
      }
    });

    var edges = el('g', { class: 'edges' }, svg);
    all.forEach(function (c) {
      c.parents.forEach(function (pid, pi) {
        var p = pos[pid], q = pos[c.id];
        if (!p) return;
        var parentLane = pid === '__ghost' ? 0 : sim.commits[pid].lane;
        var stroke = color(pi === 0 ? c.lane : parentLane);
        var d = p.y === q.y ? 'M' + p.x + ',' + p.y + ' L' + q.x + ',' + q.y
          : 'M' + p.x + ',' + p.y + ' C' + (p.x + q.x) / 2 + ',' + p.y + ' ' + (p.x + q.x) / 2 + ',' + q.y + ' ' + q.x + ',' + q.y;
        var path = el('path', { d: d, stroke: stroke, class: 'edge' + (c.id === '__ghost' ? ' ghost' : '') + (seen[c.id] ? '' : ' enter') }, edges);
        if (!seen[c.id] && c.id !== '__ghost') {
          var len = Math.abs(q.x - p.x) + Math.abs(q.y - p.y) + 10;
          path.style.strokeDasharray = len;
          path.style.strokeDashoffset = len;
        }
      });
    });

    var nodes = el('g', { class: 'nodes' }, svg);
    commits.forEach(function (c) {
      var p = pos[c.id];
      var g = el('g', {
        class: 'node' + (seen[c.id] ? '' : ' enter') + (opts.selected === c.id ? ' selected' : '') + (c.parents.length > 1 ? ' merge' : ''),
        transform: 'translate(' + p.x + ',' + p.y + ')', tabindex: opts.onSelect ? 0 : null, role: opts.onSelect ? 'button' : null,
        'aria-label': 'commit ' + c.id + '：' + c.message
      }, nodes);
      el('circle', { r: R + 7, class: 'halo', fill: color(c.lane) }, g);
      el('circle', { r: R, fill: color(c.lane), class: 'dot' }, g);
      if (c.parents.length > 1) el('circle', { r: R - 4.5, class: 'merge-ring' }, g);
      var hash = el('text', { y: R + 15, class: 'hash' }, g);
      hash.textContent = c.id;
      var title = el('title', {}, g);
      title.textContent = c.id + ' ' + c.message + '\n' + c.author;
      if (opts.onSelect) {
        g.addEventListener('click', function () { opts.onSelect(c.id); });
        g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onSelect(c.id); } });
      }
      (labels[c.id] || []).forEach(function (lb, i) {
        var w = textWidth(lb.text), ly = -R - 8 - (i + 1) * LABEL_H + 4;
        // positioned outer group + animated inner group (a CSS transform would override the attribute)
        var outer = el('g', { transform: 'translate(' + (-w / 2) + ',' + ly + ')' }, g);
        var lg = el('g', { class: 'ref ref-' + lb.kind }, outer);
        el('rect', { width: w, height: LABEL_H - 3, rx: 8.5, fill: lb.kind === 'remote' ? 'none' : color(lb.lane), stroke: color(lb.lane) }, lg);
        var t = el('text', { x: w / 2, y: (LABEL_H - 3) / 2 + 4, fill: lb.kind === 'remote' ? color(lb.lane) : null }, lg);
        t.textContent = lb.text;
      });
    });

    if (ghost) {
      var gp = pos.__ghost;
      var gg = el('g', { class: 'node ghost' + (ghost.conflict ? ' conflict' : ''), transform: 'translate(' + gp.x + ',' + gp.y + ')' }, nodes);
      el('circle', { r: R, class: 'dot' }, gg);
      var gt = el('text', { y: 4, class: 'ghost-mark' }, gg);
      gt.textContent = ghost.conflict ? '!' : '✎';
      var gl = el('text', { y: R + 15, class: 'hash' }, gg);
      gl.textContent = ghost.conflict ? '衝突中' : ghost.merging ? '待 commit' : '未 commit';
    }

    container.innerHTML = '';
    container.appendChild(svg);
    var nowSeen = {};
    all.forEach(function (c) { nowSeen[c.id] = true; });
    delete nowSeen.__ghost;
    seenByContainer.set(container, nowSeen);

    // trigger enter animations on next frame
    requestAnimationFrame(function () {
      svg.querySelectorAll('.edge.enter').forEach(function (p) { p.style.strokeDashoffset = 0; });
    });
    if (opts.autoScroll !== false) {
      container.scrollTo ? container.scrollTo({ left: container.scrollWidth, behavior: 'smooth' }) : (container.scrollLeft = container.scrollWidth);
    }
  }

  function resetGraphMemory(container) { seenByContainer.delete(container); }

  root.renderGraph = renderGraph;
  root.resetGraphMemory = resetGraphMemory;
})(window);
