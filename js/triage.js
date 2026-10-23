// ===== Triage Workspace Pages Logic =====

const TRIAGE_PAGE_IDS = ['fans-not-followed', 'mutuals', 'not-following-back'];
const TRIAGE_CHUNK_SIZE = 100;

// Silent Local LRU Profile Cache Configuration
const TRIAGE_STORAGE_KEY = 'ig_inspector_profiles_v1';
const MAX_CACHED_PROFILES = 50;
const PROFILE_SIMILARITY_THRESHOLD = 0.40;
const MAX_FINGERPRINT_SAMPLES = 2500;
let activeProfileId = null;

// In-memory tag storage
// - decision & custom: 綁定「分區頁面 + 帳號 (lowercase)」，狀態轉移時自動重置為未分類
// - relation: 綁定「帳號 (lowercase)」，跨分區繼承（若新分區支援該關係標籤）
const inMemoryTags = {
  decision: {
    'fans-not-followed': {},
    'mutuals': {},
    'not-following-back': {}
  },
  relation: {},
  custom: {
    'fans-not-followed': {},
    'mutuals': {},
    'not-following-back': {}
  }
};

// In-memory custom tags storage
const inMemoryCustomTags = {
  'fans-not-followed': [],
  'mutuals': [],
  'not-following-back': []
};

function getTriageTag(username, mode = 'decision', pageId = null) {
  if (!username) return null;
  const key = String(username).toLowerCase();

  if (mode === 'relation') {
    const tagId = inMemoryTags.relation ? inMemoryTags.relation[key] : null;
    if (!tagId) return null;
    if (pageId) {
      const validTags = TRIAGE_MODES.relation[pageId] || [];
      if (!validTags.some(t => t.id === tagId)) return null;
    }
    return tagId;
  }

  if (mode === 'decision' || mode === 'custom') {
    if (!pageId || !inMemoryTags[mode] || !inMemoryTags[mode][pageId]) return null;
    const tagId = inMemoryTags[mode][pageId][key] || null;
    if (!tagId) return null;
    const validList = (mode === 'decision')
      ? (TRIAGE_MODES.decision[pageId] || [])
      : (inMemoryCustomTags[pageId] || []);
    if (!validList.some(t => t.id === tagId)) return null;
    return tagId;
  }

  return null;
}

function setTriageTag(username, tagId, mode = 'decision', pageId = null, skipSave = false) {
  if (!username) return;
  const key = String(username).toLowerCase();

  if (mode === 'relation') {
    if (!inMemoryTags.relation) inMemoryTags.relation = {};
    if (tagId) {
      inMemoryTags.relation[key] = tagId;
    } else {
      delete inMemoryTags.relation[key];
    }
  } else if (mode === 'decision' || mode === 'custom') {
    if (!pageId) return;
    if (!inMemoryTags[mode]) inMemoryTags[mode] = {};
    if (!inMemoryTags[mode][pageId]) inMemoryTags[mode][pageId] = {};
    if (tagId) {
      inMemoryTags[mode][pageId][key] = tagId;
    } else {
      delete inMemoryTags[mode][pageId][key];
    }
  }

  if (!skipSave) {
    saveActiveProfileToStorage();
  }
}

// Fast 32-bit FNV-1a hash for deterministic MinHash account fingerprinting
function fnv1aHash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function buildAccountFingerprint(allUsersSet) {
  const hashes = [];
  allUsersSet.forEach(u => {
    if (u) hashes.push(fnv1aHash32(u));
  });
  hashes.sort((a, b) => a - b);

  // Deduplicate any rare 32-bit hash collisions and cap at MAX_FINGERPRINT_SAMPLES (MinHash sketch)
  const uniqueHashes = [];
  for (let i = 0; i < hashes.length; i++) {
    if (i === 0 || hashes[i] !== hashes[i - 1]) {
      uniqueHashes.push(hashes[i].toString(36));
      if (uniqueHashes.length >= MAX_FINGERPRINT_SAMPLES) break;
    }
  }

  return {
    fp: uniqueHashes,
    totalCount: allUsersSet.size
  };
}

function computeProfileSimilarity(fpA, countA, fpB, countB) {
  if (!Array.isArray(fpA) || !Array.isArray(fpB) || fpA.length === 0 || fpB.length === 0) return 0;
  if (!countA || !countB) return 0;

  const setA = new Set(fpA);
  let inter = 0;
  for (let i = 0; i < fpB.length; i++) {
    if (setA.has(fpB[i])) inter++;
  }
  const union = setA.size + fpB.length - inter;
  if (union <= 0) return 0;

  const sketchJaccard = inter / union;
  const sizeRatio = Math.min(countA, countB) / Math.max(countA, countB);
  return Math.min(sketchJaccard, sizeRatio);
}

function loadProfilesFromStorage() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TRIAGE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveProfilesToStorage(profiles) {
  if (typeof localStorage === 'undefined') return;
  const list = profiles.slice(0, MAX_CACHED_PROFILES);
  while (list.length > 0) {
    try {
      localStorage.setItem(TRIAGE_STORAGE_KEY, JSON.stringify(list));
      return;
    } catch (e) {
      if (list.length <= 1) break;
      list.pop();
    }
  }
}

function cloneInMemoryTags() {
  return {
    decision: {
      'fans-not-followed': { ...(inMemoryTags.decision['fans-not-followed'] || {}) },
      'mutuals': { ...(inMemoryTags.decision['mutuals'] || {}) },
      'not-following-back': { ...(inMemoryTags.decision['not-following-back'] || {}) }
    },
    relation: { ...(inMemoryTags.relation || {}) },
    custom: {
      'fans-not-followed': { ...(inMemoryTags.custom['fans-not-followed'] || {}) },
      'mutuals': { ...(inMemoryTags.custom['mutuals'] || {}) },
      'not-following-back': { ...(inMemoryTags.custom['not-following-back'] || {}) }
    }
  };
}

function cloneCustomDefs() {
  return {
    'fans-not-followed': (inMemoryCustomTags['fans-not-followed'] || []).map(t => ({ ...t })),
    'mutuals': (inMemoryCustomTags['mutuals'] || []).map(t => ({ ...t })),
    'not-following-back': (inMemoryCustomTags['not-following-back'] || []).map(t => ({ ...t }))
  };
}

function saveActiveProfileToStorage() {
  if (!activeProfileId) return;
  const profiles = loadProfilesFromStorage();
  const idx = profiles.findIndex(p => p && p.id === activeProfileId);
  if (idx === -1) return;

  const current = profiles.splice(idx, 1)[0];
  current.updatedAt = Date.now();
  current.tags = cloneInMemoryTags();
  current.customDefs = cloneCustomDefs();
  profiles.unshift(current);
  saveProfilesToStorage(profiles);
}

// Match or create LRU profile silently when a ZIP is parsed
function syncTriageProfileOnLoad() {
  const sectionSets = {
    'fans-not-followed': new Set((state.fansNotFollowed || []).map(u => u._lower || u.username.toLowerCase())),
    'mutuals': new Set((state.mutuals || []).map(u => u._lower || u.username.toLowerCase())),
    'not-following-back': new Set((state.notFollowingBack || []).map(u => u._lower || u.username.toLowerCase()))
  };

  const allUsersSet = new Set();
  TRIAGE_PAGE_IDS.forEach(pageId => {
    sectionSets[pageId].forEach(u => allUsersSet.add(u));
  });
  (state.followers || []).forEach(u => allUsersSet.add(u._lower || u.username.toLowerCase()));
  (state.following || []).forEach(u => allUsersSet.add(u._lower || u.username.toLowerCase()));

  if (allUsersSet.size === 0) {
    activeProfileId = null;
    return;
  }

  const { fp, totalCount } = buildAccountFingerprint(allUsersSet);
  const profiles = loadProfilesFromStorage();

  let bestIdx = -1;
  let bestSim = 0;

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    if (!p || !Array.isArray(p.fp)) continue;
    const sim = computeProfileSimilarity(fp, totalCount, p.fp, p.totalCount);
    if (sim > bestSim) {
      bestSim = sim;
      bestIdx = i;
    }
  }

  if (bestIdx !== -1 && bestSim >= PROFILE_SIMILARITY_THRESHOLD) {
    const matched = profiles.splice(bestIdx, 1)[0];

    // 1. Restore Custom Tag Definitions per page
    TRIAGE_PAGE_IDS.forEach(pageId => {
      const savedDefs = matched.customDefs && Array.isArray(matched.customDefs[pageId])
        ? matched.customDefs[pageId]
        : [];
      inMemoryCustomTags[pageId] = savedDefs.filter(t => t && t.id && t.label);
    });

    // 2. Restore Decision & Custom tags (must still reside in the SAME page section; auto-resets on status migration or removal)
    TRIAGE_PAGE_IDS.forEach(pageId => {
      const secSet = sectionSets[pageId];
      const validDecisionIds = new Set((TRIAGE_MODES.decision[pageId] || []).map(t => t.id));
      const validCustomIds = new Set((inMemoryCustomTags[pageId] || []).map(t => t.id));

      const savedDecMap = (matched.tags && matched.tags.decision && matched.tags.decision[pageId]) || {};
      for (const [u, tagId] of Object.entries(savedDecMap)) {
        if (secSet.has(u) && validDecisionIds.has(tagId)) {
          inMemoryTags.decision[pageId][u] = tagId;
        }
      }

      const savedCusMap = (matched.tags && matched.tags.custom && matched.tags.custom[pageId]) || {};
      for (const [u, tagId] of Object.entries(savedCusMap)) {
        if (secSet.has(u) && validCustomIds.has(tagId)) {
          inMemoryTags.custom[pageId][u] = tagId;
        }
      }
    });

    // 3. Restore Relation tags (bound to person across sections; pruned if no longer in list or unsupported in new section)
    const savedRelMap = (matched.tags && matched.tags.relation) || {};
    for (const [u, tagId] of Object.entries(savedRelMap)) {
      let currentSec = null;
      for (let i = 0; i < TRIAGE_PAGE_IDS.length; i++) {
        const pid = TRIAGE_PAGE_IDS[i];
        if (sectionSets[pid].has(u)) {
          currentSec = pid;
          break;
        }
      }
      if (currentSec) {
        const validRelIds = TRIAGE_MODES.relation[currentSec] || [];
        if (validRelIds.some(t => t.id === tagId)) {
          inMemoryTags.relation[u] = tagId;
        }
      }
    }

    matched.fp = fp;
    matched.totalCount = totalCount;
    matched.updatedAt = Date.now();
    matched.tags = cloneInMemoryTags();
    matched.customDefs = cloneCustomDefs();
    activeProfileId = matched.id;

    profiles.unshift(matched);
    saveProfilesToStorage(profiles);
  } else {
    // New account / alt account: allocate a fresh LRU slot
    const newProfile = {
      id: 'prof_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      updatedAt: Date.now(),
      totalCount,
      fp,
      tags: cloneInMemoryTags(),
      customDefs: cloneCustomDefs()
    };
    activeProfileId = newProfile.id;
    profiles.unshift(newProfile);
    saveProfilesToStorage(profiles);
  }
}

// Tag Definitions across modes
const TRIAGE_MODES = {
  // 模式 A：決策導向（動作執行）
  decision: {
    'fans-not-followed': [
      { id: 'keep', label: '保留', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.35)' },
      { id: 'pending', label: '暫緩', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.35)' },
      { id: 'remove', label: '欲移除', color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.12)', border: 'rgba(244, 63, 94, 0.35)' }
    ],
    'mutuals': [
      { id: 'keep', label: '保留', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.35)' },
      { id: 'pending', label: '暫緩', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.35)' },
      { id: 'unbind', label: '欲解除', color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.12)', border: 'rgba(244, 63, 94, 0.35)' }
    ],
    'not-following-back': [
      { id: 'keep', label: '保留', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.35)' },
      { id: 'pending', label: '暫緩', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.35)' },
      { id: 'unfollow', label: '欲退追', color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.12)', border: 'rgba(244, 63, 94, 0.35)' }
    ]
  },

  // 模式 B：關係導向
  relation: {
    'fans-not-followed': [
      { id: 'friend_close', label: '朋友全熟', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.35)' },
      { id: 'friend_mid', label: '朋友半熟', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', border: 'rgba(56, 189, 248, 0.35)' },
      { id: 'friend_distant', label: '朋友不熟', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.35)' },
      { id: 'passerby', label: '路人', color: '#64748b', bg: 'rgba(100, 116, 139, 0.12)', border: 'rgba(100, 116, 139, 0.35)' },
      { id: 'spam', label: '假帳號', color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.12)', border: 'rgba(244, 63, 94, 0.35)' }
    ],
    'mutuals': [
      { id: 'friend_close', label: '朋友全熟', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.35)' },
      { id: 'friend_mid', label: '朋友半熟', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', border: 'rgba(56, 189, 248, 0.35)' },
      { id: 'friend_distant', label: '朋友不熟', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.35)' }
    ],
    'not-following-back': [
      { id: 'friend_close', label: '朋友全熟', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.35)' },
      { id: 'friend_mid', label: '朋友半熟', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', border: 'rgba(56, 189, 248, 0.35)' },
      { id: 'friend_distant', label: '朋友不熟', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.35)' },
      { id: 'celebrity', label: '名人', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.12)', border: 'rgba(168, 85, 247, 0.35)' }
    ]
  }
};

const TRIAGE_PAGE_CONFIG = {
  'fans-not-followed': { title: '你尚未追蹤', dataKey: 'fansNotFollowed' },
  'mutuals': { title: '互追中', dataKey: 'mutuals' },
  'not-following-back': { title: '對方未回追', dataKey: 'notFollowingBack' }
};

function createTriagePageState() {
  return {
    tagMode: 'decision',
    viewMode: 'single',
    filterTag: 'uncategorized',
    sortMode: 'recent',
    searchQuery: '',
    renderedCount: 0,
    currentList: [],
    selectedUsernames: new Set(),
    lastCheckedIndex: -1
  };
}

const triageState = {
  'fans-not-followed': createTriagePageState(),
  'mutuals': createTriagePageState(),
  'not-following-back': createTriagePageState()
};

// Reset all triage state and UI when a new ZIP file is uploaded
function resetTriageData() {
  activeProfileId = null;
  inMemoryTags.relation = {};

  TRIAGE_PAGE_IDS.forEach(pageId => {
    inMemoryTags.decision[pageId] = {};
    inMemoryTags.custom[pageId] = {};
    inMemoryCustomTags[pageId] = [];
    triageState[pageId] = createTriagePageState();

    const searchInput = document.querySelector(`.triage-search-input[data-triage="${pageId}"]`);
    if (searchInput) {
      searchInput.value = '';
      const clearBtn = searchInput.parentElement.querySelector('.triage-search-clear');
      if (clearBtn) clearBtn.style.display = 'none';
    }
    const batchBar = document.getElementById(`triage-batch-bar-${pageId}`);
    if (batchBar) batchBar.classList.remove('show');

    const emptyStateEl = document.getElementById(`triage-empty-${pageId}`);
    const containerEl = document.getElementById(`triage-container-${pageId}`);
    if (emptyStateEl) emptyStateEl.style.display = 'block';
    if (containerEl) containerEl.style.display = 'none';
  });
}

// Toast Notification (統一導向 state.js 的 showToast)
function showTriageToast(message) {
  if (typeof showToast === 'function') {
    showToast(message, 'info');
  }
}

// Get active tag list for a page based on its current tagMode
function getActiveTags(pageId) {
  const mode = triageState[pageId].tagMode || 'decision';
  if (mode === 'decision') {
    return TRIAGE_MODES.decision[pageId] || [];
  }
  if (mode === 'relation') {
    return TRIAGE_MODES.relation[pageId] || [];
  }
  return inMemoryCustomTags[pageId] || [];
}

// Get raw list for a triage section
function getTriageRawList(pageId) {
  const cfg = TRIAGE_PAGE_CONFIG[pageId];
  return cfg ? getEffectiveList(cfg.dataKey) : [];
}

// Render entire triage page
function renderTriagePage(pageId) {
  const emptyStateEl = document.getElementById(`triage-empty-${pageId}`);
  const containerEl = document.getElementById(`triage-container-${pageId}`);
  const rawList = getTriageRawList(pageId);

  if (!state.isDataLoaded) {
    if (emptyStateEl) emptyStateEl.style.display = 'block';
    if (containerEl) containerEl.style.display = 'none';
    return;
  }

  if (emptyStateEl) emptyStateEl.style.display = 'none';
  if (containerEl) containerEl.style.display = 'flex';

  // 1. Update total count banner number
  const countNum = document.getElementById(`triage-count-${pageId}`);
  if (countNum) {
    countNum.textContent = rawList.length.toLocaleString();
  }

  // 2. Filter & Sort list (also updates filter bar)
  filterAndRenderTriageList(pageId);
}

// Update the Batch Action Bar (批次工具列狀態更新)
function updateBatchBar(pageId) {
  const s = triageState[pageId];
  const batchBar = document.getElementById(`triage-batch-bar-${pageId}`);
  if (!batchBar) return;

  const count = s.selectedUsernames.size;
  const grid = document.getElementById(`triage-grid-${pageId}`);
  if (grid) {
    grid.classList.toggle('has-batch-dock', count > 0);
  }

  if (count === 0) {
    batchBar.classList.remove('show');
  } else {
    batchBar.classList.add('show');
    const countEl = batchBar.querySelector('.triage-batch-count');
    if (countEl) countEl.textContent = count.toLocaleString();

    // Render active tag buttons
    const tagsContainer = document.getElementById(`triage-batch-tags-${pageId}`);
    if (tagsContainer) {
      const activeTags = getActiveTags(pageId);
      tagsContainer.innerHTML = activeTags.map(t => `
        <button type="button" class="btn-batch-tag" data-tag-id="${t.id}" style="--btn-color: ${t.color}; --btn-bg: ${t.bg}; --btn-border: ${t.border};">
          <span class="triage-pill-dot" style="background: ${t.color};"></span>
          <span>${escapeHtml(t.label)}</span>
        </button>
      `).join('');
    }
  }

  // Update Select All button state without re-rendering entire filter bar
  const selectAllBtn = document.querySelector(`.btn-triage-select-all[data-triage="${pageId}"]`);
  if (selectAllBtn) {
    const totalCurrent = s.currentList ? s.currentList.length : 0;
    const isAllSelected = totalCurrent > 0 && s.selectedUsernames.size === totalCurrent;
    selectAllBtn.classList.toggle('active', isAllSelected);
    const textSpan = selectAllBtn.querySelector('.select-all-text');
    if (textSpan) {
      textSpan.textContent = isAllSelected ? '取消全選' : `全選 (${totalCurrent.toLocaleString()})`;
    }
  }
}

// Apply tag to all selected accounts in batch
function applyBatchTag(pageId, tagId) {
  const s = triageState[pageId];
  if (!s.selectedUsernames || s.selectedUsernames.size === 0) return;

  const count = s.selectedUsernames.size;
  const mode = s.tagMode || 'decision';

  s.selectedUsernames.forEach(username => {
    setTriageTag(username, tagId, mode, pageId, true);
  });
  saveActiveProfileToStorage();

  const activeTags = getActiveTags(pageId);
  const tag = activeTags.find(t => t.id === tagId);
  const tagName = tag ? tag.label : '指定標籤';

  showTriageToast(`已將 ${count} 個帳號標記為「${tagName}」`);
  s.selectedUsernames.clear();
  s.lastCheckedIndex = -1;

  filterAndRenderTriageList(pageId);
  updateBatchBar(pageId);
}

// Clear tags on all selected accounts
function clearBatchTag(pageId) {
  const s = triageState[pageId];
  if (!s.selectedUsernames || s.selectedUsernames.size === 0) return;

  const count = s.selectedUsernames.size;
  const mode = s.tagMode || 'decision';

  s.selectedUsernames.forEach(username => {
    setTriageTag(username, null, mode, pageId, true);
  });
  saveActiveProfileToStorage();

  showTriageToast(`已清除 ${count} 個帳號的標籤`);
  s.selectedUsernames.clear();
  s.lastCheckedIndex = -1;

  filterAndRenderTriageList(pageId);
  updateBatchBar(pageId);
}

// Cancel batch selection
function cancelBatchSelection(pageId) {
  const s = triageState[pageId];
  s.selectedUsernames.clear();
  s.lastCheckedIndex = -1;

  const grid = document.getElementById(`triage-grid-${pageId}`);
  if (grid) {
    grid.querySelectorAll('.triage-checkbox').forEach(cb => cb.checked = false);
    grid.querySelectorAll('.triage-user-item').forEach(el => el.classList.remove('selected'));
  }

  updateBatchBar(pageId);
}

// Toggle select all on current visible/filtered list
function toggleSelectAll(pageId) {
  const s = triageState[pageId];
  if (!s.currentList || s.currentList.length === 0) return;

  const isAll = s.selectedUsernames.size === s.currentList.length;
  if (isAll) {
    s.selectedUsernames.clear();
    s.lastCheckedIndex = -1;
  } else {
    s.currentList.forEach(item => {
      s.selectedUsernames.add(item.username);
    });
  }

  const grid = document.getElementById(`triage-grid-${pageId}`);
  if (grid) {
    grid.querySelectorAll('.triage-user-item').forEach(row => {
      const u = row.getAttribute('data-username');
      const isSel = s.selectedUsernames.has(u);
      const cb = row.querySelector('.triage-checkbox');
      if (cb) cb.checked = isSel;
      row.classList.toggle('selected', isSel);
    });
  }

  updateBatchBar(pageId);
}

// Render Filter Pill Bar
function renderTriageFilterBar(pageId) {
  const bar = document.getElementById(`triage-filter-bar-${pageId}`);
  if (!bar) return;

  const s = triageState[pageId];
  const mode = s.tagMode || 'decision';
  const activeTags = getActiveTags(pageId);
  const rawList = getTriageRawList(pageId);

  // Compute counts
  let countUncategorized = 0;
  const tagCounts = {};
  activeTags.forEach(t => tagCounts[t.id] = 0);

  rawList.forEach(item => {
    const assigned = getTriageTag(item.username, mode, pageId);
    if (!assigned || tagCounts[assigned] === undefined) {
      countUncategorized++;
    } else {
      tagCounts[assigned]++;
    }
  });

  // 1. 未分類放在最前面
  let html = `
    <button type="button" class="triage-filter-pill ${s.filterTag === 'uncategorized' ? 'active' : ''}" data-tag="uncategorized">
      <span class="triage-pill-label">未分類</span>
      <span class="triage-pill-count">${countUncategorized}</span>
    </button>
  `;

  // 2. 當前模式的分類標籤
  const isCustom = (mode === 'custom');
  activeTags.forEach(t => {
    const isActive = s.filterTag === t.id;
    html += `
      <button type="button" class="triage-filter-pill ${isActive ? 'active' : ''}" data-tag="${t.id}">
        <span class="triage-pill-dot" style="background: ${t.color};"></span>
        <span class="triage-pill-label">${escapeHtml(t.label)}</span>
        <span class="triage-pill-count">${tagCounts[t.id]}</span>
        ${isCustom ? `
          <span class="custom-tag-delete" data-del-tag="${t.id}">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </span>
        ` : ''}
      </button>
    `;
  });

  // If in custom mode, provide + 新增標籤 button
  if (isCustom) {
    html += `
      <button type="button" class="btn-add-custom-tag" id="btn-add-tag-${pageId}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>新增標籤</span>
      </button>
    `;
  }

  // Right-aligned Select All button
  const totalCurrent = s.currentList ? s.currentList.length : 0;
  const isAllSelected = totalCurrent > 0 && s.selectedUsernames.size === totalCurrent;
  html += `
    <button type="button" class="btn-triage-select-all ${isAllSelected ? 'active' : ''}" data-triage="${pageId}">
      <span class="select-all-text">${isAllSelected ? '取消全選' : `全選 (${totalCurrent.toLocaleString()})`}</span>
    </button>
  `;

  bar.innerHTML = html;

  // Bind clicks on filter pills
  bar.querySelectorAll('.triage-filter-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.custom-tag-delete')) return;
      s.filterTag = btn.getAttribute('data-tag');
      s.selectedUsernames.clear();
      s.lastCheckedIndex = -1;
      filterAndRenderTriageList(pageId);
    });
  });

  // Bind Select All button
  const selectAllBtn = bar.querySelector(`.btn-triage-select-all[data-triage="${pageId}"]`);
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => toggleSelectAll(pageId));
  }

  // Bind delete custom tag
  bar.querySelectorAll('.custom-tag-delete').forEach(delBtn => {
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tagId = delBtn.getAttribute('data-del-tag');
      const targetTag = (inMemoryCustomTags[pageId] || []).find(t => t.id === tagId);
      const tagLabel = targetTag ? targetTag.label : '';

      inMemoryCustomTags[pageId] = inMemoryCustomTags[pageId].filter(t => t.id !== tagId);

      // 清除該分區內所有被貼上此標籤的帳號標記，自動回到未分類
      if (inMemoryTags.custom && inMemoryTags.custom[pageId]) {
        for (const username in inMemoryTags.custom[pageId]) {
          if (inMemoryTags.custom[pageId][username] === tagId) {
            delete inMemoryTags.custom[pageId][username];
          }
        }
      }
      saveActiveProfileToStorage();

      if (s.filterTag === tagId) s.filterTag = 'uncategorized';
      s.selectedUsernames.clear();
      s.lastCheckedIndex = -1;
      filterAndRenderTriageList(pageId);
      if (tagLabel) {
        showTriageToast(`已刪除「${tagLabel}」標籤`);
      }
    });
  });

  // Bind add custom tag
  const addBtn = document.getElementById(`btn-add-tag-${pageId}`);
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const name = window.prompt('請輸入新標籤名稱：');
      if (name && name.trim()) {
        const cleanName = name.trim();
        const colors = ['#38bdf8', '#a855f7', '#f59e0b', '#10b981', '#f43f5e'];
        const existing = inMemoryCustomTags[pageId];
        const nextColor = colors[existing.length % colors.length];
        const newId = 'custom_' + Date.now();
        existing.push({
          id: newId,
          label: cleanName,
          color: nextColor,
          bg: 'rgba(255, 255, 255, 0.08)',
          border: 'rgba(255, 255, 255, 0.25)'
        });
        saveActiveProfileToStorage();
        renderTriageFilterBar(pageId);
        updateBatchBar(pageId);
      }
    });
  }
}

// Update Sort dropdown display label and active status
function updateSortDropdownUI(pageId) {
  const s = triageState[pageId];
  if (!s) return;
  const sortDropdown = document.querySelector(`.triage-sort-dropdown[data-triage="${pageId}"]`);
  if (!sortDropdown) return;

  const currentSort = s.sortMode || 'recent';
  const triggerLabel = sortDropdown.querySelector('.dropdown-trigger span');
  const items = sortDropdown.querySelectorAll('.dropdown-item');

  items.forEach(item => {
    const val = item.getAttribute('data-value');
    const isActive = (val === currentSort);
    item.classList.toggle('active', isActive);
    if (isActive && triggerLabel) {
      const span = item.querySelector('span');
      if (span) triggerLabel.textContent = span.textContent;
    }
  });
}

// Update Tag Mode dropdown display label and active status
function updateModeDropdownUI(pageId) {
  const s = triageState[pageId];
  if (!s) return;
  const dropdown = document.querySelector(`.triage-mode-dropdown[data-triage="${pageId}"]`);
  if (!dropdown) return;

  const currentMode = s.tagMode || 'decision';
  const modeNames = {
    'decision': '決策導向',
    'relation': '關係導向',
    'custom': '自訂標籤'
  };

  const labelEl = dropdown.querySelector('.mode-dropdown-label');
  if (labelEl) {
    labelEl.textContent = modeNames[currentMode] || '決策導向';
  }

  dropdown.querySelectorAll('.dropdown-item').forEach(item => {
    const itemMode = item.getAttribute('data-mode');
    item.classList.toggle('active', itemMode === currentMode);
  });
}

// Filter and render list
function filterAndRenderTriageList(pageId) {
  const s = triageState[pageId];
  const mode = s.tagMode || 'decision';
  const rawList = getTriageRawList(pageId);
  const query = (s.searchQuery || '').trim().toLowerCase();

  // 1. Tag filter & Search query filter
  const filtered = rawList.filter(item => {
    const assigned = getTriageTag(item.username, mode, pageId);
    const matchesTag = (s.filterTag === 'uncategorized') ? !assigned : (assigned === s.filterTag);
    if (!matchesTag) return false;
    return matchesSearchQuery(item, query);
  });

  // 2. High-precision Sort (shared helper in state.js)
  sortUserList(filtered, s.sortMode);

  // 3. Prune any selected usernames not in filtered list (only when selection is non-empty)
  if (s.selectedUsernames.size > 0) {
    const filteredUsernames = new Set(filtered.map(x => x.username));
    for (const u of s.selectedUsernames) {
      if (!filteredUsernames.has(u)) {
        s.selectedUsernames.delete(u);
      }
    }
  }

  s.currentList = filtered;
  s.renderedCount = 0;

  // Sync mode dropdown & sort dropdown UI, re-render filter bar
  updateModeDropdownUI(pageId);
  updateSortDropdownUI(pageId);
  renderTriageFilterBar(pageId);
  updateBatchBar(pageId);

  const grid = document.getElementById(`triage-grid-${pageId}`);
  if (!grid) return;
  grid.scrollTop = 0;

  if (filtered.length === 0) {
    grid.classList.add('empty-prompt-active');
    grid.innerHTML = `
      <div class="empty-state">
        <p>沒有找到符合條件的帳號</p>
      </div>
    `;
    return;
  }

  grid.classList.remove('empty-prompt-active');
  renderTriageChunk(pageId, true);
}

// Render next chunk of users
function renderTriageChunk(pageId, isInitial = false) {
  const s = triageState[pageId];
  const mode = s.tagMode || 'decision';
  const grid = document.getElementById(`triage-grid-${pageId}`);
  if (!grid || !s.currentList) return;

  const total = s.currentList.length;
  if (s.renderedCount >= total && !isInitial) return;

  const nextBatch = s.currentList.slice(s.renderedCount, s.renderedCount + TRIAGE_CHUNK_SIZE);
  if (nextBatch.length === 0) return;

  const activeTags = getActiveTags(pageId);

  const chunkHtml = nextBatch.map(item => {
    const isSelected = s.selectedUsernames.has(item.username);
    const assignedTagId = getTriageTag(item.username, mode, pageId);
    const assignedTag = activeTags.find(t => t.id === assignedTagId);

    let tagBtnStyle = '';
    let tagBtnClass = 'tag-btn';
    let tagLabel = '未分類';

    if (assignedTag) {
      tagBtnClass += ' has-tag';
      tagLabel = escapeHtml(assignedTag.label);
      tagBtnStyle = `--tag-color: ${assignedTag.color}; --tag-bg: ${assignedTag.bg}; --tag-border: ${assignedTag.border};`;
    }

    const menuOptions = activeTags.map(t => `
      <button type="button" class="tag-menu-item ${assignedTagId === t.id ? 'active' : ''}" data-action="set-tag" data-tag-id="${t.id}" data-username="${encodeURIComponent(item.username)}">
        <span class="triage-pill-dot" style="background: ${t.color};"></span>
        <span>${escapeHtml(t.label)}</span>
      </button>
    `).join('');

    return `
      <div class="user-item triage-user-item ${isSelected ? 'selected' : ''}" data-username="${item.username}">
        <div class="triage-user-left">
          <label class="triage-checkbox-wrap">
            <input type="checkbox" class="triage-checkbox" data-username="${item.username}" ${isSelected ? 'checked' : ''}>
            <span class="triage-checkmark"></span>
          </label>
          <div class="triage-user-info">
            <a href="https://www.instagram.com/${encodeURIComponent(item.username)}/" target="_blank" rel="noopener noreferrer" class="username">
              <span>@${item.username}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
            ${item.time ? `<span class="user-meta">${item.time}</span>` : ''}
          </div>
        </div>
        <div class="triage-user-right">
          <div class="tag-selector" data-username="${item.username}">
            <button type="button" class="${tagBtnClass}" style="${tagBtnStyle}">
              <span class="tag-dot"></span>
              <span class="tag-text">${tagLabel}</span>
              <svg class="tag-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <div class="tag-menu">
              ${menuOptions}
              <div class="tag-menu-divider"></div>
              <button type="button" class="tag-menu-item clear-tag" data-action="clear-tag" data-username="${encodeURIComponent(item.username)}">
                <span>清除標籤</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (isInitial) {
    grid.innerHTML = chunkHtml;
  } else {
    grid.insertAdjacentHTML('beforeend', chunkHtml);
  }

  s.renderedCount += nextBatch.length;
}

// Copy list of currently filtered usernames to clipboard
function copyTriageList(pageId) {
  const s = triageState[pageId];
  if (!s || !s.currentList || s.currentList.length === 0) {
    showTriageToast('目前沒有可複製的帳號');
    return;
  }
  const text = s.currentList.map(u => `@${u.username}`).join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showTriageToast(`已複製 ${s.currentList.length.toLocaleString()} 筆帳號名稱至剪貼簿`);
    }).catch(() => {
      fallbackCopy(text, s.currentList.length);
    });
  } else {
    fallbackCopy(text, s.currentList.length);
  }
}

function fallbackCopy(text, count) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
  showTriageToast(`已複製 ${count.toLocaleString()} 筆帳號名稱至剪貼簿`);
}

// Global Tag Selector Dropdown Click & Outside Click handling
document.addEventListener('click', (e) => {
  // 1. Tag menu button clicked (toggle dropdown)
  const tagBtn = e.target.closest('.tag-btn');
  if (tagBtn) {
    e.stopPropagation();
    const selector = tagBtn.closest('.tag-selector');
    const wasOpen = selector.classList.contains('open');
    document.querySelectorAll('.tag-selector.open').forEach(s => s.classList.remove('open'));
    document.querySelectorAll('.triage-user-item.has-open-menu').forEach(el => el.classList.remove('has-open-menu'));
    if (!wasOpen) {
      selector.classList.add('open');
      const item = selector.closest('.triage-user-item');
      if (item) item.classList.add('has-open-menu');
    }
    return;
  }

  // 2. Tag menu option clicked
  const tagOption = e.target.closest('.tag-menu-item');
  if (tagOption) {
    e.stopPropagation();
    const action = tagOption.getAttribute('data-action');
    const rawUsername = tagOption.getAttribute('data-username');
    const username = decodeURIComponent(rawUsername);

    // Find active page
    const pagePanel = tagOption.closest('.page-panel');
    const pageId = pagePanel ? pagePanel.id.replace('page-', '') : null;
    const s = pageId ? triageState[pageId] : null;
    const mode = s ? (s.tagMode || 'decision') : 'decision';

    if (action === 'set-tag') {
      const tagId = tagOption.getAttribute('data-tag-id');
      setTriageTag(username, tagId, mode, pageId);
    } else if (action === 'clear-tag') {
      setTriageTag(username, null, mode, pageId);
    }

    // Close dropdown
    const selector = tagOption.closest('.tag-selector');
    if (selector) selector.classList.remove('open');
    document.querySelectorAll('.triage-user-item.has-open-menu').forEach(el => el.classList.remove('has-open-menu'));

    if (pageId) {
      filterAndRenderTriageList(pageId);
    }
    return;
  }

  // 3. Outside click closes all open tag menus & custom dropdowns
  document.querySelectorAll('.tag-selector.open').forEach(s => s.classList.remove('open'));
  document.querySelectorAll('.triage-user-item.has-open-menu').forEach(el => el.classList.remove('has-open-menu'));
  document.querySelectorAll('.custom-dropdown.open').forEach(d => {
    if (!d.contains(e.target)) d.classList.remove('open');
  });
});

// Setup listeners for all 3 triage pages
function initTriageListeners() {
  TRIAGE_PAGE_IDS.forEach(pageId => {
    // 1. Tag Mode Dropdown (決策導向 / 關係導向 / 自訂標籤)
    const modeDropdown = document.querySelector(`.triage-mode-dropdown[data-triage="${pageId}"]`);
    if (modeDropdown) {
      const trigger = modeDropdown.querySelector('.dropdown-trigger');
      const items = modeDropdown.querySelectorAll('.dropdown-item');

      if (trigger) {
        trigger.addEventListener('click', (e) => {
          e.stopPropagation();
          document.querySelectorAll('.custom-dropdown.open').forEach(d => {
            if (d !== modeDropdown) d.classList.remove('open');
          });
          modeDropdown.classList.toggle('open');
        });
      }

      items.forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const s = triageState[pageId];
          s.tagMode = item.getAttribute('data-mode');
          s.filterTag = 'uncategorized';
          s.selectedUsernames.clear();
          s.lastCheckedIndex = -1;
          modeDropdown.classList.remove('open');
          updateModeDropdownUI(pageId);
          filterAndRenderTriageList(pageId);
        });
      });
    }

    // 2. View Mode Toggle (單欄 / 多欄)
    const viewToggle = document.querySelector(`.triage-view-toggle[data-triage="${pageId}"]`);
    const grid = document.getElementById(`triage-grid-${pageId}`);
    if (viewToggle && grid) {
      const btnSingle = viewToggle.querySelector('[data-view="single"]');
      const btnMulti = viewToggle.querySelector('[data-view="multi"]');

      if (btnSingle) {
        btnSingle.addEventListener('click', () => {
          triageState[pageId].viewMode = 'single';
          btnSingle.classList.add('active');
          if (btnMulti) btnMulti.classList.remove('active');
          viewToggle.classList.remove('multi');
          grid.classList.remove('view-multi');
          grid.classList.add('view-single');
        });
      }

      if (btnMulti) {
        btnMulti.addEventListener('click', () => {
          triageState[pageId].viewMode = 'multi';
          btnMulti.classList.add('active');
          if (btnSingle) btnSingle.classList.remove('active');
          viewToggle.classList.add('multi');
          grid.classList.remove('view-single');
          grid.classList.add('view-multi');
        });
      }
    }

    // 3. Search input & clear button
    const searchInput = document.querySelector(`.triage-search-input[data-triage="${pageId}"]`);
    const searchClear = searchInput ? searchInput.parentElement.querySelector('.triage-search-clear') : null;

    if (searchInput) {
      let timer = null;
      searchInput.addEventListener('input', () => {
        if (searchClear) {
          searchClear.style.display = searchInput.value.trim().length > 0 ? 'flex' : 'none';
        }
        clearTimeout(timer);
        timer = setTimeout(() => {
          triageState[pageId].searchQuery = searchInput.value;
          filterAndRenderTriageList(pageId);
        }, 120);
      });

      if (searchClear) {
        searchClear.addEventListener('click', () => {
          searchInput.value = '';
          searchClear.style.display = 'none';
          triageState[pageId].searchQuery = '';
          filterAndRenderTriageList(pageId);
        });
      }
    }

    // 4. Copy button
    const copyBtn = document.querySelector(`.btn-triage-copy[data-triage="${pageId}"]`);
    if (copyBtn) {
      copyBtn.addEventListener('click', () => copyTriageList(pageId));
    }

    // 5. Grid Checkbox & Shift+Click range select
    if (grid) {
      let isShiftPressed = false;
      grid.addEventListener('mousedown', (e) => {
        isShiftPressed = !!e.shiftKey;
      });

      // Clicking row whitespace or left area toggles selection safely
      grid.addEventListener('click', (e) => {
        if (e.target.closest('a.username')) return;
        if (e.target.closest('.tag-selector')) return;
        if (e.target.closest('.triage-checkbox-wrap')) return;

        const row = e.target.closest('.triage-user-item');
        if (row) {
          const cb = row.querySelector('.triage-checkbox');
          if (cb) {
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      });

      grid.addEventListener('change', (e) => {
        if (e.target && e.target.classList.contains('triage-checkbox')) {
          const s = triageState[pageId];
          const cb = e.target;
          const username = cb.getAttribute('data-username');
          const isChecked = cb.checked;
          const row = cb.closest('.triage-user-item');
          if (row) row.classList.toggle('selected', isChecked);

          const currentIndex = s.currentList.findIndex(x => x.username === username);

          if (isShiftPressed && s.lastCheckedIndex !== -1 && s.lastCheckedIndex !== currentIndex) {
            const start = Math.min(s.lastCheckedIndex, currentIndex);
            const end = Math.max(s.lastCheckedIndex, currentIndex);
            for (let i = start; i <= end; i++) {
              const u = s.currentList[i].username;
              if (isChecked) s.selectedUsernames.add(u);
              else s.selectedUsernames.delete(u);

              const itemRow = grid.querySelector(`.triage-user-item[data-username="${CSS.escape(u)}"]`);
              if (itemRow) {
                const itemCb = itemRow.querySelector('.triage-checkbox');
                if (itemCb) itemCb.checked = isChecked;
                itemRow.classList.toggle('selected', isChecked);
              }
            }
          } else {
            if (isChecked) s.selectedUsernames.add(username);
            else s.selectedUsernames.delete(username);
            s.lastCheckedIndex = currentIndex;
          }

          isShiftPressed = false;
          updateBatchBar(pageId);
        }
      });

      // Infinite scroll
      grid.addEventListener('scroll', () => {
        const s = triageState[pageId];
        if (!s.currentList) return;
        if (s.renderedCount >= s.currentList.length) return;
        const { scrollTop, scrollHeight, clientHeight } = grid;
        if (scrollTop + clientHeight >= scrollHeight - 350) {
          renderTriageChunk(pageId, false);
        }
      }, { passive: true });
    }

    // 6. Sort Dropdown
    const sortDropdown = document.querySelector(`.triage-sort-dropdown[data-triage="${pageId}"]`);
    if (sortDropdown) {
      const trigger = sortDropdown.querySelector('.dropdown-trigger');
      const items = sortDropdown.querySelectorAll('.dropdown-item');

      if (trigger) {
        trigger.addEventListener('click', (e) => {
          e.stopPropagation();
          document.querySelectorAll('.custom-dropdown.open').forEach(d => {
            if (d !== sortDropdown) d.classList.remove('open');
          });
          sortDropdown.classList.toggle('open');
        });
      }

      items.forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          triageState[pageId].sortMode = item.getAttribute('data-value');
          sortDropdown.classList.remove('open');
          updateSortDropdownUI(pageId);
          filterAndRenderTriageList(pageId);
        });
      });
    }

    // 7. Batch Bar actions (1-click tag, clear, cancel)
    const batchBar = document.getElementById(`triage-batch-bar-${pageId}`);
    if (batchBar) {
      batchBar.addEventListener('click', (e) => {
        const tagBtn = e.target.closest('.btn-batch-tag');
        if (tagBtn) {
          applyBatchTag(pageId, tagBtn.getAttribute('data-tag-id'));
          return;
        }
        if (e.target.closest('.btn-batch-clear')) {
          clearBatchTag(pageId);
          return;
        }
        if (e.target.closest('.btn-batch-cancel')) {
          cancelBatchSelection(pageId);
        }
      });
    }
  });
}

// When DOM is loaded, initialize listeners
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTriageListeners);
} else {
  initTriageListeners();
}
