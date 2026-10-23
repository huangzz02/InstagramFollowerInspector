// Handle files (ZIP only)
async function handleFiles(fileList) {
  resetData();
  const files = Array.from(fileList);
  const zipFile = files.find(f => f.name.toLowerCase().endsWith('.zip'));

  if (!zipFile) {
    showToast('格式不支援：請上傳 Instagram 官方匯出的 .zip 壓縮檔。', 'error', 3500);
    fileInput.value = '';
    return;
  }

  loadingState.style.display = 'block';

  try {
    loadingText.textContent = `正在以串流技術精準讀取 ZIP 索引（檔案大小：${(zipFile.size / (1024 * 1024)).toFixed(1)} MB）...`;
    await parseZipFile(zipFile);
    await computeAndRender();
  } catch (err) {
    console.error(err);
    showToast('解析失敗：' + (err.message || '請確認檔案格式是否為 IG 官方匯出資料。'), 'error', 4500);
  } finally {
    loadingState.style.display = 'none';
    fileInput.value = '';
  }
}

// High performance native streaming ZIP reader without loading full GBs into RAM
async function parseZipFile(file) {
  const fileSize = file.size;
  const readBuffer = async (start, length) => {
    const slice = file.slice(start, start + length);
    return await slice.arrayBuffer();
  };

  // 1. Read last 65KB to locate EOCD record (0x06054b50)
  const tailSize = Math.min(65557, fileSize);
  const tailBuf = new DataView(await readBuffer(fileSize - tailSize, tailSize));

  let eocdOffset = -1;
  for (let i = tailSize - 22; i >= 0; i--) {
    if (tailBuf.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('找不到有效的 ZIP 壓縮檔標頭');
  }

  const numEntries = tailBuf.getUint16(eocdOffset + 10, true);
  const cdSize = tailBuf.getUint32(eocdOffset + 12, true);
  let cdOffset = tailBuf.getUint32(eocdOffset + 16, true);

  // Check for Zip64
  if (cdOffset === 0xFFFFFFFF || numEntries === 0xFFFF) {
    const zip64Loc = eocdOffset - 20;
    if (zip64Loc >= 0 && tailBuf.getUint32(zip64Loc, true) === 0x07064b50) {
      const zip64EocdOffset = Number(tailBuf.getBigUint64(zip64Loc + 8, true));
      const zip64Buf = new DataView(await readBuffer(zip64EocdOffset, 56));
      cdOffset = Number(zip64Buf.getBigUint64(48, true));
    }
  }

  // 2. Read Central Directory
  const cdDataView = new DataView(await readBuffer(cdOffset, cdSize));
  let pos = 0;
  const targetEntries = [];
  const decoder = new TextDecoder();

  while (pos < cdSize) {
    if (cdDataView.getUint32(pos, true) !== 0x02014b50) break;
    const method = cdDataView.getUint16(pos + 10, true);
    const compSize = cdDataView.getUint32(pos + 20, true);
    const uncompSize = cdDataView.getUint32(pos + 24, true);
    const nameLen = cdDataView.getUint16(pos + 28, true);
    const extraLen = cdDataView.getUint16(pos + 30, true);
    const commentLen = cdDataView.getUint16(pos + 32, true);
    const localOffset = cdDataView.getUint32(pos + 42, true);

    const nameBytes = new Uint8Array(cdDataView.buffer, pos + 46, nameLen);
    const fileName = decoder.decode(nameBytes);
    const lowerName = fileName.toLowerCase();
    const baseName = lowerName.split('/').pop().split('\\').pop();

    // STRICT FILTER: Exclude threads, only target followers / following HTML or JSON
    if (!lowerName.includes('threads/') && !lowerName.includes('threads\\')) {
      const isSupportedExt = baseName.endsWith('.html') || baseName.endsWith('.json');
      if (isSupportedExt) {
        if (baseName.startsWith('follower')) {
          targetEntries.push({ targetType: 'followers', baseName, method, compSize, uncompSize, localOffset });
        } else if (baseName.startsWith('following') && !baseName.includes('hashtag')) {
          targetEntries.push({ targetType: 'following', baseName, method, compSize, uncompSize, localOffset });
        }
      }
    }

    pos += 46 + nameLen + extraLen + commentLen;
  }

  if (targetEntries.length === 0) {
    throw new Error('在此 ZIP 檔中未找到 Instagram 追蹤者或粉絲名單（followers 或 following 檔案）');
  }

  // 3. Extract content of target files only with progressive feedback
  for (let i = 0; i < targetEntries.length; i++) {
    const entry = targetEntries[i];
    loadingText.textContent = `正在解壓縮第 ${i + 1} / ${targetEntries.length} 個檔案（${entry.baseName}）...`;
    await new Promise(r => setTimeout(r, 0));

    const localHeaderBuf = new DataView(await readBuffer(entry.localOffset, 30));
    const localNameLen = localHeaderBuf.getUint16(26, true);
    const localExtraLen = localHeaderBuf.getUint16(28, true);
    const dataOffset = entry.localOffset + 30 + localNameLen + localExtraLen;

    const rawData = await readBuffer(dataOffset, entry.compSize);
    let contentText = '';

    if (entry.method === 0) {
      contentText = decoder.decode(rawData);
    } else if (entry.method === 8) {
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(new Uint8Array(rawData));
        writer.close();
        const decompressedBuf = await new Response(ds.readable).arrayBuffer();
        contentText = decoder.decode(decompressedBuf);
      } else {
        console.warn('Browser does not support DecompressionStream');
      }
    }

    if (contentText) {
      loadingText.textContent = `正在解析 ${entry.baseName}...`;
      const parsed = await parseHtmlOrJson(entry.baseName, contentText, (count) => {
        loadingText.textContent = `正在解析 ${entry.baseName}...（已讀取 ${count.toLocaleString()} 筆）`;
      });
      const targetArray = state[entry.targetType];
      for (let j = 0; j < parsed.length; j++) {
        targetArray.push(parsed[j]);
      }
      contentText = null; // Immediately release for GC
    }
  }
}

// Parse HTML or JSON
async function parseHtmlOrJson(baseName, content, onProgress) {
  if (baseName.endsWith('.json')) {
    return await parseJsonData(content, onProgress);
  }
  return await parseHtmlData(content, onProgress);
}

// Normalize and clean extracted Instagram username
function cleanInstagramUsername(raw) {
  if (!raw) return '';
  let clean = raw.trim().replace(/^\/+|\/+$/g, '');
  if (clean.startsWith('_u/')) {
    clean = clean.slice(3).replace(/^\/+|\/+$/g, '');
  }
  return clean;
}

// JSON Format Parser (with high-volume chunking & async yield)
async function parseJsonData(jsonStr, onProgress) {
  try {
    const data = JSON.parse(jsonStr);
    const list = [];
    const seen = new Set();
    let lastYield = performance.now();

    const addValid = (u, t, ts) => {
      const clean = cleanInstagramUsername(u);
      if (!clean) return;
      const lower = clean.toLowerCase();
      if (/^[a-zA-Z0-9._]+$/.test(clean) && !seen.has(lower)) {
        seen.add(lower);
        const parsedTs = (typeof ts === 'number' && !isNaN(ts)) ? ts : 0;
        list.push({
          username: clean,
          _lower: lower,
          time: t || '',
          timestamp: parsedTs,
          originalIndex: list.length
        });
      }
    };

    function decodeMetaText(str) {
      if (!str) return '';
      try {
        return decodeURIComponent(escape(str));
      } catch (e) {
        return str;
      }
    }

    const items = Array.isArray(data) ? data : (data.relationships_following || data.relationships_followers || []);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.string_list_data) {
        for (const s of item.string_list_data) {
          const username = s.value || (s.href ? s.href.split('/').filter(Boolean).pop() : '');
          const ts = s.timestamp ? s.timestamp * 1000 : 0;
          const time = ts ? formatTwDateTime(new Date(ts)) : '';
          addValid(username, time, ts);
        }
      } else if (item.label_values && Array.isArray(item.label_values)) {
        const ts = item.timestamp ? item.timestamp * 1000 : 0;
        const time = ts ? formatTwDateTime(new Date(ts)) : '';
        for (const lv of item.label_values) {
          const label = decodeMetaText(lv.label || '');
          const lowerLabel = label.toLowerCase();
          if (label.includes('用戶名稱') || lowerLabel.includes('username') || lowerLabel.includes('user')) {
            addValid(lv.value, time, ts);
            break;
          }
        }
      } else if (item.title) {
        addValid(item.title, '', 0);
      }

      if (i % 2500 === 0 && performance.now() - lastYield > 35) {
        if (onProgress) onProgress(list.length);
        await new Promise(r => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }

    return list;
  } catch (e) {
    console.error('JSON parse error', e);
    return [];
  }
}

// HTML Format Parser (with high-volume streaming regex & async yield)
async function parseHtmlData(html, onProgress) {
  const list = [];
  const seen = new Set();
  let lastYield = performance.now();

  const linkRegex = /<a\s+[^>]*href=["']https:\/\/www\.instagram\.com\/(?:_u\/)?([^"'/?#]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = linkRegex.exec(html)) !== null) {
    const rawUser = cleanInstagramUsername(m[1]);

    if (rawUser && /^[a-zA-Z0-9._]+$/.test(rawUser)) {
      const lowerUser = rawUser.toLowerCase();
      if (!seen.has(lowerUser)) {
        seen.add(lowerUser);

        const searchSlice = html.slice(m.index, m.index + 350);
        const timeMatch = /<div>([^<]+(?:上午|下午|AM|PM|\d{4})[^<]*)<\/div>/i.exec(searchSlice);
        const rawTime = timeMatch ? timeMatch[1].trim() : '';
        const parsedTime = parseHtmlTime(rawTime);

        list.push({
          username: rawUser,
          _lower: lowerUser,
          time: parsedTime.formatted,
          timestamp: parsedTime.timestamp || 0,
          originalIndex: list.length
        });
      }
    }

    if (performance.now() - lastYield > 35) {
      if (onProgress) onProgress(list.length);
      await new Promise(r => setTimeout(r, 0));
      lastYield = performance.now();
    }
  }

  return list;
}

// Compute & Display
async function computeAndRender() {
  loadingText.textContent = '正在交叉比對名單關係...';
  await new Promise(r => setTimeout(r, 0));

  state.followers = dedupe(state.followers);
  state.following = dedupe(state.following);

  const followerSet = new Set(state.followers.map(f => f._lower));
  const followingSet = new Set(state.following.map(f => f._lower));

  // Calculations (O(1) Set lookups - instant even for 500k accounts)
  state.notFollowingBack = state.following.filter(f => !followerSet.has(f._lower));
  state.fansNotFollowed = state.followers.filter(f => !followingSet.has(f._lower));
  state.mutuals = state.following.filter(f => followerSet.has(f._lower));
  state.isDataLoaded = true;

  // Silently match account fingerprint & restore/sanitize cached triage tags
  if (typeof syncTriageProfileOnLoad === 'function') {
    syncTriageProfileOnLoad();
  }

  // Hide empty state, reveal results section
  const analysisEmptyState = document.getElementById('analysis-empty-state');
  if (analysisEmptyState) analysisEmptyState.style.display = 'none';
  if (resultsSection) resultsSection.style.display = 'flex';

  // Switch to analysis page (skip redundant non-animated sync since we animate right below)
  switchPage('analysis', { skipSync: true });

  // Render list & animate counters/chart once
  renderActiveList();
  updateStatCardCounters(true);
  setPerspectiveMode('all', true);
}
