(() => {
  // 既に起動していたら何もしない
  if (document.getElementById('__mv_viewer')) return;

  // === 1. 画像URL抽出 ===
  const selectors = [
    '.page-chapter img',
    'div[id^="page_"] img',
    '#readerarea img',
    '.chapter-container img',
  ];
  let imgs = [];
  for (const sel of selectors) {
    imgs = Array.from(document.querySelectorAll(sel));
    if (imgs.length > 0) break;
  }
  const urls = imgs
    .map(i => i.dataset.original || i.dataset.cdn || i.dataset.src || i.src)
    .filter(Boolean);

  if (urls.length === 0) {
    alert('画像が見つかりませんでした。');
    return;
  }

  // === 2. 次章リンクを探す ===
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
    // テキストで探す
    const links = Array.from(document.querySelectorAll('a'));
    const next = links.find(a => /次|next|→|>>/i.test(a.textContent.trim()) && a.href);
    return next ? next.href : null;
  };
  const nextChapterUrl = findNextChapterUrl();

  // === 3. ビューア構築 ===
  const BREAKPOINT = 600;
  const state = {
    index: 0,           // 現在の先頭ページ
    urls,
  };

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
    </style>
    <div id="__mv_stage"></div>
    <div id="__mv_tap_next"></div>
    <div id="__mv_tap_prev"></div>
    <button class="__mv_btn" id="__mv_close">✕ 閉じる</button>
    <button class="__mv_btn" id="__mv_shift">⇄ 1枚ずらす</button>
    <div id="__mv_end_msg">最終ページです</div>
    <button class="__mv_btn" id="__mv_next_chapter">次の章へ →</button>
  `;
  document.body.appendChild(root);
  // bodyスクロール抑制
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';

  const stage = root.querySelector('#__mv_stage');
  const endMsg = root.querySelector('#__mv_end_msg');
  const nextChapterBtn = root.querySelector('#__mv_next_chapter');

  // === 4. 表示ロジック ===
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

    // 2枚表示: flex-direction:row-reverse なので
    // DOM順 [右, 左] で append すると視覚的に [左, 右] → 違う
    // 正しくは DOM順 [i, i+1] で append し、row-reverse で [i+1(左), i(右)] となる
    // つまり i が右ページ、i+1 が左ページ
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
    if (state.index >= urls.length) return; // 既に終端
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

  const close = () => {
    root.remove();
    document.documentElement.style.overflow = prevOverflow;
    window.removeEventListener('resize', onResize);
  };

  // === 5. イベント ===
  root.querySelector('#__mv_tap_next').addEventListener('click', goNext);
  root.querySelector('#__mv_tap_prev').addEventListener('click', goPrev);
  root.querySelector('#__mv_close').addEventListener('click', close);
  root.querySelector('#__mv_shift').addEventListener('click', shiftOne);
  nextChapterBtn.addEventListener('click', () => {
    if (nextChapterUrl) location.href = nextChapterUrl;
  });

  let resizeTimer;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
  };
  window.addEventListener('resize', onResize);

  // === 6. 初期描画 ===
  render();
})();
