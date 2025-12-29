Napolitan Relay Starter v12 (Full package)
릴레이 멀티플레이 텍스트 게임 - 한 번에 1명씩 플레이하고 유언을 남기는 협력/배신 게임
🚨 로그인 안 되는 문제 해결
빠른 해결 체크리스트

Cloudflare Pages 환경 변수 설정했나요?

Dashboard > Settings > Environment Variables
GAME_PASSWORD 와 SESSION_SECRET 추가
Production과 Preview 모두 설정
⚠️ 환경 변수 추가 후 반드시 재배포 필요!


Functions가 배포되었나요?

Dashboard > Deployments > 최근 배포 클릭
"Functions" 섹션에서 /api/auth/login 확인
안 보이면 → Git에 functions/ 폴더 커밋 확인


브라우저 콘솔 확인

F12 > Console 탭
에러 메시지 확인


테스트 페이지 사용

test-login.html 파일을 프로젝트에 추가
배포 후 https://your-site.pages.dev/test-login.html 접속
단계별로 문제 진단



📖 자세한 문제 해결: TROUBLESHOOTING.md 참고

📁 프로젝트 구조
napolitan-relay/
├── index.html              # Gate (로그인) 페이지
├── play.html               # 게임 플레이 페이지
├── test-login.html         # 로그인 테스트 페이지 (NEW!)
├── functions/              # Cloudflare Pages Functions
│   ├── _middleware.js      # 인증 미들웨어
│   └── api/
│       └── auth/
│           ├── login.js    # 로그인 API
│           └── logout.js   # 로그아웃 API
├── src/
│   └── app.js             # 메인 JavaScript
├── styles/
│   └── app.css            # 스타일
├── data/
│   ├── manifests/         # 이미지/오디오 매니페스트
│   ├── config.json        # UI 설정
│   ├── room1_story.json   # Room 1 스토리
│   └── minigame_cases.json # 미니게임 케이스
├── assets/
│   ├── images/            # 이미지 파일들
│   └── audio/             # 오디오 파일들
├── .gitignore
├── wrangler.toml          # Cloudflare 설정
├── .dev.vars.example      # 로컬 환경 변수 예시
├── README.md              # 이 파일
└── TROUBLESHOOTING.md     # 문제 해결 가이드

🚀 배포 방법
1. Cloudflare Pages에 배포
A. Git 저장소 연결

GitHub/GitLab에 코드 푸시
Cloudflare Dashboard 로그인
Workers & Pages > Create application > Pages
Connect to Git > 저장소 선택
빌드 설정:

Build command: (비워둠)
Build output directory: /
Root directory: (비워둠)



B. 환경 변수 설정 ⚠️ 중요!
배포 후:

Settings > Environment Variables
Production 환경에 추가:

   GAME_PASSWORD=1234
   SESSION_SECRET=your_random_secret_key_at_least_32_characters_long

Preview 환경에도 동일하게 추가
Save 클릭
⚠️ 재배포 필요: Deployments > Retry deployment

C. SESSION_SECRET 생성 방법
bash# Node.js 사용
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 결과 예시
# d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5

💻 로컬 개발
방법 1: Python (권장)
bashcd napolitan-relay
python -m http.server 5173
브라우저에서: http://localhost:5173
⚠️ 주의: 로컬에서는 Functions가 작동하지 않습니다. 로그인 테스트는 Cloudflare에서만 가능합니다.
방법 2: Wrangler (Functions 포함)
bash# Wrangler 설치
npm install -g wrangler

# .dev.vars 파일 생성
cat > .dev.vars << EOF
GAME_PASSWORD=1234
SESSION_SECRET=test_secret_key
EOF

# 로컬 서버 실행
wrangler pages dev . --port 5173
이제 로컬에서도 로그인이 작동합니다!

🎨 에셋 파일 교체
이미지 교체

assets/images/ 폴더로 이동
같은 파일명으로 PNG 파일 교체

예: r1_bg_lobby_01.png → 자신의 이미지로 교체


파일명을 변경하지 말 것 (manifest와 일치해야 함)

오디오 교체

assets/audio/bgm/ - BGM 루프 파일
assets/audio/sfx/ - 효과음 파일
같은 파일명으로 MP3 파일 교체

파일 목록은 data/manifests/images.json과 audio.json 참고

🔧 문제 해결
"ACCESS DENIED" 계속 나옴

Cloudflare Dashboard에서 GAME_PASSWORD 확인
숫자만 입력 (키패드 UI)
대소문자 구분 없음

로그인 후에도 play.html로 안 넘어감

F12 > Console 확인
에러 메시지 확인
test-login.html로 진단

Functions가 작동 안 함

functions/ 폴더가 Git에 커밋되었는지 확인
Cloudflare Dashboard > Deployments에서 Functions 섹션 확인
환경 변수 설정 후 재배포

이미지가 안 나옴

data/manifests/images.json 경로 확인
파일명이 정확히 일치하는지 확인
파일이 실제로 assets/images/ 에 있는지 확인


📚 추가 문서

TROUBLESHOOTING.md: 상세한 문제 해결 가이드
게임 설계 문서: Document 1 참고
wrangler.toml: Cloudflare 설정 파일


🎮 게임 플레이 흐름

Gate (index.html): 비밀번호 입력
Lobby (play.html): 대기 or 미니게임
Room 1: 스토리 진행, 선택지
Death: 사망 카드 & 유언 남기기
Feeds: 유언 목록, 사망 기록, 랭킹


🔐 보안 주의사항

.dev.vars 파일을 Git에 커밋하지 마세요

.gitignore에 포함되어 있음


SESSION_SECRET는 충분히 길고 랜덤하게

최소 32자 이상


GAME_PASSWORD는 복잡하게

프로덕션에서는 긴 숫자 조합 권장




📞 지원
문제가 계속되면:

TROUBLESHOOTING.md 전체 읽기
test-login.html로 진단
브라우저 콘솔 로그 확인
Cloudflare 배포 로그 확인


🎯 다음 단계

 환경 변수 설정 확인
 test-login.html로 테스트
 에셋 파일 교체
 실제 비밀번호로 변경
 Room 1 스토리 커스터마이징
 미니게임 케이스 추가
 KV/DO 백엔드 구현 (다음 버전)
