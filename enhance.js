/* =========================================================
   FILM LOG · 增强层（enhance.js） · v2
   纯增量：不改动原 app.js / styles.css
   1) 在次要 / 非核心 / 空白较多的页面注入「水彩印象派」电影插画（AI 生成位图）
   2) 统一加上有重量感的滚动入场动效与微交互
   通过监听 hashchange + 初始渲染后注入，随原站每次 render 自动重挂。
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 小工具 ---------- */
  function insertAfter(ref, node) { if (ref && ref.parentNode) ref.parentNode.insertBefore(node, ref.nextSibling); }
  function insertBefore(ref, node) { if (ref && ref.parentNode) ref.parentNode.insertBefore(node, ref); }

  // 插画固有尺寸表（优化 9：显式声明 width/height，避免加载时的布局位移 CLS）
  var ILLUS_SIZE = {
    'search.webp': [1100, 688],
    'cinephile.webp': [1100, 688],
    'preview.webp': [1100, 688],
    'notfound.webp': [1024, 930],
    'king.webp': [1024, 930]
  };

  // 插画载体：<div class="fl-illus"><img ...></div>
  function illus(src, alt, cls) {
    var d = document.createElement('div');
    d.className = 'fl-illus' + (cls ? ' ' + cls : '');
    var img = document.createElement('img');
    img.src = 'assets/' + src;
    img.alt = alt || '';
    img.decoding = 'async';
    img.loading = 'eager';
    var sz = ILLUS_SIZE[src];
    if (sz) { img.width = sz[0]; img.height = sz[1]; }
    d.appendChild(img);
    return d;
  }
  // 带（居中装饰带）
  function band(node, bandCls) {
    var w = document.createElement('div');
    w.className = 'fl-illus-band' + (bandCls ? ' ' + bandCls : '');
    w.appendChild(node);
    return w;
  }

  /* =========================================================
     注入：把插画放进对应页面的空白处
     ========================================================= */
  function injectIllustrations() {
    // 搜索页：搜索框与列表之间 —— 放映机（首屏可见，填补留白）
    var sInput = document.getElementById('searchInput');
    var sLabel = document.querySelector('.index-label');
    if (sLabel && sLabel.parentNode) {
      insertBefore(sLabel, band(illus('search.webp', '放映机与银幕，水彩印象派插画')));
    } else if (sInput) {
      insertAfter(sInput, band(illus('search.webp', '放映机与银幕，水彩印象派插画')));
    }

    // 注：按反馈，仅保留「搜索页」一处插画；
    // 影迷名录 / 隐藏预览页 / 404 / 观影帝空态的插画均已停用，
    // 页脚胶片条装饰也已移除（素材保留在 assets 中，需要时可一键恢复）。
  }

  /* =========================================================
     动效：滚动入场（IntersectionObserver）+ 交错
     ========================================================= */
  // 注：按反馈，已移除原 '.preview section' —— 「谁和谁最常一起看」模块不使用滚动入场
  var REVEAL_SEL = '.cal-head,.cal-weekdays,.cal-grid,.king-card,.cine-group,.index-item,' +
    '.lib-card,.watch,.dir-film,.tf-card,.hc-item,.ps-cell,.summary-block,.film-head,' +
    '.divider';

  function initMotion() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      // 尊重偏好：直接呈现最终态
      Array.prototype.forEach.call(document.querySelectorAll(REVEAL_SEL + ',.fl-illus'), function (e) {
        e.classList.add('fl-in');
      });
      return;
    }
    var els = document.querySelectorAll(REVEAL_SEL);
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(els, function (e) { e.classList.add('fl-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('fl-in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -10% 0px' });

    // 标记 + 交错延迟；首屏内元素稍后立即显示，其余交给 IO
    var aboveFold = [];
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    Array.prototype.forEach.call(els, function (el) {
      el.classList.add('fl-reveal');
      var parent = el.parentElement;
      var idx = 0;
      if (parent) {
        var sibs = Array.prototype.slice.call(parent.children);
        idx = sibs.indexOf(el);
      }
      // 交错阶梯取中间值 56ms：能看出先后，又不拖沓
      el.style.transitionDelay = (Math.min(idx, 12) * 56) + 'ms';
      var r = el.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) aboveFold.push(el);
      else io.observe(el);
    });

    // 强制提交初始态，保证首屏元素优雅入场（而非直接跳显）
    void document.body.offsetWidth;
    aboveFold.forEach(function (el) { el.classList.add('fl-in'); });

    // 插画也走滚动入场
    var illus = document.querySelectorAll('.fl-illus');
    if (illus.length) {
      var io2 = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('fl-in'); io2.unobserve(en.target); }
        });
      }, { threshold: 0.12 });
      var vh2 = vh;
      Array.prototype.forEach.call(illus, function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < vh2 && r.bottom > 0) el.classList.add('fl-in');
        else io2.observe(el);
      });
    }

    // 兜底：1.8s 后全部显示，杜绝内容被永久隐藏
    setTimeout(function () {
      Array.prototype.forEach.call(document.querySelectorAll('.fl-reveal,.fl-illus'), function (el) {
        el.classList.add('fl-in');
      });
    }, 1800);
  }

  /* =========================================================
     优化 1：翻月方向感
     包装原 goMonth，记录翻月方向；render 后给日历网格加对应方向动画。
     （原函数保持可用，失败时不影响任何原有行为）
     ========================================================= */
  var lastMonthDir = 0;
  function patchMonthNav() {
    try {
      if (typeof window.goMonth !== 'function') return;
      if (window.goMonth.__flPatched) return;
      var orig = window.goMonth;
      var wrapped = function (d) {
        lastMonthDir = (d === 0) ? 0 : (d < 0 ? -1 : 1);
        var r = orig.apply(this, arguments);
        // 翻月走 render() 不触发 hashchange，故需在此主动应用方向动画
        setTimeout(function () { try { applyMonthDir(); } catch (e) {} }, 0);
        return r;
      };
      wrapped.__flPatched = true;
      window.goMonth = wrapped;
    } catch (e) { /* 翻月包装失败不影响主站 */ }
  }

  function applyMonthDir() {
    if (!lastMonthDir) return;
    var grid = document.querySelector('.cal-grid');
    if (!grid) return;
    var cls = lastMonthDir < 0 ? 'fl-cal-prev' : 'fl-cal-next';
    grid.classList.remove('fl-cal-prev', 'fl-cal-next');
    // 强制重排以重启动画（连续翻月时每次都要重新播放）
    void grid.offsetWidth;
    grid.classList.add(cls);
    lastMonthDir = 0; // 用后即清，避免其它路由误触发
  }

  /* =========================================================
     总入口：随每次 render 重挂
     ========================================================= */
  function runEnhance() {
    try { injectIllustrations(); } catch (e) { /* 插画失败不影响主站 */ }
    try { initMotion(); } catch (e) { /* 动效失败不影响主站 */ }
    try { applyMonthDir(); } catch (e) { /* 翻月方向动画失败不影响主站 */ }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(runEnhance, 0);
  } else {
    window.addEventListener('DOMContentLoaded', function () { setTimeout(runEnhance, 0); });
  }
  window.addEventListener('hashchange', runEnhance);

  // 翻月方向：包装原 goMonth（需在 app.js 定义之后执行）
  patchMonthNav();
})();
