'use strict';
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
// 업로드 저장 위치: DATA_DIR(영구 디스크) 하위에 저장 → 재배포에도 파일 유지
const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 원룸/자취 관련 카테고리
const CATEGORIES = [
  '침대/매트리스', '책상/의자', '옷장/수납', '냉장고', '세탁기',
  '전자레인지/주방', 'TV/모니터', '에어컨/난방', '소파/거실',
  '조명/인테리어', '생활가전', '기타 자취용품'
];
const CONDITIONS = ['미개봉/새제품', '거의 새것', '사용감 적음', '사용감 있음', '고장/부품용'];
const STATUSES = ['판매중', '예약중', '거래완료'];

// ---------- 미들웨어 ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR)); // 업로드 파일 서빙 (DATA_DIR 기준)

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7일
}));

// 현재 사용자 & 공통 뷰 변수
app.use((req, res, next) => {
  if (req.session.userId) {
    req.user = db.prepare('SELECT id, username, email, nickname, area FROM users WHERE id = ?')
                 .get(req.session.userId);
  }
  res.locals.user = req.user || null;
  res.locals.CATEGORIES = CATEGORIES;
  res.locals.CONDITIONS = CONDITIONS;
  res.locals.STATUSES = STATUSES;
  res.locals.query = {};
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  // 안 읽은 메시지 수
  res.locals.unread = 0;
  if (req.user) {
    res.locals.unread = db.prepare(
      'SELECT COUNT(*) c FROM messages WHERE receiver_id = ? AND is_read = 0'
    ).get(req.user.id).c;
  }
  next();
});

function requireLogin(req, res, next) {
  if (!req.user) {
    req.session.flash = { type: 'error', msg: '로그인이 필요합니다.' };
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

// ---------- 파일 업로드 (multer) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB (동영상 대비)
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime))$/.test(file.mimetype);
    cb(ok ? null : new Error('이미지(jpg,png,gif,webp) 또는 동영상(mp4,webm,mov)만 업로드 가능합니다.'), ok);
  }
});

// 숫자 포맷 헬퍼 (뷰에서 사용)
app.locals.won = (n) => (n === 0 ? '나눔' : Number(n).toLocaleString('ko-KR') + '원');

// ================= 라우트 =================

// 홈 / 목록 (검색·필터)
app.get('/', (req, res) => {
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

  const listings = db.prepare(`
    SELECT l.*, u.nickname,
      (SELECT filename FROM images WHERE listing_id = l.id AND kind='image' ORDER BY id LIMIT 1) AS thumb,
      (SELECT COUNT(*) FROM comments WHERE listing_id = l.id) AS comment_count,
      (SELECT COUNT(*) FROM favorites WHERE listing_id = l.id) AS fav_count
    FROM listings l JOIN users u ON u.id = l.user_id
    ${whereSql} ORDER BY ${order} LIMIT 100
  `).all(...params);

  res.locals.query = req.query;
  res.render('index', { listings, title: '자취마켓' });
});

// 지도 보기 (좌표가 있는 매물만)
app.get('/map', (req, res) => {
  const listings = db.prepare(`
    SELECT l.id, l.title, l.price, l.category, l.status, l.lat, l.lng, l.location_txt,
      (SELECT filename FROM images WHERE listing_id = l.id AND kind='image' ORDER BY id LIMIT 1) AS thumb
    FROM listings l WHERE l.lat IS NOT NULL AND l.lng IS NOT NULL ORDER BY l.id DESC
  `).all();
  res.render('map', { listings, title: '지도로 매물 찾기' });
});

// ---------- 회원가입 ----------
app.get('/signup', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('signup', { title: '회원가입', form: {}, error: null });
});

app.post('/signup', (req, res) => {
  const { username, email, password, password2, nickname, area } = req.body;
  const form = { username, email, nickname, area };
  const fail = (m) => res.status(400).render('signup', { title: '회원가입', form, error: m });

  if (!username || !email || !password || !nickname) return fail('필수 항목을 모두 입력해주세요.');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return fail('아이디는 영문/숫자/_ 3~20자여야 합니다.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('올바른 이메일 형식이 아닙니다.');
  if (password.length < 6) return fail('비밀번호는 6자 이상이어야 합니다.');
  if (password !== password2) return fail('비밀번호가 일치하지 않습니다.');

  const dup = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (dup) return fail('이미 사용 중인 아이디 또는 이메일입니다.');

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO users (username, email, password_hash, nickname, area) VALUES (?,?,?,?,?)'
  ).run(username, email, hash, nickname, area || null);
  req.session.userId = Number(info.lastInsertRowid);
  req.session.flash = { type: 'success', msg: `${nickname}님, 자취마켓 가입을 환영합니다!` };
  res.redirect('/');
});

// ---------- 로그인 / 로그아웃 ----------
app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: '로그인', error: null, next: req.query.next || '/' });
});

app.post('/login', (req, res) => {
  const { username, password, next: nextUrl } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('login', { title: '로그인', error: '아이디 또는 비밀번호가 올바르지 않습니다.', next: nextUrl || '/' });
  }
  req.session.userId = user.id;
  req.session.flash = { type: 'success', msg: `${user.nickname}님 환영합니다!` };
  res.redirect(nextUrl && nextUrl.startsWith('/') ? nextUrl : '/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- 매물 등록 ----------
app.get('/listings/new', requireLogin, (req, res) => {
  res.render('listing_form', { title: '매물 등록', listing: null, images: [], action: '/listings/new' });
});

app.post('/listings/new', requireLogin, (req, res, next) => {
  upload.array('media', 10)(req, res, (err) => {
    if (err) { req.session.flash = { type: 'error', msg: err.message }; return res.redirect('/listings/new'); }
    const { title, category, price, condition, description, lat, lng, location_txt } = req.body;
    if (!title || !category) {
      req.session.flash = { type: 'error', msg: '제목과 카테고리는 필수입니다.' };
      return res.redirect('/listings/new');
    }
    const info = db.prepare(`
      INSERT INTO listings (user_id,title,category,price,condition,description,lat,lng,location_txt)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      req.user.id, title, category, parseInt(price, 10) || 0, condition || null,
      description || null,
      lat ? parseFloat(lat) : null, lng ? parseFloat(lng) : null, location_txt || null
    );
    const listingId = Number(info.lastInsertRowid);
    const insImg = db.prepare('INSERT INTO images (listing_id, filename, kind) VALUES (?,?,?)');
    for (const f of (req.files || [])) {
      insImg.run(listingId, f.filename, f.mimetype.startsWith('video') ? 'video' : 'image');
    }
    req.session.flash = { type: 'success', msg: '매물이 등록되었습니다.' };
    res.redirect('/listings/' + listingId);
  });
});

// ---------- 매물 상세 ----------
app.get('/listings/:id', (req, res) => {
  const listing = db.prepare(`
    SELECT l.*, u.nickname, u.area AS seller_area, u.id AS seller_id
    FROM listings l JOIN users u ON u.id = l.user_id WHERE l.id = ?
  `).get(req.params.id);
  if (!listing) return res.status(404).render('404', { title: '없는 매물' });

  db.prepare('UPDATE listings SET views = views + 1 WHERE id = ?').run(listing.id);
  const media = db.prepare('SELECT * FROM images WHERE listing_id = ? ORDER BY kind DESC, id').all(listing.id);
  const comments = db.prepare(`
    SELECT c.*, u.nickname FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.listing_id = ? ORDER BY c.id
  `).all(listing.id);
  let isFav = false;
  if (req.user) {
    isFav = !!db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND listing_id=?').get(req.user.id, listing.id);
  }
  res.render('listing_detail', { title: listing.title, listing, media, comments, isFav });
});

// ---------- 매물 수정 ----------
app.get('/listings/:id/edit', requireLogin, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).render('404', { title: '없는 매물' });
  if (listing.user_id !== req.user.id) return res.status(403).send('권한이 없습니다.');
  const images = db.prepare('SELECT * FROM images WHERE listing_id = ? ORDER BY kind DESC, id').all(listing.id);
  res.render('listing_form', { title: '매물 수정', listing, images, action: `/listings/${listing.id}/edit` });
});

app.post('/listings/:id/edit', requireLogin, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).render('404', { title: '없는 매물' });
  if (listing.user_id !== req.user.id) return res.status(403).send('권한이 없습니다.');
  upload.array('media', 10)(req, res, (err) => {
    if (err) { req.session.flash = { type: 'error', msg: err.message }; return res.redirect(`/listings/${listing.id}/edit`); }
    const { title, category, price, condition, description, status, lat, lng, location_txt, delete_media } = req.body;
    db.prepare(`
      UPDATE listings SET title=?,category=?,price=?,condition=?,description=?,status=?,lat=?,lng=?,location_txt=?
      WHERE id=?
    `).run(
      title, category, parseInt(price, 10) || 0, condition || null, description || null,
      status || '판매중',
      lat ? parseFloat(lat) : null, lng ? parseFloat(lng) : null, location_txt || null, listing.id
    );
    // 삭제 요청된 기존 미디어 제거
    if (delete_media) {
      const ids = [].concat(delete_media);
      const getImg = db.prepare('SELECT * FROM images WHERE id=? AND listing_id=?');
      const delImg = db.prepare('DELETE FROM images WHERE id=?');
      for (const mid of ids) {
        const img = getImg.get(mid, listing.id);
        if (img) { fs.rm(path.join(UPLOAD_DIR, img.filename), () => {}); delImg.run(mid); }
      }
    }
    const insImg = db.prepare('INSERT INTO images (listing_id, filename, kind) VALUES (?,?,?)');
    for (const f of (req.files || [])) {
      insImg.run(listing.id, f.filename, f.mimetype.startsWith('video') ? 'video' : 'image');
    }
    req.session.flash = { type: 'success', msg: '수정되었습니다.' };
    res.redirect('/listings/' + listing.id);
  });
});

// ---------- 매물 삭제 ----------
app.post('/listings/:id/delete', requireLogin, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).render('404', { title: '없는 매물' });
  if (listing.user_id !== req.user.id) return res.status(403).send('권한이 없습니다.');
  const imgs = db.prepare('SELECT filename FROM images WHERE listing_id=?').all(listing.id);
  for (const im of imgs) fs.rm(path.join(UPLOAD_DIR, im.filename), () => {});
  db.prepare('DELETE FROM listings WHERE id=?').run(listing.id);
  req.session.flash = { type: 'success', msg: '매물이 삭제되었습니다.' };
  res.redirect('/');
});

// 상태 빠른 변경
app.post('/listings/:id/status', requireLogin, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (listing && listing.user_id === req.user.id && STATUSES.includes(req.body.status)) {
    db.prepare('UPDATE listings SET status=? WHERE id=?').run(req.body.status, listing.id);
  }
  res.redirect('/listings/' + req.params.id);
});

// ---------- 댓글 (구매자-판매자 소통) ----------
app.post('/listings/:id/comments', requireLogin, (req, res) => {
  const listing = db.prepare('SELECT id FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).send('없는 매물');
  const body = (req.body.body || '').trim();
  const parentId = req.body.parent_id ? parseInt(req.body.parent_id, 10) : null;
  if (body) {
    db.prepare('INSERT INTO comments (listing_id,user_id,body,parent_id) VALUES (?,?,?,?)')
      .run(listing.id, req.user.id, body, parentId);
  }
  res.redirect('/listings/' + listing.id + '#comments');
});

app.post('/comments/:id/delete', requireLogin, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id=?').get(req.params.id);
  if (c && c.user_id === req.user.id) db.prepare('DELETE FROM comments WHERE id=?').run(c.id);
  res.redirect('back' in res ? 'back' : '/listings/' + (c ? c.listing_id : ''));
});

// ---------- 찜하기 (토글, JSON) ----------
app.post('/listings/:id/favorite', requireLogin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const exists = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND listing_id=?').get(req.user.id, id);
  if (exists) db.prepare('DELETE FROM favorites WHERE user_id=? AND listing_id=?').run(req.user.id, id);
  else db.prepare('INSERT INTO favorites (user_id,listing_id) VALUES (?,?)').run(req.user.id, id);
  const count = db.prepare('SELECT COUNT(*) c FROM favorites WHERE listing_id=?').get(id).c;
  res.json({ favorited: !exists, count });
});

// ---------- 1:1 쪽지 ----------
app.post('/messages', requireLogin, (req, res) => {
  const { receiver_id, listing_id, body } = req.body;
  const rid = parseInt(receiver_id, 10);
  const text = (body || '').trim();
  if (rid && text && rid !== req.user.id) {
    db.prepare('INSERT INTO messages (listing_id,sender_id,receiver_id,body) VALUES (?,?,?,?)')
      .run(listing_id ? parseInt(listing_id, 10) : null, req.user.id, rid, text);
    req.session.flash = { type: 'success', msg: '쪽지를 보냈습니다.' };
  }
  res.redirect(listing_id ? '/listings/' + listing_id : '/messages');
});

app.get('/messages', requireLogin, (req, res) => {
  // 나와 대화한 상대별 최근 메시지 목록
  const threads = db.prepare(`
    SELECT other.id AS other_id, other.nickname AS other_nick,
      (SELECT body FROM messages m2 WHERE (m2.sender_id=? AND m2.receiver_id=other.id) OR (m2.sender_id=other.id AND m2.receiver_id=?) ORDER BY m2.id DESC LIMIT 1) AS last_body,
      (SELECT created_at FROM messages m2 WHERE (m2.sender_id=? AND m2.receiver_id=other.id) OR (m2.sender_id=other.id AND m2.receiver_id=?) ORDER BY m2.id DESC LIMIT 1) AS last_at,
      (SELECT COUNT(*) FROM messages m3 WHERE m3.sender_id=other.id AND m3.receiver_id=? AND m3.is_read=0) AS unread
    FROM users other WHERE other.id IN (
      SELECT CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END
      FROM messages WHERE sender_id=? OR receiver_id=?
    ) ORDER BY last_at DESC
  `).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
  res.render('messages', { title: '쪽지함', threads });
});

app.get('/messages/:otherId', requireLogin, (req, res) => {
  const other = db.prepare('SELECT id, nickname FROM users WHERE id=?').get(req.params.otherId);
  if (!other) return res.status(404).render('404', { title: '없는 사용자' });
  const msgs = db.prepare(`
    SELECT * FROM messages
    WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)
    ORDER BY id
  `).all(req.user.id, other.id, other.id, req.user.id);
  db.prepare('UPDATE messages SET is_read=1 WHERE sender_id=? AND receiver_id=? AND is_read=0').run(other.id, req.user.id);
  res.render('conversation', { title: other.nickname + '님과의 대화', other, msgs });
});

// ---------- 마이페이지 / 프로필 ----------
app.get('/mypage', requireLogin, (req, res) => {
  const myListings = db.prepare(`
    SELECT l.*, (SELECT filename FROM images WHERE listing_id=l.id AND kind='image' ORDER BY id LIMIT 1) AS thumb
    FROM listings l WHERE user_id=? ORDER BY id DESC
  `).all(req.user.id);
  const favs = db.prepare(`
    SELECT l.*, u.nickname, (SELECT filename FROM images WHERE listing_id=l.id AND kind='image' ORDER BY id LIMIT 1) AS thumb
    FROM favorites f JOIN listings l ON l.id=f.listing_id JOIN users u ON u.id=l.user_id
    WHERE f.user_id=? ORDER BY l.id DESC
  `).all(req.user.id);
  res.render('mypage', { title: '마이페이지', myListings, favs });
});

app.get('/users/:id', (req, res) => {
  const seller = db.prepare('SELECT id, nickname, area, created_at FROM users WHERE id=?').get(req.params.id);
  if (!seller) return res.status(404).render('404', { title: '없는 사용자' });
  const listings = db.prepare(`
    SELECT l.*, (SELECT filename FROM images WHERE listing_id=l.id AND kind='image' ORDER BY id LIMIT 1) AS thumb
    FROM listings l WHERE user_id=? ORDER BY id DESC
  `).all(seller.id);
  res.render('profile', { title: seller.nickname + '님의 상점', seller, listings });
});

// 404
app.use((req, res) => res.status(404).render('404', { title: '페이지 없음' }));

app.listen(PORT, () => console.log(`자취마켓 실행 중 → http://localhost:${PORT}`));
