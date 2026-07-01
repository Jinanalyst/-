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

## 테스트 계정
- 아이디 `seller01` / 비밀번호 `test1234`

## 라이선스
[MIT](LICENSE) © 2026 Jinanalyst
