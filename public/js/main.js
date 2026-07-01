'use strict';
// 기본 지도 중심: 서울 시청
const DEFAULT_CENTER = [37.5665, 126.9780];

document.addEventListener('DOMContentLoaded', () => {
  setupDropzone();
  setupPickMap();
  setupViewMap();
  setupBrowseMap();
  setupFavorite();
  setupReplies();
});

// ---------- 등록 폼: 드래그앤드롭 업로드 + 미리보기 ----------
// 배포(Vercel Blob) 시: 파일을 브라우저에서 Blob 으로 직접 업로드하고 URL 을 히든 필드로 제출
// 로컬 개발 시: 기존처럼 file input(멀티파트)로 제출
function setupDropzone() {
  const dz = document.getElementById('dropzone');
  const input = document.getElementById('mediaInput');
  const preview = document.getElementById('preview');
  if (!dz || !input || !preview) return;
  const form = dz.closest('form');
  const MAX = 10;
  const useBlob = window.__BLOB__ === true;
  const items = []; // {file, kind, previewUrl, uploading, error, url}
  let uploaderFn = null;

  const openPicker = () => input.click();
  dz.addEventListener('click', openPicker);
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'dragend', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  input.addEventListener('change', () => { addFiles(input.files); if (useBlob) input.value = ''; });

  // 업로드 진행 중 제출 방지
  if (form) form.addEventListener('submit', e => {
    if (items.some(it => it.uploading)) { e.preventDefault(); alert('파일 업로드가 끝날 때까지 잠시 기다려주세요.'); }
  });

  async function getUploader() {
    if (!uploaderFn) uploaderFn = (await import('https://esm.sh/@vercel/blob@2.5.0/client')).upload;
    return uploaderFn;
  }

  async function addFiles(files) {
    for (const f of files) {
      if (items.length >= MAX) { alert(`최대 ${MAX}개까지 업로드할 수 있습니다.`); break; }
      if (!/^(image|video)\//.test(f.type)) continue;
      const it = { file: f, kind: f.type.startsWith('video') ? 'video' : 'image', previewUrl: URL.createObjectURL(f), uploading: useBlob, error: false, url: null };
      items.push(it);
      render();
      if (useBlob) {
        try {
          const upload = await getUploader();
          const blob = await upload(f.name, f, { access: 'public', handleUploadUrl: '/api/upload-token', contentType: f.type });
          it.url = blob.url;
        } catch (err) { it.error = true; console.error(err); alert('업로드 실패: ' + f.name); }
        it.uploading = false;
        render(); syncHidden();
      }
    }
    if (!useBlob) syncInput();
  }

  function syncInput() { // 로컬 모드: file input 동기화
    const dt = new DataTransfer();
    items.forEach(it => dt.items.add(it.file));
    input.files = dt.files;
  }

  function syncHidden() { // Blob 모드: media_url / media_kind 히든 필드 재생성
    if (!form) return;
    form.querySelectorAll('.media-hidden').forEach(el => el.remove());
    items.forEach(it => {
      if (!it.url) return;
      for (const [name, value] of [['media_url', it.url], ['media_kind', it.kind]]) {
        const el = document.createElement('input');
        el.type = 'hidden'; el.name = name; el.value = value; el.className = 'media-hidden';
        form.appendChild(el);
      }
    });
  }

  function remove(i) {
    items.splice(i, 1);
    render();
    if (useBlob) syncHidden(); else syncInput();
  }

  function render() {
    preview.innerHTML = '';
    items.forEach((it, i) => {
      const box = document.createElement('div');
      box.className = 'p-item';
      const media = it.kind === 'video' ? `<video src="${it.previewUrl}" muted></video>` : `<img src="${it.previewUrl}" alt="">`;
      const overlay = it.uploading ? '<div class="p-loading">업로드중…</div>' : (it.error ? '<div class="p-loading err">실패</div>' : '');
      box.innerHTML = media + overlay + `<button type="button" class="p-del" aria-label="삭제">×</button>`;
      box.querySelector('.p-del').addEventListener('click', e => { e.stopPropagation(); remove(i); });
      preview.appendChild(box);
    });
  }
}

// ---------- 등록 폼: 위치 선택 지도 ----------
function setupPickMap() {
  const el = document.getElementById('pickMap');
  if (!el) return;
  const latI = document.getElementById('lat');
  const lngI = document.getElementById('lng');
  const start = (latI.value && lngI.value) ? [parseFloat(latI.value), parseFloat(lngI.value)] : DEFAULT_CENTER;
  const map = L.map(el).setView(start, latI.value ? 15 : 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  let marker = null;
  if (latI.value && lngI.value) marker = L.marker(start).addTo(map);

  function place(lat, lng) {
    latI.value = lat.toFixed(6); lngI.value = lng.toFixed(6);
    if (marker) marker.setLatLng([lat, lng]); else marker = L.marker([lat, lng]).addTo(map);
  }
  map.on('click', e => place(e.latlng.lat, e.latlng.lng));

  const geoBtn = document.getElementById('geoBtn');
  if (geoBtn) geoBtn.addEventListener('click', () => {
    if (!navigator.geolocation) return alert('위치 정보를 지원하지 않는 브라우저입니다.');
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], 16);
      place(latitude, longitude);
    }, () => alert('위치 정보를 가져올 수 없습니다.'));
  });

  setTimeout(() => map.invalidateSize(), 200);
}

// ---------- 상세: 위치 보기 지도 ----------
function setupViewMap() {
  const el = document.getElementById('viewMap');
  if (!el) return;
  const lat = parseFloat(el.dataset.lat), lng = parseFloat(el.dataset.lng);
  const map = L.map(el, { scrollWheelZoom: false }).setView([lat, lng], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  L.marker([lat, lng]).addTo(map).bindPopup(el.dataset.title || '거래 위치').openPopup();
  setTimeout(() => map.invalidateSize(), 200);
}

// ---------- 지도 둘러보기 ----------
function setupBrowseMap() {
  const el = document.getElementById('browseMap');
  if (!el) return;
  const data = JSON.parse(document.getElementById('mapData').textContent || '[]');
  const map = L.map(el).setView(DEFAULT_CENTER, 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  const won = n => (n === 0 ? '나눔' : Number(n).toLocaleString('ko-KR') + '원');
  const bounds = [];
  data.forEach(l => {
    if (l.lat == null || l.lng == null) return;
    bounds.push([l.lat, l.lng]);
    const thumb = l.thumb ? `<img src="${l.thumb}" style="width:100%;border-radius:6px;margin-bottom:6px">` : '';
    L.marker([l.lat, l.lng]).addTo(map).bindPopup(
      `${thumb}<strong>${escapeHtml(l.title)}</strong><br>${l.category} · ${won(l.price)}<br>` +
      `<a href="/listings/${l.id}">자세히 보기 →</a>`
    );
  });
  if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  setTimeout(() => map.invalidateSize(), 200);
}

// ---------- 찜하기 토글 ----------
function setupFavorite() {
  const btn = document.getElementById('favBtn');
  if (!btn) return;
  const countEl = document.getElementById('favCount');
  btn.addEventListener('click', async () => {
    const res = await fetch(`/listings/${btn.dataset.id}/favorite`, { method: 'POST' });
    if (!res.ok) return;
    const data = await res.json();
    btn.classList.toggle('on', data.favorited);
    btn.querySelector('.heart').textContent = data.favorited ? '♥' : '♡';
    if (countEl) countEl.textContent = data.count;
  });
}

// ---------- 답글 토글 ----------
function setupReplies() {
  document.querySelectorAll('.reply-btn').forEach(b => {
    b.addEventListener('click', () => {
      const f = document.getElementById('reply-' + b.dataset.id);
      if (f) f.hidden = !f.hidden;
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
