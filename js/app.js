/* 二次元游戏情报站 - 前端逻辑（原生 JS，无外部依赖） */
(function () {
  'use strict';

  const API = '';
  // 静态模式：GitHub Pages 等无后端环境下，从 data/*.json 读取快照数据。
  // 启动时探测后端 /api/health，可用则走 API，否则回退静态 JSON。
  let API_MODE = 'api';       // 'api' | 'static'
  const staticCache = { games: null, details: {} };  // 静态数据缓存
  const state = {
    status: 'all',
    search: '',
    sort: 'heat',
    games: [],
    stats: null,
    compare: [],   // 选中的 slug，最多 2 款
  };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  };
  const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const fmtNum = (n) => {
    if (n == null) return '—';
    if (n >= 100000000) return (n / 100000000).toFixed(n % 100000000 === 0 ? 0 : 1) + '亿';
    if (n >= 10000) return (n / 10000).toFixed(n % 10000 === 0 ? 0 : 0) + '万';
    return String(n);
  };
  const STATUS_LABEL = { released: '已上线', upcoming: '即将上线', beta: '测试中', announced: '即将上线', terminated: '已停运', terminating: '即将停运' };

  /* 用户规模指标：已上线在运营看「全平台下载量」，未上线看「预约量」；
     缺一方时回退到另一方，避免已上线但未披露下载量的游戏显示空值 */
  function scaleOf(g) {
    const released = g.status === 'released' || g.status === 'terminated' || g.status === 'terminating';
    let label = released ? '全平台下载量' : '预约量';
    let short = released ? '下载' : '预约';
    let value = released ? g.downloads : g.reservation;
    let note = released ? (g.downloads_note || '') : '';
    if (!value) {
      value = released ? g.reservation : g.downloads;
      if (value) {
        label = released ? '预约量' : '全平台下载量';
        short = released ? '预约' : '下载';
        note = '';
      }
    }
    return {
      label: label,
      short: short,
      value: value || null,
      note: note,
    };
  }

  async function api(path) {
    const res = await fetch(API + path);
    if (!res.ok) {
      let msg = '请求失败 ' + res.status;
      try { const j = await res.json(); msg = j.error?.message || msg; } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  }

  // 探测后端是否可用：静态部署环境（GitHub Pages）下无 FastAPI 后端，
  // /health 会返回 404 的 HTML，据此切换到静态 JSON 模式。
  async function detectMode() {
    try {
      const res = await fetch(API + '/health');
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (j && j.status === 'ok') { API_MODE = 'api'; return; }
      }
    } catch (_) {}
    API_MODE = 'static';
  }

  // 静态模式下读取 data/games.json（含 items + stats）
  async function staticGames() {
    if (!staticCache.games) {
      const res = await fetch(API + 'data/games.json');
      if (!res.ok) throw new Error('加载静态数据失败 ' + res.status);
      staticCache.games = await res.json();
    }
    return staticCache.games;
  }

  // 静态模式下读取单款详情 data/details/{slug}.json
  async function staticDetail(slug) {
    if (!staticCache.details[slug]) {
      const res = await fetch(API + 'data/details/' + encodeURIComponent(slug) + '.json');
      if (!res.ok) throw new Error('详情不存在 ' + res.status);
      staticCache.details[slug] = await res.json();
    }
    return staticCache.details[slug];
  }

  // 统一获取游戏详情：API 模式走后端，静态模式读 JSON
  function getGameDetail(slug) {
    if (API_MODE === 'static') return staticDetail(slug);
    return api('/api/games/' + encodeURIComponent(slug));
  }

  // 静态模式下的本地筛选 + 搜索 + 排序（复刻后端 GameRepository.list_games 逻辑）
  function staticQuery(status, search, sort) {
    let items = staticCache.games.items.slice();
    if (status && status !== 'all') {
      if (status === 'terminated') {
        items = items.filter(g => g.status === 'terminated' || g.status === 'terminating');
      } else {
        items = items.filter(g => g.status === status);
      }
    }
    if (search) {
      const kw = search.toLowerCase();
      items = items.filter(g =>
        (g.name || '').toLowerCase().includes(kw) ||
        (g.name_en || '').toLowerCase().includes(kw) ||
        (g.alias || '').toLowerCase().includes(kw) ||
        (g.developer || '').toLowerCase().includes(kw)
      );
    }
    const by = {
      heat: (a, b) => ((b.heat ?? -1) - (a.heat ?? -1)),
      reservation: (a, b) => ((b.reservation ?? -1) - (a.reservation ?? -1)),
      date: (a, b) => ((a.launch_date || '').localeCompare(b.launch_date || '')),
      name: (a, b) => (a.name || '').localeCompare(b.name || '', 'zh'),
    }[sort] || ((a, b) => ((b.heat ?? -1) - (a.heat ?? -1)));
    items.sort(by);
    return { items, total: items.length, stats: staticCache.games.stats };
  }

  function formatDate(s) {
    if (!s) return '待定';
    const parts = s.split('-');
    if (parts.length === 3) return `${parts[0]}.${parts[1]}.${parts[2]}`;
    if (parts.length === 2) return `${parts[0]}.${parts[1]}`;
    return s;
  }

  /* ---------- 统计卡 ---------- */
  const ICONS = {
    games: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="4"/><path d="M8 10v4M6 12h4M15.5 11h.01M18 13h.01"/></svg>',
    live: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 13.5 11 20l9-16"/><path d="M4.5 4.5h4"/></svg>',
    soon: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    users: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.7-5 5.5-5s4.9 1.8 5.5 5"/><path d="M16 5.5a3 3 0 0 1 0 5.5M17.5 14.5c2 .8 3.2 2.4 3.5 4.5"/></svg>',
    heat: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-1.5 3.5-5 5.5-5 10a5 5 0 0 0 10 0c0-2-1-3.5-2.5-5 .2 2-1 3-2 3.5.8-3.5-1-6.5-.5-8.5Z"/></svg>',
    tomb: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21h6"/><path d="M10 21v-4.5A6 6 0 0 1 16 11"/><path d="M8 21v-5a6 6 0 0 1 6-5"/><path d="M12 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/><path d="M8 5h8"/></svg>',
  };
  function renderStats(st) {
    const cards = [
      { label: '收录游戏', value: st.total_games, suffix: '款', cls: 'accent', icon: 'games' },
      { label: '已上线', value: st.released, suffix: '款', cls: '', icon: 'live' },
      { label: '即将上线', value: st.upcoming, suffix: '款', cls: '', icon: 'soon' },
      { label: '已停运', value: st.terminated ?? 0, suffix: '款', cls: 'dead', icon: 'tomb' },
      { label: '规模峰值', value: fmtNum(st.max_scale), suffix: '', cls: '', icon: 'users', sub: st.max_scale_label, tip: st.max_scale_game ? `${st.max_scale_label}最高：${st.max_scale_game}` : '' },
      { label: '平均热度', value: st.avg_heat, suffix: '/100', cls: 'hot', icon: 'heat' },
    ];
    $('#stats').innerHTML = cards.map(c => `
      <div class="stat-card"${c.tip ? ` title="${esc(c.tip)}"` : ''}>
        <div class="stat-top"><span class="stat-label">${c.label}</span><span class="stat-icon">${ICONS[c.icon]}</span></div>
        <div class="stat-value ${c.cls}">${c.value}<span class="stat-suffix">${c.suffix}</span></div>
        ${c.sub ? `<div class="stat-sub">${esc(c.sub)}</div>` : ''}
      </div>`).join('');
    if (st.last_updated) {
      const d = st.last_updated.split(' ')[0];
      $('#asOfLabel').textContent = '数据更新于 ' + d;
    }
  }

  /* ---------- 游戏卡片 ---------- */
  function renderCards(items) {
    const grid = $('#gameGrid');
    grid.innerHTML = '';
    $('#countBadge').textContent = items.length + ' 款';
    $('#emptyState').hidden = items.length > 0;
    items.forEach(g => {
      const card = el('article', 'game-card');
      card.dataset.slug = g.slug;
      const sc = scaleOf(g);
      const statusCls = 'status-' + (g.status === 'released' ? 'released' : g.status === 'beta' ? 'beta' : g.status === 'terminated' ? 'terminated' : g.status === 'terminating' ? 'terminating' : 'upcoming');
      const cmpIdx = state.compare.indexOf(g.slug);
      const isStopped = g.status === 'terminated' || g.status === 'terminating';
      const coverHtml = `
        ${isStopped ? '' : `<div class="rank-corner">#${g.heat_rank || '-'}</div>`}
        <span class="status-chip ${statusCls}">${STATUS_LABEL[g.status] || g.status}</span>
        <button class="compare-pick ${cmpIdx >= 0 ? 'picked' : ''}" data-slug="${esc(g.slug)}"
                title="${cmpIdx >= 0 ? '移出对比' : '加入对比'}" aria-label="${cmpIdx >= 0 ? '移出对比' : '加入对比'}">
          <span class="cmp-box">${cmpIdx >= 0 ? '✓' : '+'}</span>
          <span class="cmp-text">${cmpIdx >= 0 ? '已选' : '对比'}</span>
        </button>`;
      card.innerHTML = `
        <div class="cover" style="background:${g.cover_color || '#6C7A89'}">
          <img src="${esc(g.cover_url)}" alt="${esc(g.name)} 宣传图" loading="lazy"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
               style="display:block">
          <div class="cover-fallback" style="display:none;background:${g.cover_color || '#6C7A89'}">${esc(g.name.slice(0, 4))}</div>
          ${coverHtml}
        </div>
        <div class="card-body">
          <div>
            <h3 class="card-title">${esc(g.name)}</h3>
            <div class="card-en">${esc(g.name_en || '')}</div>
          </div>
          <p class="card-tagline">${esc(g.tagline || g.genre || '')}</p>
          <div class="card-foot">
            <span class="dev-tag" title="${esc(g.developer)}">${esc(g.developer)}</span>
            <span class="scale-tag" title="${esc(sc.label + '：' + (sc.value ? fmtNum(sc.value) : '暂无'))}">${sc.short} ${sc.value ? fmtNum(sc.value) : '—'}</span>
            <span class="launch-tag">${formatDate(g.launch_date)}</span>
          </div>
          <div class="card-meta">
            ${isStopped ? '' : `
            <div class="heat-inline">
              <span class="heat-num">${Number(g.heat || 0).toFixed(1)}</span>
              <span class="heat-label">热度</span>
            </div>`}
            <div class="rating-inline">
              <span class="rating-star">★</span>
              <span>${g.avg_rating != null ? Number(g.avg_rating).toFixed(1) : '待评'}</span>
            </div>
          </div>
        </div>`;
      card.addEventListener('click', () => openDetail(g.slug));
      card.querySelector('.compare-pick').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCompare(g.slug);
      });
      grid.appendChild(card);
    });
  }

  /* ---------- 热度排行条形图（SVG） ---------- */
  function renderRank(items) {
    // 仅对在运营的游戏排名（已停运/即将停运无热度、无排行）
    const top = items
      .filter(g => g.status !== 'terminated' && g.status !== 'terminating')
      .sort((a, b) => (b.heat || 0) - (a.heat || 0));
    const box = $('#rankChart');
    box.innerHTML = '';
    const max = Math.max(...top.map(g => g.heat || 0), 1);
    top.forEach((g, i) => {
      const row = el('div', 'rank-row');
      row.innerHTML = `
        <span class="rank-idx">${i + 1}</span>
        <span class="rank-name" title="${esc(g.name)}">${esc(g.name)}</span>
        <span class="rank-val">${Number(g.heat).toFixed(1)}</span>
        <div class="rank-bar-track"><div class="rank-bar" style="width:${(g.heat / max * 100).toFixed(1)}%"></div></div>`;
      row.addEventListener('click', () => openDetail(g.slug));
      box.appendChild(row);
    });
  }

  /* ---------- 热点消息（右侧栏） ---------- */
  function renderHotNews(items) {
    const box = $('#hotNewsList');
    if (!box) return;
    box.innerHTML = '';
    if (!items || !items.length) {
      box.innerHTML = '<div class="hot-news-empty">暂无热点消息</div>';
      return;
    }
    items.forEach(n => {
      const item = el('div', 'hot-news-item');
      item.title = n.title;
      item.innerHTML = `
        <div class="hot-news-title">${esc(n.title)}</div>
        <div class="hot-news-meta">
          <span class="hot-news-game">${esc(n.game_name)}</span>
          ${n.published_at ? `<span class="hot-news-dot"></span><span class="hot-news-date">${esc(n.published_at)}</span>` : ''}
          ${n.source ? `<span class="hot-news-dot"></span><span class="hot-news-source" title="${esc(n.source)}">${esc(n.source)}</span>` : ''}
        </div>`;
      // 点击标题打开新闻原文，点击其他区域打开游戏详情
      item.addEventListener('click', (e) => {
        const t = e.target.closest('.hot-news-title');
        if (t) {
          window.open(n.url, '_blank', 'noopener');
        } else {
          openDetail(n.game_slug);
        }
      });
      box.appendChild(item);
    });
  }

  /* ---------- 加载热点消息（API / 静态双模式） ---------- */
  async function loadHotNews() {
    try {
      let items;
      if (API_MODE === 'static') {
        const res = await fetch(API + 'data/news.json');
        if (!res.ok) throw new Error('热点消息加载失败 ' + res.status);
        const data = await res.json();
        items = data.items || [];
      } else {
        const data = await api('/api/news?limit=10');
        items = data.items || [];
      }
      renderHotNews(items);
    } catch (e) {
      const box = $('#hotNewsList');
      if (box) box.innerHTML = `<div class="hot-news-empty">${esc(e.message)}</div>`;
    }
  }

  /* ---------- 雷达图（SVG，热度构成） ---------- */
  function radarSvg(breakdown) {
    const dims = [
      ['口碑', breakdown.rating_score],
      ['关注', breakdown.buzz_score],
      ['商业', breakdown.revenue_score],
      ['势能', breakdown.momentum_score],
    ];
    const cx = 78, cy = 78, R = 58;
    const angle = (i) => (Math.PI * 2 * i) / dims.length - Math.PI / 2;
    const pt = (i, r) => `${(cx + Math.cos(angle(i)) * r).toFixed(1)},${(cy + Math.sin(angle(i)) * r).toFixed(1)}`;
    let grid = '';
    [0.25, 0.5, 0.75, 1].forEach(f => {
      grid += `<polygon points="${dims.map((_, i) => pt(i, R * f)).join(' ')}" fill="${f === 1 ? 'rgba(155,139,255,.04)' : 'none'}" stroke="#333c5c" stroke-width="1"/>`;
    });
    dims.forEach((_, i) => { grid += `<line x1="${cx}" y1="${cy}" x2="${pt(i, R).split(',')[0]}" y2="${pt(i, R).split(',')[1]}" stroke="#333c5c" stroke-width="1"/>`; });
    const dataPts = dims.map((d, i) => pt(i, R * Math.max(0.05, d[1] / 100))).join(' ');
    const labels = dims.map((d, i) => {
      const x = cx + Math.cos(angle(i)) * (R + 15);
      const y = cy + Math.sin(angle(i)) * (R + 15) + 4;
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="#8b94b5">${d[0]}</text>`;
    }).join('');
    return `<svg viewBox="0 0 156 156" width="156" height="156" role="img" aria-label="热度构成雷达图">
      <defs><linearGradient id="radarFill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#7c6cf0" stop-opacity=".38"/><stop offset="100%" stop-color="#ff6b9d" stop-opacity=".28"/>
      </linearGradient><linearGradient id="radarStroke" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#5b5bd6"/><stop offset="100%" stop-color="#f0455f"/>
      </linearGradient></defs>
      ${grid}
      <polygon points="${dataPts}" fill="url(#radarFill)" stroke="url(#radarStroke)" stroke-width="2" stroke-linejoin="round"/>
      ${dims.map((d, i) => { const [x,y] = pt(i, R * Math.max(0.05, d[1]/100)).split(','); return `<circle cx="${x}" cy="${y}" r="3" fill="#fff" stroke="#f0455f" stroke-width="2"/>`; }).join('')}
      ${labels}</svg>`;
  }

  /* ---------- 详情抽屉 ---------- */
  async function openDetail(slug) {
    const overlay = $('#drawerOverlay');
    const drawer = $('#drawer');
    const body = $('#drawerBody');
    overlay.hidden = false; drawer.hidden = false;
    document.body.style.overflow = 'hidden';
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-3)">加载中…</div>';
    try {
      const g = await getGameDetail(slug);
      body.innerHTML = buildDetailHtml(g);
      drawer.scrollTop = 0;
      drawer.querySelector('.drawer-close').addEventListener('click', closeDetail);
    } catch (e) {
      body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--hot)">加载失败：${esc(e.message)}</div>`;
    }
  }
  function closeDetail() {
    $('#drawerOverlay').hidden = true;
    $('#drawer').hidden = true;
    document.body.style.overflow = '';
  }
  $('#drawerOverlay').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#compareModal').hidden) closeCompare();
    else closeDetail();
  });

  function buildDetailHtml(g) {
    const heat = g.heat;
    const isStoppedDetail = g.status === 'terminated' || g.status === 'terminating';
    const b = heat ? heat.breakdown : { rating_score: 0, buzz_score: 0, revenue_score: 0, momentum_score: 0 };
    const statusCls = 'status-' + (g.status === 'released' ? 'released' : g.status === 'beta' ? 'beta' : g.status === 'terminated' ? 'terminated' : g.status === 'terminating' ? 'terminating' : 'upcoming');

    // 时间线
    const tl = g.milestones.map(m => {
      const catCls = m.category === '上线' ? 'cat-launch' : m.category === '测试' ? 'cat-test' : '';
      return `<div class="tl-item ${catCls}">
        <span class="tl-dot"></span>
        <div class="tl-date">${formatDate(m.event_date)}<span class="tl-cat">${esc(m.category)}</span></div>
        <div class="tl-title">${esc(m.title)}</div>
        ${m.detail ? `<div class="tl-detail">${esc(m.detail)}</div>` : ''}
      </div>`;
    }).join('');

    // 评分
    const maxScore = Math.max(...g.ratings.map(r => Number(r.score) || 0), 1);
    const ratings = g.ratings.length ? `<div class="rating-list">${g.ratings.map(r => `
      <div class="rating-row">
        <span class="rating-plat">${esc(r.platform)}</span>
        <div class="rating-track"><div class="rating-fill" style="width:${((r.score / maxScore) * 100).toFixed(0)}%"></div></div>
        <span class="rating-score">${r.score != null ? Number(r.score).toFixed(1) : '—'}</span>
        ${r.note ? `<div class="rating-note">${esc(r.note)}</div>` : ''}
      </div>`).join('')}</div>` : '<p class="card-tagline">暂无评分数据（尚未公测）</p>';

    // 收入
    const revs = g.revenues.length ? g.revenues.map(r => `
      <div class="revenue-item">
        <div><div class="rev-period">${esc(r.period)}</div><div class="rev-meta">${esc(r.scope || '')} · ${esc(r.source || '')}</div></div>
        <div class="rev-amount">${r.amount_cny != null ? '¥ ' + (r.amount_cny / 100000000).toFixed(2) + ' 亿' : '—'}</div>
      </div>`).join('') : '<p class="card-tagline">尚未上线，暂无收入数据</p>';

    // 热度构成
    const legend = [
      ['口碑 (28%)', b.rating_score], ['关注 (29%)', b.buzz_score],
      ['商业 (30%)', b.revenue_score], ['势能 (13%)', b.momentum_score],
    ].map(([k, v]) => `<div class="radar-legend-row"><span>${k}</span><span>${Number(v).toFixed(1)}</span></div>`).join('');
    const scaleHint = (b.scale_metric && b.scale_value)
      ? `<div class="heat-scale-hint">关注度基于<b>${esc(b.scale_label || '')}</b> ${fmtNum(b.scale_value)} 计算</div>`
      : '';
    const radar = heat ? `<div class="radar-wrap">
        ${radarSvg(b)}
        <div class="radar-legend">
          <div style="margin-bottom:6px"><div class="heat-total-big">${Number(heat.heat).toFixed(1)}</div><span style="font-size:12px;color:var(--text-3)">综合热度 / 100</span></div>
          ${legend}
          ${scaleHint}
        </div>
      </div>` : '<p class="card-tagline">暂无热度数据</p>';

    // 基本信息（用户规模指标按状态切换：已上线看下载量，未上线看预约量）
    const sc = scaleOf(g);
    const kv = [
      ['开发团队', g.developer],
      ['国内发行', g.publisher_cn],
      ['海外发行', g.publisher_global],
      ['上线平台', g.platform],
      ['游戏引擎', g.engine],
      ['上线日期', formatDate(g.launch_date)],
      [sc.label, sc.value ? fmtNum(sc.value) : '—'],
    ].filter(([, v]) => v).map(([k, v]) => `<div class="kv-k">${k}</div><div class="kv-v">${esc(v)}</div>`).join('');
    const scaleNote = sc.note ? `<div class="kv-note"><span class="kv-note-tag">统计口径</span>${esc(sc.note)}</div>` : '';

    const sources = (g.source_urls || []).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join('');

    // 近期热点新闻（后端已按发布时间倒序：最新在前）
    const news = (g.news || []).length ? `<div class="news-list">${g.news.map(n => `
      <a class="news-item" href="${esc(n.url)}" target="_blank" rel="noopener">
        <div class="news-main">
          <div class="news-title">${esc(n.title)}</div>
          ${n.summary ? `<div class="news-summary">${esc(n.summary)}</div>` : ''}
          <div class="news-meta">
            ${n.published_at ? `<span class="news-date">${esc(n.published_at)}</span>` : ''}
            ${n.source ? `<span class="news-source">${esc(n.source)}</span>` : ''}
          </div>
        </div>
        <span class="news-arrow" aria-hidden="true">→</span>
      </a>`).join('')}</div>` : '<p class="card-tagline">暂无近期新闻数据</p>';

    return `
      <button class="drawer-close" aria-label="关闭">×</button>
      <img class="d-cover" src="${esc(g.cover_url)}" alt="${esc(g.name)} 宣传图"
           onerror="this.style.background='${g.cover_color || '#6C7A89'}'">
      <div class="d-head">
        <h2 class="d-title">${esc(g.name)}</h2>
        <div class="d-en">${esc(g.name_en || '')}</div>
        <div class="d-tags">
          <span class="pill ${g.status === 'released' ? '' : g.status === 'terminated' || g.status === 'terminating' ? 'dead' : 'hot'}">${STATUS_LABEL[g.status] || g.status}</span>
          ${(g.genre || '').split(',').filter(Boolean).map(t => `<span class="pill">${esc(t)}</span>`).join('')}
        </div>
      </div>
      ${isStoppedDetail ? '' : `
      <div class="d-section">
        <h3>热度分析</h3>
        ${radar}
      </div>`}
      <div class="d-section">
        <h3>基本信息</h3>
        <div class="kv-grid">${kv}</div>
        ${scaleNote}
      </div>
      <div class="d-section">
        <h3>游戏简介</h3>
        <p class="d-desc">${esc(g.description || g.tagline || '')}</p>
      </div>
      <div class="d-section">
        <h3>关键节点</h3>
        <div class="timeline">${tl || '<p class="card-tagline">暂无节点数据</p>'}</div>
      </div>
      <div class="d-section">
        <h3>平台评分</h3>
        ${ratings}
      </div>
      <div class="d-section">
        <h3>收入情况</h3>
        ${revs}
        ${g.revenue_note ? `<p class="rev-meta" style="margin-top:10px">${esc(g.revenue_note)}</p>` : ''}
      </div>
      <div class="d-section">
        <h3>近期热点新闻</h3>
        ${news}
      </div>
      ${sources ? `<div class="d-section"><h3>数据来源</h3><div class="source-list">${sources}</div></div>` : ''}
      ${g.data_as_of ? `<div class="d-section" style="background:transparent"><p class="rev-meta">数据采集日期：${g.data_as_of}</p></div>` : ''}
    `;
  }

  /* ================= 对比功能 ================= */
  const CMP_COLORS = ['#9b8bff', '#4dd4f0'];  // A 紫 / B 青

  function toggleCompare(slug) {
    const i = state.compare.indexOf(slug);
    if (i >= 0) {
      state.compare.splice(i, 1);
    } else {
      if (state.compare.length >= 2) {
        // 已满：替换第二款，给出轻提示
        state.compare[1] = slug;
      } else {
        state.compare.push(slug);
      }
    }
    renderCards(state.games);  // 刷新卡片按钮状态
    renderCompareTray();
  }

  function findGame(slug) {
    return state.games.find(g => g.slug === slug) || null;
  }

  function renderCompareTray() {
    const tray = $('#compareTray');
    tray.hidden = state.compare.length === 0;
    // 浮栏出现时给页面留出空间，避免遮挡底部内容
    document.body.classList.toggle('has-compare-tray', state.compare.length > 0);
    [0, 1].forEach(i => {
      const slot = $('#compareSlot' + i);
      const slug = state.compare[i];
      const g = slug ? findGame(slug) : null;
      if (g) {
        slot.className = 'compare-slot filled';
        slot.innerHTML = `
          <img src="${esc(g.cover_url)}" alt="" onerror="this.style.display='none'">
          <span class="slot-name">${esc(g.name)}</span>
          <button class="slot-remove" data-slot="${i}" aria-label="移除">×</button>`;
      } else {
        slot.className = 'compare-slot';
        slot.innerHTML = '<span class="slot-placeholder">选择游戏 ' + (i === 0 ? 'A' : 'B') + '</span>';
      }
      slot.querySelectorAll('.slot-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          state.compare.splice(Number(btn.dataset.slot), 1);
          renderCards(state.games);
          renderCompareTray();
        });
      });
    });
    $('#compareGo').disabled = state.compare.length < 2;
  }

  // 生成双色对比条：返回一行 HTML，valueA/valueB 为数值，formatter 格式化展示
  // subs: 每侧可选的口径小标签，如 ['下载', '预约']
  function cmpBarRow(label, a, b, fmt, higherIsBetter = true, subs = null) {
    const va = Number(a) || 0, vb = Number(b) || 0;
    const max = Math.max(va, vb, 0.0001);
    const aWin = higherIsBetter ? va > vb : va < vb;
    const bWin = higherIsBetter ? vb > va : vb < va;
    const wA = (va / max * 100).toFixed(1), wB = (vb / max * 100).toFixed(1);
    const subA = subs && subs[0] ? `<span class="cmp-bar-sub">${esc(subs[0])}</span>` : '';
    const subB = subs && subs[1] ? `<span class="cmp-bar-sub">${esc(subs[1])}</span>` : '';
    return `<div class="cmp-row">
      <div class="cmp-row-label">${label}</div>
      <div class="cmp-bar-group">
        <div class="cmp-bar-side left ${aWin && va !== vb ? 'win' : ''}">
          <span class="cmp-bar-val">${fmt(va, a)}${subA}</span>
          <div class="cmp-bar-track"><div class="cmp-bar-fill" style="width:${wA}%;background:${CMP_COLORS[0]}"></div></div>
        </div>
        <div class="cmp-bar-side right ${bWin && va !== vb ? 'win' : ''}">
          <div class="cmp-bar-track"><div class="cmp-bar-fill" style="width:${wB}%;background:${CMP_COLORS[1]}"></div></div>
          <span class="cmp-bar-val">${fmt(vb, b)}${subB}</span>
        </div>
      </div>
    </div>`;
  }

  // 双雷达叠加图
  function dualRadarSvg(ba, bb) {
    const dims = [['口碑','rating_score'],['关注','buzz_score'],['商业','revenue_score'],['势能','momentum_score']];
    const cx = 100, cy = 100, R = 72;
    const angle = (i) => (Math.PI * 2 * i) / dims.length - Math.PI / 2;
    const pt = (i, r) => `${(cx + Math.cos(angle(i)) * r).toFixed(1)},${(cy + Math.sin(angle(i)) * r).toFixed(1)}`;
    let grid = '';
    [0.25, 0.5, 0.75, 1].forEach(f => {
      grid += `<polygon points="${dims.map((_, i) => pt(i, R * f)).join(' ')}" fill="none" stroke="#333c5c" stroke-width="1"/>`;
    });
    dims.forEach((_, i) => { grid += `<line x1="${cx}" y1="${cy}" x2="${pt(i, R).split(',')[0]}" y2="${pt(i, R).split(',')[1]}" stroke="#333c5c" stroke-width="1"/>`; });
    const poly = (b, color) => {
      const pts = dims.map((d, i) => pt(i, R * Math.max(0.03, (b[d[1]] || 0) / 100))).join(' ');
      return `<polygon points="${pts}" fill="${color}" fill-opacity=".16" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` +
        dims.map((d, i) => { const [x,y] = pt(i, R * Math.max(0.03, (b[d[1]] || 0)/100)).split(','); return `<circle cx="${x}" cy="${y}" r="2.6" fill="${color}"/>`; }).join('');
    };
    const labels = dims.map((d, i) => {
      const x = cx + Math.cos(angle(i)) * (R + 16);
      const y = cy + Math.sin(angle(i)) * (R + 16) + 4;
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="#8b94b5">${d[0]}</text>`;
    }).join('');
    return `<svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="热度构成对比雷达图">
      ${grid}${poly(ba, CMP_COLORS[0])}${poly(bb, CMP_COLORS[1])}${labels}</svg>`;
  }

  const fmtRating = (v) => (v > 0 ? Number(v).toFixed(1) : '—');
  const fmtReserve = (v) => (v > 0 ? fmtNum(v) : '—');
  const fmtMoney = (v) => (v > 0 ? '¥' + (v / 100000000).toFixed(2) + '亿' : '—');

  function revenueMax(g) {
    if (!g.revenues || !g.revenues.length) return 0;
    return Math.max(...g.revenues.map(r => Number(r.amount_cny) || 0), 0);
  }

  function buildCompareHtml(ga, gb) {
    const ba = ga.heat ? ga.heat.breakdown : { rating_score:0, buzz_score:0, revenue_score:0, momentum_score:0 };
    const bb = gb.heat ? gb.heat.breakdown : { rating_score:0, buzz_score:0, revenue_score:0, momentum_score:0 };
    const statusLabel = (g) => STATUS_LABEL[g.status] || g.status;
    const anyStopped = ga.status === 'terminated' || ga.status === 'terminating' ||
                       gb.status === 'terminated' || gb.status === 'terminating';

    // 头部双封面
    const heads = [ga, gb].map((g, i) => `
      <div class="cmp-head-card">
        <div class="cmp-head-cover" style="background:${g.cover_color || '#6C7A89'}">
          <img src="${esc(g.cover_url)}" alt="${esc(g.name)}" onerror="this.style.display='none'">
          <span class="cmp-head-badge" style="background:${CMP_COLORS[i]}">${i === 0 ? 'A' : 'B'}</span>
        </div>
        <div class="cmp-head-info">
          <div class="cmp-head-name">${esc(g.name)}</div>
          <div class="cmp-head-en">${esc(g.name_en || '')}</div>
          <span class="cmp-head-status">${statusLabel(g)}</span>
        </div>
      </div>`).join('');

    // 核心指标对比条
    const sa = scaleOf(ga), sb = scaleOf(gb);
    const bars = [
      anyStopped ? '' : cmpBarRow('综合热度', ga.heat?.heat, gb.heat?.heat, v => v > 0 ? Number(v).toFixed(1) : '—'),
      cmpBarRow('平均评分', ga.avg_rating, gb.avg_rating, fmtRating),
      cmpBarRow('用户规模', sa.value, sb.value, fmtReserve, true, [sa.short, sb.short]),
      cmpBarRow('已披露流水', revenueMax(ga), revenueMax(gb), fmtMoney),
      anyStopped ? '' : cmpBarRow('口碑分', ba.rating_score, bb.rating_score, v => Number(v).toFixed(1)),
      anyStopped ? '' : cmpBarRow('关注度分', ba.buzz_score, bb.buzz_score, v => Number(v).toFixed(1), true,
        [ba.scale_label || '', bb.scale_label || '']),
      anyStopped ? '' : cmpBarRow('商业分', ba.revenue_score, bb.revenue_score, v => Number(v).toFixed(1)),
      anyStopped ? '' : cmpBarRow('时间势能分', ba.momentum_score, bb.momentum_score, v => Number(v).toFixed(1)),
    ].join('');

    // 基本信息对照表
    const infoRows = [
      ['开发团队', ga.developer, gb.developer],
      ['国内发行', ga.publisher_cn, gb.publisher_cn],
      ['海外发行', ga.publisher_global, gb.publisher_global],
      ['上线平台', ga.platform, gb.platform],
      ['游戏引擎', ga.engine, gb.engine],
      ['上线日期', formatDate(ga.launch_date), formatDate(gb.launch_date)],
      ['游戏类型', ga.genre, gb.genre],
      ['运行状态', statusLabel(ga), statusLabel(gb)],
      ['用户规模', `${sa.label} ${sa.value ? fmtNum(sa.value) : '—'}`,
                   `${sb.label} ${sb.value ? fmtNum(sb.value) : '—'}`],
    ].filter(([, a, b]) => a || b).map(([k, a, b]) => `
      <div class="cmp-info-row">
        <div class="cmp-info-a">${esc(a || '—')}</div>
        <div class="cmp-info-k">${k}</div>
        <div class="cmp-info-b">${esc(b || '—')}</div>
      </div>`).join('');

    // 平台评分对照（合并平台名）
    const platMap = {};
    ga.ratings.forEach(r => { platMap[r.platform] = platMap[r.platform] || {}; platMap[r.platform].a = r.score; });
    gb.ratings.forEach(r => { platMap[r.platform] = platMap[r.platform] || {}; platMap[r.platform].b = r.score; });
    const ratingRows = Object.keys(platMap).map(p => {
      const { a, b } = platMap[p];
      return `<div class="cmp-plat-row">
        <span class="cmp-plat-a ${a > b ? 'win' : ''}">${a != null ? Number(a).toFixed(1) : '—'}</span>
        <span class="cmp-plat-name">${esc(p)}</span>
        <span class="cmp-plat-b ${b > a ? 'win' : ''}">${b != null ? Number(b).toFixed(1) : '—'}</span>
      </div>`;
    }).join('');
    const ratingBlock = ratingRows
      ? `<div class="cmp-plat-list">${ratingRows}</div>`
      : '<p class="card-tagline">暂无可比对的平台评分</p>';

    // 关键节点对照（双列时间线）
    const msA = (ga.milestones || []).map(m => `<div class="cmp-ms ${m.category === '上线' ? 'cat-launch' : ''}"><span class="cmp-ms-date">${formatDate(m.event_date)}</span><span class="cmp-ms-title">${esc(m.title)}</span></div>`).join('') || '<div class="cmp-ms-empty">暂无节点</div>';
    const msB = (gb.milestones || []).map(m => `<div class="cmp-ms ${m.category === '上线' ? 'cat-launch' : ''}"><span class="cmp-ms-date">${formatDate(m.event_date)}</span><span class="cmp-ms-title">${esc(m.title)}</span></div>`).join('') || '<div class="cmp-ms-empty">暂无节点</div>';

    const legend = `<div class="cmp-legend">
      <span><i style="background:${CMP_COLORS[0]}"></i>${esc(ga.name)}</span>
      <span><i style="background:${CMP_COLORS[1]}"></i>${esc(gb.name)}</span>
    </div>`;

    return `
      <div class="cmp-heads">
        <div class="cmp-vs-mark">VS</div>
        ${heads}
      </div>
      ${legend}

      ${anyStopped ? '' : `
      <div class="cmp-panel">
        <h3 class="cmp-panel-title">热度构成对照<span class="section-en">HEAT PROFILE</span></h3>
        <div class="cmp-radar-wrap">
          ${dualRadarSvg(ba, bb)}
          <div class="cmp-radar-note">
            <div class="cmp-score-pair"><span style="color:${CMP_COLORS[0]}">${Number(ga.heat?.heat || 0).toFixed(1)}</span><em>综合热度</em><span style="color:${CMP_COLORS[1]}">${Number(gb.heat?.heat || 0).toFixed(1)}</span></div>
            <p>雷达图叠加展示四维得分：口碑、关注、商业、势能。数值越高，该维度表现越强。</p>
          </div>
        </div>
      </div>`}

      <div class="cmp-panel">
        <h3 class="cmp-panel-title">核心指标对照<span class="section-en">KEY METRICS</span></h3>
        <div class="cmp-bars">${bars}</div>
      </div>

      <div class="cmp-panel">
        <h3 class="cmp-panel-title">基本信息对照<span class="section-en">PROFILE</span></h3>
        <div class="cmp-info-table">${infoRows}</div>
      </div>

      <div class="cmp-panel">
        <h3 class="cmp-panel-title">平台评分对照<span class="section-en">RATINGS</span></h3>
        ${ratingBlock}
      </div>

      <div class="cmp-panel">
        <h3 class="cmp-panel-title">关键节点对照<span class="section-en">TIMELINE</span></h3>
        <div class="cmp-timeline-grid">
          <div class="cmp-tl-col"><div class="cmp-tl-head" style="color:${CMP_COLORS[0]}">${esc(ga.name)}</div>${msA}</div>
          <div class="cmp-tl-col"><div class="cmp-tl-head" style="color:${CMP_COLORS[1]}">${esc(gb.name)}</div>${msB}</div>
        </div>
      </div>

      <p class="cmp-footnote">注：评分口径与采集时点因平台而异，流水为第三方估算，仅供趋势参考。</p>
    `;
  }

  async function openCompare() {
    if (state.compare.length < 2) return;
    const ga = findGame(state.compare[0]);
    const gb = findGame(state.compare[1]);
    if (!ga || !gb) return;
    const modal = $('#compareModal');
    const body = $('#compareBody');
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    body.innerHTML = '<div style="padding:60px;text-align:center;color:var(--text-3)">加载详细数据…</div>';
    try {
      // 拉取两款详情补全评分/时间线，失败则退回列表数据
      const [da, db] = await Promise.all([
        getGameDetail(ga.slug).catch(() => null),
        getGameDetail(gb.slug).catch(() => null),
      ]);
      const fullA = Object.assign({}, ga, da || {});
      const fullB = Object.assign({}, gb, db || {});
      body.innerHTML = buildCompareHtml(fullA, fullB);
      $('#compareModal').scrollTop = 0;
    } catch (e) {
      body.innerHTML = `<div style="padding:60px;text-align:center;color:var(--hot)">加载失败：${esc(e.message)}</div>`;
    }
  }
  function closeCompare() {
    $('#compareModal').hidden = true;
    document.body.style.overflow = '';
  }

  /* ---------- 加载列表 ---------- */
  async function load() {
    const params = new URLSearchParams({ status: state.status, sort: state.sort });
    if (state.search) params.set('search', state.search);
    try {
      let data;
      if (API_MODE === 'static') {
        await staticGames();
        data = staticQuery(state.status, state.search, state.sort);
      } else {
        data = await api('/api/games?' + params.toString());
      }
      state.games = data.items;
      state.stats = data.stats;
      renderStats(data.stats);
      renderCards(data.items);
      // 已停运 tab 无热度、无排行，隐藏右侧热度排行栏
      const rankSection = document.querySelector('.rank-section');
      if (rankSection) rankSection.hidden = state.status === 'terminated';
      renderRank(data.items);
      // 加载右侧栏「热点消息」（与列表筛选无关，始终取全站最新）
      loadHotNews();
      // 构建星球环绕背景数据（始终取全部已上线游戏，与 tab 无关）
      buildPlanetData();
      preloadCovers(planet.data);
    } catch (e) {
      $('#gameGrid').innerHTML = `<div class="empty-state">加载失败：${esc(e.message)}<br>请确认服务已启动</div>`;
    }
  }

  /* ================= 星球环绕动态背景 ================= */
  const planet = {
    canvas: null, ctx: null,
    images: {},       // slug -> Image
    loaded: {},       // slug -> boolean
    data: [],         // 已上线游戏按热度降序
    raf: null,
    t: 0,
    dpr: 1,
    w: 0, h: 0,
    hitAreas: [],     // 每帧所有星球的可命中区域 [{px,py,r,game}]
    mouse: { x: -9999, y: -9999 },
  };

  // 把封面图预加载为星球纹理
  function preloadCovers(items) {
    items.forEach(g => {
      if (!g.cover_url || planet.loaded[g.slug]) return;
      planet.loaded[g.slug] = true;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { planet.images[g.slug] = img; };
      img.onerror = () => { delete planet.images[g.slug]; };
      img.src = g.cover_url;
    });
  }

  // 生成星球颜色（无封面时兜底，带柔和渐变）
  function planetPalette(hex, i) {
    try {
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return { base: hex, light: `rgba(${r},${g},${b},.35)` };
      }
    } catch (_) {}
    const palette = ['#7c6cf0', '#ff7fac', '#4dd4f0', '#34d399', '#fbbf24', '#9b8bff', '#ff5d78', '#38bdf8'];
    const c = palette[i % palette.length];
    return { base: c, light: 'rgba(255,255,255,.12)' };
  }

  // 按热度取「已上线」游戏，降序排列；热度最高为中心主星
  function buildPlanetData() {
    const released = state.games
      .filter(g => g.status === 'released' && (g.heat != null))
      .sort((a, b) => (b.heat || 0) - (a.heat || 0));
    planet.data = released;
    preloadCovers(released);
  }

  function resizeCanvas() {
    const c = planet.canvas;
    planet.dpr = Math.min(window.devicePixelRatio || 1, 2);
    planet.w = window.innerWidth;
    planet.h = window.innerHeight;
    c.width = planet.w * planet.dpr;
    c.height = planet.h * planet.dpr;
    c.style.width = planet.w + 'px';
    c.style.height = planet.h + 'px';
    planet.ctx.setTransform(planet.dpr, 0, 0, planet.dpr, 0, 0);
  }

  function drawPlanet(px, py, r, img, color, glow) {
    const ctx = planet.ctx;
    // 外发光（适度光晕，避免相邻球体视觉粘连拥挤）
    const g = ctx.createRadialGradient(px, py, r * 0.5, px, py, r * 1.8);
    g.addColorStop(0, glow || 'rgba(155,139,255,.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r * 1.8, 0, Math.PI * 2);
    ctx.fill();

    // 星球本体：有封面用封面，否则用渐变色
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.clip();
    const side = r * 2;
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, px - r, py - r, side, side);
    } else {
      const bg = ctx.createRadialGradient(px - r * 0.35, py - r * 0.35, r * 0.1, px, py, r);
      bg.addColorStop(0, color.light);
      bg.addColorStop(1, color.base);
      ctx.fillStyle = bg;
      ctx.fillRect(px - r, py - r, side, side);
    }
    // —— 3D 球体光照：光源固定在左上角 ——
    // 1) 主体明暗：线性渐变从左上(亮)到右下(暗)，强化球面受光方向
    const dir = ctx.createLinearGradient(px - r, py - r, px + r * 0.9, py + r * 0.9);
    dir.addColorStop(0, 'rgba(255,255,255,.28)');
    dir.addColorStop(0.4, 'rgba(255,255,255,0)');
    dir.addColorStop(0.72, 'rgba(2,4,12,.45)');
    dir.addColorStop(1, 'rgba(1,2,8,.8)');
    ctx.fillStyle = dir;
    ctx.fillRect(px - r, py - r, side, side);
    // 2) 背光暗面：径向渐变中心偏移到右下，模拟球体背对光源的暗部（明显压暗）
    const dark = ctx.createRadialGradient(px - r * 0.2, py - r * 0.2, r * 0.2, px + r * 0.5, py + r * 0.5, r * 1.7);
    dark.addColorStop(0, 'rgba(0,0,0,0)');
    dark.addColorStop(0.45, 'rgba(3,5,16,.25)');
    dark.addColorStop(0.75, 'rgba(2,3,10,.62)');
    dark.addColorStop(1, 'rgba(1,2,6,.92)');
    ctx.fillStyle = dark;
    ctx.fillRect(px - r, py - r, side, side);
    // 3) 球面暗角：边缘压暗、中心保持亮，让圆形贴图"鼓"起来成球体
    const vig = ctx.createRadialGradient(px - r * 0.15, py - r * 0.15, r * 0.45, px, py, r);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(0.75, 'rgba(2,4,12,.15)');
    vig.addColorStop(1, 'rgba(2,4,12,.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(px - r, py - r, side, side);
    ctx.restore();

    // 星球描边（沿光照方向的渐变描边：左上亮边、右下暗边）
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    const edge = ctx.createLinearGradient(px - r, py - r, px + r, py + r);
    edge.addColorStop(0, 'rgba(255,255,255,.75)');
    edge.addColorStop(0.5, 'rgba(255,255,255,.18)');
    edge.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // 镜面高光点（斜向小椭圆，模拟球面镜面反光，强化立体感）
    const hx = px - r * 0.34, hy = py - r * 0.40;
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.clip();
    const spec = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.5);
    spec.addColorStop(0, 'rgba(255,255,255,.92)');
    spec.addColorStop(0.3, 'rgba(255,255,255,.34)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.ellipse(hx, hy, r * 0.34, r * 0.22, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function renderPlanets() {
    const ctx = planet.ctx;
    planet.raf = requestAnimationFrame(renderPlanets);  // 始终持续循环
    if (!ctx) return;
    ctx.clearRect(0, 0, planet.w, planet.h);

    const items = planet.data;
    if (!items.length) return;

    const cx = planet.w / 2;
    const cy = planet.h * 0.50;   // 透视投影中心
    planet.t += 0.0016;

    // 每帧重建命中区域（供鼠标悬停检测）
    planet.hitAreas = [];

    // 主星（热度最高）放中心，尺寸最大
    const center = items[0];
    const maxHeat = center.heat || 1;
    const centerR = Math.min(planet.w, planet.h) * 0.14;
    const centerImg = planet.images[center.slug];
    const centerColor = planetPalette(center.cover_color, 0);

    // 环绕星球
    const others = items.slice(1);
    const count = others.length;
    if (count) {
      const maxOrbit = Math.min(planet.w, planet.h) * 0.58;
      const minOrbit = centerR + Math.min(planet.w, planet.h) * 0.16;
      // —— 斜视透视视角：轨道平面绕 X 轴倾斜（椭圆更扁 = 明显斜着看）——
      const tiltX = 1.05;          // 约 60°，椭圆垂直半径明显压缩，斜视感强
      const cosTX = Math.cos(tiltX), sinTX = Math.sin(tiltX);
      // 透视参数：d0 为"眼睛"到轨道平面的距离，越大透视越弱、越小透视越强
      const d0 = maxOrbit * 1.35;

      // 预计算每个星球的轨道参数（含独立随机速度）
      const orbitParams = others.map((g, i) => {
        const heatRatio = (g.heat || 0) / maxHeat;
        const rankFrac = i / Math.max(count - 1, 1);
        // 稳定散列：同一游戏每次刷新得到相同的"随机"值
        const jitter = ((i * 2654435761) % 97) / 97;
        const jitter2 = ((i * 40503 + 17) % 89) / 89;
        // 轨道半径：热度越高越靠内，按排名在 [minOrbit, maxOrbit] 全区间均匀拉开，
        // 去掉抖动，让轨道间距均匀、更宽
        const orbit = minOrbit + (maxOrbit - minOrbit) * rankFrac;
        // 独立随机角速度：0.3 ~ 1.5 之间，速度差异大；内圈快外圈慢（开普勒式），
        // 差异足够大能让球体在各自轨道上快速错开、减少长时间堆叠
        const speed = 0.3 + jitter2 * 1.2 - rankFrac * 0.2;
        // 初始相位：黄金角度分布 + 稳定散列抖动，让球体在轨道上尽量错开不堆叠
        const phase = (i * 2.39996323) + jitter * 1.5;
        return { orbit, speed, phase, heatRatio };
      });

      // —— 画家算法：先画轨道线，再按深度（z 远→近）排序绘制所有球体 ——
      // 1) 所有轨道线（最底层）：用透视投影逐点采样，与球体轨迹完全吻合且平滑
      others.forEach((g, i) => {
        const op = orbitParams[i];
        ctx.save();
        ctx.strokeStyle = 'rgba(155,139,255,.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const SEG = 160;
        for (let k = 0; k <= SEG; k++) {
          const a = (k / SEG) * Math.PI * 2;
          // 世界坐标（轨道圆上一点）
          const ox = Math.cos(a) * op.orbit;
          const oy = Math.sin(a) * op.orbit;
          // 深度（朝向观察者为正）：绕 X 轴倾斜后，oy 投影到纵深方向
          const z = oy * sinTX;
          // 标准透视投影：近端（z 大）放大、远端（z 小）缩小
          const s = d0 / (d0 - z);
          const sx = cx + ox * s;
          const sy = cy + oy * cosTX * s;
          if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      });

      // 2) 收集所有球体（主星 + 环绕球），附上深度值，统一排序
      const drawables = [];
      // 主星：深度 zRot = 0（轨道平面中心）
      drawables.push({
        z: 0,
        px: cx, py: cy, r: centerR,
        img: centerImg, color: centerColor,
        glow: 'rgba(155,139,255,.4)',
        game: center, isCenter: true,
      });

      others.forEach((g, i) => {
        const op = orbitParams[i];
        const heatRatio = op.heatRatio;
        const baseR = centerR * (0.09 + heatRatio * 0.23);
        const ang = planet.t * op.speed + op.phase;

        const ox = Math.cos(ang) * op.orbit;
        const oy = Math.sin(ang) * op.orbit;
        // 深度（朝向观察者为正）：绕 X 轴倾斜后 oy 投影到纵深方向
        const depth = oy * sinTX;
        // 标准透视投影：近端（屏幕下方，depth 大）放大、远端（上方，depth 小）缩小
        const s = d0 / (d0 - depth);
        const px = cx + ox * s;
        const py = cy + oy * cosTX * s;

        // 球体尺寸随透视缩放（近大远小）
        const r = baseR * s;

        const img = planet.images[g.slug];
        const color = planetPalette(g.cover_color, i + 1);
        // 光晕强度随深度变化：近端亮、远端弱
        const glowAlpha = 0.16 + (depth / (maxOrbit * sinTX)) * 0.30;

        drawables.push({
          z: depth,
          px, py, r,
          img, color,
          glow: `rgba(155,139,255,${Math.max(0.10, Math.min(0.5, glowAlpha))})`,
          game: g, isCenter: false,
        });
      });

      // 3) 按深度从小到大（远→近）排序后绘制，实现正确遮挡：
      //    绕到主星后方（zRot<0）的球体先画、被主星遮住；前方（zRot>0）的后画、盖住主星
      drawables.sort((a, b) => a.z - b.z);
      drawables.forEach((d) => {
        drawPlanet(d.px, d.py, d.r, d.img, d.color, d.glow);
        planet.hitAreas.push({ px: d.px, py: d.py, r: d.r, game: d.game });
      });
    } else {
      // 无环绕球时，仅绘制主星
      drawPlanet(cx, cy, centerR, centerImg, centerColor, 'rgba(155,139,255,.4)');
      planet.hitAreas.push({ px: cx, py: cy, r: centerR, game: center });
    }

    // 中心主星标签（绘制在最上层，始终可见）
    if (center.name) {
      ctx.save();
      ctx.fillStyle = 'rgba(238,241,251,.9)';
      ctx.font = '600 13px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(center.name, cx, cy + centerR + 22);
      ctx.fillStyle = 'rgba(162,170,198,.75)';
      ctx.font = '11px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('热度 ' + Number(center.heat).toFixed(1), cx, cy + centerR + 38);
      ctx.restore();
    }
  }

  function startPlanets() {
    if (!planet.canvas) planet.canvas = $('#planet-bg');
    if (!planet.canvas) return;
    planet.ctx = planet.canvas.getContext('2d');
    buildPlanetData();
    resizeCanvas();
    // 绑定鼠标悬停检测（仅一次）——监听 document，因为 canvas 在内容层之下
    if (!planet.boundEvents) {
      planet.boundEvents = true;
      document.addEventListener('mousemove', updateTooltip);
    }
    if (planet.raf) cancelAnimationFrame(planet.raf);
    renderPlanets();
  }

  /* ---------- 星球悬停提示 ---------- */
  function updateTooltip(e) {
    const canvas = planet.canvas;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    planet.mouse = { x: mx, y: my };

    // 从最近的命中区域里找悬停的星球（取半径最大者优先，避免重叠歧义）
    let hovered = null;
    for (const h of planet.hitAreas) {
      const dx = mx - h.px, dy = my - h.py;
      if (dx * dx + dy * dy <= (h.r + 3) * (h.r + 3)) {
        if (!hovered || h.r > hovered.r) hovered = h;
      }
    }

    const tip = $('#planetTooltip');
    if (hovered) {
      const g = hovered.game;
      tip.innerHTML = `
        <div class="pt-name">${esc(g.name)}</div>
        <div class="pt-sub">${esc(g.name_en || g.developer || '')}</div>
        <div class="pt-meta">热度 <b>${Number(g.heat || 0).toFixed(1)}</b> · 排名 #${g.heat_rank || '-'}</div>`;
      tip.hidden = false;
      // 定位在鼠标右上，避免遮挡；越界时翻转
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let tx = e.clientX + 16, ty = e.clientY - th - 12;
      if (tx + tw > window.innerWidth - 8) tx = e.clientX - tw - 16;
      if (ty < 8) ty = e.clientY + 20;
      tip.style.left = tx + 'px';
      tip.style.top = ty + 'px';
    } else {
      tip.hidden = true;
    }
  }

  /* ================= 隐藏/显示切换 ================= */
  function toggleHide() {
    const hidden = document.body.classList.toggle('planet-focus');
    const btn = $('#hideBtn');
    const label = btn.querySelector('span');
    label.textContent = hidden ? '显示' : '隐藏';
    btn.title = hidden ? '显示全部页面内容' : '隐藏页面内容，仅保留星球环绕';
    btn.setAttribute('aria-label', btn.title);
    // 切换到隐藏态时关闭可能打开浮层
    if (hidden) {
      closeDetail();
      closeCompare();
    }
  }
  $('#hideBtn').addEventListener('click', toggleHide);

  /* ---------- 事件绑定 ---------- */
  $('#statusTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.status = tab.dataset.status;
    load();
  });
  let searchTimer;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = e.target.value.trim(); load(); }, 250);
  });
  $('#sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; load(); });

  /* 对比事件 */
  $('#compareClear').addEventListener('click', () => {
    state.compare = [];
    renderCards(state.games);
    renderCompareTray();
  });
  $('#compareGo').addEventListener('click', openCompare);
  $('#compareModalClose').addEventListener('click', closeCompare);
  $('#compareModal').addEventListener('click', (e) => {
    if (e.target === $('#compareModal')) closeCompare();
  });

  // 先探测后端可用性，再开始加载数据（静态部署环境自动回退 JSON）
  detectMode().then(() => {
    load();
    startPlanets();
  });
  window.addEventListener('resize', resizeCanvas);
})();
