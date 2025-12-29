문제 해결 가이드
로그인 화면에서 다음으로 넘어가지 않는 문제
1. 환경 변수 확인
Cloudflare Pages Dashboard에서:

프로젝트 선택
Settings > Environment Variables
다음 변수들이 Production과 Preview 모두에 설정되어 있는지 확인:

GAME_PASSWORD=your_actual_password
SESSION_SECRET=random_secret_at_least_32_chars
중요: 환경 변수를 추가하거나 수정한 후에는 다시 배포해야 적용됩니다!
2. 브라우저 콘솔 확인

브라우저에서 F12 키를 눌러 개발자 도구 열기
Console 탭 확인
에러 메시지가 있는지 확인:

"fetch failed" → 파일 경로 문제
"401 Unauthorized" → 비밀번호가 틀림
"403 Forbidden" → 세션 쿠키 문제
"500 Internal Server Error" → 서버 함수 오류



3. Network 탭에서 API 요청 확인

F12 > Network 탭
비밀번호 입력 후 ENTER
/api/auth/login 요청 확인:

Status 200: 성공 (하지만 리다이렉트 안됨 → JS 오류)
Status 401: 비밀번호 틀림
Status 403: Functions가 제대로 배포 안됨
Status 404: Functions 경로 문제


Response 확인:

{"ok":true} → 성공
{"error":"DENIED"} → 비밀번호 틀림



4. 쿠키 확인
로그인 성공 후:

F12 > Application (또는 Storage) 탭
Cookies > 사이트 URL 선택
nr_session 쿠키가 있는지 확인
없으면 → 쿠키 설정 문제 (Secure flag 이슈일 수 있음)

5. 프로덕션 배포 확인
Functions가 제대로 배포되었는지 확인:
Cloudflare Pages 대시보드에서:

프로젝트 선택
최근 배포 클릭
Functions 섹션 확인
다음 함수들이 보여야 함:

   /api/auth/login
   /api/auth/logout
만약 Functions가 안 보이면:

functions/ 폴더가 프로젝트 루트에 있는지 확인
Git에 제대로 커밋되었는지 확인
다시 배포

6. 로컬 테스트 (Wrangler 사용)
bash# Wrangler 설치
npm install -g wrangler

# 로컬에서 Pages 실행
wrangler pages dev . --port 5173

# .dev.vars 파일 생성 (로컬 환경 변수)
# .dev.vars.example 참고
.dev.vars 파일 생성:
GAME_PASSWORD=1234
SESSION_SECRET=test_secret_key
7. 일반적인 해결 방법
방법 1: 하드 리프레시

Windows: Ctrl + F5
Mac: Cmd + Shift + R

방법 2: 쿠키 삭제

F12 > Application > Cookies
모든 쿠키 삭제
페이지 새로고침

방법 3: 시크릿 모드에서 테스트

캐시/쿠키 문제인지 확인

방법 4: 다른 브라우저에서 테스트

Chrome, Firefox, Safari 등

8. 디버깅 코드 추가
src/app.js의 doLogin() 함수에 이미 console.log가 추가되어 있습니다.
브라우저 콘솔에서 다음과 같은 로그를 확인하세요:
Attempting login with password length: X
Login response status: 200
Login success: {ok: true}
Redirecting to play.html...
9. Cloudflare Pages 빌드 설정
Dashboard > Settings > Build & Deploy 에서:

Build command: (비워둠)
Build output directory: /
Root directory: /

10. 여전히 안 되면
다음 정보를 제공하면 도와드릴 수 있습니다:

브라우저 콘솔의 전체 로그 (F12 > Console)
Network 탭의 /api/auth/login 요청/응답
Cloudflare Pages 배포 로그
사용 중인 비밀번호 길이 (실제 비밀번호 말고!)

추가 팁
환경 변수 즉시 적용
환경 변수 변경 후 자동으로 재배포되지 않으면:

Deployments 탭
Retry deployment 또는 새로운 커밋 푸시

SESSION_SECRET 생성
안전한 랜덤 문자열 생성:
bash# Node.js로 생성
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 또는 온라인 생성기 사용
# https://generate-secret.vercel.app/32
GAME_PASSWORD 권장사항

최소 4자 이상
숫자로만 구성 (키패드 UI 때문)
예: 1234, 9999, 12340815
