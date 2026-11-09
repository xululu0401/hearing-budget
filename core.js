/* 听力预算台 · core.js
 * 噪声暴露剂量与听力预算算术：
 *   允许时长 T(L) = 8h × 2^((L_ref − L)/E)     （E = 交换率，3 dB 或 5 dB）
 *   剂量 D = Σ (t_i / T_i)                      （1.0 = 刚好用满所选口径的上限）
 *   等效 8 小时声级 L_EX = L_ref + E·log2(D)    （剂量口径）
 *   等能量口径 L_EN = 10·log10( Σ t_i·10^(L_i/10) / 8h )（对照口径）
 *   剩余额度 / 反推（只改一项的降 dB 与减时长，闭式解 + 可行性判定）
 *   参考换算：多声源同时叠加（能量相加）、自由场点声源距离衰减
 * 纯计算、无 DOM、无网络；浏览器挂 window.AppCore，Node 下 module.exports。
 */
(function (global) {
  'use strict';

  var LIMITS = {
    MIN_ROWS: 1, MAX_ROWS: 8,
    MAX_NAME: 16,
    MAX_LEVEL: 200,
    MIN_REF: 70, MAX_REF: 95,
    MIN_MINUTES: 0, MAX_MINUTES: 1440,
    MIN_DIST: 1e-6, MAX_DIST: 1e6,
    EXCHANGES: [3, 5],
    EPS: 1e-12
  };

  function err(msg) { var e = new Error(msg); e.userMessage = msg; return e; }

  var NUM_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

  function numStrict(v, label, min, max) {
    var x;
    if (typeof v === 'number') {
      x = v;
    } else {
      var s = String(v === null || v === undefined ? '' : v).trim();
      if (!s) throw err(label + '不能为空');
      if (!NUM_RE.test(s)) throw err(label + '不是有效数字：' + s);
      x = Number(s);
    }
    if (!isFinite(x)) throw err(label + '超出了可计算范围');
    if (typeof min === 'number' && x < min) throw err(label + '不能小于 ' + min);
    if (typeof max === 'number' && x > max) throw err(label + '不能大于 ' + max);
    return x;
  }

  function strStrict(v, label, maxLen) {
    var s = String(v === null || v === undefined ? '' : v).trim();
    if (!s) throw err(label + '不能为空');
    if (s.length > maxLen) throw err(label + '最多 ' + maxLen + ' 个字符（当前 ' + s.length + '）');
    return s;
  }

  function pickExchange(v, label) {
    var x = numStrict(v, label, 0, 1e9);
    if (Math.abs(x - 3) < 1e-9) return 3;
    if (Math.abs(x - 5) < 1e-9) return 5;
    throw err(label + '只能是 3 或 5（当前 ' + x + '）');
  }

  function log2(x) { return Math.log(x) / Math.LN2; }

  // ── 格式化（UI 与导出共用，保证同口径）──────────────────────
  function fmt(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    var s = Number(x).toFixed(d === undefined ? 2 : d);
    var neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    var p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + p.join('.');
  }
  function pct(x, d) { return fmt(x * 100, d === undefined ? 2 : d) + '%'; }
  function hours(x) { return fmt(x, 2) + ' 小时'; }
  function db(x) { return fmt(x, 2) + ' dB(A)'; }

  // ── 内置虚构场景 ────────────────────────────────────────────
  var PRESETS = [
    {
      key: 'commute', label: '通勤+耳机的一天',
      note: '虚构示例：地铁、耳机、餐厅三段。数字为演示用，不是任何实测值。',
      exchange: 3, refLevel: 85, targetLevel: 90,
      rowNote: '虚构示例',
      items: [
        { name: '地铁车厢', level: 82, minutes: 50 },
        { name: '耳机听歌', level: 91, minutes: 90 },
        { name: '餐厅午饭', level: 75, minutes: 60 }
      ]
    },
    {
      key: 'renovation', label: '装修现场半天',
      note: '虚构示例：电锤与切割机轮着用。数字为演示用，不是任何实测值。',
      exchange: 3, refLevel: 85, targetLevel: 90,
      rowNote: '虚构示例',
      items: [
        { name: '电锤打墙', level: 95, minutes: 20 },
        { name: '切割机', level: 102, minutes: 10 },
        { name: '现场其他', level: 78, minutes: 150 }
      ]
    },
    {
      key: 'concert', label: '演唱会内场 2 小时',
      note: '虚构示例：一场演出的内场声级与时长。数字为演示用，不是任何实测值。',
      exchange: 3, refLevel: 85, targetLevel: 90,
      rowNote: '虚构示例',
      items: [
        { name: '内场演出', level: 104, minutes: 120 }
      ]
    },
    {
      key: 'factory', label: '车间一个班',
      note: '虚构示例：机床、休息室、叉车。数字为演示用，不是任何实测值。',
      exchange: 3, refLevel: 85, targetLevel: 90,
      rowNote: '虚构示例',
      items: [
        { name: '机床旁', level: 88, minutes: 300 },
        { name: '叉车经过', level: 92, minutes: 60 },
        { name: '休息室', level: 65, minutes: 60 }
      ]
    },
    {
      key: 'quiet', label: '安静办公日',
      note: '虚构示例：办公室、通勤、咖啡机。数字为演示用，不是任何实测值。',
      exchange: 3, refLevel: 85, targetLevel: 90,
      rowNote: '虚构示例',
      items: [
        { name: '办公室', level: 55, minutes: 420 },
        { name: '路上通勤', level: 70, minutes: 60 },
        { name: '咖啡机', level: 78, minutes: 10 }
      ]
    }
  ];

  function clonePreset(key) {
    var p = null;
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].key === key) p = PRESETS[i];
    if (!p) throw err('没有这个内置场景：' + key);
    return {
      rows: p.items.map(function (x) { return { name: x.name, level: String(x.level), minutes: String(x.minutes) }; }),
      exchange: String(p.exchange),
      refLevel: String(p.refLevel),
      targetLevel: String(p.targetLevel),
      refSum: { a: '80', b: '80' },
      refDist: { l1: '85', r1: '1', r2: '2' }
    };
  }

  function blankRow() { return { name: '', level: '', minutes: '' }; }

  // ── 单项公式 ───────────────────────────────────────────────
  // 允许时长（小时）：在该口径下，这个声级一天最多能待多久
  function allowedHours(level, refLevel, exchange) {
    return 8 * Math.pow(2, (refLevel - level) / exchange);
  }
  // 单项剂量：t 小时 / 允许时长
  function doseOf(minutes, level, refLevel, exchange) {
    return (minutes / 60) / allowedHours(level, refLevel, exchange);
  }
  // 剂量口径的等效 8 小时声级
  function lexFromDose(dose, refLevel, exchange) {
    return refLevel + exchange * log2(dose);
  }
  // 等能量口径的等效 8 小时声级（t 与 level 的数组）
  function lexEnergy(rows) {
    var acc = 0;
    for (var i = 0; i < rows.length; i++) {
      var h = rows[i].minutes / 60;
      if (h > 0) acc += h * Math.pow(10, rows[i].level / 10);
    }
    if (acc <= 0) return null;
    return 10 * Math.log(acc / 8) / Math.LN10;
  }

  // 参考换算：多声源同时响（能量相加）
  function sumLevels(list) {
    var acc = 0;
    for (var i = 0; i < list.length; i++) acc += Math.pow(10, list[i] / 10);
    if (acc <= 0) return null;
    return 10 * Math.log(acc) / Math.LN10;
  }
  // 参考换算：自由场点声源距离衰减（每距离加倍 −6.02 dB）
  function distanceLevel(level, r1, r2) {
    return level - 20 * Math.log(r2 / r1) / Math.LN10;
  }

  // ── 解析输入 ───────────────────────────────────────────────
  function parse(input) {
    if (!input || typeof input !== 'object') throw err('缺少输入');
    var rawRows = input.rows;
    if (!Array.isArray(rawRows)) throw err('暴露清单必须是数组');
    if (rawRows.length < LIMITS.MIN_ROWS) throw err('至少要有一条暴露记录');
    if (rawRows.length > LIMITS.MAX_ROWS) throw err('最多 ' + LIMITS.MAX_ROWS + ' 条暴露记录（当前 ' + rawRows.length + '）');
    var rows = rawRows.map(function (r, i) {
      var tag = '第 ' + (i + 1) + ' 条';
      return {
        name: strStrict(r && r.name, tag + '的名称', LIMITS.MAX_NAME),
        level: numStrict(r && r.level, tag + '的声级', 0, LIMITS.MAX_LEVEL),
        minutes: numStrict(r && r.minutes, tag + '的时长（分钟）', LIMITS.MIN_MINUTES, LIMITS.MAX_MINUTES)
      };
    });
    return {
      rows: rows,
      exchange: pickExchange(input.exchange === '' || input.exchange === undefined || input.exchange === null ? 3 : input.exchange, '交换率'),
      refLevel: numStrict(input.refLevel === '' || input.refLevel === undefined || input.refLevel === null ? 85 : input.refLevel, '上限基准声级', LIMITS.MIN_REF, LIMITS.MAX_REF),
      targetLevel: numStrict(input.targetLevel === '' || input.targetLevel === undefined || input.targetLevel === null ? 90 : input.targetLevel, '追加声级', 0, LIMITS.MAX_LEVEL),
      refSum: {
        a: numStrict((input.refSum || {}).a === '' || (input.refSum || {}).a === undefined ? 80 : input.refSum.a, '叠加声源 A', 0, LIMITS.MAX_LEVEL),
        b: numStrict((input.refSum || {}).b === '' || (input.refSum || {}).b === undefined ? 80 : input.refSum.b, '叠加声源 B', 0, LIMITS.MAX_LEVEL)
      },
      refDist: {
        l1: numStrict((input.refDist || {}).l1 === '' || (input.refDist || {}).l1 === undefined ? 85 : input.refDist.l1, '衰减起点声级', 0, LIMITS.MAX_LEVEL),
        r1: numStrict((input.refDist || {}).r1 === '' || (input.refDist || {}).r1 === undefined ? 1 : input.refDist.r1, '衰减起点距离', LIMITS.MIN_DIST, LIMITS.MAX_DIST),
        r2: numStrict((input.refDist || {}).r2 === '' || (input.refDist || {}).r2 === undefined ? 2 : input.refDist.r2, '衰减终点距离', LIMITS.MIN_DIST, LIMITS.MAX_DIST)
      }
    };
  }

  // ── 求解 ───────────────────────────────────────────────────
  function solve(input) {
    var p = parse(input);
    var rows = p.rows, E = p.exchange, R = p.refLevel;
    var totalMinutes = 0;
    rows.forEach(function (r) { totalMinutes += r.minutes; });

    var out = rows.map(function (r, i) {
      var T = allowedHours(r.level, R, E);
      var d = (r.minutes / 60) / T;
      return {
        index: i, name: r.name, level: r.level, minutes: r.minutes,
        allowedHours: T, dose: d, share: 0,
        overUnit: d > 1,
        equivHoursAtRef: 8 * d
      };
    });

    var dose = 0;
    out.forEach(function (r) { dose += r.dose; });
    out.forEach(function (r) { r.share = dose > 0 ? r.dose / dose : 0; });

    var dominant = null;
    out.forEach(function (r) { if (!dominant || r.dose > dominant.dose) dominant = r; });
    if (dominant && dominant.dose <= 0) dominant = null;

    var lexDose = dose > 0 ? lexFromDose(dose, R, E) : null;
    var lexEn = lexEnergy(out);
    var energyDiff = (lexDose !== null && lexEn !== null) ? (lexEn - lexDose) : null;

    // 剩余额度：在追加声级 targetLevel 下还能听多久
    var targetAllowedHours = allowedHours(p.targetLevel, R, E);
    var remainingHours = (1 - dose) * targetAllowedHours;
    var remainingMinutes = remainingHours * 60;
    var isOver = dose > 1 + 1e-12;
    var factor = dose > 0 ? dose : 0;

    // 反推：只改一项时，让剂量回到 1.0 需要的改动
    var byRow = out.map(function (r) {
      var rest = 1 - dose + r.dose;          // 改完之后这一项应有的剂量
      var feasible = rest > LIMITS.EPS;
      var deltaDb = feasible ? E * log2(r.dose / rest) : null;   // >0 表示需要降这么多 dB
      var newLevel = feasible ? r.level - deltaDb : null;
      var newMinutes = feasible ? r.minutes * (rest / r.dose) : null; // 只在 r.dose>0 时有意义
      return {
        index: r.index, name: r.name, feasible: feasible,
        deltaDb: deltaDb, newLevel: (newLevel !== null ? newLevel : null),
        newMinutes: (newMinutes !== null ? newMinutes : null),
        cutMinutes: (newMinutes !== null ? r.minutes - newMinutes : null),
        reason: feasible ? '' : ('即使把「' + r.name + '」降到 0 dB(A) 也回不到上限内')
      };
    });

    // 最优可执行建议：只需改动最小的一项（降 dB 最小）
    var best = null;
    if (isOver) {
      byRow.forEach(function (b) {
        if (!b.feasible) return;
        if (b.deltaDb < -1e-9) return;                // 需要升高声级，不合理
        if (b.newLevel < 0) return;                    // 降到 0 dB 以下不成立
        if (!best || b.deltaDb < best.deltaDb) best = b;
      });
    }

    // 交换率口径对照（同一份暴露换一个交换率）
    var altE = (E === 3) ? 5 : 3;
    var altDose = 0;
    out.forEach(function (r) { altDose += doseOf(r.minutes, r.level, R, altE); });
    var alt = {
      exchange: altE,
      dose: altDose,
      dosePct: altDose * 100,
      lex: altDose > 0 ? lexFromDose(altDose, R, altE) : null,
      verdictKey: verdictOf(altDose).key,
      verdictLabel: verdictOf(altDose).label
    };

    // 敏感性：逐项 −3 dB / −6 dB / 时长减半，全部 −3 dB，追加一段
    var sensitivity = [];
    out.forEach(function (r) {
      if (r.minutes <= 0) return;
      [3, 6].forEach(function (cut) {
        var d2 = dose - r.dose + doseOf(r.minutes, r.level - cut, R, E);
        sensitivity.push(sensRow('「' + r.name + '」降 ' + cut + ' dB', d2, dose, R, E));
      });
      var d3 = dose - r.dose + doseOf(r.minutes / 2, r.level, R, E);
      sensitivity.push(sensRow('「' + r.name + '」时长减半', d3, dose, R, E));
    });
    if (out.length > 1) {
      var dAll = 0;
      out.forEach(function (r) { dAll += doseOf(r.minutes, r.level - 3, R, E); });
      sensitivity.push(sensRow('全部条目降 3 dB', dAll, dose, R, E));
    }
    var extra = { name: '额外一段', level: p.targetLevel, minutes: 30 };
    var dExtra = dose + doseOf(extra.minutes, extra.level, R, E);
    sensitivity.push(sensRow('多听 30 分钟 ' + fmt(p.targetLevel, 1) + ' dB(A)', dExtra, dose, R, E));

    // 参考换算
    var sumTotal = sumLevels([p.refSum.a, p.refSum.b]);
    var distLevel = distanceLevel(p.refDist.l1, p.refDist.r1, p.refDist.r2);
    var refs = {
      sum: {
        a: p.refSum.a, b: p.refSum.b, total: sumTotal,
        delta: sumTotal === null ? null : sumTotal - Math.max(p.refSum.a, p.refSum.b),
        same: Math.abs(p.refSum.a - p.refSum.b) < 1e-9
      },
      dist: {
        l1: p.refDist.l1, r1: p.refDist.r1, r2: p.refDist.r2,
        level: distLevel, drop: p.refDist.l1 - distLevel,
        ratio: p.refDist.r2 / p.refDist.r1
      }
    };

    var verdict = verdictOf(dose);
    var warnings = [];
    if (dose === 0) warnings.push('所有条目的时长都是 0 分钟，剂量为 0；等效声级在剂量为 0 时没有定义，本页显示为「—」。');
    if (dose > 0 && totalMinutes > 1440) warnings.push('计入的时长合计 ' + fmt(totalMinutes, 0) + ' 分钟，超过一天 1440 分钟——请检查是不是把同一段时间重复计了（本页只是把它们相加）。');
    out.forEach(function (r) {
      if (r.minutes > 0 && r.level <= 0) warnings.push('「' + r.name + '」的声级填的是 0 dB(A)：它几乎不贡献剂量。如果这是漏填，请补上实际声级。');
      if (r.minutes === 0) warnings.push('「' + r.name + '」的时长是 0 分钟，未计入剂量。');
    });
    if (isOver && !best) warnings.push('已超上限，但没有哪一项能单靠降声级解决（把其中任何一项降到 0 dB(A) 都不够）——需要同时减多项或缩短时长。');
    if (E === 5) warnings.push('当前用 5 dB 交换率口径：在高于 ' + fmt(R, 0) + ' dB(A) 的声级上它比 3 dB 口径宽松（同一个声级允许待更久），在低于这个声级时反而更严；换口径可能直接改变「超没超」的结论。');
    if (dose > 0 && verdictOf(altDose).key !== verdict.key) {
      warnings.push('同一份暴露换口径判定会变：3 dB 口径是 ' + fmt(E === 3 ? dose * 100 : altDose * 100, 2) + '%，5 dB 口径是 ' + fmt(E === 3 ? altDose * 100 : dose * 100, 2) + '%——所以看任何「安全时长」的说法，都先问清是哪个交换率。');
    }

    return {
      rows: out,
      criteria: { exchange: E, refLevel: R, targetLevel: p.targetLevel },
      totals: {
        minutes: totalMinutes,
        dose: dose,
        dosePct: dose * 100,
        lexDose: lexDose,
        lexEnergy: lexEn,
        energyDiff: energyDiff,
        equivHoursAtRef: 8 * dose,
        rowCount: out.length,
        dominantIndex: dominant ? dominant.index : null,
        dominantName: dominant ? dominant.name : null,
        dominantShare: dominant ? dominant.share : 0,
        dominantDose: dominant ? dominant.dose : 0,
        remainingHoursAtTarget: remainingHours > 0 ? remainingHours : 0,
        remainingMinutesAtTarget: remainingMinutes > 0 ? remainingMinutes : 0,
        targetAllowedHours: targetAllowedHours
      },
      verdict: verdict,
      over: {
        isOver: isOver,
        factor: factor,
        byRow: byRow,
        best: best,
        unsolved: isOver && !best
      },
      alt: alt,
      sensitivity: sensitivity,
      refs: refs,
      warnings: warnings
    };
  }

  function sensRow(label, dose2, dose0, R, E) {
    return {
      label: label,
      dosePct: dose2 * 100,
      lex: dose2 > 0 ? lexFromDose(dose2, R, E) : null,
      deltaDosePct: (dose2 - dose0) * 100,
      deltaDoseRelPct: dose0 > 0 ? (dose2 - dose0) / dose0 * 100 : 0,
      verdictLabel: verdictOf(dose2).label
    };
  }

  // 判定分组：这是本页为了让结论可读而设的显示分组，不是科学或法规边界
  function verdictOf(dose) {
    if (!(dose > 0)) return { key: 'none', label: '没有计入暴露', tone: 'info' };
    if (dose <= 0.5) return { key: 'ample', label: '余量充足', tone: 'good' };
    if (dose <= 1) return { key: 'near', label: '接近上限', tone: 'warn' };
    if (dose <= 2) return { key: 'over', label: '已超所选口径的上限', tone: 'bad' };
    return { key: 'far', label: '远超所选口径的上限', tone: 'bad' };
  }

  var API = {
    LIMITS: LIMITS,
    PRESETS: PRESETS,
    clonePreset: clonePreset,
    blankRow: blankRow,
    solve: solve,
    parse: parse,
    allowedHours: allowedHours,
    doseOf: doseOf,
    lexFromDose: lexFromDose,
    lexEnergy: lexEnergy,
    sumLevels: sumLevels,
    distanceLevel: distanceLevel,
    verdictOf: verdictOf,
    log2: log2,
    fmt: fmt,
    pct: pct,
    hours: hours,
    db: db
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.AppCore = API;
})(typeof window !== 'undefined' ? window : globalThis);
