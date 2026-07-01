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
function setupDropzone() {
  const dz = document.getElementById('dropzone');
  const input = document.getElementById('mediaInput');
  const preview = document.getElementById('preview');
  if (!dz || !input || !preview) return;

  const MAX = 10;
  const store = new DataTransfer(); // input.files 와 동기화되는 파일 저장소

  const openPicker = () => input.click();
  dz.addEventListener('click', openPicker);
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });

  ['dragenter', 'dragover'].forEach(ev =>
    dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'dragend', 'drop'].forEach(ev =>
    dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));

  dz.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  input.addEventListener('change', () => addFiles(input.files));

  function addFiles(files) {
    let skipped = false;
    for (const f of files) {
      if (store.items.length >= MAX) { skipped = true; break; }
      if (!/^(image|video)\//.test(f.type)) continue;
      store.items.add(f);
    }
    input.files = store.files; // 실제 폼 제출에 반영
    render();
    if (skipped) alert(`최대 ${MAX}개까지 업로드할 수 있습니다.`);
  }

  function render() {
    preview.innerHTML = '';
    [...store.files].forEach((file, i) => {
      const url = URL.createObjectURL(file);
      const box = document.createElement('div');
      box.className = 'p-item';
      box.innerHTML = (file.type.startsWith('video')
        ? `<video src="${url}" muted></video>`
        : `<img src="${url}" alt="">`) +
        `<button type="button" class="p-del" data-i="${i}" aria-label="삭제">×</button>`;
      preview.appendChild(box);
    });
    preview.querySelectorAll('.p-del').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        store.items.remove(Number(btn.dataset.i));
        input.files = store.files;
        render();
      }));
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
    const thumb = l.thumb ? `<img src="/uploads/${l.thumb}" style="width:100%;border-radius:6px;margin-bottom:6px">` : '';
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
