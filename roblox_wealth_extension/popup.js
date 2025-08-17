/* popup.js */

const communityInput = document.getElementById('communityLink');
const searchBtn = document.getElementById('searchBtn');
const refreshBtn = document.getElementById('refreshBtn');
const statusP = document.getElementById('status');
const resultList = document.getElementById('resultList');

/**
 * Extracts the community ID from a given Roblox community link.
 * Supports new 2025 format `/communities/ID/<name>` and legacy `/groups/ID`.
 * @param {string} link
 * @returns {string|null}
 */
function extractCommunityId(link) {
  if (!link) return null;
  const communitiesMatch = link.match(/communities\/(\d+)/i);
  if (communitiesMatch) return communitiesMatch[1];
  const groupsMatch = link.match(/groups\/(\d+)/i);
  if (groupsMatch) return groupsMatch[1];
  // Fallback: digits between slashes
  const genericMatch = link.match(/\/([0-9]{3,})\//);
  return genericMatch ? genericMatch[1] : null;
}

function setStatus(text) {
  statusP.textContent = text;
}

function clearResults() {
  resultList.innerHTML = '';
}

function displayResults(list) {
  clearResults();
  if (!Array.isArray(list) || list.length === 0) {
    setStatus('No members or RAP data found.');
    return;
  }
  // Show only first 100 for performance
  const top = list.slice(0, 100);
  top.forEach((entry, idx) => {
    const li = document.createElement('li');
    li.textContent = `#${idx + 1} ${entry.username} - RAP: ${entry.rap.toLocaleString()}`;
    resultList.appendChild(li);
  });
  setStatus(`Showing top ${top.length} of ${list.length} members.`);
}

function toggleLoading(isLoading) {
  searchBtn.disabled = isLoading;
  refreshBtn.disabled = isLoading;
  if (isLoading) {
    setStatus('Fetching data, please wait...');
  }
}

async function fetchCommunityList(id) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'FETCH_COMMUNITY', communityId: id }, (response) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      if (response?.success) {
        resolve(response.list);
      } else {
        reject(new Error(response?.error || 'Unknown error'));
      }
    });
  });
}

async function refreshList() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'REFRESH' }, (response) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      if (response?.success) return resolve(response.list);
      reject(new Error(response?.error || 'Unknown error'));
    });
  });
}

searchBtn.addEventListener('click', async () => {
  const link = communityInput.value.trim();
  const communityId = extractCommunityId(link);
  if (!communityId) {
    setStatus('Invalid community link.');
    return;
  }
  toggleLoading(true);
  try {
    const list = await fetchCommunityList(communityId);
    displayResults(list);
    refreshBtn.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
  } finally {
    toggleLoading(false);
  }
});

refreshBtn.addEventListener('click', async () => {
  toggleLoading(true);
  try {
    const list = await refreshList();
    displayResults(list);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  } finally {
    toggleLoading(false);
  }
});

// On load: show last results if available
chrome.storage.local.get(['lastResults'], (items) => {
  if (items.lastResults) {
    displayResults(items.lastResults);
    refreshBtn.disabled = false;
  }
});