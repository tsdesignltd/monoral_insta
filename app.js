const driveFolderUrl = 'https://drive.google.com/drive/u/2/folders/1-qyygiLBAEwG8_Po0dwhog-PgkVqfiWX';
const driveFolderId = '1-qyygiLBAEwG8_Po0dwhog-PgkVqfiWX';
const instagramUrl = 'https://www.instagram.com/monoral_outdoor/';
const driveScope = 'https://www.googleapis.com/auth/drive.readonly';
const defaultGoogleClientId = '728021192860-rv5fnl6clav3mbjujfqjv8vupjl2hgjc.apps.googleusercontent.com';
const defaultInstagramAccountId = '17841403518578706';
const instagramTokenStorageKey = 'insta.instagramAccessToken';
const queueStorageKey = 'insta.approvalQueue';
const driveCacheDatabaseName = 'monoral-insta-cache';
const driveCacheStoreName = 'drive-catalog';
const driveCacheRecordKey = 'current';
const latestPageSize = 30;
const visiblePhotoGridRows = 3;

let photos = [];
let photographerFolders = [];
let focusedId = null;
let filter = 'all';
let selectedPhotographer = 'all';
let queue = loadStoredQueue();
let tokenClient = null;
let accessToken = '';
let latestOffsets = {};
let driveCacheSaveTimer = null;

const syncDrive = document.querySelector('#syncDrive');
const googleClientId = document.querySelector('#googleClientId');
const instagramBusinessId = document.querySelector('#instagramBusinessId');
const instagramAccessToken = document.querySelector('#instagramAccessToken');
const toggleInstagramToken = document.querySelector('#toggleInstagramToken');
const verifyInstagramConnection = document.querySelector('#verifyInstagramConnection');
const clearInstagramToken = document.querySelector('#clearInstagramToken');
const instagramTokenStatus = document.querySelector('#instagramTokenStatus');
const instagramConnectionPill = document.querySelector('#instagramConnectionPill');
const syncStatus = document.querySelector('#syncStatus');
const photographerSelect = document.querySelector('#photographerSelect');
const latestByPhotographer = document.querySelector('#latestByPhotographer');
const photoGrid = document.querySelector('#photoGrid');
const previewFrame = document.querySelector('.preview-frame');
const previewImage = document.querySelector('#previewImage');
const caption = document.querySelector('#caption');
const generateCaption = document.querySelector('#generateCaption');
const hashtags = document.querySelector('#hashtags');
const postType = document.querySelector('#postType');
const queueList = document.querySelector('#queueList');
const addToQueue = document.querySelector('#addToQueue');
const exportPlan = document.querySelector('#exportPlan');

googleClientId.value = localStorage.getItem('instaha.googleClientId') || defaultGoogleClientId;
instagramBusinessId.value = localStorage.getItem('insta.instagramBusinessId') || defaultInstagramAccountId;
instagramAccessToken.value = localStorage.getItem(instagramTokenStorageKey) || '';
syncDrive.dataset.label = syncDrive.textContent.trim();

function loadStoredQueue() {
  try {
    const storedQueue = JSON.parse(localStorage.getItem(queueStorageKey) || '[]');
    if (!Array.isArray(storedQueue)) return [];

    return storedQueue.map((item) => ({
      ...item,
      status: item.status === 'posting' ? 'failed' : item.status,
      error: item.status === 'posting' ? '投稿処理が中断されました。再度実行してください。' : item.error
    }));
  } catch {
    return [];
  }
}

function saveQueue() {
  localStorage.setItem(queueStorageKey, JSON.stringify(queue));
}

function openDriveCacheDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(driveCacheDatabaseName, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(driveCacheStoreName)) {
        database.createObjectStore(driveCacheStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readDriveCatalogCache() {
  const database = await openDriveCacheDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(driveCacheStoreName, 'readonly');
    const request = transaction.objectStore(driveCacheStoreName).get(driveCacheRecordKey);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

async function writeDriveCatalogCache() {
  const database = await openDriveCacheDatabase();
  const catalog = {
    version: 1,
    savedAt: new Date().toISOString(),
    driveFolderId,
    photographerFolders,
    photos
  };

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(driveCacheStoreName, 'readwrite');
    transaction.objectStore(driveCacheStoreName).put(catalog, driveCacheRecordKey);

    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

function scheduleDriveCatalogSave() {
  window.clearTimeout(driveCacheSaveTimer);
  driveCacheSaveTimer = window.setTimeout(() => {
    writeDriveCatalogCache().catch(() => {
      setSyncStatus('写真キャッシュの保存に失敗しました。Drive同期を再実行してください。', 'error');
    });
  }, 250);
}

async function restoreDriveCatalogCache() {
  try {
    const catalog = await readDriveCatalogCache();
    if (!catalog || catalog.driveFolderId !== driveFolderId) return;

    photographerFolders = Array.isArray(catalog.photographerFolders) ? catalog.photographerFolders : [];
    photos = Array.isArray(catalog.photos) ? catalog.photos.sort(sortNewestFirst) : [];
    focusedId = photos[0]?.id || null;
    selectedPhotographer = 'all';
    latestOffsets = {};

    if (photos.length || photographerFolders.length) {
      const savedAt = catalog.savedAt ? formatScheduledAt(catalog.savedAt) : '';
      setSyncStatus(`前回キャッシュを表示中: 写真${photos.length}枚${savedAt ? `（${savedAt}保存）` : ''}`, 'cached');
      render();
    }
  } catch {
    setSyncStatus('写真キャッシュを読み込めませんでした。Drive同期で再取得してください。', 'error');
  }
}

function updateInstagramTokenStatus(message) {
  const hasToken = Boolean(instagramAccessToken.value.trim());
  const isAppToken = hasToken && isMetaAppAccessToken(instagramAccessToken.value.trim());
  instagramTokenStatus.textContent = message || (isAppToken
    ? 'このトークンはアプリトークンのため投稿に使用できません。Instagramユーザートークンを取得してください。'
    : hasToken
      ? 'アクセストークンはこのブラウザに保存されています。接続確認を実行してください。'
      : 'Instagramユーザートークンを入力すると、このブラウザに保存されます。');
  instagramTokenStatus.dataset.saved = String(hasToken);
  instagramTokenStatus.dataset.invalid = String(isAppToken);
  clearInstagramToken.disabled = !hasToken;
  verifyInstagramConnection.disabled = !hasToken || isAppToken;

  if (!hasToken || isAppToken) {
    setInstagramConnectionState(isAppToken ? 'アプリトークンは使用不可' : 'Meta API 接続待ち', isAppToken ? 'error' : 'idle');
  }
}

function saveInstagramToken() {
  const token = instagramAccessToken.value.trim();

  if (token) {
    localStorage.setItem(instagramTokenStorageKey, token);
  } else {
    localStorage.removeItem(instagramTokenStorageKey);
  }

  updateInstagramTokenStatus();
}

function isMetaAppAccessToken(token) {
  return /^\d+\|/.test(token);
}

function setInstagramConnectionState(message, tone = 'idle') {
  instagramConnectionPill.textContent = message;
  instagramConnectionPill.dataset.tone = tone;
}

async function fetchInstagramProfile(token) {
  const requestProfile = async (fields) => {
    const url = new URL(instagramGraphUrl('me'));
    url.searchParams.set('fields', fields);
    url.searchParams.set('access_token', token);
    const response = await fetch(url);
    const result = await response.json();
    return { response, result };
  };

  let profileResponse = await requestProfile('user_id,username');
  if (!profileResponse.response.ok && /field|user_id/i.test(profileResponse.result.error?.message || '')) {
    profileResponse = await requestProfile('id,username');
  }

  if (!profileResponse.response.ok) {
    throw new Error(profileResponse.result.error?.message || 'Instagramアカウント情報を取得できませんでした。');
  }

  const accountId = String(profileResponse.result.user_id || profileResponse.result.id || '').trim();
  if (!accountId) {
    throw new Error('Instagram Account IDを取得できませんでした。トークンの権限を確認してください。');
  }

  return {
    accountId,
    username: profileResponse.result.username || ''
  };
}

async function verifyAndStoreInstagramConnection() {
  const token = instagramAccessToken.value.trim();
  if (!token) {
    throw new Error('Instagramユーザーアクセストークンを入力してください。');
  }
  if (isMetaAppAccessToken(token)) {
    throw new Error('アプリアクセストークンは投稿に使用できません。Instagram Loginで取得したユーザーアクセストークンが必要です。');
  }

  const profile = await fetchInstagramProfile(token);
  instagramBusinessId.value = profile.accountId;
  localStorage.setItem('insta.instagramBusinessId', profile.accountId);
  localStorage.setItem(instagramTokenStorageKey, token);
  setInstagramConnectionState(profile.username ? `@${profile.username} 接続済み` : 'Instagram 接続済み', 'success');
  updateInstagramTokenStatus(`接続成功: ${profile.username ? `@${profile.username} / ` : ''}Account ID ${profile.accountId}`);
  return profile;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setSyncStatus(message, tone = 'muted') {
  syncStatus.textContent = message;
  syncStatus.dataset.tone = tone;
}

function setBusy(isBusy) {
  document.body.classList.toggle('is-busy', isBusy);
  document.body.setAttribute('aria-busy', String(isBusy));
  syncDrive.classList.toggle('is-loading', isBusy);
  syncDrive.disabled = isBusy;
  syncDrive.textContent = isBusy ? '同期中' : syncDrive.dataset.label;
}

function escapeDriveQueryValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function driveThumbnail(file, size = 900) {
  if (file.thumbnailLink) return file.thumbnailLink.replace(/=s\d+$/, `=s${size}`);
  return `https://drive.google.com/thumbnail?id=${file.id}&sz=w${size}`;
}

function driveViewUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

function driveDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

function instagramGraphUrl(path) {
  return `https://graph.instagram.com/v25.0/${path}`;
}

async function postToInstagram(item) {
  const token = instagramAccessToken.value.trim();

  if (!token) {
    throw new Error('Instagramユーザーアクセストークンを入力してください。');
  }
  if (isMetaAppAccessToken(token)) {
    throw new Error('アプリアクセストークンは投稿に使用できません。Instagramユーザーアクセストークンを取得してください。');
  }

  const profile = await fetchInstagramProfile(token);
  const igUserId = profile.accountId;
  instagramBusinessId.value = igUserId;
  localStorage.setItem('insta.instagramBusinessId', igUserId);
  localStorage.setItem(instagramTokenStorageKey, token);
  setInstagramConnectionState(profile.username ? `@${profile.username} 接続済み` : 'Instagram 接続済み', 'success');

  if (item.type !== 'フィード投稿') {
    throw new Error('現在の実投稿はフィード投稿のみ対応しています。リール/ストーリーズはMeta API設定を追加してください。');
  }

  const captionText = `${item.caption}\n\n${item.hashtags}`.trim();
  const imageUrl = item.publishImageUrl || item.originalUrl;
  if (!imageUrl) {
    throw new Error('投稿用の画像URLがありません。Drive同期から写真を追加してください。');
  }

  const createParams = new URLSearchParams({
    image_url: imageUrl,
    caption: captionText,
    access_token: token
  });

  const createResponse = await fetch(instagramGraphUrl(`${encodeURIComponent(igUserId)}/media`), {
    method: 'POST',
    body: createParams
  });
  const createResult = await createResponse.json();

  if (!createResponse.ok || !createResult.id) {
    throw new Error(createResult.error?.message || 'Instagramメディア作成に失敗しました。');
  }

  const publishParams = new URLSearchParams({
    creation_id: createResult.id,
    access_token: token
  });

  const publishResponse = await fetch(instagramGraphUrl(`${encodeURIComponent(igUserId)}/media_publish`), {
    method: 'POST',
    body: publishParams
  });
  const publishResult = await publishResponse.json();

  if (!publishResponse.ok || !publishResult.id) {
    throw new Error(publishResult.error?.message || 'Instagram投稿公開に失敗しました。');
  }

  return {
    creationId: createResult.id,
    mediaId: publishResult.id
  };
}

async function loadGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return;

  await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        window.clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > 8000) {
        window.clearInterval(timer);
        reject(new Error('Google Identity Servicesを読み込めませんでした。'));
      }
    }, 100);
  });
}

async function getAccessToken() {
  const clientId = googleClientId.value.trim();
  if (!clientId) {
    throw new Error('Google OAuth Client IDを入力してください。');
  }

  localStorage.setItem('instaha.googleClientId', clientId);
  await loadGoogleIdentity();

  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: driveScope,
      callback: (response) => {
        if (response?.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        accessToken = response.access_token;
        resolve(accessToken);
      }
    });

    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  });
}

async function driveList(params) {
  if (!accessToken) await getAccessToken();

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 401) {
    accessToken = '';
    await getAccessToken();
    return driveList(params);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Drive API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

async function listAllDriveFiles(params) {
  const files = [];
  let pageToken = '';

  do {
    const page = await driveList({
      ...params,
      pageSize: '1000',
      ...(pageToken ? { pageToken } : {})
    });
    files.push(...(page.files || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);

  return files;
}

function mapDrivePhoto(file, photographer, folderPath) {
  return {
    id: file.id,
    name: file.name,
    src: driveThumbnail(file),
    originalUrl: file.webContentLink || driveViewUrl(file.id),
    publishImageUrl: driveDownloadUrl(file.id),
    webViewLink: file.webViewLink || driveViewUrl(file.id),
    mimeType: file.mimeType,
    width: file.imageMediaMetadata?.width,
    height: file.imageMediaMetadata?.height,
    modifiedTime: file.modifiedTime,
    createdTime: file.createdTime,
    folderPath,
    score: 3,
    status: 'selected',
    angle: '撮影者フォルダ配下から同期した最新写真',
    photographerId: photographer.id,
    photographerName: photographer.name
  };
}

async function listImagesUnderFolder(folder, photographer, folderPath, visitedFolderIds = new Set()) {
  if (visitedFolderIds.has(folder.id)) return [];
  visitedFolderIds.add(folder.id);

  const parentId = escapeDriveQueryValue(folder.id);
  const [imageFiles, childFolders] = await Promise.all([
    listAllDriveFiles({
      q: `'${parentId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, thumbnailLink, webContentLink, webViewLink, modifiedTime, createdTime, imageMediaMetadata(width, height))',
      orderBy: 'modifiedTime desc'
    }),
    listAllDriveFiles({
      q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'nextPageToken, files(id, name, modifiedTime, createdTime, webViewLink)',
      orderBy: 'name'
    })
  ]);

  const photosInFolder = imageFiles.map((file) => mapDrivePhoto(file, photographer, folderPath));
  const photosInChildren = [];

  for (const childFolder of childFolders) {
    const childPath = `${folderPath} / ${childFolder.name}`;
    const childPhotos = await listImagesUnderFolder(childFolder, photographer, childPath, visitedFolderIds);
    photosInChildren.push(...childPhotos);
  }

  return [...photosInFolder, ...photosInChildren];
}

async function syncDrivePhotos() {
  setBusy(true);
  setSyncStatus(photos.length ? 'キャッシュとの差分を確認しています...' : 'Google認証を開始しています...', 'loading');

  try {
    await getAccessToken();
    setSyncStatus('撮影者フォルダを読み込んでいます...', 'loading');

    const rootId = escapeDriveQueryValue(driveFolderId);
    const folders = await listAllDriveFiles({
      q: `'${rootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'nextPageToken, files(id, name, modifiedTime, createdTime, webViewLink)',
      orderBy: 'name'
    });

    const nextPhotographerFolders = folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      modifiedTime: folder.modifiedTime,
      createdTime: folder.createdTime,
      webViewLink: folder.webViewLink
    }));

    setSyncStatus(`撮影者${nextPhotographerFolders.length}件の差分を確認しています...`, 'loading');

    const allPhotos = [];
    for (const [index, folder] of nextPhotographerFolders.entries()) {
      setSyncStatus(`${index + 1}/${nextPhotographerFolders.length}: ${folder.name} の差分を確認しています...`, 'loading');
      const folderPhotos = await listImagesUnderFolder(folder, folder, folder.name);
      allPhotos.push(...folderPhotos);
    }

    const cachedPhotosById = new Map(photos.map((photo) => [photo.id, photo]));
    let addedCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;

    const nextPhotos = allPhotos.map((photo) => {
      const cachedPhoto = cachedPhotosById.get(photo.id);
      if (!cachedPhoto) {
        addedCount += 1;
        return photo;
      }

      const hasChanged = cachedPhoto.modifiedTime !== photo.modifiedTime
        || cachedPhoto.name !== photo.name
        || cachedPhoto.folderPath !== photo.folderPath
        || cachedPhoto.photographerId !== photo.photographerId;

      if (hasChanged) {
        updatedCount += 1;
      } else {
        unchangedCount += 1;
      }

      return {
        ...photo,
        score: cachedPhoto.score ?? photo.score,
        status: cachedPhoto.status || photo.status,
        angle: cachedPhoto.angle || photo.angle
      };
    });

    const nextPhotoIds = new Set(nextPhotos.map((photo) => photo.id));
    const deletedCount = photos.filter((photo) => !nextPhotoIds.has(photo.id)).length;

    photographerFolders = nextPhotographerFolders;
    photos = nextPhotos.sort(sortNewestFirst);
    selectedPhotographer = 'all';
    latestOffsets = {};
    focusedId = photos.some((photo) => photo.id === focusedId) ? focusedId : (photos[0]?.id || null);
    await writeDriveCatalogCache();
    setSyncStatus(
      `差分同期完了: 新規${addedCount}枚・更新${updatedCount}枚・削除${deletedCount}枚・変更なし${unchangedCount}枚`,
      'success'
    );
    render();
  } catch (error) {
    setSyncStatus(error.message || 'Drive同期に失敗しました。', 'error');
  } finally {
    setBusy(false);
  }
}

function buildCaption(photo) {
  if (!photo) return '';
  return `自然の中で、必要なものだけを研ぎ澄ます。\n\n${photo.angle}を伝える1枚として、MONORAL OUTDOORの道具がある時間を切り取ります。`;
}

function captionSeed(photo) {
  return Array.from(`${photo.id}${photo.name}${photo.folderPath || ''}`)
    .reduce((total, char) => total + char.charCodeAt(0), 0);
}

function sceneWords(photo) {
  const source = `${photo.name} ${photo.folderPath || ''}`.toLowerCase();
  const words = [];

  if (/fire|焚|薪|stove|flame/.test(source)) words.push('火を囲む時間');
  if (/snow|雪|winter|冬/.test(source)) words.push('冷えた空気');
  if (/sea|ocean|beach|海|浜/.test(source)) words.push('水辺の余白');
  if (/mount|山|trail|hike|forest|森/.test(source)) words.push('山の静けさ');
  if (/coffee|朝|morning|breakfast/.test(source)) words.push('朝の支度');
  if (/chair|table|gear|道具|ギア/.test(source)) words.push('道具の佇まい');

  return words.length ? words : ['外で過ごす時間'];
}

function generateMonoralCaption(photo) {
  if (!photo) return '';

  const scenes = sceneWords(photo);
  const scene = scenes[captionSeed(photo) % scenes.length];
  const templates = [
    `${scene}に、必要なものだけを持ち込む。\n\n大きく足さず、静かに整える。\nMONORAL OUTDOORの道具は、そんな時間のそばにあります。`,
    `火を眺める、座る、湯を沸かす。\n\nひとつひとつの動作が、外で過ごす時間を少しだけ深くしてくれる。\n\nMONORAL OUTDOOR`,
    `${scene}の中で、道具が景色に馴染んでいく。\n\n使うほどに自然になり、必要な瞬間だけしっかり応える。`,
    `余白のある場所へ。\n\n軽く、強く、無理なく使えること。\nMONORAL OUTDOORが大切にしている感覚です。`
  ];

  return templates[captionSeed(photo) % templates.length]
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function defaultHashtags() {
  return '#monoral #焚き火台 #ミニマルキャンプ #軽量焚き火台 #microcamping #ワイヤフレーム #wireflame';
}

function localDateTimeValue(date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatScheduledAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function sortNewestFirst(photoA, photoB) {
  const timeA = new Date(photoA.modifiedTime || photoA.createdTime || 0).getTime();
  const timeB = new Date(photoB.modifiedTime || photoB.createdTime || 0).getTime();
  return timeB - timeA;
}

function renderLatestByPhotographer() {
  if (!photographerFolders.length) {
    latestByPhotographer.innerHTML = `
      <div class="empty-grid">
        <strong>撮影者フォルダを同期すると、ここに最新30枚ずつ表示します。</strong>
        <span>Drive直下の各サブフォルダを撮影者として読み込み、その中の写真を更新日時の新しい順に並べます。</span>
      </div>
    `;
    return;
  }

  latestByPhotographer.innerHTML = photographerFolders.map((folder) => {
    const allFolderPhotos = photos
      .filter((photo) => photo.photographerId === folder.id)
      .sort(sortNewestFirst);
    const lastPageOffset = allFolderPhotos.length
      ? Math.floor((allFolderPhotos.length - 1) / latestPageSize) * latestPageSize
      : 0;
    const offset = Math.min(latestOffsets[folder.id] || 0, lastPageOffset);
    const folderPhotos = allFolderPhotos.slice(offset, offset + latestPageSize);
    const from = allFolderPhotos.length ? offset + 1 : 0;
    const to = Math.min(offset + latestPageSize, allFolderPhotos.length);
    const canGoPrev = offset > 0;
    const canGoNext = offset + latestPageSize < allFolderPhotos.length;

    const photoCells = folderPhotos.length ? folderPhotos.map((photo) => `
      <button class="latest-photo" type="button" data-id="${escapeHtml(photo.id)}" aria-label="${escapeHtml(`${folder.name} ${photo.name}`)}">
        <img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.name)}">
        <span>${escapeHtml(photo.name)}</span>
        <small>${escapeHtml(photo.folderPath || folder.name)}</small>
      </button>
    `).join('') : '<p class="latest-empty">この撮影者フォルダには写真がありません。</p>';

    return `
      <article class="photographer-row">
        <div class="photographer-row-head">
          <div>
            <h4>${escapeHtml(folder.name)}</h4>
            <span>${from}-${to} / ${allFolderPhotos.length}</span>
          </div>
          <div class="latest-pager" aria-label="${escapeHtml(folder.name)} latest pager">
            <button type="button" data-page-action="prev" data-folder-id="${escapeHtml(folder.id)}" ${canGoPrev ? '' : 'disabled'}>前の30枚</button>
            <button type="button" data-page-action="next" data-folder-id="${escapeHtml(folder.id)}" ${canGoNext ? '' : 'disabled'}>次の30枚</button>
          </div>
        </div>
        <div class="latest-strip">${photoCells}</div>
      </article>
    `;
  }).join('');
}

function render() {
  const visiblePhotos = photos.filter((photo) => {
    const matchesStatus = filter === 'all' || photo.status === filter;
    const matchesPhotographer = selectedPhotographer === 'all' || photo.photographerId === selectedPhotographer;
    return matchesStatus && matchesPhotographer;
  });

  photographerSelect.disabled = photographerFolders.length === 0;
  photographerSelect.innerHTML = photographerFolders.length ? [
    '<option value="all">すべての撮影者</option>',
    ...photographerFolders.map((folder) => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}</option>`)
  ].join('') : '<option value="all">Drive同期後に表示</option>';
  photographerSelect.value = selectedPhotographer;

  photoGrid.innerHTML = visiblePhotos.length ? visiblePhotos.map((photo) => {
    const dots = Array.from({ length: 5 }, (_, index) => `<span class="score-dot ${index < photo.score ? 'is-on' : ''}"></span>`).join('');
    return `
      <article class="photo-card ${photo.id === focusedId ? 'is-focused' : ''}" data-id="${escapeHtml(photo.id)}">
        <img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.name)}">
        <div class="photo-body">
          <p class="photo-name">${escapeHtml(photo.name)}</p>
          <p class="photo-meta">${escapeHtml(photo.photographerName || '撮影者未設定')}</p>
          <p class="photo-path">${escapeHtml(photo.folderPath || '')}</p>
          <div class="score-row" aria-label="score ${photo.score} of 5">${dots}</div>
          <div class="card-actions">
            <button class="keep" type="button" data-action="selected">採用</button>
            <button class="reject" type="button" data-action="rejected">保留</button>
          </div>
        </div>
      </article>
    `;
  }).join('') : `
    <div class="empty-grid">
      <strong>Driveフォルダ内の写真だけを候補にします。</strong>
      <span>直下のサブフォルダ名を撮影者として読み込みます。現在はGoogle Drive API未接続のため候補は表示していません。</span>
    </div>
  `;

  document.querySelector('#totalCount').textContent = photos.length;
  document.querySelector('#selectedCount').textContent = photos.filter((photo) => photo.status === 'selected').length;
  document.querySelector('#readyCount').textContent = queue.length;
  document.querySelector('#photographerCount').textContent = photographerFolders.length;
  renderLatestByPhotographer();

  const focused = photos.find((photo) => photo.id === focusedId);
  previewFrame.classList.toggle('has-image', Boolean(focused));
  generateCaption.disabled = !focused;
  if (focused) {
    previewImage.src = focused.src;
    previewImage.alt = focused.name;
    caption.value = '';
    hashtags.value = defaultHashtags();
  } else {
    previewImage.removeAttribute('src');
    previewImage.alt = '';
    caption.value = '';
    hashtags.value = defaultHashtags();
  }

  queueList.innerHTML = queue.length ? queue.map((item) => {
    const isPosted = item.status === 'posted';
    const isPosting = item.status === 'posting';
    const isFailed = item.status === 'failed';
    const isScheduled = item.status === 'scheduled';
    const timing = item.publishTiming === 'scheduled' ? 'scheduled' : 'now';
    const scheduledValue = item.scheduledAt
      ? localDateTimeValue(new Date(item.scheduledAt))
      : localDateTimeValue(new Date(Date.now() + 10 * 60_000));
    const stateText = isPosted
      ? '投稿済み'
      : isPosting
        ? '投稿中'
        : isFailed
          ? '投稿失敗'
          : isScheduled
            ? '予約済み'
            : '投稿待ち';
    return `
    <article class="queue-item" data-queue-id="${escapeHtml(item.id)}">
      <img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.name)}">
      <div>
        <h4>${escapeHtml(item.name)}</h4>
        <p>${escapeHtml(item.photographerName || '撮影者未設定')} / ${escapeHtml(item.type)} / ${escapeHtml(item.caption.slice(0, 48))}...</p>
        <div class="queue-schedule">
          <label>
            投稿タイミング
            <select data-queue-timing ${isPosted || isPosting ? 'disabled' : ''}>
              <option value="now" ${timing === 'now' ? 'selected' : ''}>すぐに投稿</option>
              <option value="scheduled" ${timing === 'scheduled' ? 'selected' : ''}>日時指定</option>
            </select>
          </label>
          <label class="queue-scheduled-at" ${timing === 'scheduled' ? '' : 'hidden'}>
            投稿日時
            <input type="datetime-local" data-queue-scheduled-at value="${escapeHtml(scheduledValue)}" min="${escapeHtml(localDateTimeValue(new Date(Date.now() + 60_000)))}" ${isPosted || isPosting ? 'disabled' : ''}>
          </label>
        </div>
        ${timing === 'scheduled' && item.scheduledAt ? `<p class="queue-timing">投稿予定: ${escapeHtml(formatScheduledAt(item.scheduledAt))}</p>` : ''}
        ${item.error ? `<p class="queue-error">${escapeHtml(item.error)}</p>` : ''}
      </div>
      <div class="queue-actions">
        <span class="queue-state ${isPosted ? 'is-posted' : ''} ${isPosting ? 'is-posting' : ''} ${isFailed ? 'is-failed' : ''} ${isScheduled ? 'is-scheduled' : ''}">${stateText}</span>
        <button type="button" data-queue-action="post" ${isPosted || isPosting ? 'disabled' : ''}>${isPosting ? '投稿中' : '今すぐ投稿'}</button>
        <button type="button" data-queue-action="delete" class="danger-action">削除</button>
      </div>
    </article>
  `;
  }).join('') : '<p class="empty-queue">採用した写真を選び、投稿案をキューに追加してください。</p>';

  window.requestAnimationFrame(updatePhotoGridHeight);
}

function updatePhotoGridHeight() {
  const cards = photoGrid.querySelectorAll('.photo-card');
  if (!cards.length) {
    photoGrid.style.removeProperty('max-height');
    return;
  }

  const gridStyle = window.getComputedStyle(photoGrid);
  const rowGap = Number.parseFloat(gridStyle.rowGap) || 0;
  const paddingTop = Number.parseFloat(gridStyle.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(gridStyle.paddingBottom) || 0;
  const cardHeight = cards[0].getBoundingClientRect().height;
  const maxHeight = (cardHeight * visiblePhotoGridRows)
    + (rowGap * (visiblePhotoGridRows - 1))
    + paddingTop
    + paddingBottom;

  photoGrid.style.maxHeight = `${Math.ceil(maxHeight)}px`;
}

function focusPhoto(id) {
  focusedId = id;
  const focused = photos.find((photo) => photo.id === focusedId);
  if (focused && focused.status !== 'selected') {
    focused.status = 'selected';
    scheduleDriveCatalogSave();
  }
  render();
}

syncDrive.addEventListener('click', syncDrivePhotos);

instagramAccessToken.addEventListener('input', saveInstagramToken);

verifyInstagramConnection.addEventListener('click', async () => {
  verifyInstagramConnection.disabled = true;
  verifyInstagramConnection.textContent = '確認中';
  setInstagramConnectionState('接続確認中', 'loading');

  try {
    await verifyAndStoreInstagramConnection();
  } catch (error) {
    setInstagramConnectionState('Instagram 接続失敗', 'error');
    updateInstagramTokenStatus(error.message || 'Instagram接続確認に失敗しました。');
  } finally {
    verifyInstagramConnection.textContent = 'Instagram接続確認';
    verifyInstagramConnection.disabled = !instagramAccessToken.value.trim() || isMetaAppAccessToken(instagramAccessToken.value.trim());
  }
});

toggleInstagramToken.addEventListener('click', () => {
  const shouldShow = instagramAccessToken.type === 'password';
  instagramAccessToken.type = shouldShow ? 'text' : 'password';
  toggleInstagramToken.textContent = shouldShow ? '隠す' : '表示';
  toggleInstagramToken.setAttribute('aria-label', shouldShow ? 'アクセストークンを隠す' : 'アクセストークンを表示');
});

clearInstagramToken.addEventListener('click', () => {
  instagramAccessToken.value = '';
  instagramAccessToken.type = 'password';
  toggleInstagramToken.textContent = '表示';
  toggleInstagramToken.setAttribute('aria-label', 'アクセストークンを表示');
  localStorage.removeItem(instagramTokenStorageKey);
  updateInstagramTokenStatus('保存したアクセストークンを削除しました。');
  setInstagramConnectionState('Meta API 接続待ち');
});

generateCaption.addEventListener('click', () => {
  const focused = photos.find((photo) => photo.id === focusedId);
  if (!focused) return;

  caption.value = generateMonoralCaption(focused);
  hashtags.value = defaultHashtags();
});

photographerSelect.addEventListener('change', () => {
  selectedPhotographer = photographerSelect.value;
  const visibleFocused = photos.some((photo) => {
    const matchesStatus = filter === 'all' || photo.status === filter;
    const matchesPhotographer = selectedPhotographer === 'all' || photo.photographerId === selectedPhotographer;
    return photo.id === focusedId && matchesStatus && matchesPhotographer;
  });
  if (!visibleFocused) focusedId = null;
  render();
});

photoGrid.addEventListener('click', (event) => {
  const card = event.target.closest('.photo-card');
  if (!card) return;

  const action = event.target.dataset.action;
  const photo = photos.find((item) => item.id === card.dataset.id);
  if (!photo) return;

  if (action) {
    photo.status = action;
    if (action === 'selected') focusedId = photo.id;
    scheduleDriveCatalogSave();
  } else {
    focusPhoto(photo.id);
  }
  render();
});

latestByPhotographer.addEventListener('click', (event) => {
  const pagerButton = event.target.closest('[data-page-action]');
  if (pagerButton) {
    const folderId = pagerButton.dataset.folderId;
    const currentOffset = latestOffsets[folderId] || 0;
    latestOffsets[folderId] = pagerButton.dataset.pageAction === 'next'
      ? currentOffset + latestPageSize
      : Math.max(0, currentOffset - latestPageSize);
    renderLatestByPhotographer();
    return;
  }

  const button = event.target.closest('.latest-photo');
  if (!button) return;

  focusPhoto(button.dataset.id);
  document.querySelector('#select')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelectorAll('.filter').forEach((button) => {
  button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('.filter').forEach((item) => item.classList.toggle('is-active', item === button));
    render();
  });
});

async function processQueueItem(item) {
  if (!item || item.status === 'posted' || item.status === 'posting') return;

  item.status = 'posting';
  item.error = '';
  saveQueue();
  render();

  try {
    const result = await postToInstagram(item);
    item.status = 'posted';
    item.postedAt = new Date().toISOString();
    item.instagramMediaId = result.mediaId;
    item.instagramCreationId = result.creationId;
  } catch (error) {
    item.status = 'failed';
    item.error = error.message || 'Instagram投稿に失敗しました。';
  }

  saveQueue();
  render();
}

async function runScheduledQueue() {
  const dueItems = queue.filter((item) => (
    item.status === 'scheduled'
    && item.scheduledAt
    && new Date(item.scheduledAt).getTime() <= Date.now()
  ));

  for (const item of dueItems) {
    await processQueueItem(item);
  }
}

addToQueue.addEventListener('click', () => {
  const focused = photos.find((photo) => photo.id === focusedId);
  if (!focused) return;

  const queueItem = {
    id: `queue-${Date.now()}`,
    sourceId: focused.id,
    name: focused.name,
    src: focused.src,
    photographerId: focused.photographerId,
    photographerName: focused.photographerName,
    type: postType.value,
    caption: caption.value,
    hashtags: hashtags.value,
    instagramUrl,
    driveFolderUrl,
    originalUrl: focused.originalUrl,
    publishImageUrl: focused.publishImageUrl,
    publishTiming: 'now',
    scheduledAt: null,
    status: 'pending'
  };

  queue = [
    queueItem,
    ...queue
  ];
  saveQueue();
  render();
});

queueList.addEventListener('change', (event) => {
  const queueItem = event.target.closest('.queue-item');
  const item = queue.find((entry) => entry.id === queueItem?.dataset.queueId);
  if (!item || item.status === 'posted' || item.status === 'posting') return;

  if (event.target.matches('[data-queue-timing]')) {
    if (event.target.value === 'scheduled') {
      const dateInput = queueItem.querySelector('[data-queue-scheduled-at]');
      const scheduledDate = new Date(dateInput.value);
      item.publishTiming = 'scheduled';
      item.scheduledAt = scheduledDate.getTime() > Date.now()
        ? scheduledDate.toISOString()
        : new Date(Date.now() + 10 * 60_000).toISOString();
      item.status = 'scheduled';
      item.error = '';
    } else {
      item.publishTiming = 'now';
      item.scheduledAt = null;
      item.status = 'pending';
      item.error = '';
    }
  }

  if (event.target.matches('[data-queue-scheduled-at]')) {
    const scheduledDate = new Date(event.target.value);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
      window.alert('現在より後の投稿日時を指定してください。');
      render();
      return;
    }
    item.publishTiming = 'scheduled';
    item.scheduledAt = scheduledDate.toISOString();
    item.status = 'scheduled';
    item.error = '';
  }

  saveQueue();
  render();
});

queueList.addEventListener('click', async (event) => {
  const actionButton = event.target.closest('[data-queue-action]');
  if (!actionButton) return;

  const queueItem = actionButton.closest('.queue-item');
  const item = queue.find((entry) => entry.id === queueItem?.dataset.queueId);
  if (!item) return;

  if (actionButton.dataset.queueAction === 'delete') {
    queue = queue.filter((entry) => entry.id !== item.id);
    saveQueue();
    render();
    return;
  }

  if (actionButton.dataset.queueAction === 'post') {
    item.publishTiming = 'now';
    item.scheduledAt = null;
    await processQueueItem(item);
  }
});

exportPlan.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ account: '@monoral_outdoor', driveFolderUrl, queue }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `insta-monoral-outdoor-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

window.addEventListener('resize', updatePhotoGridHeight);
window.addEventListener('focus', runScheduledQueue);
window.setInterval(runScheduledQueue, 30_000);

updateInstagramTokenStatus();
render();
restoreDriveCatalogCache();
runScheduledQueue();
