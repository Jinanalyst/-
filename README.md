# 자취마켓 (Jachwi Market)

원룸·자취생을 위한 **가구 & 생활용품 직거래 포럼**. 구매자와 판매자가 사진·동영상·지도·쪽지로 소통하며 거래합니다.

## 실행 방법

```powershell
cd C:\Users\장진우\jachwi-market
npm install      # 최초 1회
npm start        # http://localhost:3000
```

개발 중 자동 재시작: `npm run dev`

> 로컬에서는 데이터가 `jachwi.db` (libSQL 파일 모드)에 저장되고, 업로드 파일은 `uploads/` 폴더에
> 저장됩니다. 배포 시에는 환경변수만 넣으면 Turso(DB) · Vercel Blob(업로드)으로 자동 전환됩니다.

## 기능

| 요구사항 | 구현 |
|---|---|
| **회원가입 / 로그인** | 아이디·이메일·닉네임·활동지역, bcrypt 해시, 세션 로그인 |
| **이미지 업로드** | 매물당 사진 여러 장 업로드(드래그·미리보기), 갤러리 뷰 |
| **동영상** | 동영상 파일 직접 업로드 + 유튜브 등 외부 영상 링크 임베드 |
| **지도** | Leaflet + OpenStreetMap(키 불필요). 등록 시 클릭/‘내 위치’로 좌표 지정, 상세·둘러보기 지도 표시 |
| **구매자↔판매자 소통** | 매물 문의 댓글·답글, 1:1 실시간 쪽지함, 안 읽은 쪽지 뱃지 |
| **자취 특화** | 침대·냉장고·세탁기 등 원룸 카테고리, 상품 상태, 가격/나눔, 예약중·거래완료 상태, 찜하기, 검색·정렬 |
| 상점 / 마이페이지 | 판매자별 상점, 내 매물·찜 목록 |

## 기술 스택
- **백엔드**: Node.js + Express (서버리스 호환), libSQL/Turso, cookie-session
- **인증**: bcryptjs
- **업로드**: 로컬은 디스크, 배포는 Vercel Blob(브라우저 직접 업로드로 대용량·동영상 지원)
- **프론트**: EJS 서버 렌더링 + 바닐라 JS, Leaflet 지도

## 폴더 구조
```
server.js          라우트·비즈니스 로직 (Express 앱 export)
db.js              libSQL 연결 & 스키마
api/index.js       Vercel 서버리스 진입점
vercel.json        Vercel 라우팅
views/             EJS 템플릿
public/css, js     스타일 & 클라이언트 스크립트
```

## Vercel 배포

서버리스 환경에선 파일시스템에 쓸 수 없으므로 **DB는 Turso**, **업로드는 Vercel Blob**을 사용합니다.

### 1) Turso 데이터베이스 만들기 (무료)
```bash
# https://turso.tech 가입 후 CLI 설치
turso db create jachwi
turso db show jachwi --url          # → TURSO_DATABASE_URL 값
turso db tokens create jachwi       # → TURSO_AUTH_TOKEN 값
```
(CLI 없이 Turso 웹 대시보드에서 DB 생성 후 URL·토큰을 복사해도 됩니다.)

### 2) Vercel 프로젝트 만들기
1. [vercel.com](https://vercel.com) → **Add New → Project** → 이 GitHub 저장소 import.
2. **Storage** 탭 → **Create Database → Blob** 생성 후 프로젝트에 연결.
   → `BLOB_READ_WRITE_TOKEN` 환경변수가 자동으로 추가됩니다.
3. **Settings → Environment Variables** 에 아래 값 추가 후 **Deploy**.

### 환경변수
| 변수 | 필수 | 설명 |
|---|---|---|
| `TURSO_DATABASE_URL` | ✅ | Turso DB URL (`libsql://...`) |
| `TURSO_AUTH_TOKEN` | ✅ | Turso 인증 토큰 |
| `BLOB_READ_WRITE_TOKEN` | ✅ | Vercel Blob 연결 시 자동 생성 |
| `SESSION_SECRET` | ✅ | 세션 쿠키 서명용 임의 문자열 (예: `openssl rand -hex 32`) |

> 이 4개가 모두 있어야 정상 동작합니다. `BLOB_READ_WRITE_TOKEN` 이 없으면 업로드 시 오류가 납니다.

### (대안) Render / Railway
항상 켜진 서버로 운영하려면 `render.yaml` 블루프린트로 Render에 배포할 수도 있습니다.
이 경우 환경변수 없이 로컬 파일(SQLite·디스크)로 동작하며, 데이터 유지를 위해 영구 디스크(`DATA_DIR`)를 씁니다.

## 라이선스
[MIT](LICENSE) © 2026 Jinanalyst
