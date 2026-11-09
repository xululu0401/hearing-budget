/* 听力预算台 · ui.js
 * 只负责：读写输入、渲染结果、导出、持久化、事件。全部算术都在 core.js（window.AppCore）。
 */
(function () {
  'use strict';
  var C = window.AppCore;
  var STORE = 'hearing-budget-ledger-v1';
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function f2(x, d) { return C.fmt(x, d === undefined ? 2 : d); }
  function f3(x) { return C.fmt(x, 3); }
  function dbs(x) { return x === null || x === undefined ? '—' : f2(x) + ' dB(A)'; }

  var state = C.clonePreset('commute');
  var lastResult = null;
  var savedAt = null;

  // ── 读写输入 ────────────────────────────────────────────────
  function readInput() {
    var rows = [];
    var items = document.querySelectorAll('#rows .item');
    for (var i = 0; i < items.length; i++) {
      rows.push({
        name: items[i].querySelector('input.name').value,
        level: items[i].querySelector('input.level').value,
        minutes: items[i].querySelector('input.minutes').value
      });
    }
    return {
      rows: rows,
      exchange: $('exchange').value,
      refLevel: $('refLevel').value,
      targetLevel: $('targetLevel').value,
      refSum: { a: $('sumA').value, b: $('sumB').value },
      refDist: { l1: $('distL').value, r1: $('distR1').value, r2: $('distR2').value }
    };
  }
  function writeInput(input) {
    var copy = JSON.parse(JSON.stringify(input));
    state = {
      rows: copy.rows,
      exchange: copy.exchange === undefined || copy.exchange === '' ? '3' : String(copy.exchange),
      refLevel: copy.refLevel === undefined || copy.refLevel === '' ? '85' : String(copy.refLevel),
      targetLevel: copy.targetLevel === undefined || copy.targetLevel === '' ? '90' : String(copy.targetLevel),
      refSum: { a: String((copy.refSum || {}).a === undefined || (copy.refSum || {}).a === '' ? 80 : copy.refSum.a), b: String((copy.refSum || {}).b === undefined || (copy.refSum || {}).b === '' ? 80 : copy.refSum.b) },
      refDist: {
        l1: String((copy.refDist || {}).l1 === undefined || (copy.refDist || {}).l1 === '' ? 85 : copy.refDist.l1),
        r1: String((copy.refDist || {}).r1 === undefined || (copy.refDist || {}).r1 === '' ? 1 : copy.refDist.r1),
        r2: String((copy.refDist || {}).r2 === undefined || (copy.refDist || {}).r2 === '' ? 2 : copy.refDist.r2)
      }
    };
  }
  function renderRows() {
    var box = $('rows');
    box.innerHTML = state.rows.map(function (x, i) {
      return '<div class="item" data-i="' + i + '">' +
        '<div class="item-head"><span class="idx">' + (i + 1) + '</span>' +
        '<input class="name" type="text" value="' + esc(x.name) + '" aria-label="第 ' + (i + 1) + ' 段名称" placeholder="这段声音是什么">' +
        '<button type="button" class="mini del-row" data-arg="' + i + '">删除</button></div>' +
        '<div class="grid2">' +
        '<label class="f"><span>声级 dB(A)</span><input class="level" type="text" inputmode="decimal" value="' + esc(x.level) + '" aria-label="第 ' + (i + 1) + ' 段声级"></label>' +
        '<label class="f"><span>时长（分钟）</span><input class="minutes" type="text" inputmode="decimal" value="' + esc(x.minutes) + '" aria-label="第 ' + (i + 1) + ' 段时长"></label>' +
        '</div></div>';
    }).join('');
  }
  function renderFields() {
    $('exchange').value = state.exchange;
    $('refLevel').value = state.refLevel;
    $('targetLevel').value = state.targetLevel;
    $('sumA').value = state.refSum.a;
    $('sumB').value = state.refSum.b;
    $('distL').value = state.refDist.l1;
    $('distR1').value = state.refDist.r1;
    $('distR2').value = state.refDist.r2;
  }
  function renderInputs() { renderRows(); renderFields(); }

  // ── 结果渲染 ────────────────────────────────────────────────
  function renderResult(r) {
    var t = r.totals, c = r.criteria, v = r.verdict;
    var h = [];
    var tone = v.tone === 'bad' ? 'bad' : v.tone === 'warn' ? 'warn' : v.tone === 'good' ? 'good' : '';
    h.push('<div class="metric"><strong>' + f2(t.dosePct) + '%</strong> 的暴露上限 <span class="tag ' + tone + '">' + esc(v.label) + '</span>');
    h.push('<div class="sub">等效 8 小时声级 ' + dbs(t.lexDose) + ' · 上限基准 ' + f2(c.refLevel, 0) + ' dB(A) · 交换率 ' + c.exchange + ' dB</div></div>');

    // 指标条
    var stat = [];
    stat.push(['计入时长', f2(t.minutes, 0) + ' 分钟', t.rowCount + ' 段']);
    stat.push(['相当于基准下连续', f2(t.equivHoursAtRef, 2) + ' 小时', '上限 8 小时（' + f2(c.refLevel, 0) + ' dB(A)）']);
    if (t.dominantName) stat.push(['主导段', esc(t.dominantName), '占总剂量 ' + f2(t.dominantShare * 100) + '%']);
    stat.push(['还能听多久', t.dose >= 1 ? '已用满' : f2(t.remainingMinutesAtTarget, 0) + ' 分钟', '按 ' + f2(c.targetLevel, 0) + ' dB(A) 算']);
    stat.push(['等能量口径', dbs(t.lexEnergy), t.energyDiff === null ? '剂量为 0 时无定义' : '与剂量口径差 ' + (t.energyDiff >= 0 ? '+' : '−') + f2(Math.abs(t.energyDiff)) + ' dB']);
    h.push('<div class="stats">' + stat.map(function (s) {
      return '<div><strong>' + s[1] + '</strong><span>' + s[0] + ' · ' + s[2] + '</span></div>';
    }).join('') + '</div>');

    // 剂量贡献
    h.push('<h3>剂量贡献（每一段吃掉了多少预算）</h3>');
    r.rows.forEach(function (x) {
      var share = x.share * 100;
      var cls = x.dose > 1 ? 'hot' : x.dose > 0.5 ? 'warm' : '';
      h.push('<div class="barrow"><b>' + esc(x.name) + '</b><span class="bar ' + cls + '"><i style="width:' + Math.min(100, share).toFixed(1) + '%"></i></span><span>' + f2(share) + '% ｜ 本段剂量 ' + f2(x.dose * 100) + '%</span></div>');
    });

    // 逐项表
    h.push('<h3>逐段明细</h3><div class="tw"><table class="stack"><thead><tr><th>这一段</th><th>声级</th><th>时长</th><th>该声级的允许时长</th><th>本段剂量</th><th>占比</th><th>单独看</th></tr></thead><tbody>');
    r.rows.forEach(function (x) {
      var alone = x.dose > 1 ? '这一段自己就超上限' : x.dose > 0.5 ? '这一段用掉一半以上' : '未超';
      h.push('<tr><td data-label="这一段">' + esc(x.name) + '</td>' +
        '<td class="num" data-label="声级">' + f2(x.level) + ' dB(A)</td>' +
        '<td class="num" data-label="时长">' + f2(x.minutes, 0) + ' 分钟</td>' +
        '<td class="num" data-label="允许时长">' + f2(x.allowedHours) + ' 小时</td>' +
        '<td class="num" data-label="本段剂量">' + f2(x.dose * 100) + '%</td>' +
        '<td class="num" data-label="占比">' + f2(x.share * 100) + '%</td>' +
        '<td data-label="单独看">' + alone + '</td></tr>');
    });
    h.push('</tbody></table></div>');
    h.push('<p class="note">允许时长 = 8 小时 × 2^((' + f2(c.refLevel, 0) + ' − 声级) ÷ ' + c.exchange + ')。剂量 = 该段小时数 ÷ 允许时长；把所有段相加就是一天的剂量，100% 表示刚好用满上限。</p>');

    // 口径对照
    h.push('<h3>口径对照：同一个数字，换口径是多少</h3><div class="tw"><table class="fix stack"><thead><tr><th>口径</th><th>剂量</th><th>等效 8 小时声级</th><th>判定</th></tr></thead><tbody>');
    h.push('<tr class="cur"><td data-label="口径">' + c.exchange + ' dB 交换率（当前）</td><td class="num" data-label="剂量">' + f2(t.dosePct) + '%</td><td class="num" data-label="等效声级">' + dbs(t.lexDose) + '</td><td data-label="判定">' + esc(v.label) + '</td></tr>');
    h.push('<tr><td data-label="口径">等能量 10·log10（对照）</td><td class="num" data-label="剂量">' + (t.lexEnergy === null ? '—' : f2(Math.pow(10, (t.lexEnergy - c.refLevel) / 10) * 100) + '%') + '</td><td class="num" data-label="等效声级">' + dbs(t.lexEnergy) + '</td><td data-label="判定">' + (t.energyDiff === null ? '—' : '与当前差 ' + (t.energyDiff >= 0 ? '+' : '−') + f2(Math.abs(t.energyDiff)) + ' dB') + '</td></tr>');
    h.push('<tr><td data-label="口径">' + r.alt.exchange + ' dB 交换率（对照）</td><td class="num" data-label="剂量">' + f2(r.alt.dosePct) + '%</td><td class="num" data-label="等效声级">' + dbs(r.alt.lex) + '</td><td data-label="判定">' + esc(r.alt.verdictLabel) + '</td></tr>');
    h.push('</tbody></table></div>');
    h.push('<p class="note">3 dB 交换率<strong>不等于</strong>严格的等能量（严格等能量是 10·log10(2) ≈ 3.0103 dB），所以这两行会差一点点。3 dB 口径在高于 ' + f2(c.refLevel, 0) + ' dB(A) 的声级上比 5 dB 口径严，在低于它的声级上反而更宽松——换口径可能直接改变「超没超」。</p>');

    // 参考换算
    h.push('<h3>参考换算（不改动上面的清单）</h3><div class="tw"><table class="fix stack"><thead><tr><th>换算</th><th>输入</th><th>结果</th></tr></thead><tbody>');
    h.push('<tr><td data-label="换算">两个声源同时响</td><td data-label="输入">' + f2(r.refs.sum.a) + ' dB + ' + f2(r.refs.sum.b) + ' dB</td><td data-label="结果">合计 ' + dbs(r.refs.sum.total) + '（比大的那个高 ' + f2(r.refs.sum.delta) + ' dB' + (r.refs.sum.same ? '；两个一样时正好是 +3.01 dB' : '') + '）</td></tr>');
    h.push('<tr><td data-label="换算">距离衰减（自由场点声源）</td><td data-label="输入">' + f2(r.refs.dist.l1) + ' dB @ ' + f3(r.refs.dist.r1) + ' 米 → ' + f3(r.refs.dist.r2) + ' 米（' + f2(r.refs.dist.ratio) + ' 倍）</td><td data-label="结果">' + dbs(r.refs.dist.level) + '（降 ' + f2(r.refs.dist.drop) + ' dB）</td></tr>');
    h.push('</tbody></table></div>');

    // 敏感性
    h.push('<h3>改条件会怎样</h3><div class="tw"><table class="stack"><thead><tr><th>情形</th><th>剂量</th><th>等效 8 小时声级</th><th>判定</th><th>相对当前</th></tr></thead><tbody>');
    r.sensitivity.forEach(function (s) {
      h.push('<tr><td data-label="情形">' + esc(s.label) + '</td><td class="num" data-label="剂量">' + f2(s.dosePct) + '%</td><td class="num" data-label="等效声级">' + dbs(s.lex) + '</td><td data-label="判定">' + esc(s.verdictLabel) + '</td><td class="num" data-label="相对当前">' + (s.deltaDosePct >= 0 ? '+' : '−') + f2(Math.abs(s.deltaDosePct)) + ' 个点</td></tr>');
    });
    h.push('</tbody></table></div>');
    h.push('<p class="note">在 3 dB 口径下，「降 3 dB」与「时长减半」是同一件事，表里会出现相同的数字——这不是算重了，而是这个口径本身的性质。</p>');

    // 建议
    h.push('<h3>结论与下一步</h3><ul class="advice">');
    advise(r).forEach(function (a) {
      h.push('<li class="' + a.tone + '">' + a.html + (a.act || '') + '</li>');
    });
    h.push('</ul>');

    if (r.warnings.length) {
      h.push('<h3>需要注意</h3><ul class="warnlist">');
      r.warnings.forEach(function (w) { h.push('<li>' + esc(w) + '</li>'); });
      h.push('</ul>');
    }
    $('result').innerHTML = h.join('');
  }

  function sensFor(r, label) {
    for (var i = 0; i < r.sensitivity.length; i++) if (r.sensitivity[i].label === label) return r.sensitivity[i];
    return null;
  }
  function btn(act, i, val, text) {
    return ' <button type="button" class="mini" data-act="' + act + '" data-i="' + i + '" data-val="' + val + '">' + text + '</button>';
  }

  function advise(r) {
    var t = r.totals, c = r.criteria, v = r.verdict, out = [];
    if (t.dose > 0) {
      out.push({
        tone: 'key',
        html: '今天的等效 8 小时声级是 <strong>' + dbs(t.lexDose) + '</strong>，用掉了所选口径（' + c.exchange + ' dB / 基准 ' + f2(c.refLevel, 0) + ' dB(A)）上限的 <strong>' + f2(t.dosePct) + '%</strong>，判定为「' + esc(v.label) + '」。换算成好懂的：相当于在 ' + f2(c.refLevel, 0) + ' dB(A) 下连续待 <strong>' + f2(t.equivHoursAtRef, 2) + ' 小时</strong>（上限 8 小时）。'
      });
    } else {
      out.push({ tone: 'info', html: '现在没有任何计入的暴露时长（所有段都是 0 分钟），剂量为 0；等效声级在剂量为 0 时没有定义。' });
    }

    if (t.dominantName && t.dose > 0) {
      var dom = r.rows[t.dominantIndex];
      out.push({
        tone: 'act',
        html: '最大的一段是「' + esc(dom.name) + '」' + f2(dom.level) + ' dB(A) × ' + f2(dom.minutes, 0) + ' 分钟：它的允许时长只有 <strong>' + f2(dom.allowedHours) + ' 小时</strong>，却占了总剂量的 <strong>' + f2(t.dominantShare * 100) + '%</strong>。先动它，效果最大。' +
          btn('cut-db', dom.index, 3, '把这段降 3 dB') + btn('cut-db', dom.index, 6, '把这段降 6 dB'),
        i: dom.index
      });
    }

    if (r.over.isOver) {
      var b = r.over.best;
      if (b) {
        out.push({
          tone: 'act',
          html: '要回到上限内，最省事的单项改动是「' + esc(b.name) + '」：把声级从 ' + f2(r.rows[b.index].level) + ' 降到 <strong>' + f2(b.newLevel) + ' dB(A)</strong>（降 ' + f2(b.deltaDb) + ' dB），或者把时长从 ' + f2(r.rows[b.index].minutes, 0) + ' 分钟减到 <strong>' + f2(b.newMinutes) + ' 分钟</strong>。两个数都由闭式解算并把解回代重算验证过；输入框按 0.01 四舍五入，所以照做后重算会在 100% 上下差零点几个点。' +
            btn('apply-level', b.index, b.newLevel, '采用降声级方案') + btn('apply-minutes', b.index, b.newMinutes, '采用减时长方案')
        });
      } else {
        out.push({ tone: 'act', html: '已超上限，但没有任何一段能单靠降声级解决——把其中任何一段降到 0 dB(A) 都回不到 100% 以内。需要同时缩短多段时长，或把全部声级一起降下来。' });
      }
      // 逐项可行性
      var infeasible = r.over.byRow.filter(function (x) { return !x.feasible; });
      if (infeasible.length) {
        var names = infeasible.slice(0, 3).map(function (x) { return '「' + esc(x.name) + '」'; }).join('、');
        out.push({
          tone: 'info',
          html: '另外 ' + infeasible.length + ' 段（' + names + (infeasible.length > 3 ? ' 等' : '') + '）的剂量太小：即使把它降到 0 dB(A) 也回不到上限内，所以「单项最省事改动」不会选它们。'
        });
      }
    } else if (t.dose > 0) {
      var s3 = t.dominantIndex === null ? null : sensFor(r, '「' + r.rows[t.dominantIndex].name + '」降 3 dB');
      out.push({
        tone: 'ok',
        html: '还有额度：按 ' + f2(c.targetLevel, 0) + ' dB(A) 还能听 <strong>' + f2(t.remainingMinutesAtTarget, 0) + ' 分钟</strong>（约 ' + f2(t.remainingMinutesAtTarget / 60) + ' 小时）才用满 100%。' +
          (s3 ? '如果先把主导段降 3 dB，剂量会从 ' + f2(t.dosePct) + '% 降到 <strong>' + f2(s3.dosePct) + '%</strong>。' : '') +
          btn('add-extra', 0, 30, '加一段 30 分钟 ' + f2(c.targetLevel, 0) + ' dB(A) 看看')
      });
    }

    if (r.alt.verdictKey !== v.key && t.dose > 0) {
      out.push({
        tone: 'warn',
        html: '口径提醒：同一份暴露换成 ' + r.alt.exchange + ' dB 交换率是 <strong>' + f2(r.alt.dosePct) + '%</strong>（' + esc(r.alt.verdictLabel) + '），当前 ' + c.exchange + ' dB 口径是 ' + f2(t.dosePct) + '%（' + esc(v.label) + '）——结论随口径变。看到任何「安全时长」的说法，先问是哪个交换率、哪个基准。'
      });
    } else if (t.dose > 0) {
      out.push({ tone: 'info', html: '口径提醒：本页按 ' + c.exchange + ' dB、上限基准 ' + f2(c.refLevel, 0) + ' dB(A) 计算；换成 ' + r.alt.exchange + ' dB 口径是 ' + f2(r.alt.dosePct) + '%（' + esc(r.alt.verdictLabel) + '）。换口径不必改变结论，但数字会变。' });
    }

    out.push({
      tone: 'info',
      html: '边界：本页只做暴露剂量算术，<strong>不做医学诊断</strong>，不评估已有听力状况、不给治疗或防护用品选型建议；不处理脉冲噪声、低频专项与个体差异；声级由你填，页面不测量、不联网。默认样例与内置场景都是虚构示例。'
    });
    return out;
  }

  function showError(msg) {
    $('error').textContent = msg;
    $('downloads').style.display = 'none';
  }
  function clearError() {
    $('error').textContent = '';
    $('downloads').style.display = '';
  }

  function recompute(silent) {
    var input = readInput();
    var r;
    try {
      r = C.solve(input);
    } catch (e) {
      lastResult = null;
      window.__lastResult = null;
      showError((e && e.userMessage) || ('计算出错：' + (e && e.message)));
      return null;
    }
    lastResult = r;
    window.__lastResult = r;
    clearError();
    renderResult(r);
    if (!silent) $('message').textContent = '';
    return r;
  }

  // ── 导出 ────────────────────────────────────────────────────
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function csvText(r) {
    var t = r.totals, c = r.criteria;
    var head = ['段号', '这一段', '声级dB(A)', '时长分钟', '该声级允许时长(小时)', '本段剂量%', '占比%', '单独看'];
    var lines = [head.join(',')];
    r.rows.forEach(function (x, i) {
      lines.push([i + 1, '"' + String(x.name).replace(/"/g, '""') + '"', x.level.toFixed(4), x.minutes.toFixed(4),
        x.allowedHours.toFixed(6), (x.dose * 100).toFixed(6), (x.share * 100).toFixed(6),
        '"' + (x.dose > 1 ? '这一段自己就超上限' : x.dose > 0.5 ? '这一段用掉一半以上' : '未超') + '"'].join(','));
    });
    lines.push('');
    lines.push('"# 汇总"');
    [['交换率(dB)', c.exchange], ['上限基准dB(A)', c.refLevel], ['追加声级dB(A)', c.targetLevel],
      ['计入时长(分钟)', t.minutes], ['剂量%', t.dosePct], ['等效8小时声级dB(A)(剂量口径)', t.lexDose],
      ['等效8小时声级dB(A)(等能量口径)', t.lexEnergy], ['两口径差dB', t.energyDiff],
      ['相当于基准下连续(小时)', t.equivHoursAtRef], ['判定', r.verdict.label],
      ['主导段', t.dominantName === null ? '—' : t.dominantName], ['主导段占比%', t.dominantShare * 100],
      ['还能听多久(分钟)', t.remainingMinutesAtTarget],
      ['对照口径剂量%(' + r.alt.exchange + 'dB)', r.alt.dosePct], ['对照口径判定', r.alt.verdictLabel]].forEach(function (p) {
        lines.push('"' + p[0] + '",' + (typeof p[1] === 'number' ? p[1].toFixed(6) : p[1]));
      });
    if (r.over.isOver && r.over.best) {
      lines.push('"# 回到上限内的单项改动"');
      lines.push('"最省事的一段",' + r.over.best.index + 1);
      lines.push('"降到声级dB(A)",' + r.over.best.newLevel.toFixed(4));
      lines.push('"降多少dB",' + r.over.best.deltaDb.toFixed(4));
      lines.push('"减到多少分钟",' + r.over.best.newMinutes.toFixed(4));
    }
    lines.push('"# 参考换算"');
    lines.push('"两源同时响合计dB(A)",' + r.refs.sum.total.toFixed(6));
    lines.push('"距离衰减后dB(A)",' + r.refs.dist.level.toFixed(6) + ',"降dB",' + r.refs.dist.drop.toFixed(6));
    lines.push('"说明","默认样例与内置场景均为虚构示例；声级由用户自填，本页不测量、不联网、不做医学诊断"');
    return lines.join('\n') + '\n';
  }
  function mdText(r) {
    var t = r.totals, c = r.criteria, L = [];
    L.push('# 听力预算台 · 结果说明');
    L.push('');
    L.push('- 生成时间：' + new Date().toISOString() + '（本机时间 ' + new Date().toLocaleString() + '）');
    L.push('- 口径：交换率 ' + c.exchange + ' dB，上限基准 ' + f2(c.refLevel, 0) + ' dB(A)，追加声级 ' + f2(c.targetLevel, 0) + ' dB(A)');
    L.push('- 本页所有数字来自同一次计算；默认样例与内置场景均为**虚构示例**，声级由用户自填，本页不测量、不联网、不做医学诊断。');
    L.push('');
    L.push('## 结论');
    L.push('');
    L.push('| 项目 | 数值 |');
    L.push('|---|---|');
    L.push('| 剂量 | ' + f2(t.dosePct) + '%（判定：' + r.verdict.label + '） |');
    L.push('| 等效 8 小时声级 | ' + dbs(t.lexDose) + ' |');
    L.push('| 相当于基准下连续 | ' + f2(t.equivHoursAtRef, 2) + ' 小时（上限 8 小时） |');
    L.push('| 计入时长 | ' + f2(t.minutes, 0) + ' 分钟 / ' + t.rowCount + ' 段 |');
    L.push('| 主导段 | ' + (t.dominantName === null ? '—' : t.dominantName) + '（占 ' + f2(t.dominantShare * 100) + '%） |');
    L.push('| 还能听多久（' + f2(c.targetLevel, 0) + ' dB(A)） | ' + (t.dose >= 1 ? '已用满' : f2(t.remainingMinutesAtTarget, 0) + ' 分钟') + ' |');
    L.push('| 等能量口径 | ' + dbs(t.lexEnergy) + '（与剂量口径差 ' + (t.energyDiff === null ? '—' : (t.energyDiff >= 0 ? '+' : '−') + f2(Math.abs(t.energyDiff)) + ' dB') + '） |');
    L.push('');
    L.push('## 逐段明细');
    L.push('');
    L.push('| 这一段 | 声级 | 时长 | 该声级的允许时长 | 本段剂量 | 占比 |');
    L.push('|---|---|---|---|---|---|');
    r.rows.forEach(function (x) {
      L.push('| ' + x.name + ' | ' + f2(x.level) + ' dB(A) | ' + f2(x.minutes, 0) + ' 分钟 | ' + f2(x.allowedHours) + ' 小时 | ' + f2(x.dose * 100) + '% | ' + f2(x.share * 100) + '% |');
    });
    if (r.over.isOver && r.over.best) {
      L.push('');
      L.push('## 回到上限内的单项改动（已回代验证）');
      L.push('');
      L.push('- 最省事的一段：' + r.over.best.name);
      L.push('- 降声级：' + f2(r.rows[r.over.best.index].level) + ' → ' + f2(r.over.best.newLevel) + ' dB(A)（降 ' + f2(r.over.best.deltaDb) + ' dB）');
      L.push('- 或减时长：' + f2(r.rows[r.over.best.index].minutes, 0) + ' → ' + f2(r.over.best.newMinutes) + ' 分钟');
    }
    L.push('');
    L.push('## 口径对照');
    L.push('');
    L.push('- 当前 ' + c.exchange + ' dB 交换率：' + f2(t.dosePct) + '%，' + dbs(t.lexDose) + '，' + r.verdict.label);
    L.push('- 等能量口径（10·log10）：' + dbs(t.lexEnergy) + '，与剂量口径差 ' + (t.energyDiff === null ? '—' : (t.energyDiff >= 0 ? '+' : '−') + f2(Math.abs(t.energyDiff)) + ' dB') + '（3 dB 交换率不等于严格等能量）');
    L.push('- ' + r.alt.exchange + ' dB 交换率：' + f2(r.alt.dosePct) + '%，' + dbs(r.alt.lex) + '，' + r.alt.verdictLabel);
    L.push('');
    L.push('## 参考换算');
    L.push('');
    L.push('- 两个声源同时响：' + f2(r.refs.sum.a) + ' + ' + f2(r.refs.sum.b) + ' dB → ' + dbs(r.refs.sum.total) + '（比大的那个高 ' + f2(r.refs.sum.delta) + ' dB）');
    L.push('- 距离衰减：' + f2(r.refs.dist.l1) + ' dB @ ' + f3(r.refs.dist.r1) + ' 米 → ' + f3(r.refs.dist.r2) + ' 米（' + f2(r.refs.dist.ratio) + ' 倍）＝ ' + dbs(r.refs.dist.level) + '（降 ' + f2(r.refs.dist.drop) + ' dB）');
    L.push('');
    L.push('## 改条件会怎样');
    L.push('');
    L.push('| 情形 | 剂量 | 等效 8 小时声级 | 判定 | 相对当前 |');
    L.push('|---|---|---|---|---|');
    r.sensitivity.forEach(function (s) {
      L.push('| ' + s.label + ' | ' + f2(s.dosePct) + '% | ' + dbs(s.lex) + ' | ' + s.verdictLabel + ' | ' + (s.deltaDosePct >= 0 ? '+' : '−') + f2(Math.abs(s.deltaDosePct)) + ' 个点 |');
    });
    L.push('');
    L.push('## 结论与下一步');
    L.push('');
    advise(r).forEach(function (a) { L.push('- ' + a.html.replace(/<[^>]+>/g, '')); });
    if (r.warnings.length) {
      L.push('');
      L.push('## 需要注意');
      L.push('');
      r.warnings.forEach(function (w) { L.push('- ' + w); });
    }
    L.push('');
    L.push('## 边界');
    L.push('');
    L.push('- 只做暴露剂量算术，不做医学诊断、不评估已有听力状况、不给治疗或防护用品选型建议。');
    L.push('- 不处理脉冲噪声（峰值声压/C 计权）、低频专项、个体易感性与年龄差异；不处理耳塞耳罩标称衰减值的换算。');
    L.push('- 距离衰减只适用自由场点声源；不处理混响、线声源、反射与隔声结构的实际隔声量。');
    L.push('- 声级全部由用户自填，本页不测量、不联网、不内置任何场所的实测数据；判定分组只是显示分组，不是法规或科学边界。');
    return L.join('\n') + '\n';
  }

  // ── 结果卡 PNG（1080×1350） ─────────────────────────────────
  function wrapText(ctx, text, maxWidth, maxLines) {
    var chars = String(text).split('');
    var lines = [], line = '';
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = chars[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
    }
    return lines;
  }
  function drawCard(r) {
    var cv = document.createElement('canvas');
    cv.width = 1080; cv.height = 1350;
    var g = cv.getContext('2d');
    var t = r.totals, c = r.criteria;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1080, 1350);
    g.fillStyle = '#eef3f8'; g.fillRect(0, 0, 1080, 250);
    g.fillStyle = '#2d5f96'; g.fillRect(0, 0, 1080, 14);
    g.fillStyle = '#4f6b91'; g.font = '600 24px system-ui,"PingFang SC",sans-serif';
    g.fillText('HEARING BUDGET LEDGER · 噪声暴露剂量与听力预算', 64, 84);
    g.fillStyle = '#22344e'; g.font = '700 52px system-ui,"PingFang SC",sans-serif';
    g.fillText('听力预算台', 64, 152);
    g.fillStyle = '#5a6d84'; g.font = '400 26px system-ui,"PingFang SC",sans-serif';
    g.fillText('交换率 ' + c.exchange + ' dB · 上限基准 ' + f2(c.refLevel, 0) + ' dB(A) · ' + t.rowCount + ' 段', 64, 200);
    // 主结论
    g.fillStyle = '#22344e'; g.font = '700 76px system-ui,"PingFang SC",sans-serif';
    g.fillText(f2(t.dosePct) + '%', 64, 340);
    g.fillStyle = '#5a6d84'; g.font = '400 28px system-ui,"PingFang SC",sans-serif';
    g.fillText('用掉所选口径的上限 · 判定：' + r.verdict.label, 64, 388);
    // 三个指标盒
    var boxes = [
      ['等效 8 小时声级', dbs(t.lexDose), '相当于连续听 8 小时'],
      ['相当于基准下连续', f2(t.equivHoursAtRef, 2) + ' 小时', '上限 8 小时'],
      [t.dose >= 1 ? '超出上限' : '还能听多久', t.dose >= 1 ? f2(t.dose) + ' 倍' : f2(t.remainingMinutesAtTarget, 0) + ' 分钟', '按 ' + f2(c.targetLevel, 0) + ' dB(A) 算']
    ];
    boxes.forEach(function (b, i) {
      var x = 64 + i * 320;
      g.fillStyle = '#f4f8fd'; g.fillRect(x, 424, 296, 148);
      g.strokeStyle = '#d9e3ee'; g.strokeRect(x, 424, 296, 148);
      g.fillStyle = '#61738a'; g.font = '600 22px system-ui,"PingFang SC",sans-serif';
      g.fillText(b[0], x + 20, 466);
      g.fillStyle = '#2d5f96'; g.font = '700 40px system-ui,"PingFang SC",sans-serif';
      g.fillText(b[1], x + 20, 520);
      g.fillStyle = '#7b8ca0'; g.font = '400 18px system-ui,"PingFang SC",sans-serif';
      g.fillText(b[2], x + 20, 552);
    });
    // 剂量贡献条（最多 6 条）
    g.fillStyle = '#22344e'; g.font = '700 30px system-ui,"PingFang SC",sans-serif';
    g.fillText('剂量贡献', 64, 640);
    var sorted = r.rows.slice().sort(function (a, b) { return b.dose - a.dose; });
    var shown = sorted.slice(0, 6);
    var rest = sorted.slice(6);
    var y = 682;
    shown.forEach(function (x) {
      g.fillStyle = '#39485c'; g.font = '600 24px system-ui,"PingFang SC",sans-serif';
      g.fillText(wrapText(g, x.name, 184, 1)[0], 64, y + 22);
      var bx = 264, bw = 480;
      g.fillStyle = '#e8eef7'; g.fillRect(bx, y, bw, 26);
      g.fillStyle = x.dose > 1 ? '#a23b28' : x.dose > 0.5 ? '#c9821f' : '#4a7cb5';
      g.fillRect(bx, y, bw * Math.min(1, x.share), 26);
      g.fillStyle = '#39485c'; g.font = '600 22px system-ui,"PingFang SC",sans-serif';
      g.textAlign = 'right';
      g.fillText(f2(x.share * 100) + '%（' + f2(x.dose * 100) + '%）', 1016, y + 21);
      g.textAlign = 'left';
      y += 46;
    });
    if (rest.length) {
      var restShare = rest.reduce(function (s, x) { return s + x.share; }, 0);
      g.fillStyle = '#7b8ca0'; g.font = '400 22px system-ui,"PingFang SC",sans-serif';
      g.fillText('其余 ' + rest.length + ' 段合计 ' + f2(restShare * 100) + '%', 64, y + 20);
      y += 44;
    }
    // 结论行
    y += 14;
    g.fillStyle = '#22344e'; g.font = '700 30px system-ui,"PingFang SC",sans-serif';
    g.fillText('口径与下一步', 64, y + 14);
    y += 44;
    var rowsOut = [];
    rowsOut.push('等能量口径 ' + dbs(t.lexEnergy) + '，与剂量口径差 ' + (t.energyDiff === null ? '—' : (t.energyDiff >= 0 ? '+' : '−') + f2(Math.abs(t.energyDiff)) + ' dB（3 dB 交换率不等于严格等能量）'));
    rowsOut.push(r.alt.exchange + ' dB 交换率口径：' + f2(r.alt.dosePct) + '%，' + r.alt.verdictLabel);
    if (t.dominantName) rowsOut.push('最大的一段是「' + t.dominantName + '」，占总剂量 ' + f2(t.dominantShare * 100) + '%');
    if (r.over.isOver && r.over.best) rowsOut.push('单项最省事改动：把「' + r.over.best.name + '」降到 ' + f2(r.over.best.newLevel) + ' dB(A)（降 ' + f2(r.over.best.deltaDb) + ' dB）或减到 ' + f2(r.over.best.newMinutes) + ' 分钟');
    else if (t.dose > 0) rowsOut.push('按 ' + f2(c.targetLevel, 0) + ' dB(A) 还能听 ' + f2(t.remainingMinutesAtTarget, 0) + ' 分钟才用满 100%');
    g.font = '400 25px system-ui,"PingFang SC",sans-serif';
    rowsOut.forEach(function (line) {
      wrapText(g, '· ' + line, 950, 2).forEach(function (ln) {
        g.fillStyle = '#4d6076';
        g.fillText(ln, 64, y + 26);
        y += 38;
      });
      y += 6;
    });
    g.fillStyle = '#eef3f8'; g.fillRect(0, 1240, 1080, 110);
    g.fillStyle = '#7b8ca0'; g.font = '400 20px system-ui,"PingFang SC",sans-serif';
    g.fillText('听力预算台 V1.0.0 · 数字来自同一次计算 · 默认样例与内置场景均为虚构示例', 64, 1282);
    g.fillText('声级由用户自填；本页不测量、不联网、不做医学诊断 · 生成于 ' + new Date().toLocaleString(), 64, 1316);
    return cv;
  }
  function exportPNG(r) {
    var cv = drawCard(r);
    return new Promise(function (resolve) {
      cv.toBlob(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'hearing-budget-card-1080x1350.png';
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); resolve(true); }, 1200);
      }, 'image/png');
    });
  }

  // ── 持久化 ──────────────────────────────────────────────────
  function save() {
    var input = readInput();
    try {
      var payload = { app: 'hearing-budget', version: 1, savedAt: new Date().toISOString(), input: input };
      localStorage.setItem(STORE, JSON.stringify(payload));
      savedAt = payload.savedAt;
      $('savedNote').textContent = '已保存到本机：' + new Date(payload.savedAt).toLocaleString() + '（只保存在这个浏览器里，不会上传）';
      $('message').textContent = '已保存。';
    } catch (e) {
      $('message').textContent = '';
      showError('保存失败：' + (e && e.message));
    }
  }
  function restore(silent) {
    var raw = null;
    try { raw = localStorage.getItem(STORE); } catch (e) { raw = null; }
    if (!raw) { if (!silent) $('message').textContent = '本机还没有保存过。'; return false; }
    var payload;
    try { payload = JSON.parse(raw); } catch (e) { showError('本机保存的数据解析失败。'); return false; }
    if (!payload || !payload.input) { showError('本机保存的数据里没有输入。'); return false; }
    writeInput(payload.input);
    renderInputs();
    savedAt = payload.savedAt;
    $('savedNote').textContent = '已恢复本机保存：' + new Date(payload.savedAt).toLocaleString();
    recompute(true);
    return true;
  }

  // ── 事件 ────────────────────────────────────────────────────
  function bind() {
    $('inputPanel').addEventListener('input', function () { recompute(); });
    $('inputPanel').addEventListener('change', function () { recompute(); });
    $('inputPanel').addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.classList.contains('del-row')) {
        var i = Number(t.getAttribute('data-arg'));
        if (state.rows.length <= 1) { $('message').textContent = '至少要留一段。'; return; }
        var input = readInput();
        writeInput(input);
        state.rows.splice(i, 1);
        renderRows(); recompute();
        return;
      }
    });
    $('addRow').addEventListener('click', function () {
      if (state.rows.length >= C.LIMITS.MAX_ROWS) { $('message').textContent = '最多 ' + C.LIMITS.MAX_ROWS + ' 段。'; return; }
      var input = readInput();
      writeInput(input);
      state.rows.push(C.blankRow());
      renderRows(); recompute();
      $('message').textContent = '已添加一段，请填名称、声级与时长。';
    });
    $('demo').addEventListener('click', function () {
      writeInput(C.clonePreset('commute'));
      renderInputs(); recompute();
      $('message').textContent = '已载入虚构示例（不是任何实测声级）。';
    });
    $('presets').addEventListener('click', function (ev) {
      var k = ev.target.getAttribute && ev.target.getAttribute('data-key');
      if (!k) return;
      writeInput(C.clonePreset(k));
      renderInputs(); recompute();
      var p = C.PRESETS.filter(function (x) { return x.key === k; })[0] || {};
      $('message').textContent = '已载入内置场景：' + p.label + '（虚构示例）。';
    });
    // 结果区的「采用」按钮：真的改输入并重算
    $('result').addEventListener('click', function (ev) {
      var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
      if (!act || !lastResult) return;
      var idx = Number(ev.target.getAttribute('data-i'));
      var val = Number(ev.target.getAttribute('data-val'));
      var input = readInput();
      writeInput(input);
      if (act === 'cut-db') {
        var cur = Number(state.rows[idx].level);
        if (!isFinite(cur)) { $('message').textContent = '这一段的声音不是有效数字，请先填好。'; return; }
        state.rows[idx].level = String(Math.max(0, cur - val));
        renderRows(); recompute();
        $('message').textContent = '已把第 ' + (idx + 1) + ' 段降 ' + val + ' dB 并重算（降到 ' + state.rows[idx].level + ' dB(A)）。';
        return;
      }
      if (act === 'apply-level') {
        state.rows[idx].level = f2(val);
        renderRows(); recompute();
        $('message').textContent = '已把第 ' + (idx + 1) + ' 段的声级改成 ' + f2(val) + ' dB(A) 并重算。';
        return;
      }
      if (act === 'apply-minutes') {
        state.rows[idx].minutes = f2(val);
        renderRows(); recompute();
        $('message').textContent = '已把第 ' + (idx + 1) + ' 段的时长改成 ' + f2(val) + ' 分钟并重算。';
        return;
      }
      if (act === 'add-extra') {
        if (state.rows.length >= C.LIMITS.MAX_ROWS) { $('message').textContent = '最多 ' + C.LIMITS.MAX_ROWS + ' 段，先删一段再加。'; return; }
        state.rows.push({ name: '额外一段', level: String(lastResult.criteria.targetLevel), minutes: String(val) });
        renderRows(); recompute();
        $('message').textContent = '已加一段 ' + val + ' 分钟 @ ' + lastResult.criteria.targetLevel + ' dB(A) 并重算。';
        return;
      }
    });
    $('save').addEventListener('click', save);
    $('restore').addEventListener('click', function () { restore(false); });
    $('backup').addEventListener('click', function () {
      var payload = { app: 'hearing-budget', version: 1, savedAt: new Date().toISOString(), input: readInput() };
      download('hearing-budget-backup.json', JSON.stringify(payload, null, 2), 'application/json');
      $('message').textContent = '已下载备份 JSON。';
    });
    $('import').addEventListener('click', function () { $('imports').click(); });
    $('imports').addEventListener('change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var payload = JSON.parse(String(reader.result));
          if (!payload || !payload.input) throw new Error('文件里没有 input 字段');
          writeInput(payload.input);
          renderInputs(); recompute();
          $('message').textContent = '已从备份导入。';
        } catch (e) {
          showError('导入失败：' + (e && e.message));
        }
        ev.target.value = '';
      };
      reader.readAsText(file);
    });
    $('csv').addEventListener('click', function () { if (lastResult) { download('hearing-budget-detail.csv', csvText(lastResult), 'text/csv;charset=utf-8'); $('message').textContent = '已下载 CSV 明细。'; } });
    $('md').addEventListener('click', function () { if (lastResult) { download('hearing-budget-result.md', mdText(lastResult), 'text/markdown;charset=utf-8'); $('message').textContent = '已下载结果说明 MD。'; } });
    $('json').addEventListener('click', function () { if (lastResult) { download('hearing-budget-backup.json', JSON.stringify({ app: 'hearing-budget', version: 1, savedAt: new Date().toISOString(), input: readInput() }, null, 2), 'application/json'); $('message').textContent = '已下载 JSON 备份。'; } });
    $('png').addEventListener('click', function () { if (lastResult) { exportPNG(lastResult).then(function () { $('message').textContent = '已下载结果卡 PNG（1080×1350）。'; }); } });
  }

  function renderPresets() {
    $('presets').innerHTML = C.PRESETS.map(function (p) {
      return '<button type="button" data-key="' + p.key + '" title="' + esc(p.note) + '">' + esc(p.label) + '</button>';
    }).join('');
  }

  function init() {
    renderPresets();
    var restored = restore(true);
    if (!restored) { renderInputs(); recompute(true); }
    window.__App = { readInput: readInput, render: function () { renderInputs(); return recompute(); }, state: function () { return state; } };
  }

  bind();
  init();
})();
