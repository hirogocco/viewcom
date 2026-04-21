/* ============================================================
 * Manga Spread Viewer
 * Version: 1.1.0
 * Updated: 2026-04-21
 *
 * Changelog:
 *   1.1.0 - 次章への引き継ぎ方式を変更。「次の章へ」タップで
 *           通常遷移し、新ページでブックマークレットを再実行
 *           すると sessionStorage から続行。トースト表示あり。
 *   1.0.0 - 初回リリース。見開き・タップ操作・閉じる・ずらす。
 * ============================================================ */

(() => {
  const VERSION = '1.1.0';
  const RESUME_KEY = '__mv_resume_v1';
  const RESUME_TTL = 2 * 60 * 1000; // 2分以内の再起動なら「続行」とみなす

  if (document.getElementById('__mv_viewer')) return;

  const SELECTORS = [
    '.page-chapter img',
    'div[id^="page_"] img',
    '#readerarea img',
    '.chapter-container img',
  ];

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
    const candidates = [
      'a[rel="next"]',
      'a.next',
      '.next a',
      '.nav-next a',
      'a.next_page',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.href) return el.href;
    }
    const links = Array.from(document.querySelectorAll('a'));
    const next = links.find(a => /次|next|→|>>/i.test(a.textContent.trim()) && a.href);
    return next ? next.href : null;
  };

  const urls = extractImageUrls();
  if (urls.length === 0) {
    alert('画像が見つかりませんでした。');
    return;
  }
  const nextChapterUrl = findNextChapterUrl();

  let resumedFromPrev = false;
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && saved.version === VERSION &&
          typeof saved.ts === 'number' &&
          Date.now() - saved.ts < RESUME_TTL) {
        resumedFromPrev = true;
      }
      sessionStorage.removeItem(RESUME_KEY);
    }
  } catch {}

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
      #__mv_version {
        position: absolute; bottom: 6px; right: 8px; z-index: 3;
        color: rgba(255,255,255,0.4); font: 10px/1 sans-serif;
        pointer-events: none;
      }
      #__mv_next_chapter {
        top: 50%; left: 50%; transform: translate(-50%, -50%);
        padding: 16px 24px; font-size: 16px;
        display: none;
      }
      #__mv_next_chapter.show { display: block; }
      #__mv_end_msg {
        position: absolute; top: 40%; left: 50%;
        transform: translate(-50%, -50%);
        color: #fff; font: 14px sans-serif;
        display: none;
      }
      #__mv_end_msg.show { display: block; }
      #__mv_toast {
        position: absolute; top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.75); color: #fff;
        padding: 12px 20px; border-radius: 8px;
        font: 14px sans-serif; z-index: 4;
        opacity: 0; transition: opacity 0.3s;
        pointer-events: none;
      }
      #__mv_toast.show { opacity: 1; }
    </style>
    <div id="__mv_stage"></div>
    <div id="__mv_tap_next"></div>
    <div id="__mv_tap_prev"></div>
    <button class="__mv_btn" id="__mv_close" title="v${VERSION}">✕ 閉じる</button>
    <button class="__mv_btn" id="__mv_shift">⇄ 1枚ずらす</button>
    <div id="__mv_end_msg">最終ページです</div>
    <button class="__mv_btn" id="__mv_next_chapter">次の章へ →</button>
    <div id="__mv_toast"></div>
    <div id="__mv_version">v${VERSION}</div>
  `;
  document.body.appendChild(root);
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';

  const stage = root.querySelector('#__mv_stage');
  const endMsg = root.querySelector('#__mv_end_msg');
  const nextChapterBtn = root.querySelector('#__mv_next_chapter');
  const toast = root.querySelector('#__mv_toast');

  const showToast = (msg, ms = 1500) => {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), ms);
  };

  const isDouble = () => window.innerWidth >= BREAKPOINT;

  const render = () => {
    const step = isDouble() ? 2 : 1;
    const i = state.index;
    stage.innerHTML = '';
    stage.classList.toggle('single', step === 1);

    if (i >= urls.length) {
      endMsg.classList.add('show');
      nextChapterBtn.classList.toggle('show', !!nextChapterUrl);
      return;
    }
    endMsg.classList.remove('show');
    nextChapterBtn.classList.remove('show');

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

  const goNext = () => {
    const step = isDouble() ? 2 : 1;
    if (state.index >= urls.length) return;
    state.index = Math.min(state.index + step, urls.length);
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

  const loadNextChapter = () => {
    if (!nextChapterUrl) return;
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({
        version: VERSION,
        ts: Date.now(),
      }));
    } catch {}
    location.href = nextChapterUrl;
  };

  const close = () => {
    root.remove();
    document.documentElement.style.overflow = prevOverflow;
    window.removeEventListener('resize', onResize);
  };

  root.querySelector('#__mv_tap_next').addEventListener('click', goNext);
  root.querySelector('#__mv_tap_prev').addEventListener('click', goPrev);
  root.querySelector('#__mv_close').addEventListener('click', close);
  root.querySelector('#__mv_shift').addEventListener('click', shiftOne);
  nextChapterBtn.addEventListener('click', loadNextChapter);

  let resizeTimer;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
  };
  window.addEventListener('resize', onResize);

  render();
  if (resumedFromPrev) showToast('前の章から続行');
})();
