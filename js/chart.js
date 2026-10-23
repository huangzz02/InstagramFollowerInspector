// Store active animation frame request IDs for each element
const activeCounters = new Map();
const legendItemRafs = new Map();

function cancelCounter(el) {
  if (el && activeCounters.has(el)) {
    cancelAnimationFrame(activeCounters.get(el));
    activeCounters.delete(el);
  }
}

function cancelChartCounters() {
  const chartElementIds = [
    'donut-center-total',
    'legend-count-mutuals',
    'legend-pct-mutuals',
    'legend-count-fans-only',
    'legend-pct-fans-only',
    'legend-count-not-back',
    'legend-pct-not-back'
  ];
  chartElementIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) cancelCounter(el);
  });
}

function setLegendItemsVisible(items, visible) {
  items.forEach(item => {
    if (!item) return;

    // Cancel any pending collapse animation frame on rapid switching
    if (legendItemRafs.has(item)) {
      cancelAnimationFrame(legendItemRafs.get(item));
      legendItemRafs.delete(item);
    }

    if (visible) {
      item.classList.remove('legend-leaving');
      item.classList.remove('legend-collapsed');
      return;
    }

    if (item.classList.contains('legend-collapsed')) return;
    item.classList.add('legend-leaving');
    item.getBoundingClientRect(); // Force layout reflow
    const rafId = requestAnimationFrame(() => {
      item.classList.add('legend-collapsed');
      item.classList.remove('legend-leaving');
      legendItemRafs.delete(item);
    });
    legendItemRafs.set(item, rafId);
  });
}

function parseCurrentNumericValue(el) {
  if (!el || !el.textContent) return 0;
  const clean = el.textContent.replace(/[^\d.-]/g, '');
  const num = parseFloat(clean);
  return (!isNaN(num) && isFinite(num)) ? num : 0;
}

// Smooth Ease-out Counter Animation with seamless mid-flight retargeting
function animateCounter(el, targetVal, duration = ANIMATION_SPEED_MS, formatter = (n) => Math.round(n).toLocaleString()) {
  if (!el) return;
  cancelCounter(el);

  const startVal = parseCurrentNumericValue(el);
  if (Math.abs(startVal - targetVal) < 0.001) {
    el.textContent = formatter(targetVal);
    return;
  }

  const startTime = performance.now();
  function tick(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3); // Ease-out cubic
    const current = startVal + (targetVal - startVal) * ease;
    el.textContent = formatter(current);
    if (progress < 1) {
      const id = requestAnimationFrame(tick);
      activeCounters.set(el, id);
    } else {
      el.textContent = formatter(targetVal);
      activeCounters.delete(el);
    }
  }
  const id = requestAnimationFrame(tick);
  activeCounters.set(el, id);
}

// Perspective Mode Controller (四種分析視角：全部資訊 / 三區模式 / 粉絲模式 / 追蹤模式)
function setPerspectiveMode(mode, animate = true) {
  state.perspectiveMode = mode;
  const container = document.getElementById('stats-container');
  if (container) {
    container.className = `stats-container mode-${mode}`;
  }
  const rightCol = document.getElementById('analysis-right-col');
  if (rightCol) {
    rightCol.className = `analysis-right-col mode-${mode}`;
  }
  const tabsContainer = document.getElementById('perspective-tabs');
  if (tabsContainer) {
    tabsContainer.className = `perspective-tabs mode-${mode}`;
  }

  // Update Perspective Tab active state
  document.querySelectorAll('.perspective-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-mode') === mode);
  });

  // If the active card is dimmed in the new mode, reset selection and display prompt
  const isCurrentTabDimmed =
    (mode === 'trio' && (state.currentTab === 'followers' || state.currentTab === 'following')) ||
    (mode === 'followers' && (state.currentTab === 'following' || state.currentTab === 'not-following-back')) ||
    (mode === 'following' && (state.currentTab === 'followers' || state.currentTab === 'fans-not-followed'));

  if (isCurrentTabDimmed) {
    state.currentTab = null;
    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
    if (typeof renderActiveList === 'function') {
      renderActiveList();
    }
  }

  // Update Donut Chart
  updateDonutChart(animate);
}

// Slice geometry state for seamless morph transitions
let currentSliceState = {
  lenMutuals: 0,
  lenFansOnly: 0,
  lenNotBack: 0,
  offsetFansOnly: 0,
  offsetNotBack: 0
};
let activeDonutAnimationId = null;

function resetChartState() {
  if (activeDonutAnimationId) {
    cancelAnimationFrame(activeDonutAnimationId);
    activeDonutAnimationId = null;
  }
  cancelChartCounters();
  legendItemRafs.forEach(id => cancelAnimationFrame(id));
  legendItemRafs.clear();
  currentSliceState = {
    lenMutuals: 0,
    lenFansOnly: 0,
    lenNotBack: 0,
    offsetFansOnly: 0,
    offsetNotBack: 0
  };
}

// Donut Chart & Legend handling across 4 Perspective Modes
function updateDonutChart(animate = false) {
  const mode = state.perspectiveMode || 'all';
  const mutuals = getEffectiveList('mutuals').length;
  const notBack = getEffectiveList('notFollowingBack').length;
  const fansOnly = getEffectiveList('fansNotFollowed').length;
  const totalFollowers = getEffectiveList('followers').length;
  const totalFollowing = getEffectiveList('following').length;

  const totalEl = document.getElementById('donut-center-total');
  const labelEl = document.getElementById('donut-center-label');
  const sliceMutuals = document.getElementById('slice-mutuals');
  const sliceFansOnly = document.getElementById('slice-fans-only');
  const sliceNotBack = document.getElementById('slice-not-back');

  const countMutualsEl = document.getElementById('legend-count-mutuals');
  const pctMutualsEl = document.getElementById('legend-pct-mutuals');
  const countFansOnlyEl = document.getElementById('legend-count-fans-only');
  const pctFansOnlyEl = document.getElementById('legend-pct-fans-only');
  const countNotBackEl = document.getElementById('legend-count-not-back');
  const pctNotBackEl = document.getElementById('legend-pct-not-back');

  const itemMutuals = document.getElementById('legend-item-mutuals');
  const itemFansOnly = document.getElementById('legend-item-fans-only');
  const itemNotBack = document.getElementById('legend-item-not-back');

  const C = 2 * Math.PI * 50; // ~314.159265

  if (activeDonutAnimationId) {
    cancelAnimationFrame(activeDonutAnimationId);
    activeDonutAnimationId = null;
  }
  cancelChartCounters();

  // Target values based on mode
  let targetTotal = 0;
  let targetLabel = '關聯總數';
  let targetM = 0;
  let targetFO = 0;
  let targetNB = 0;
  let targetOffFO = 0;
  let targetOffNB = 0;

  let showCountM = '0', showPctM = '0%';
  let showCountFO = '0', showPctFO = '0%';
  let showCountNB = '0', showPctNB = '0%';

  if (mode === 'all') {
    // Mode 1: 預設（全部資訊，剛匯入時）：圓餅圖無切片，三個小方塊各自獨立收折
    targetLabel = '全域總覽';
    targetTotal = 0;
    targetM = 0;
    targetFO = 0;
    targetNB = 0;
    targetOffFO = 0;
    targetOffNB = 0;

    // 全部模式：三個小方塊各自獨立收折隱藏，絕不透過父容器淡入淡出
    setLegendItemsVisible([itemMutuals, itemFansOnly, itemNotBack], false);

    showCountM = '—'; showPctM = '—';
    showCountFO = '—'; showPctFO = '—';
    showCountNB = '—'; showPctNB = '—';
  } else if (mode === 'trio') {
    // Mode 2: 三區模式（互追、尚未追蹤、對方未回追）
    targetTotal = mutuals + fansOnly + notBack;
    targetLabel = '關聯總數';

    setLegendItemsVisible([itemMutuals, itemFansOnly, itemNotBack], true);

    if (targetTotal > 0) {
      targetM = (mutuals / targetTotal) * C;
      targetFO = (fansOnly / targetTotal) * C;
      targetNB = (notBack / targetTotal) * C;
      targetOffFO = -targetM;
      targetOffNB = -(targetM + targetFO);

      showCountM = mutuals.toLocaleString();
      showPctM = `${((mutuals / targetTotal) * 100).toFixed(1)}%`;
      showCountFO = fansOnly.toLocaleString();
      showPctFO = `${((fansOnly / targetTotal) * 100).toFixed(1)}%`;
      showCountNB = notBack.toLocaleString();
      showPctNB = `${((notBack / targetTotal) * 100).toFixed(1)}%`;
    }
  } else if (mode === 'followers') {
    // Mode 3: 粉絲模式（拆解總粉絲：互追 vs 尚未追蹤）
    targetTotal = totalFollowers;
    targetLabel = '總粉絲結構';

    setLegendItemsVisible([itemMutuals, itemFansOnly], true);
    setLegendItemsVisible([itemNotBack], false);

    if (targetTotal > 0) {
      targetM = (mutuals / targetTotal) * C;
      targetFO = (fansOnly / targetTotal) * C;
      targetNB = 0;
      targetOffFO = -targetM;
      targetOffNB = 0;

      showCountM = mutuals.toLocaleString();
      showPctM = `${((mutuals / targetTotal) * 100).toFixed(1)}%`;
      showCountFO = fansOnly.toLocaleString();
      showPctFO = `${((fansOnly / targetTotal) * 100).toFixed(1)}%`;
    }
  } else if (mode === 'following') {
    // Mode 4: 追蹤模式（拆解追蹤中：互追 vs 對方未回追）
    targetTotal = totalFollowing;
    targetLabel = '追蹤中結構';

    setLegendItemsVisible([itemMutuals, itemNotBack], true);
    setLegendItemsVisible([itemFansOnly], false);

    if (targetTotal > 0) {
      targetM = (mutuals / targetTotal) * C;
      targetNB = (notBack / targetTotal) * C;
      targetFO = 0;
      targetOffFO = 0;
      targetOffNB = -targetM;

      showCountM = mutuals.toLocaleString();
      showPctM = `${((mutuals / targetTotal) * 100).toFixed(1)}%`;
      showCountNB = notBack.toLocaleString();
      showPctNB = `${((notBack / targetTotal) * 100).toFixed(1)}%`;
    }
  }

  if (labelEl) labelEl.textContent = targetLabel;

  if (!animate) {
    if (totalEl) totalEl.textContent = mode === 'all' ? '-' : targetTotal.toLocaleString();
    if (countMutualsEl) countMutualsEl.textContent = showCountM;
    if (pctMutualsEl) pctMutualsEl.textContent = showPctM;
    if (countFansOnlyEl) countFansOnlyEl.textContent = showCountFO;
    if (pctFansOnlyEl) pctFansOnlyEl.textContent = showPctFO;
    if (countNotBackEl) countNotBackEl.textContent = showCountNB;
    if (pctNotBackEl) pctNotBackEl.textContent = showPctNB;

    if (sliceMutuals) {
      sliceMutuals.setAttribute('stroke-dasharray', `${targetM.toFixed(2)} ${(C - targetM).toFixed(2)}`);
      sliceMutuals.setAttribute('stroke-dashoffset', '0');
    }
    if (sliceFansOnly) {
      sliceFansOnly.setAttribute('stroke-dasharray', `${targetFO.toFixed(2)} ${(C - targetFO).toFixed(2)}`);
      sliceFansOnly.setAttribute('stroke-dashoffset', `${targetOffFO.toFixed(2)}`);
    }
    if (sliceNotBack) {
      sliceNotBack.setAttribute('stroke-dasharray', `${targetNB.toFixed(2)} ${(C - targetNB).toFixed(2)}`);
      sliceNotBack.setAttribute('stroke-dashoffset', `${targetOffNB.toFixed(2)}`);
    }

    currentSliceState = {
      lenMutuals: targetM,
      lenFansOnly: targetFO,
      lenNotBack: targetNB,
      offsetFansOnly: targetOffFO,
      offsetNotBack: targetOffNB
    };
    return;
  }

  // Animated mode with smooth ease-out morph
  if (totalEl) {
    if (mode === 'all') {
      totalEl.textContent = '-';
    } else {
      animateCounter(totalEl, targetTotal, ANIMATION_SPEED_MS);
    }
  }

  if (mode === 'all') {
    if (countMutualsEl) countMutualsEl.textContent = '—';
    if (pctMutualsEl) pctMutualsEl.textContent = '—';
    if (countFansOnlyEl) countFansOnlyEl.textContent = '—';
    if (pctFansOnlyEl) pctFansOnlyEl.textContent = '—';
    if (countNotBackEl) countNotBackEl.textContent = '—';
    if (pctNotBackEl) pctNotBackEl.textContent = '—';
  } else {
    if (countMutualsEl) animateCounter(countMutualsEl, mutuals, ANIMATION_SPEED_MS);
    if (pctMutualsEl && showPctM !== '—') animateCounter(pctMutualsEl, parseFloat(showPctM) || 0, ANIMATION_SPEED_MS, n => `${n.toFixed(1)}%`);

    if (countFansOnlyEl) animateCounter(countFansOnlyEl, fansOnly, ANIMATION_SPEED_MS);
    if (pctFansOnlyEl && showPctFO !== '—') animateCounter(pctFansOnlyEl, parseFloat(showPctFO) || 0, ANIMATION_SPEED_MS, n => `${n.toFixed(1)}%`);

    if (countNotBackEl) animateCounter(countNotBackEl, notBack, ANIMATION_SPEED_MS);
    if (pctNotBackEl && showPctNB !== '—') animateCounter(pctNotBackEl, parseFloat(showPctNB) || 0, ANIMATION_SPEED_MS, n => `${n.toFixed(1)}%`);
  }

  const startM = currentSliceState.lenMutuals;
  const startFO = currentSliceState.lenFansOnly;
  const startNB = currentSliceState.lenNotBack;
  const startOffFO = currentSliceState.offsetFansOnly;
  const startOffNB = currentSliceState.offsetNotBack;

  // If already at target within a negligible threshold, avoid spinning redundant rAF
  if (
    Math.abs(targetM - startM) < 0.05 &&
    Math.abs(targetFO - startFO) < 0.05 &&
    Math.abs(targetNB - startNB) < 0.05 &&
    Math.abs(targetOffFO - startOffFO) < 0.05 &&
    Math.abs(targetOffNB - startOffNB) < 0.05
  ) {
    if (sliceMutuals) {
      sliceMutuals.setAttribute('stroke-dasharray', `${Math.max(0, targetM).toFixed(2)} ${Math.max(0, C - targetM).toFixed(2)}`);
      sliceMutuals.setAttribute('stroke-dashoffset', '0');
    }
    if (sliceFansOnly) {
      sliceFansOnly.setAttribute('stroke-dasharray', `${Math.max(0, targetFO).toFixed(2)} ${Math.max(0, C - targetFO).toFixed(2)}`);
      sliceFansOnly.setAttribute('stroke-dashoffset', `${targetOffFO.toFixed(2)}`);
    }
    if (sliceNotBack) {
      sliceNotBack.setAttribute('stroke-dasharray', `${Math.max(0, targetNB).toFixed(2)} ${Math.max(0, C - targetNB).toFixed(2)}`);
      sliceNotBack.setAttribute('stroke-dashoffset', `${targetOffNB.toFixed(2)}`);
    }
    currentSliceState = {
      lenMutuals: targetM,
      lenFansOnly: targetFO,
      lenNotBack: targetNB,
      offsetFansOnly: targetOffFO,
      offsetNotBack: targetOffNB
    };
    return;
  }

  const startTime = performance.now();
  const duration = ANIMATION_SPEED_MS;

  function renderDonutFrame(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3); // Ease-out cubic

    const curM = startM + (targetM - startM) * ease;
    const curFO = startFO + (targetFO - startFO) * ease;
    const curNB = startNB + (targetNB - startNB) * ease;
    const curOffFO = startOffFO + (targetOffFO - startOffFO) * ease;
    const curOffNB = startOffNB + (targetOffNB - startOffNB) * ease;

    if (sliceMutuals) {
      sliceMutuals.setAttribute('stroke-dasharray', `${Math.max(0, curM).toFixed(2)} ${Math.max(0, C - curM).toFixed(2)}`);
      sliceMutuals.setAttribute('stroke-dashoffset', '0');
    }
    if (sliceFansOnly) {
      sliceFansOnly.setAttribute('stroke-dasharray', `${Math.max(0, curFO).toFixed(2)} ${Math.max(0, C - curFO).toFixed(2)}`);
      sliceFansOnly.setAttribute('stroke-dashoffset', `${curOffFO.toFixed(2)}`);
    }
    if (sliceNotBack) {
      sliceNotBack.setAttribute('stroke-dasharray', `${Math.max(0, curNB).toFixed(2)} ${Math.max(0, C - curNB).toFixed(2)}`);
      sliceNotBack.setAttribute('stroke-dashoffset', `${curOffNB.toFixed(2)}`);
    }

    // Keep currentSliceState synchronized every frame so rapid switching seamlessly picks up mid-flight values
    currentSliceState.lenMutuals = curM;
    currentSliceState.lenFansOnly = curFO;
    currentSliceState.lenNotBack = curNB;
    currentSliceState.offsetFansOnly = curOffFO;
    currentSliceState.offsetNotBack = curOffNB;

    if (progress < 1) {
      activeDonutAnimationId = requestAnimationFrame(renderDonutFrame);
    } else {
      activeDonutAnimationId = null;
      currentSliceState = {
        lenMutuals: targetM,
        lenFansOnly: targetFO,
        lenNotBack: targetNB,
        offsetFansOnly: targetOffFO,
        offsetNotBack: targetOffNB
      };
    }
  }

  activeDonutAnimationId = requestAnimationFrame(renderDonutFrame);
}

// Link Legend & Donut Chart hover for subtle, non-button-like visual focus
document.addEventListener('DOMContentLoaded', () => {
  const donutSvg = document.getElementById('donut-svg');
  const chartLegend = document.getElementById('chart-legend');
  const legendMap = [
    { item: 'legend-item-mutuals', slice: 'slice-mutuals' },
    { item: 'legend-item-fans-only', slice: 'slice-fans-only' },
    { item: 'legend-item-not-back', slice: 'slice-not-back' }
  ];

  legendMap.forEach(({ item, slice }) => {
    const itemEl = document.getElementById(item);
    const sliceEl = document.getElementById(slice);
    if (!itemEl || !sliceEl) return;

    const activate = () => {
      if (itemEl.classList.contains('legend-collapsed') || itemEl.classList.contains('legend-leaving')) return;
      sliceEl.classList.add('slice-hover');
      itemEl.classList.add('legend-hover');
      if (donutSvg) donutSvg.classList.add('has-hover-slice');
      if (chartLegend) chartLegend.classList.add('has-hover-item');
    };

    const deactivate = () => {
      sliceEl.classList.remove('slice-hover');
      itemEl.classList.remove('legend-hover');
      if (donutSvg) donutSvg.classList.remove('has-hover-slice');
      if (chartLegend) chartLegend.classList.remove('has-hover-item');
    };

    itemEl.addEventListener('mouseenter', activate);
    itemEl.addEventListener('mouseleave', deactivate);
    sliceEl.addEventListener('mouseenter', activate);
    sliceEl.addEventListener('mouseleave', deactivate);
  });
});
