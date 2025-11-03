// popup.js (adds per-row close button + 'Close selected' with confirmation)

// Restored v3.2 behavior + multi-select drag + numbering
let allWindows = [];
let filterText = '';
let currentWindowId = null;
let collapsedWindows = {}; // windowId -> bool
const selectedTabs = new Set();
let dragGroup = null; // { ids: [...], fromWindow }

// new: holds live drag-over info so dragend can use exact drop index
let currentDrop = null; // { list, windowId, index, beforeElement }

const statusEl = () => document.getElementById('status');

// --- Badge (total tabs) ----------------------------------------------------
async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});
    const total = tabs.length;
    chrome.action.setBadgeText({ text: String(total) });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  } catch (err) {
    console.warn('updateBadge (popup) error', err);
  }
}

// --- Load windows & render ------------------------------------------------
async function loadAllWindows() {
  try {
    const current = await chrome.windows.getCurrent();
    currentWindowId = current.id;
  } catch {
    currentWindowId = null;
  }

  allWindows = await chrome.windows.getAll({ populate: true });

  // Put current window first if present
  allWindows.sort((a, b) => {
    if (a.id === currentWindowId) return -1;
    if (b.id === currentWindowId) return 1;
    return a.id - b.id;
  });

  allWindows.forEach(w => {
    if (!(w.id in collapsedWindows)) collapsedWindows[w.id] = (w.id !== currentWindowId);
  });

  populateTargetDropdown();
  renderWindows();

  await updateBadge();
}

function populateTargetDropdown() {
  const sel = document.getElementById('targetWindow');
  sel.innerHTML = '';
  const newOpt = document.createElement('option');
  newOpt.value = 'new';
  newOpt.textContent = '🆕 New Window';
  sel.appendChild(newOpt);

  allWindows.forEach((w, idx) => {
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = `${w.id === currentWindowId ? 'Current Window' : 'Window ' + (idx + 1)} (${w.tabs.length} tabs)`;
    sel.appendChild(opt);
  });

  // default to current window (user requested)
  if (currentWindowId !== null) sel.value = String(currentWindowId);
  else sel.value = 'new';
}

function renderWindows() {
  const container = document.getElementById('windowsContainer');
  container.innerHTML = '';

  allWindows.forEach((win, wIndex) => {
    const winDiv = document.createElement('div');
    winDiv.className = 'window';
    winDiv.dataset.windowId = win.id;

    const header = document.createElement('div');
    header.className = 'window-header';
    header.innerHTML = `<div><strong>${win.id === currentWindowId ? 'Current Window' : 'Window ' + (wIndex + 1)}</strong> <span class="meta">(${win.tabs.length} tabs)</span></div>
                        <div class="meta">${collapsedWindows[win.id] ? '▶' : '▼'}</div>`;
    header.addEventListener('click', () => {
      collapsedWindows[win.id] = !collapsedWindows[win.id];
      renderWindows();
    });

    winDiv.appendChild(header);

    const body = document.createElement('div');
    body.className = 'window-body';
    if (collapsedWindows[win.id]) body.classList.add('collapsed');

    // filter tabs
    const filteredTabs = win.tabs.filter(t => {
      if (!filterText) return true;
      const q = filterText.toLowerCase();
      return (t.title && t.title.toLowerCase().includes(q)) || (t.url && t.url.toLowerCase().includes(q));
    });

    if (filteredTabs.length === 0) {
      const empty = document.createElement('div');
      empty.style.padding = '8px';
      empty.style.color = '#666';
      empty.textContent = '(No matching tabs)';
      body.appendChild(empty);
    } else {
      filteredTabs.forEach((tab, indexInWindow) => {
        const row = document.createElement('div');
        row.className = 'tab-row';
        row.dataset.tabId = tab.id;
        row.dataset.windowId = win.id;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'tab-checkbox';
        checkbox.dataset.tabId = tab.id;
        checkbox.checked = selectedTabs.has(tab.id);
        checkbox.addEventListener('change', (e) => {
          const id = parseInt(e.target.dataset.tabId, 10);
          if (e.target.checked) selectedTabs.add(id);
          else selectedTabs.delete(id);
        });

        const num = document.createElement('div');
        num.className = 'tab-number';
        const displayIndex = (typeof tab.index === 'number') ? tab.index + 1 : (indexInWindow + 1);
        num.textContent = displayIndex;

        const title = document.createElement('div');
        title.className = 'tab-title';
        title.textContent = tab.title || '(No title)';
        title.title = tab.url || '';
        title.addEventListener('click', async () => {
          try {
            await chrome.windows.update(win.id, { focused: true });
            await chrome.tabs.update(tab.id, { active: true });
            statusEl().textContent = 'Jumped to tab.';
            statusEl().classList.remove('error');
          } catch (err) {
            statusEl().textContent = 'Error jumping to tab: ' + err.message;
            statusEl().classList.add('error');
          }
        });

        const info = document.createElement('div');
        info.className = 'tab-info';
        try { info.textContent = tab.url ? (new URL(tab.url)).hostname : ''; } catch { info.textContent = ''; }

        // Close (per-row) button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close';
        closeBtn.title = 'Close tab';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', async (ev) => {
          ev.stopPropagation(); // prevent other click/drag handlers
          const label = tab.title || tab.url || String(tab.id);
          const ok = confirm(`Close tab:\n${label}\n\nThis action cannot be undone.`);
          if (!ok) return;
          try {
            await chrome.tabs.remove(tab.id);
            statusEl().textContent = 'Tab closed.';
            // ensure selection state doesn't keep the removed id
            selectedTabs.delete(tab.id);
          } catch (err) {
            statusEl().textContent = 'Error closing tab: ' + (err.message || err);
            statusEl().classList.add('error');
          }
          await loadAllWindows();
        });

        row.appendChild(checkbox);
        row.appendChild(num);
        row.appendChild(title);
        row.appendChild(info);
        row.appendChild(closeBtn);

        // drag handlers
        row.draggable = true;
        row.addEventListener('dragstart', onRowDragStart);
        row.addEventListener('dragover', onRowDragOver);
        row.addEventListener('drop', onRowDrop);
        row.addEventListener('dragend', onRowDragEnd);

        body.appendChild(row);
      });
    }

    winDiv.appendChild(body);
    container.appendChild(winDiv);
  });
}

// --- Drag & drop for multi-select group ---

function onRowDragStart(e) {
  const tabId = parseInt(e.currentTarget.dataset.tabId, 10);
  const windowId = parseInt(e.currentTarget.dataset.windowId, 10);

  // Determine group: if this tab is selected, drag all selected; otherwise drag only this tab
  let idsToDrag;
  if (selectedTabs.has(tabId)) {
    idsToDrag = Array.from(selectedTabs);
  } else {
    idsToDrag = [tabId];
    // reflect selection visually
    selectedTabs.clear();
    selectedTabs.add(tabId);
    renderWindows();
  }

  dragGroup = { ids: idsToDrag.map(id => parseInt(id, 10)), fromWindow: windowId };

  try { e.dataTransfer.setData('text/plain', JSON.stringify(dragGroup)); } catch {}
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';

  // reset any existing drop state
  clearDropVisuals();
  currentDrop = null;
}

function onRowDragOver(e) {
  e.preventDefault();

  // compute drop index (do NOT move the dragging element in DOM)
  const list = e.currentTarget.parentNode;
  const windowId = parseInt(list.parentNode.dataset.windowId, 10);
  const { index, beforeElement } = computeDropIndexFromY(list, e.clientY);

  // set visual cues
  clearDropVisuals();
  if (beforeElement) {
    beforeElement.classList.add('drop-before');
  } else {
    // when dropping at end, highlight last element's after state (or nothing)
    const els = list.querySelectorAll('.tab-row');
    if (els.length) els[els.length - 1].classList.add('drop-after');
  }

  // store drop info for dragend
  currentDrop = { list, windowId, index, beforeElement };
}

function onRowDrop(e) {
  e.preventDefault();
  // no-op: actual apply logic in dragend (we keep drop info in currentDrop)
}

async function onRowDragEnd(e) {
  e.currentTarget.classList.remove('dragging');

  try {
    // get dropped payload
    let dropped = dragGroup;
    try {
      const dt = e.dataTransfer.getData('text/plain');
      if (dt) {
        const parsed = JSON.parse(dt);
        if (parsed && parsed.ids) dropped = parsed;
      }
    } catch {}

    if (!dropped) {
      dragGroup = null;
      clearDropVisuals();
      currentDrop = null;
      return;
    }

    // determine destination window & index
    let destWindowId, insertIndex;
    if (currentDrop) {
      destWindowId = currentDrop.windowId;
      insertIndex = currentDrop.index;
    } else {
      // fallback: use the parent list of the element where drag ended
      const list = e.currentTarget.parentNode;
      destWindowId = parseInt(list.parentNode.dataset.windowId, 10);
      const rows = Array.from(list.querySelectorAll('.tab-row'));
      insertIndex = rows.length;
    }

    if (dropped.fromWindow === destWindowId) {
      // same window reorder: build desired order by removing moved ids and inserting at insertIndex
      const win = await chrome.windows.get(destWindowId, { populate: true });
      const currentIds = win.tabs.map(t => t.id);
      // remove moved ids preserving order
      const remaining = currentIds.filter(id => !dropped.ids.includes(id));
      const insertAt = Math.min(Math.max(0, insertIndex), remaining.length);
      const desiredOrder = [...remaining.slice(0, insertAt), ...dropped.ids, ...remaining.slice(insertAt)];
      await applyReorderWithinWindow(destWindowId, dropped.ids, desiredOrder);
    } else {
      // cross-window: insert moved ids into destination at insertIndex
      const destWin = await chrome.windows.get(destWindowId, { populate: true });
      const destCurrent = destWin.tabs.map(t => t.id);
      const insertAt = Math.min(Math.max(0, insertIndex), destCurrent.length);
      const desiredOrder = [...destCurrent.slice(0, insertAt), ...dropped.ids, ...destCurrent.slice(insertAt)];
      await moveGroupToDifferentWindow(dropped.ids, dropped.fromWindow, destWindowId, desiredOrder);
    }
  } catch (err) {
    console.error('Drag end error', err);
  } finally {
    dragGroup = null;
    clearDropVisuals();
    currentDrop = null;
    await loadAllWindows();
  }
}

function clearDropVisuals() {
  document.querySelectorAll('.tab-row.drop-before, .tab-row.drop-after').forEach(el => {
    el.classList.remove('drop-before', 'drop-after');
  });
}

// compute drop index (0..n) and return beforeElement (null if at end)
function computeDropIndexFromY(container, clientY) {
  const rows = Array.from(container.querySelectorAll('.tab-row:not(.dragging)'));
  if (!rows.length) return { index: 0, beforeElement: null };
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const child of rows) {
    const box = child.getBoundingClientRect();
    const offset = clientY - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: child };
    }
  }
  if (!closest.element) {
    // drop at end
    return { index: rows.length, beforeElement: null };
  } else {
    const idx = rows.indexOf(closest.element);
    return { index: idx, beforeElement: closest.element };
  }
}

// --- Deterministic reorder algorithm (same-window) -----------------------
async function applyReorderWithinWindow(windowId, movedIds, newOrderIds) {
  try {
    const win = await chrome.windows.get(windowId, { populate: true });
    if (!win || !win.tabs) return;

    const currentIds = win.tabs.map(t => t.id);
    if (newOrderIds.length !== currentIds.length) {
      for (let i = 0; i < newOrderIds.length; i++) {
        const id = newOrderIds[i];
        try { await chrome.tabs.move(id, { index: i }); } catch (e) { /* ignore */ }
      }
      statusEl().textContent = `Reordered ${movedIds.length} tab(s) in window ${windowId}.`;
      return;
    }

    const live = currentIds.slice();

    for (let targetIndex = 0; targetIndex < newOrderIds.length; targetIndex++) {
      const desiredId = newOrderIds[targetIndex];
      const currentIndex = live.indexOf(desiredId);
      if (currentIndex === -1) continue;
      if (currentIndex === targetIndex) continue;

      try {
        await chrome.tabs.move(desiredId, { index: targetIndex });
      } catch (err) {
        console.warn('applyReorderWithinWindow: move failed', desiredId, err);
        continue;
      }

      live.splice(currentIndex, 1);
      live.splice(targetIndex, 0, desiredId);
    }

    statusEl().textContent = `Reordered ${movedIds.length} tab(s) in window ${windowId}.`;
  } catch (err) {
    console.error('applyReorderWithinWindow error', err);
  }
}

// --- Cross-window move respecting desired destination order ----------------
async function moveGroupToDifferentWindow(ids, fromWindow, toWindow, desiredDestOrder) {
  try {
    const desiredIndexMap = {};
    desiredDestOrder.forEach((id, idx) => {
      if (ids.includes(id)) desiredIndexMap[id] = idx;
    });

    const idsSortedByTarget = ids.slice().sort((a, b) => (desiredIndexMap[a] || 0) - (desiredIndexMap[b] || 0));

    for (const id of idsSortedByTarget) {
      let idx = desiredIndexMap[id];
      if (typeof idx !== 'number') idx = -1;
      try {
        await chrome.tabs.move(id, { windowId: toWindow, index: idx });
      } catch (err) {
        console.warn('move cross-window failed', id, err);
        try { await chrome.tabs.move(id, { windowId: toWindow, index: -1 }); } catch {}
      }
    }

    statusEl().textContent = `Moved ${ids.length} tab(s) to window ${toWindow}.`;
  } catch (err) {
    console.error('moveGroupToDifferentWindow error', err);
  }
}

// --- Move selected via controls (1-based user input) -----------------------
async function moveSelected() {
  const selected = Array.from(selectedTabs);
  if (selected.length === 0) {
    statusEl().textContent = 'No tabs selected.';
    return;
  }

  const targetVal = document.getElementById('targetWindow').value;
  const posInput = document.getElementById('positionInput').value.trim();

  // Interpret position as 1-based for users (enter 1 to mean first slot).
  const pos = posInput === '' ? null : Math.max(1, parseInt(posInput, 10)) - 1;

  statusEl().textContent = 'Working...';
  statusEl().classList.remove('error');

  try {
    if (targetVal === 'new') {
      const firstId = selected[0];
      const rest = selected.slice(1);
      const newWin = await chrome.windows.create({ tabId: firstId });
      if (rest.length) {
        for (const t of rest) {
          await chrome.tabs.move(t, { windowId: newWin.id, index: -1 });
        }
      }
      statusEl().textContent = `Moved ${selected.length} tab(s) to new window (${newWin.id}).`;
    } else {
      const targetWindowId = parseInt(targetVal, 10);
      const targetWinObj = allWindows.find(w => w.id === targetWindowId);

      const selectedObjs = [];
      for (const w of allWindows) {
        for (const t of w.tabs) {
          if (selected.includes(t.id)) selectedObjs.push({ ...t, windowId: w.id });
        }
      }

      selectedObjs.sort((a, b) => a.index - b.index);
      const selectedIdsOrdered = selectedObjs.map(x => x.id);

      const sameWindow = selectedObjs.every(t => t.windowId === targetWindowId);

      if (sameWindow) {
        const tabsInWindow = targetWinObj.tabs.map(t => t.id);
        const remaining = tabsInWindow.filter(id => !selectedIdsOrdered.includes(id));
        const insertAt = (pos === null) ? remaining.length : Math.min(pos, remaining.length);
        const desiredOrder = [...remaining.slice(0, insertAt), ...selectedIdsOrdered, ...remaining.slice(insertAt)];
        // clear selection BEFORE reload so UI matches internal state
        selectedTabs.clear();
        await applyReorderWithinWindow(targetWindowId, selectedIdsOrdered, desiredOrder);
        statusEl().textContent = `Moved ${selected.length} tab(s) within window ${targetWindowId}.`;
      } else {
        const destCurrent = targetWinObj ? targetWinObj.tabs.map(t => t.id) : [];
        const insertAt = (pos === null) ? destCurrent.length : Math.min(pos, destCurrent.length);
        const desiredDestOrder = [...destCurrent.slice(0, insertAt), ...selectedIdsOrdered, ...destCurrent.slice(insertAt)];

        // clear selection BEFORE moving to keep UI consistent
        selectedTabs.clear();
        for (let targetIndex = 0; targetIndex < desiredDestOrder.length; targetIndex++) {
          const id = desiredDestOrder[targetIndex];
          if (!selectedIdsOrdered.includes(id)) continue;
          try {
            await chrome.tabs.move(id, { windowId: targetWindowId, index: targetIndex });
          } catch (err) {
            console.warn('moveSelected cross-window move failed', id, err);
            try { await chrome.tabs.move(id, { windowId: targetWindowId, index: -1 }); } catch {}
          }
        }
        statusEl().textContent = `Moved ${selected.length} tab(s) to window ${targetWindowId} at position ${insertAt + 1}.`;
      }
    }
  } catch (err) {
    statusEl().textContent = 'Error moving tabs: ' + (err.message || err);
    statusEl().classList.add('error');
    console.error(err);
  }

  // Refresh and reflect cleared selection
  await loadAllWindows();
}

// --- New: Close selected with confirmation -------------------------------
async function closeSelected() {
  const selected = Array.from(selectedTabs);
  if (selected.length === 0) {
    statusEl().textContent = 'No tabs selected to close.';
    return;
  }

  const ok = confirm(`Close ${selected.length} selected tab(s)? This cannot be undone.`);
  if (!ok) return;

  statusEl().textContent = 'Closing...';
  statusEl().classList.remove('error');

  try {
    // chrome.tabs.remove accepts array; but use sequential removes to keep deterministic updates
    for (const id of selected) {
      try {
        await chrome.tabs.remove(id);
      } catch (err) {
        // ignore individual errors but warn
        console.warn('closeSelected: failed to remove', id, err);
      }
      // ensure internal state does not keep removed id
      selectedTabs.delete(id);
    }
    statusEl().textContent = `Closed ${selected.length} tab(s).`;
  } catch (err) {
    statusEl().textContent = 'Error closing tabs: ' + (err.message || err);
    statusEl().classList.add('error');
    console.error(err);
  }

  await loadAllWindows();
}

// Jump to first selected
async function activateSelected() {
  const selected = Array.from(selectedTabs);
  if (selected.length === 0) {
    statusEl().textContent = 'No tabs selected to jump to.';
    return;
  }
  const id = selected[0];
  for (const w of allWindows) {
    const t = w.tabs.find(x => x.id === id);
    if (t) {
      try {
        await chrome.windows.update(w.id, { focused: true });
        await chrome.tabs.update(id, { active: true });
        statusEl().textContent = 'Jumped to selected tab.';
      } catch (err) {
        statusEl().textContent = 'Error jumping to tab: ' + err.message;
        statusEl().classList.add('error');
      }
      break;
    }
  }
}

// Utility functions
function clearSelection() {
  selectedTabs.clear();
  renderWindows();
}
function selectAllVisible() {
  const checkboxes = Array.from(document.querySelectorAll('.tab-checkbox'));
  checkboxes.forEach(cb => {
    const row = cb.closest('.tab-row');
    const body = cb.closest('.window-body');

    // skip if window is collapsed (not visible)
    if (body && body.classList.contains('collapsed')) return;

    // skip if row is not rendered or visually hidden
    const style = window.getComputedStyle(row);
    if (!row || style.display === 'none' || style.visibility === 'hidden') return;

    const id = parseInt(cb.dataset.tabId, 10);
    selectedTabs.add(id);
  });

  renderWindows();
}

// Wire UI
document.getElementById('search').addEventListener('input', (e) => {
  filterText = e.target.value.trim().toLowerCase();
  renderWindows();
});
document.getElementById('moveBtn').addEventListener('click', moveSelected);
document.getElementById('activateBtn').addEventListener('click', activateSelected);
document.getElementById('clearBtn').addEventListener('click', () => { clearSelection(); statusEl().textContent = ''; });
document.getElementById('selectAllBtn').addEventListener('click', () => { selectAllVisible(); statusEl().textContent = 'All visible tabs selected.'; });

// new close selected button
const closeSelectedBtn = document.getElementById('closeSelectedBtn');
if (closeSelectedBtn) closeSelectedBtn.addEventListener('click', closeSelected);

document.getElementById('targetWindow').addEventListener('change', () => { /* noop */ });

async function init() {
  await loadAllWindows();
  statusEl().textContent = '';
  await updateBadge();
}
init();
