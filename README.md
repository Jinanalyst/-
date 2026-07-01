# 자취마켓 (Jachwi Market)

원룸·자취생을 위한 **가구 & 생활용품 직거래 포럼**. 구매자와 판매자가 사진·동영상·지도·쪽지로 소통하며 거래합니다.

## 실행 방법

```powershell
cd C:\Users\장진우\jachwi-market
npm install      # 최초 1회
npm start        # http://localhost:3000
```

개발 중 자동 재시작: `npm run dev`

> 데이터는 `jachwi.db` (SQLite, Node 24 내장 `node:sqlite`)에 저장됩니다. 네이티브 빌드가 필요 없습니다.

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
- **백엔드**: Node.js + Express, `node:sqlite`, express-session
- **인증**: bcryptjs
- **업로드**: multer (이미지/동영상, 개당 100MB)
- **프론트**: EJS 서버 렌더링 + 바닐라 JS, Leaflet 지도

## 폴더 구조
```
server.js          라우트·비즈니스 로직
db.js              스키마 & DB 연결
views/             EJS 템플릿
public/css, js     스타일 & 클라이언트 스크립트
public/uploads/    업로드된 이미지·동영상
```

## 배포 (Deploy)

이 앱은 **항상 켜져 있는 Node 서버 + 로컬 파일(SQLite·업로드)** 구조라 Render·Railway 같은
호스트에 적합합니다. (Vercel 같은 서버리스는 파일시스템이 읽기 전용이라 맞지 않습니다.)

### Render (권장)
1. 이 저장소를 GitHub에 푸시 (완료됨).
2. [render.com](https://render.com) → **New +** → **Blueprint** → 이 저장소 선택.
   `render.yaml` 을 자동으로 읽어 웹 서비스 + 영구 디스크(`/data`)를 구성합니다.
   - 무료로 쓰려면 `render.yaml` 의 `plan: starter` 를 `free` 로 바꾸고 `disk:` 블록을 지우세요.
     (무료 플랜은 디스크가 없어 재배포 시 데이터가 초기화됩니다.)
3. 배포 완료 후 `https://<이름>.onrender.com` 접속.

### Railway
1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
2. 자동으로 `npm install` → `npm start` 실행. 데이터 유지가 필요하면 **Volume** 을 추가하고
   마운트 경로를 환경변수 `DATA_DIR` 로 지정하세요 (예: `/data`).

### 환경변수
| 변수 | 설명 |
|---|---|
| `PORT` | 호스트가 자동 주입 (직접 설정 불필요) |
| `DATA_DIR` | DB·업로드 저장 경로. 영구 디스크 경로로 지정하면 재배포에도 데이터 유지 |
| `SESSION_SECRET` | 세션 서명 키. 재시작해도 로그인 유지하려면 고정값 지정 |

## 테스트 계정
- 아이디 `seller01` / 비밀번호 `test1234`

## 라이선스
[MIT](LICENSE) © 2026 Jinanalyst
