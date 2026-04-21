/* ============================================================
 * Manga Spread Viewer (Userscript edition)
 * Version: 2.0.7
 * Updated: 2026-04-21
 *
 * Changelog:
 *   2.0.7 - 左右に「次の章 →」ボタンを常時表示(次章がある場合のみ)。
 *           中央の「次の章へ」ボタンは廃止。
 *   2.0.6 - 最終画像でのタップで直接次章へ遷移。中間の「最終ページです」
 *           表示は次章がない場合(最終章)のみ表示。
 *   2.0.5 - 最終ページでの画面上70%タップを「次の章へ」と同一挙動に変更。
 *           タップ領域とボタンの挙動を一貫させた。
 *           最終ページでも下30%タップで前ページに戻れるように。
 *   2.0.4 - loadNextChapter でクリック時に次章URLを再計算。
 *           startViewer 実行時のタイミング依存で nextChapterUrl
 *           が null になる問題を回避。
 *   2.0.3 - サイト側のJSに location.href 書き込みが阻害される
 *           問題に対応。location.replace と a タグclick の
 *           二段構えで遷移を試行。
 *   2.0.2 - findNextChapterUrl の URL 比較を正規化。
 *           末尾の #、?、/ の違いで次章URLが取れない
 *           問題を修正。
 *   2.0.1 - 最終ページで透明タップ領域のクリックが
 *           「次の章へ」ボタンに優先される問題を修正。
 *   2.0.0 - Userscript 化。ドメイン別の自動起動トグル、
 *           Tampermonkey メニュー、起動ボタンに対応。
 *   1.3.0 - iframe 方式を撤回し、再タップ方式に一本化。
 * ============================================================ */

(() => {
  'use strict';

  const VERSION = '2.0.7';
  const DOMAIN = location.hostname;
  const AUTO_KEY = 'auto:' + DOMAIN;

  const SELECTORS = [
    '.page-chapter img',
    'div[id^="page_"] img',
    '#readerarea img',
    '.chapter-container img',
  ];

  const CHAPTER_URL_PATTERN = /chapter[-_]?\d/i;
  const isChapterPage = () => CHAPTER_URL_PATTERN.test(location.href);

  const getAuto = () => {
    try { return GM_getValue(AUTO_KEY, false); } catch { return false; }
  };
  const setAuto = (v) => {
    try { GM_setValue(AUTO_KEY, v); } catch {}
  };

  const extractImageUrls = () => {
    let imgs = [];
    for (const sel of SELECTORS) {
      imgs = Array.from(document.querySelectorAll(sel));
      if (imgs.length > 0) break;
    }
    return imgs
      .map(i => i.dataset.original || i.dataset.cdn || i.dataset.src || i.src)
      .filter(Boolean);
  };

  const findNextChapterUrl = () => {
    const normalize = (url) => {
      if (!url) return '';
      return url.replace(/[#?].*$/, '').replace(/\/$/, '');
    };
    const sel = document.querySelector('select.chapter-select');
    if (sel) {
      const options = Array.from(sel.querySelectorAll('option'));
      const curNorm = normalize(location.href);
      const curIdx = options.findIndex(o => normalize(o.value) === curNorm);
      if (curIdx > 0) return options[curIdx - 1].value;
    }

    const candidates = [
      'a[rel="next"]',
      'a.next',
      '.next a',
      '.nav-next a',
      'a.next_page',
    ];
    for (const s of candidates) {
      const el = document.querySelector(s);
      if (el && el.href) return el.href;
    }
    const links = Array.from(document.querySelectorAll('a'));
    const next = links.find(a => /次|next|→|>>/i.test(a.textContent.trim()) && a.href);
    return next ? next.href : null;
  };

  let launchBtnEl = null;

  const showLaunchButton = () => {
    if (launchBtnEl) return;
    if (document.getElementById('__mv_viewer')) return;

    const btn = document.createElement('button');
    btn.id = '__mv_launch';
    btn.textContent = '📖';
    btn.title = 'ビューアを起動';
    btn.style.cssText = `
      position: fixed !important;
      right: 8px !important;
      bottom: 8px !important;
      z-index: 2147483646 !important;
      width: 44px !important;
      height: 44px !important;
      border-radius: 50% !important;
      background: rgba(0,0,0,0.65) !important;
      color: #fff !important;
      border: 1px solid rgba(255,255,255,0.3) !important;
      font-size: 22px !important;
      line-height: 1 !important;
      cursor: pointer !important;
      padding: 0 !important;
      -webkit-tap-highlight-color: transparent !important;
    `;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setAuto(true);
      btn.remove();
      launchBtnEl = null;
      startViewer();
    });
    document.body.appendChild(btn);
    launchBtnEl = btn;
  };

  const startViewer = () => {
    if (document.getElementById('__mv_viewer')) return;

    const urls = extractImageUrls();
    if (urls.length === 0) {
      alert('画像が見つかりませんでした。');
      return;
    }
    const nextChapterUrl = findNextChapterUrl();

    if (launchBtnEl) {
      launchBtnEl.remove();
      launchBtnEl = null;
    }

    const BREAKPOINT = 600;
    const state = { index: 0 };

    const root = document.createElement('div');
    root.id = '__mv_viewer';
    root.innerHTML = `
      <style>
        #__mv_viewer {
          position: fixed; inset: 0; z-index: 2147483647;
          background: #000; overflow: hidden;
          user-select: none; -webkit-user-select: none;
          touch-action: manipulation;
        }
        #__mv_stage {
          position: absolute; inset: 0;
          display: flex; flex-direction: row-reverse;
          align-items: center; justify-content: center;
          gap: 2px;
        }
        #__mv_stage img {
          height: 100vh; width: auto;
          max-width: 50vw;
          object-fit: contain;
          display: block;
        }
        #__mv_stage.single img { max-width: 100vw; }
        #__mv_tap_next, #__mv_tap_prev {
          position: absolute; left: 0; right: 0;
          z-index: 2;
        }
        #__mv_tap_next { top: 0; height: 70%; }
        #__mv_tap_prev { bottom: 0; height: 30%; }
        .__mv_btn {
          position: absolute; z-index: 3;
          background: rgba(0,0,0,0.6); color: #fff;
          border: 1px solid rgba(255,255,255,0.3);
          border-radius: 6px; padding: 8px 12px;
          font: 14px/1 sans-serif; cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        #__mv_close { top: 10px; right: 10px; }
        #__mv_shift { top: 10px; left: 10px; }
        .__mv_next_side {
          top: 54px;
          display: none;
        }
        .__mv_next_side.show { display: block; }
        #__mv_next_left { left: 10px; }
        #__mv_next_right { right: 10px; }
        #__mv_version {
          position: absolute; bottom: 6px; right: 8px; z-index: 3;
          color: rgba(255,255,255,0.4); font: 10px/1 sans-serif;
          pointer-events: none;
        }
        #__mv_end_msg {
          position: absolute; top: 35%; left: 50%;
          transform: translate(-50%, -50%);
          color: #fff; font: 14px sans-serif;
          display: none;
        }
        #__mv_end_msg.show { display: block; }
        #__mv_toast {
          position: absolute; top: 20%; left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0,0,0,0.75); color: #fff;
          padding: 12px 20px; border-radius: 8px;
          font: 14px sans-serif; z-index: 4;
          opacity: 0; transition: opacity 0.3s;
          pointer-events: none;
          white-space: nowrap;
        }
        #__mv_toast.show { opacity: 1; }
      </style>
      <div id="__mv_stage"></div>
      <div id="__mv_tap_next"></div>
      <div id="__mv_tap_prev"></div>
      <button class="__mv_btn" id="__mv_close" title="v${VERSION} / ビューア終了 & 自動モードOFF">✕ 終了</button>
      <button class="__mv_btn" id="__mv_shift">⇄ 1枚ずらす</button>
      <button class="__mv_btn __mv_next_side" id="__mv_next_left">次の章 →</button>
      <button class="__mv_btn __mv_next_side" id="__mv_next_right">次の章 →</button>
      <div id="__mv_end_msg">最終ページです</div>
      <div id="__mv_toast"></div>
      <div id="__mv_version">v${VERSION}</div>
    `;
    document.body.appendChild(root);
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    const stage = root.querySelector('#__mv_stage');
    const endMsg = root.querySelector('#__mv_end_msg');
    const nextLeft = root.querySelector('#__mv_next_left');
    const nextRight = root.querySelector('#__mv_next_right');
    const toast = root.querySelector('#__mv_toast');

    const showToast = (msg, ms = 1500) => {
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(toast._hideTimer);
      toast._hideTimer = setTimeout(() => toast.classList.remove('show'), ms);
    };

    const isDouble = () => window.innerWidth >= BREAKPOINT;

    const updateSideBtns = () => {
      const show = !!nextChapterUrl;
      nextLeft.classList.toggle('show', show);
      nextRight.classList.toggle('show', show);
    };

    const render = () => {
      const step = isDouble() ? 2 : 1;
      const i = state.index;
      stage.innerHTML = '';
      stage.classList.toggle('single', step === 1);

      updateSideBtns();

      const atEnd = i >= urls.length;
      root.classList.toggle('end', atEnd);

      if (atEnd) {
        endMsg.classList.add('show');
        return;
      }
      endMsg.classList.remove('show');

      const first = document.createElement('img');
      first.src = urls[i];
      stage.appendChild(first);

      if (step === 2 && i + 1 < urls.length) {
        const second = document.createElement('img');
        second.src = urls[i + 1];
        stage.appendChild(second);
      }
      preload(i + step);
    };

    const preload = (from) => {
      for (let k = 0; k < 4; k++) {
        const idx = from + k;
        if (idx < urls.length) {
          const img = new Image();
          img.src = urls[idx];
        }
      }
    };

    const loadNextChapter = () => {
      const url = findNextChapterUrl() || nextChapterUrl;
      if (!url) return;
      try {
        location.replace(url);
      } catch (e) {
        const a = document.createElement('a');
        a.href = url;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    };

    const goNext = () => {
      const step = isDouble() ? 2 : 1;
      const nextIndex = state.index + step;
      
      if (nextIndex >= urls.length) {
        const url = findNextChapterUrl() || nextChapterUrl;
        if (url) {
          loadNextChapter();
          return;
        }
        if (state.index >= urls.length) return;
        state.index = urls.length;
        render();
        return;
      }
      
      state.index = nextIndex;
      render();
    };

    const goPrev = () => {
      const step = isDouble() ? 2 : 1;
      state.index = Math.max(state.index - step, 0);
      render();
    };

    const shiftOne = () => {
      if (state.index + 1 < urls.length) {
        state.index += 1;
        render();
      }
    };

    const close = () => {
      setAuto(false);
      root.remove();
      document.documentElement.style.overflow = prevOverflow;
      window.removeEventListener('resize', onResize);
      showToastFloating('自動起動をOFFにしました');
    };

    root.querySelector('#__mv_tap_next').addEventListener('click', goNext);
    root.querySelector('#__mv_tap_prev').addEventListener('click', goPrev);
    root.querySelector('#__mv_close').addEventListener('click', close);
    root.querySelector('#__mv_shift').addEventListener('click', shiftOne);
    nextLeft.addEventListener('click', loadNextChapter);
    nextRight.addEventListener('click', loadNextChapter);

    let resizeTimer;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 150);
    };
    window.addEventListener('resize', onResize);

    render();
  };

  const showToastFloating = (msg, ms = 1500) => {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `
      position: fixed !important;
      top: 20% !important; left: 50% !important;
      transform: translate(-50%, -50%) !important;
      background: rgba(0,0,0,0.75) !important; color: #fff !important;
      padding: 12px 20px !important; border-radius: 8px !important;
      font: 14px sans-serif !important; z-index: 2147483647 !important;
      pointer-events: none !important;
      white-space: nowrap !important;
    `;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  };

  try {
    GM_registerMenuCommand('ビューアを起動(自動モードON)', () => {
      setAuto(true);
      startViewer();
    });
    GM_registerMenuCommand('自動モードOFF(このサイト)', () => {
      setAuto(false);
      showToastFloating(`${DOMAIN}: 自動起動OFF`);
    });
  } catch {}

  if (getAuto()) {
    startViewer();
  } else if (isChapterPage()) {
    showLaunchButton();
  }
})();
