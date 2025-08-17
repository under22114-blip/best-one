/* eslint-disable no-undef */
// background.js (service worker)
// Handles fetching Roblox community members, calculating RAP, and caching results.

const LIMITED_THRESHOLD = 10000; // Only count limited items with RAP > 10k
const CONCURRENCY_LIMIT = 15; // Number of simultaneous requests for RAP fetching

/**
 * Utility: async pool to limit concurrency.
 * @param {number} poolLimit
 * @param {Array<any>} array
 * @param {(item:any,index:number)=>Promise<any>} iteratorFn
 */
async function asyncPool(poolLimit, array, iteratorFn) {
  const ret = [];
  const executing = [];
  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item, array.indexOf(item)));
    ret.push(p);
    if (poolLimit <= array.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= poolLimit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(ret);
}

/**
 * Fetch all members of a Roblox community (group).
 * @param {string|number} communityId
 * @returns {Promise<Array<{userId:number,username:string}>>}
 */
async function fetchAllMembers(communityId) {
  const members = [];
  let cursor = '';
  const limit = 100; // Max allowed by API
  while (true) {
    const url = `https://groups.roblox.com/v1/groups/${communityId}/users?limit=${limit}&sortOrder=Asc&cursor=${cursor}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch members: ${res.status}`);
    }
    const data = await res.json();
    for (const entry of data.data || []) {
      members.push({ userId: entry.user.userId, username: entry.user.username });
    }
    if (!data.nextPageCursor) break;
    cursor = data.nextPageCursor;
  }
  return members;
}

/**
 * Fetch the total RAP of a user's limited items greater than threshold.
 * @param {number} userId
 * @returns {Promise<number>} total RAP
 */
async function fetchUserRAP(userId) {
  let rap = 0;
  let cursor = '';
  const limit = 100;
  while (true) {
    const url = `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=${limit}&sortOrder=Asc&cursor=${cursor}`;
    const res = await fetch(url);
    if (!res.ok) {
      // Skip on error to avoid halting whole processing
      console.warn(`Failed to fetch collectibles for user ${userId}: ${res.status}`);
      break;
    }
    const data = await res.json();
    for (const item of data.data || []) {
      const price = item.recentAveragePrice || 0;
      if (price >= LIMITED_THRESHOLD) rap += price;
    }
    if (!data.nextPageCursor) break;
    cursor = data.nextPageCursor;
  }
  return rap;
}

/**
 * Process community: fetch members, compute RAP, rank users.
 * @param {string|number} communityId
 * @returns {Promise<Array<{username:string, rap:number}>>}
 */
async function processCommunity(communityId) {
  const members = await fetchAllMembers(communityId);

  // Compute RAP with limited concurrency
  const rapResults = {};
  await asyncPool(CONCURRENCY_LIMIT, members, async (member) => {
    const rap = await fetchUserRAP(member.userId);
    rapResults[member.userId] = rap;
  });

  const ranked = members
    .map((m) => ({ username: m.username, rap: rapResults[m.userId] || 0 }))
    .sort((a, b) => b.rap - a.rap);

  // Cache results
  await chrome.storage.local.set({ lastCommunityId: communityId, lastResults: ranked });
  return ranked;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'FETCH_COMMUNITY') {
    const { communityId } = message;
    processCommunity(communityId)
      .then((list) => sendResponse({ success: true, list }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep the message channel open for async response
  }

  if (message?.type === 'REFRESH') {
    chrome.storage.local.get(['lastCommunityId'], (items) => {
      if (items.lastCommunityId) {
        processCommunity(items.lastCommunityId)
          .then((list) => sendResponse({ success: true, list }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
      } else {
        sendResponse({ success: false, error: 'No previous community searched.' });
      }
    });
    return true;
  }
});