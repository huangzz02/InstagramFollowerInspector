// Left Navigation - Page Switching (instant, no animation)
function switchPage(page, options = {}) {
  state.currentPage = page;
  document.querySelectorAll('.left-nav-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-page') === page);
  });
  document.querySelectorAll('.page-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `page-${page}`);
  });

  if (['fans-not-followed', 'mutuals', 'not-following-back'].includes(page)) {
    if (typeof renderTriagePage === 'function') {
      renderTriagePage(page);
    }
  }

  if (page === 'analysis' && !options.skipSync) {
    updateStatCardCounters(false);
    updateDonutChart(false);
    renderActiveList();
  }
}

document.querySelectorAll('.left-nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const page = item.getAttribute('data-page');
    if (page) switchPage(page);
  });
});

// Sidebar Collapse Toggle
const btnSidebarToggle = document.getElementById('btn-sidebar-toggle');
const leftNav = document.getElementById('left-nav');
if (btnSidebarToggle && leftNav) {
  btnSidebarToggle.addEventListener('click', () => {
    const isCollapsed = leftNav.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed', isCollapsed);
  });
}

// Important Notice Centered Modal (畫面正中間，背景模糊，簡約極速)
const noticeModal = document.getElementById('notice-modal');
const btnCloseNotice = document.getElementById('btn-close-notice');

function openNoticeModal() {
  if (noticeModal) noticeModal.classList.add('show');
}

function closeNoticeModal() {
  if (noticeModal) noticeModal.classList.remove('show');
}

if (btnCloseNotice) btnCloseNotice.onclick = closeNoticeModal;
if (noticeModal) {
  noticeModal.onclick = (e) => {
    if (e.target === noticeModal) closeNoticeModal();
  };
}

// Bind all "數值錯誤說明" buttons across Analysis & Triage pages
document.querySelectorAll('.btn-warn-notice').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openNoticeModal();
  });
});

// Lightbox for Tutorial Images (點擊圖片放大檢視)
const lightboxModal = document.getElementById('lightbox-modal');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCaption = document.getElementById('lightbox-caption');

function openLightbox(src, alt) {
  if (!lightboxModal || !lightboxImg) return;
  lightboxImg.src = src;
  if (lightboxCaption) lightboxCaption.textContent = alt || '';
  lightboxModal.classList.add('show');
}

function closeLightbox() {
  if (!lightboxModal) return;
  lightboxModal.classList.remove('show');
  if (lightboxImg) lightboxImg.src = '';
}

if (lightboxModal) {
  lightboxModal.onclick = (e) => {
    // 點擊圖片以外之任何空白處或背景皆自動關閉
    if (e.target !== lightboxImg) {
      closeLightbox();
    }
  };
}

// Attach click event to all tutorial image wrappers
document.querySelectorAll('.step-img-wrap').forEach(wrap => {
  wrap.addEventListener('click', () => {
    const img = wrap.querySelector('img');
    if (img) openLightbox(img.src, img.alt);
  });
});

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const btnBrowse = document.getElementById('btn-browse');
const loadingState = document.getElementById('loading-state');
const loadingText = document.getElementById('loading-text');
const resultsSection = document.getElementById('results-section');
const userGrid = document.getElementById('user-grid');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear-btn');

function updateSearchClearBtn() {
  if (!searchClearBtn || !searchInput) return;
  searchClearBtn.style.display = searchInput.value.trim().length > 0 ? 'flex' : 'none';
}

// Guide Modal
const guideModal = document.getElementById('guide-modal');
const btnOpenGuide = document.getElementById('btn-open-guide');
const btnCloseGuide = document.getElementById('btn-close-guide');
const btnCloseGuide2 = document.getElementById('btn-close-guide-2');

btnOpenGuide.onclick = () => guideModal.classList.add('show');
btnCloseGuide.onclick = () => guideModal.classList.remove('show');
btnCloseGuide2.onclick = () => guideModal.classList.remove('show');
guideModal.onclick = (e) => {
  if (e.target === guideModal) guideModal.classList.remove('show');
};

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (lightboxModal && lightboxModal.classList.contains('show')) {
      closeLightbox();
    } else if (guideModal && guideModal.classList.contains('show')) {
      guideModal.classList.remove('show');
    } else if (typeof closeCustomTagModal === 'function' && document.getElementById('custom-tag-modal')?.classList.contains('show')) {
      closeCustomTagModal();
    } else {
      closeNoticeModal();
    }
  }
});

btnBrowse.onclick = (e) => {
  e.stopPropagation();
  fileInput.click();
};

dropZone.onclick = () => fileInput.click();

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', (e) => {
  if (e.relatedTarget && dropZone.contains(e.relatedTarget)) return;
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleFiles(e.dataTransfer.files);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    handleFiles(e.target.files);
  }
});

// Bind Perspective Mode Tabs (四種分析視角切換)
document.querySelectorAll('.perspective-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const mode = tab.getAttribute('data-mode');
    setPerspectiveMode(mode, true);
  });
});

// Tab Switching
document.querySelectorAll('.stat-card').forEach(card => {
  card.addEventListener('click', () => {
    const tab = card.getAttribute('data-tab');
    const mode = state.perspectiveMode || 'all';

    // Prevent clicking on dimmed cards
    if (mode === 'trio' && (tab === 'followers' || tab === 'following')) return;
    if (mode === 'followers' && (tab === 'following' || tab === 'not-following-back')) return;
    if (mode === 'following' && (tab === 'followers' || tab === 'fans-not-followed')) return;

    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    state.currentTab = tab;
    renderActiveList();
  });
});

// Get current list
function getCurrentList() {
  if (!state.currentTab) return [];
  return getEffectiveList(state.currentTab);
}

// Update all 5 stat card numbers on the analysis page
function updateStatCardCounters(animate = false) {
  if (!state.isDataLoaded) return;
  const followersCount = getEffectiveList('followers').length;
  const followingCount = getEffectiveList('following').length;
  const mutualsCount = getEffectiveList('mutuals').length;
  const notBackCount = getEffectiveList('notFollowingBack').length;
  const fansOnlyCount = getEffectiveList('fansNotFollowed').length;

  const elFollowers = document.getElementById('count-followers');
  const elFollowing = document.getElementById('count-following');
  const elMutuals = document.getElementById('count-mutuals');
  const elNotBack = document.getElementById('count-not-back');
  const elFansOnly = document.getElementById('count-fans-only');

  if (animate && typeof animateCounter === 'function') {
    animateCounter(elFollowers, followersCount, ANIMATION_SPEED_MS);
    animateCounter(elFollowing, followingCount, ANIMATION_SPEED_MS);
    animateCounter(elMutuals, mutualsCount, ANIMATION_SPEED_MS);
    animateCounter(elNotBack, notBackCount, ANIMATION_SPEED_MS);
    animateCounter(elFansOnly, fansOnlyCount, ANIMATION_SPEED_MS);
  } else {
    if (elFollowers) elFollowers.textContent = followersCount.toLocaleString();
    if (elFollowing) elFollowing.textContent = followingCount.toLocaleString();
    if (elMutuals) elMutuals.textContent = mutualsCount.toLocaleString();
    if (elNotBack) elNotBack.textContent = notBackCount.toLocaleString();
    if (elFansOnly) elFansOnly.textContent = fansOnlyCount.toLocaleString();
  }
}

// Progressive Chunked Rendering (Virtual Scroll support for 100k+ users)
function renderNextChunk(isInitial = false) {
  if (!state.currentFilteredList) return;
  const total = state.currentFilteredList.length;
  if (state.renderedCount >= total && !isInitial) return;

  const nextBatch = state.currentFilteredList.slice(state.renderedCount, state.renderedCount + state.CHUNK_SIZE);
  if (nextBatch.length === 0) return;

  const chunkHtml = nextBatch.map(item => `
    <a href="https://www.instagram.com/${encodeURIComponent(item.username)}/" target="_blank" rel="noopener noreferrer" class="user-item">
      <div class="username">
        <span>@${item.username}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </div>
      ${item.time ? `<span class="user-meta">${item.time}</span>` : ''}
    </a>
  `).join('');

  if (isInitial) {
    userGrid.innerHTML = chunkHtml;
  } else {
    userGrid.insertAdjacentHTML('beforeend', chunkHtml);
  }

  state.renderedCount += nextBatch.length;
}

// Scroll listener on userGrid for smooth endless chunk loading
userGrid.addEventListener('scroll', () => {
  if (!state.currentFilteredList) return;
  if (state.renderedCount >= state.currentFilteredList.length) return;
  const { scrollTop, scrollHeight, clientHeight } = userGrid;
  if (scrollTop + clientHeight >= scrollHeight - 350) {
    renderNextChunk(false);
  }
}, { passive: true });

// Render List (High-performance non-blocking pipeline)
function renderActiveList() {
  // If no tab is selected, show initial friendly guide prompt (置中、一般字體、不換行、無SVG)
  if (!state.currentTab) {
    state.currentFilteredList = [];
    state.renderedCount = 0;
    userGrid.classList.add('empty-prompt-active');
    userGrid.innerHTML = `
      <div class="empty-state">
        <p>點選左上角方塊即可顯示該分類名單</p>
      </div>
    `;
    return;
  }
  userGrid.classList.remove('empty-prompt-active');

  const list = getCurrentList() || [];
  const query = searchInput.value.trim().toLowerCase();
  const sortMode = state.sortMode || 'recent';

  // 1. High-speed Filter
  const filtered = query ? list.filter(item => matchesSearchQuery(item, query)) : list.slice();

  // 2. High-speed Sort
  sortUserList(filtered, sortMode);

  state.currentFilteredList = filtered;
  state.renderedCount = 0;
  userGrid.scrollTop = 0;

  if (filtered.length === 0) {
    userGrid.classList.add('empty-prompt-active');
    userGrid.innerHTML = `
      <div class="empty-state">
        <p>沒有找到符合條件的帳號</p>
      </div>
    `;
    return;
  }
  userGrid.classList.remove('empty-prompt-active');

  // Initial batch of 120 items (<5ms instant render)
  renderNextChunk(true);
}

// Custom Sort Dropdown Handling
const customSortDropdown = document.getElementById('custom-sort-dropdown');
const sortDropdownTrigger = document.getElementById('sort-dropdown-trigger');
const sortDropdownLabel = document.getElementById('sort-dropdown-label');
const sortDropdownItems = document.querySelectorAll('#sort-dropdown-menu .dropdown-item');

if (sortDropdownTrigger && customSortDropdown) {
  sortDropdownTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.custom-dropdown.open').forEach(d => {
      if (d !== customSortDropdown) d.classList.remove('open');
    });
    customSortDropdown.classList.toggle('open');
  });

  sortDropdownItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = item.getAttribute('data-value');
      const labelSpan = item.querySelector('span');
      if (labelSpan && sortDropdownLabel) {
        sortDropdownLabel.textContent = labelSpan.textContent;
      }
      sortDropdownItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      state.sortMode = val;
      customSortDropdown.classList.remove('open');
      renderActiveList();
    });
  });
}

// View Mode toggling with slide animation
const viewModeToggle = document.getElementById('view-mode-toggle');
const btnViewSingle = document.getElementById('btn-view-single');
const btnViewMulti = document.getElementById('btn-view-multi');

if (btnViewSingle && btnViewMulti) {
  btnViewSingle.addEventListener('click', () => {
    btnViewSingle.classList.add('active');
    btnViewMulti.classList.remove('active');
    viewModeToggle.classList.remove('multi');
    userGrid.classList.remove('view-multi');
    userGrid.classList.add('view-single');
  });

  btnViewMulti.addEventListener('click', () => {
    btnViewMulti.classList.add('active');
    btnViewSingle.classList.remove('active');
    viewModeToggle.classList.add('multi');
    userGrid.classList.remove('view-single');
    userGrid.classList.add('view-multi');
  });
}

// Search filter with debounce for massive lists
let searchDebounceTimer = null;
searchInput.addEventListener('input', () => {
  updateSearchClearBtn();
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    renderActiveList();
  }, 100);
});

if (searchClearBtn) {
  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    updateSearchClearBtn();
    renderActiveList();
    searchInput.focus();
  });
}
