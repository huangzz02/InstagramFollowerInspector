// Global Data Store
const state = {
  followers: [],
  following: [],
  notFollowingBack: [],
  fansNotFollowed: [],
  mutuals: [],
  currentTab: null,
  sortMode: 'recent',
  perspectiveMode: 'all',
  currentPage: 'upload',
  isDataLoaded: false,
  CHUNK_SIZE: 120,
  renderedCount: 0,
  currentFilteredList: []
};

// ===== 數字累加與甜甜圈圖動畫速度設定 =====
// 單位：毫秒 (ms)。數值越大速度越慢，例如 800、1000、1200
const ANIMATION_SPEED_MS = 800;

function getEffectiveList(key) {
  let mappedKey = key;
  if (key === 'not-following-back') mappedKey = 'notFollowingBack';
  else if (key === 'fans-not-followed') mappedKey = 'fansNotFollowed';
  const list = state[mappedKey];
  return Array.isArray(list) ? list : [];
}

// Reset State (包含重新上傳第二份 ZIP 時的 UI 與分類狀態重置)
function resetData() {
  state.followers = [];
  state.following = [];
  state.notFollowingBack = [];
  state.fansNotFollowed = [];
  state.mutuals = [];
  state.currentTab = null;
  state.perspectiveMode = 'all';
  state.isDataLoaded = false;
  state.currentPage = 'upload';
  state.renderedCount = 0;
  state.currentFilteredList = [];

  // Reset Analysis UI active card & search input
  document.querySelectorAll('.stat-card.active').forEach(c => c.classList.remove('active'));
  const searchInputEl = document.getElementById('search-input');
  if (searchInputEl) searchInputEl.value = '';
  const searchClearEl = document.getElementById('search-clear-btn');
  if (searchClearEl) searchClearEl.style.display = 'none';

  // Reset Chart & Triage pages state
  if (typeof resetChartState === 'function') {
    resetChartState();
  }
  if (typeof resetTriageData === 'function') {
    resetTriageData();
  }
}

// Global Toast Notification (支援一般提示、錯誤警告與自訂停留時間)
let appToastTimer = null;
function showToast(message, type = 'info', duration = 2600) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'app-toast';
    document.body.appendChild(toast);
  }

  toast.className = 'app-toast';
  if (type === 'error') {
    toast.classList.add('toast-error');
    toast.innerHTML = `
      <svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span>${escapeHtml(message)}</span>
    `;
  } else {
    toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  }

  toast.classList.add('show');
  clearTimeout(appToastTimer);
  appToastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// HTML Escape helper for safe DOM rendering
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Format Date to Taiwan 12-hour format: YYYY/M/D 上午/下午h:mm[:ss] (JSON 帶秒數，HTML 不帶秒數)
function formatTwDateTime(d, includeSeconds = true) {
  if (!d || isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hours24 = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const period = hours24 < 12 ? '上午' : '下午';
  let hours12 = hours24 % 12;
  if (hours12 === 0) hours12 = 12;
  if (includeSeconds) {
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${y}/${m}/${day} ${period}${hours12}:${minutes}:${seconds}`;
  }
  return `${y}/${m}/${day} ${period}${hours12}:${minutes}`;
}

// Convert HTML timestamp string (Meta outputs in UTC-8 PST) to local Taiwan time formatted string & timestamp
function parseHtmlTime(rawStr) {
  if (!rawStr) return { formatted: '', timestamp: 0 };
  const str = rawStr.trim();
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  // Match Chinese: 10 月 05, 2026 8:30 上午 or 9 月 22, 2026 12:53 上午
  let m = str.match(/(\d{1,2})\s*月\s*(\d{1,2}),?\s*(\d{4})\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(上午|下午|AM|PM)?/i);
  let month, day, year, hour, min, sec, period;
  if (m) {
    month = m[1];
    day = m[2];
    year = m[3];
    hour = m[4];
    min = m[5];
    sec = m[6];
    period = m[7];
  } else {
    // Match English: Oct 05, 2026 8:30 AM or October 5, 2026, 8:30 PM
    m = str.match(/([a-zA-Z]{3,9})\s+(\d{1,2}),?\s*(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|上午|下午)?/i);
    if (m) {
      const monStr = m[1].toLowerCase().slice(0, 3);
      month = months[monStr];
      day = m[2];
      year = m[3];
      hour = m[4];
      min = m[5];
      sec = m[6];
      period = m[7];
    }
  }

  if (month && day && year && hour && min) {
    month = parseInt(month, 10);
    day = parseInt(day, 10);
    year = parseInt(year, 10);
    hour = parseInt(hour, 10);
    min = parseInt(min, 10);
    sec = sec ? parseInt(sec, 10) : 0;

    if (period) {
      const p = period.toUpperCase();
      if ((p === '下午' || p === 'PM') && hour < 12) hour += 12;
      if ((p === '上午' || p === 'AM') && hour === 12) hour = 0;
    }

    // Meta HTML timestamps are fixed in UTC-8 (US Pacific Time)
    // Convert to UTC ms: HTML time + 8 hours
    const utcMs = Date.UTC(year, month - 1, day, hour + 8, min, sec);
    return {
      formatted: formatTwDateTime(new Date(utcMs), false),
      timestamp: utcMs
    };
  }

  return { formatted: str, timestamp: 0 };
}

// Extract numeric timestamp for sorting (handles parsed timestamp, cached, or formats from time string)
function getItemTimestamp(item) {
  if (!item) return 0;
  if (typeof item.timestamp === 'number' && !isNaN(item.timestamp) && item.timestamp > 0) {
    return item.timestamp;
  }
  if (item._cachedTs !== undefined) {
    return item._cachedTs;
  }

  if (item.time) {
    const m = String(item.time).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(上午|下午|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/i);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const d = parseInt(m[3], 10);
      const period = m[4];
      let h = m[5] ? parseInt(m[5], 10) : 0;
      const min = m[6] ? parseInt(m[6], 10) : 0;
      const sec = m[7] ? parseInt(m[7], 10) : 0;

      if (period) {
        const p = period.toUpperCase();
        if ((p === '下午' || p === 'PM') && h < 12) h += 12;
        if ((p === '上午' || p === 'AM') && h === 12) h = 0;
      }
      const parsed = new Date(y, mo, d, h, min, sec).getTime();
      if (!isNaN(parsed) && parsed > 0) {
        item._cachedTs = parsed;
        return parsed;
      }
    }

    const dp = Date.parse(item.time);
    if (!isNaN(dp) && dp > 0) {
      item._cachedTs = dp;
      return dp;
    }
  }

  item._cachedTs = 0;
  return 0;
}

// Shared high-speed search matcher (uses cached _lower username + time string)
function matchesSearchQuery(item, query) {
  if (!query) return true;
  const lowerUser = item._lower || (item.username ? item.username.toLowerCase() : '');
  if (lowerUser.includes(query)) return true;
  if (item.time && item.time.toLowerCase().includes(query)) return true;
  return false;
}

// Shared high-speed sorter across Analysis & Triage pages
function sortUserList(list, sortMode = 'recent') {
  if (sortMode === 'oldest') {
    list.sort((a, b) => {
      const ta = getItemTimestamp(a);
      const tb = getItemTimestamp(b);
      if (ta > 0 && tb > 0 && ta !== tb) return ta - tb;
      return (b.originalIndex || 0) - (a.originalIndex || 0);
    });
  } else if (sortMode === 'name-asc') {
    list.sort((a, b) => {
      const la = a._lower || a.username.toLowerCase();
      const lb = b._lower || b.username.toLowerCase();
      return la < lb ? -1 : (la > lb ? 1 : 0);
    });
  } else if (sortMode === 'name-desc') {
    list.sort((a, b) => {
      const la = a._lower || a.username.toLowerCase();
      const lb = b._lower || b.username.toLowerCase();
      return la > lb ? -1 : (la < lb ? 1 : 0);
    });
  } else {
    // 'recent' (由近到遠，最新在先)
    list.sort((a, b) => {
      const ta = getItemTimestamp(a);
      const tb = getItemTimestamp(b);
      if (ta > 0 && tb > 0 && ta !== tb) return tb - ta;
      return (a.originalIndex || 0) - (b.originalIndex || 0);
    });
  }
  return list;
}

// Deduplicate lists with cached lowercase keys
function dedupe(arr) {
  const map = new Map();
  for (const item of arr) {
    const key = item._lower || item.username.toLowerCase();
    if (!item._lower) item._lower = key;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}
