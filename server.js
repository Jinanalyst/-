'use strict';
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// 업로드 저장: 배포 시 BLOB(Vercel Blob) 사용, 로컬 개발 시 디스크 폴백
const BLOB_ENABLED = !!process.env.BLOB_READ_WRITE_TOKEN;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (!BLOB_ENABLED) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const CATEGORIES = [
  '침대/매트리스', '책상/의자', '옷장/수납', '냉장고', '세탁기',
  '전자레인지/주방', 'TV/모니터', '에어컨/난방', '소파/거실',
  '조명/인테리어', '생활가전', '기타 자취용품'
];
const CONDITIONS = ['미개봉/새제품', '거의 새것', '사용감 적음', '사용감 있음', '고장/부품용'];
const STATUSES = ['판매중', '예약중', '거래완료'];
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];

// ---------- 미들웨어 ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
if (!BLOB_ENABLED) app.use('/uploads', express.static(UPLOAD_DIR));

app.use(cookieSession({
  name: 'jm_sess',
  secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  maxAge: 1000 * 60 * 60 * 24 * 7,
  httpOnly: true,
  sameSite: 'lax'
}));

// DB 스키마 준비 대기 (서버리스 콜드 스타트 대응)
app.use(async (req, res, next) => {
  try { await db.ready; next(); } catch (e) { next(e); }
});

// 현재 사용자 & 공통 뷰 변수
app.use(async (req, res, next) => {
  try {
    if (req.session.userId) {
      req.user = await db.get('SELECT id, username, email, nickname, area FROM users WHERE id = ?', [req.session.userId]);
    }
    res.locals.user = req.user || null;
    res.locals.CATEGORIES = CATEGORIES;
    res.locals.CONDITIONS = CONDITIONS;
    res.locals.STATUSES = STATUSES;
    res.locals.query = {};
    res.locals.flash = req.session.flash || null;
    res.locals.blobEnabled = BLOB_ENABLED;
    if (req.session.flash) req.session.flash = null;
    res.locals.unread = 0;
    if (req.user) {
      const row = await db.get('SELECT COUNT(*) c FROM messages WHERE receiver_id = ? AND is_read = 0', [req.user.id]);
      res.locals.unread = row.c;
    }
    next();
  } catch (e) { next(e); }
});

function requireLogin(req, res, next) {
  if (!req.user) {
    req.session.flash = { type: 'error', msg: '로그인이 필요합니다.' };
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

// 라우트 핸들러 async 래퍼
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- 파일 업로드 (멀티파트 → 메모리) ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.includes(file.mimetype))
});

// 업로드된 미디어들(폼)을 저장하고 { src, kind } 목록을 반환
async function saveUploadedMedia(req) {
  const out = [];
  // 1) 클라이언트가 Blob에 직접 올린 URL (media_url / media_kind 히든 필드)
  const urls = [].concat(req.body.media_url || []).filter(Boolean);
  const kinds = [].concat(req.body.media_kind || []);
  urls.forEach((u, i) => out.push({ src: u, kind: kinds[i] === 'video' ? 'video' : 'image' }));
  // 2) 로컬 개발: 멀티파트 파일을 디스크에 저장
  for (const f of (req.files || [])) {
    const ext = path.extname(f.originalname).toLowerCase() || (f.mimetype.startsWith('video') ? '.mp4' : '.png');
    const name = Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), f.buffer);
    out.push({ src: '/uploads/' + name, kind: f.mimetype.startsWith('video') ? 'video' : 'image' });
  }
  return out.slice(0, 10);
}

app.locals.won = (n) => (Number(n) === 0 ? '나눔' : Number(n).toLocaleString('ko-KR') + '원');

// ---------- Vercel Blob: 클라이언트 직접 업로드용 토큰 발급 ----------
app.post('/api/upload-token', wrap(async (req, res) => {
  if (!BLOB_ENABLED) return res.status(400).json({ error: 'Blob 미설정' });
  const { handleUpload } = require('@vercel/blob/client');
  const jsonResponse = await handleUpload({
    body: req.body,
    request: req,
    onBeforeGenerateToken: async () => ({
      allowedContentTypes: ALLOWED_MIME,
      maximumSizeInBytes: 100 * 1024 * 1024,
      addRandomSuffix: true
    }),
    onUploadCompleted: async () => {}
  });
  res.json(jsonResponse);
}));

// ================= 라우트 =================

// 홈 / 목록
app.get('/', wrap(async (req, res) => {
  const { q = '', category = '', status = '', sort = 'new' } = req.query;
  const where = [];
  const params = [];
  if (q) { where.push('(l.title LIKE ? OR l.description LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
  if (category) { where.push('l.category = ?'); params.push(category); }
  if (status) { where.push('l.status = ?'); params.push(status); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const order = sort === 'price_low' ? 'l.price ASC'
              : sort === 'price_high' ? 'l.price DESC'
              : sort === 'views' ? 'l.views DESC'
              : 'l.id DESC';
  const listings = await db.all(`
    SELECT l.*, u.nickname,
      (SELECT src FROM images WHERE listing_id = l.id AND kind='image' ORDER BY id LIMIT 1) AS thumb,
      (SELECT COUNT(*) FROM comments WHERE listing_id = l.id) AS comment_count,
      (SELECT COUNT(*) FROM favorites WHERE listing_id = l.id) AS fav_count
    FROM listings l JOIN users u ON u.id = l.user_id
    ${whereSql} ORDER BY ${order} LIMIT 100
  `, params);
  res.locals.query = req.query;
  res.render('index', { listings, title: '자취마켓' });
}));

// 지도 보기
app.get('/map', wrap(async (req, res) => {
  const listings = await db.all(`
    SELECT l.id, l.title, l.price, l.category, l.status, l.lat, l.lng, l.location_txt,
      (SELECT src FROM images WHERE listing_id = l.id AND kind='image' ORDER BY id LIMIT 1) AS thumb
    FROM listings l WHERE l.lat IS NOT NULL AND l.lng IS NOT NULL ORDER BY l.id DESC
  `);
  res.render('map', { listings, title: '지도로 매물 찾기' });
}));

// ---------- 회원가입 ----------
app.get('/signup', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('signup', { title: '회원가입', form: {}, error: null });
});

app.post('/signup', wrap(async (req, res) => {
  const { username, email, password, password2, nickname, area } = req.body;
  const form = { username, email, nickname, area };
  const fail = (m) => res.status(400).render('signup', { title: '회원가입', form, error: m });
  if (!username || !email || !password || !nickname) return fail('필수 항목을 모두 입력해주세요.');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return fail('아이디는 영문/숫자/_ 3~20자여야 합니다.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('올바른 이메일 형식이 아닙니다.');
  if (password.length < 6) return fail('비밀번호는 6자 이상이어야 합니다.');
  if (password !== password2) return fail('비밀번호가 일치하지 않습니다.');
  const dup = await db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
  if (dup) return fail('이미 사용 중인 아이디 또는 이메일입니다.');
  const hash = bcrypt.hashSync(password, 10);
  const info = await db.run(
    'INSERT INTO users (username, email, password_hash, nickname, area) VALUES (?,?,?,?,?)',
    [username, email, hash, nickname, area || null]
  );
  req.session.userId = info.lastInsertRowid;
  req.session.flash = { type: 'success', msg: `${nickname}님, 자취마켓 가입을 환영합니다!` };
  res.redirect('/');
}));

// ---------- 로그인 / 로그아웃 ----------
app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: '로그인', error: null, next: req.query.next || '/' });
});

app.post('/login', wrap(async (req, res) => {
  const { username, password, next: nextUrl } = req.body;
  const user = await db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('login', { title: '로그인', error: '아이디 또는 비밀번호가 올바르지 않습니다.', next: nextUrl || '/' });
  }
  req.session.userId = user.id;
  req.session.flash = { type: 'success', msg: `${user.nickname}님 환영합니다!` };
  res.redirect(nextUrl && nextUrl.startsWith('/') ? nextUrl : '/');
}));

app.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

// ---------- 매물 등록 ----------
app.get('/listings/new', requireLogin, (req, res) => {
  res.render('listing_form', { title: '매물 등록', listing: null, images: [], action: '/listings/new' });
});

app.post('/listings/new', requireLogin, (req, res, next) => {
  upload.array('media', 10)(req, res, wrap(async (err) => {
    if (err) { req.session.flash = { type: 'error', msg: err.message }; return res.redirect('/listings/new'); }
    const { title, category, price, condition, description, lat, lng, location_txt } = req.body;
    if (!title || !category) {
      req.session.flash = { type: 'error', msg: '제목과 카테고리는 필수입니다.' };
      return res.redirect('/listings/new');
    }
    const info = await db.run(`
      INSERT INTO listings (user_id,title,category,price,condition,description,lat,lng,location_txt)
      VALUES (?,?,?,?,?,?,?,?,?)
    `, [req.user.id, title, category, parseInt(price, 10) || 0, condition || null, description || null,
        lat ? parseFloat(lat) : null, lng ? parseFloat(lng) : null, location_txt || null]);
    const listingId = info.lastInsertRowid;
    const media = await saveUploadedMedia(req);
    for (const m of media) await db.run('INSERT INTO images (listing_id, src, kind) VALUES (?,?,?)', [listingId, m.src, m.kind]);
    req.session.flash = { type: 'success', msg: '매물이 등록되었습니다.' };
    res.redirect('/listings/' + listingId);
  }));
});

// ---------- 매물 상세 ----------
app.get('/listings/:id', wrap(async (req, res) => {
  const listing = await db.get(`
    SELECT l.*, u.nickname, u.area AS seller_area, u.id AS seller_id
    FROM listings l JOIN users u ON u.id = l.user_id WHERE l.id = ?
  `, [req.params.id]);
  if (!listing) return res.status(404).render('404', { title: '없는 매물' });
  await db.run('UPDATE listings SET views = views + 1 WHERE id = ?', [listing.id]);
  const media = await db.all('SELECT * FROM images WHERE listing_id = ? ORDER BY kind DESC, id', [listing.id]);
  const comments = await db.all(`
    SELECT c.*, u.nickname FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.listing_id = ? ORDER BY c.id
  `, [listing.id]);
  let isFav = false;
  if (req.user) {
    isFav = !!(await db.get('SELECT 1 x FROM favorites WHERE user_id=? AND listing_id=?', [req.user.id, listing.id]));
  }
  res.render('listing_detail', { title: listing.title, listing, media, comments, isFav });
}));

// ---------- 매물 수정 ----------
app.get('/listings/:id/edit', requireLogin, wrap(async (req, res) => {
  const listing = await db.get('SELECT * FROM listings WHERE id = ?', [req.params.id]);
  if (!listing) return res.status(404).render('404', { title: '없는 매물' });
  if (listing.user_id !== req.user.id) return res.status(403).send('권한이 없습니다.');
  const images = await db.all('SELECT * FROM images WHERE listing_id = ? ORDER BY kind DESC, id', [listing.id]);
  res.render('listing_form', { title: '매물 수정', listing, images, action: `/listings/${listing.id}/edit` });
}));

app.post('/listings/:id/edit', requireLogin, (req, res, next) => {
  upload.array('media', 10)(req, res, wrap(async (err) => {
    const listing = await db.get('SELECT * FROM listings WHERE id = ?', [req.params.id]);
    if (!listing) return res.status(404).render('404', { title: '없는 매물' });
    if (listing.user_id !== req.user.id) return res.status(403).send('권한이 없습니다.');
    if (err) { req.session.flash = { type: 'error', msg: err.message }; return res.redirect(`/listings/${listing.id}/edit`); }
    const { title, category, price, condition, description, status, lat, lng, location_txt, delete_media } = req.body;
    await db.run(`
      UPDATE listings SET title=?,category=?,price=?,condition=?,description=?,status=?,lat=?,lng=?,location_txt=?
      WHERE id=?
    `, [title, category, parseInt(price, 10) || 0, condition || null, description || null, status || '판매중',
        lat ? parseFloat(lat) : null, lng ? parseFloat(lng) : null, location_txt || null, listing.id]);
    if (delete_media) {
      const ids = [].concat(delete_media);
      for (const mid of ids) {
        const img = await db.get('SELECT * FROM images WHERE id=? AND listing_id=?', [mid, listing.id]);
        if (img) {
          if (img.src.startsWith('/uploads/')) fs.rm(path.join(UPLOAD_DIR, path.basename(img.src)), () => {});
          await db.run('DELETE FROM images WHERE id=?', [mid]);
        }
      }
    }
    const media = await saveUploadedMedia(req);
    for (const m of media) await db.run('INSERT INTO images (listing_id, src, kind) VALUES (?,?,?)', [listing.id, m.src, m.kind]);
    req.session.flash = { type: 'success', msg: '수정되었습니다.' };
    res.redirect('/listings/' + listing.id);
  }));
});

// ---------- 매물 삭제 (수동 cascade) ----------
app.post('/listings/:id/delete', requireLogin, wrap(async (req, res) => {
  const listing = await db.get('SELECT * FROM listings WHERE id = ?', [req.params.id]);
  if (!listing) return res.status(404).render('404', { title: '없는 매물' });
  if (listing.user_id !== req.user.id) return res.status(403).send('권한이 없습니다.');
  const imgs = await db.all('SELECT src FROM images WHERE listing_id=?', [listing.id]);
  for (const im of imgs) if (im.src.startsWith('/uploads/')) fs.rm(path.join(UPLOAD_DIR, path.basename(im.src)), () => {});
  await db.run('DELETE FROM images WHERE listing_id=?', [listing.id]);
  await db.run('DELETE FROM comments WHERE listing_id=?', [listing.id]);
  await db.run('DELETE FROM favorites WHERE listing_id=?', [listing.id]);
  await db.run('UPDATE messages SET listing_id=NULL WHERE listing_id=?', [listing.id]);
  await db.run('DELETE FROM listings WHERE id=?', [listing.id]);
  req.session.flash = { type: 'success', msg: '매물이 삭제되었습니다.' };
  res.redirect('/');
}));

// 상태 변경
app.post('/listings/:id/status', requireLogin, wrap(async (req, res) => {
  const listing = await db.get('SELECT * FROM listings WHERE id = ?', [req.params.id]);
  if (listing && listing.user_id === req.user.id && STATUSES.includes(req.body.status)) {
    await db.run('UPDATE listings SET status=? WHERE id=?', [req.body.status, listing.id]);
  }
  res.redirect('/listings/' + req.params.id);
}));

// ---------- 댓글 ----------
app.post('/listings/:id/comments', requireLogin, wrap(async (req, res) => {
  const listing = await db.get('SELECT id FROM listings WHERE id = ?', [req.params.id]);
  if (!listing) return res.status(404).send('없는 매물');
  const body = (req.body.body || '').trim();
  const parentId = req.body.parent_id ? parseInt(req.body.parent_id, 10) : null;
  if (body) await db.run('INSERT INTO comments (listing_id,user_id,body,parent_id) VALUES (?,?,?,?)', [listing.id, req.user.id, body, parentId]);
  res.redirect('/listings/' + listing.id + '#comments');
}));

app.post('/comments/:id/delete', requireLogin, wrap(async (req, res) => {
  const c = await db.get('SELECT * FROM comments WHERE id=?', [req.params.id]);
  if (c && c.user_id === req.user.id) {
    await db.run('DELETE FROM comments WHERE id=? OR parent_id=?', [c.id, c.id]);
  }
  res.redirect(c ? '/listings/' + c.listing_id + '#comments' : '/');
}));

// ---------- 찜하기 ----------
app.post('/listings/:id/favorite', requireLogin, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const exists = await db.get('SELECT 1 x FROM favorites WHERE user_id=? AND listing_id=?', [req.user.id, id]);
  if (exists) await db.run('DELETE FROM favorites WHERE user_id=? AND listing_id=?', [req.user.id, id]);
  else await db.run('INSERT INTO favorites (user_id,listing_id) VALUES (?,?)', [req.user.id, id]);
  const row = await db.get('SELECT COUNT(*) c FROM favorites WHERE listing_id=?', [id]);
  res.json({ favorited: !exists, count: row.c });
}));

// ---------- 1:1 쪽지 ----------
app.post('/messages', requireLogin, wrap(async (req, res) => {
  const { receiver_id, listing_id, body } = req.body;
  const rid = parseInt(receiver_id, 10);
  const text = (body || '').trim();
  if (rid && text && rid !== req.user.id) {
    await db.run('INSERT INTO messages (listing_id,sender_id,receiver_id,body) VALUES (?,?,?,?)',
      [listing_id ? parseInt(listing_id, 10) : null, req.user.id, rid, text]);
    req.session.flash = { type: 'success', msg: '쪽지를 보냈습니다.' };
  }
  res.redirect(listing_id ? '/listings/' + listing_id : '/messages');
}));

app.get('/messages', requireLogin, wrap(async (req, res) => {
  const uid = req.user.id;
  const threads = await db.all(`
    SELECT other.id AS other_id, other.nickname AS other_nick,
      (SELECT body FROM messages m2 WHERE (m2.sender_id=? AND m2.receiver_id=other.id) OR (m2.sender_id=other.id AND m2.receiver_id=?) ORDER BY m2.id DESC LIMIT 1) AS last_body,
      (SELECT created_at FROM messages m2 WHERE (m2.sender_id=? AND m2.receiver_id=other.id) OR (m2.sender_id=other.id AND m2.receiver_id=?) ORDER BY m2.id DESC LIMIT 1) AS last_at,
      (SELECT COUNT(*) FROM messages m3 WHERE m3.sender_id=other.id AND m3.receiver_id=? AND m3.is_read=0) AS unread
    FROM users other WHERE other.id IN (
      SELECT CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END
      FROM messages WHERE sender_id=? OR receiver_id=?
    ) ORDER BY last_at DESC
  `, [uid, uid, uid, uid, uid, uid, uid, uid]);
  res.render('messages', { title: '쪽지함', threads });
}));

app.get('/messages/:otherId', requireLogin, wrap(async (req, res) => {
  const other = await db.get('SELECT id, nickname FROM users WHERE id=?', [req.params.otherId]);
  if (!other) return res.status(404).render('404', { title: '없는 사용자' });
  const msgs = await db.all(`
    SELECT * FROM messages
    WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)
    ORDER BY id
  `, [req.user.id, other.id, other.id, req.user.id]);
  await db.run('UPDATE messages SET is_read=1 WHERE sender_id=? AND receiver_id=? AND is_read=0', [other.id, req.user.id]);
  res.render('conversation', { title: other.nickname + '님과의 대화', other, msgs });
}));

// ---------- 마이페이지 / 프로필 ----------
app.get('/mypage', requireLogin, wrap(async (req, res) => {
  const myListings = await db.all(`
    SELECT l.*, (SELECT src FROM images WHERE listing_id=l.id AND kind='image' ORDER BY id LIMIT 1) AS thumb
    FROM listings l WHERE user_id=? ORDER BY id DESC
  `, [req.user.id]);
  const favs = await db.all(`
    SELECT l.*, u.nickname, (SELECT src FROM images WHERE listing_id=l.id AND kind='image' ORDER BY id LIMIT 1) AS thumb
    FROM favorites f JOIN listings l ON l.id=f.listing_id JOIN users u ON u.id=l.user_id
    WHERE f.user_id=? ORDER BY l.id DESC
  `, [req.user.id]);
  res.render('mypage', { title: '마이페이지', myListings, favs });
}));

app.get('/users/:id', wrap(async (req, res) => {
  const seller = await db.get('SELECT id, nickname, area, created_at FROM users WHERE id=?', [req.params.id]);
  if (!seller) return res.status(404).render('404', { title: '없는 사용자' });
  const listings = await db.all(`
    SELECT l.*, (SELECT src FROM images WHERE listing_id=l.id AND kind='image' ORDER BY id LIMIT 1) AS thumb
    FROM listings l WHERE user_id=? ORDER BY id DESC
  `, [seller.id]);
  res.render('profile', { title: seller.nickname + '님의 상점', seller, listings });
}));

// 404
app.use((req, res) => res.status(404).render('404', { title: '페이지 없음' }));

// 에러 핸들러
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('서버 오류가 발생했습니다.');
});

// 로컬에서 직접 실행할 때만 listen (Vercel에서는 export 된 app 사용)
if (require.main === module) {
  app.listen(PORT, () => console.log(`자취마켓 실행 중 → http://localhost:${PORT}`));
}

module.exports = app;
