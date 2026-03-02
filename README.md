# Spotify Lyrics Korean Translator

Spicetify 확장 프로그램 - Spotify 가사를 한국어로 자동 번역합니다.

## 기능

- **실시간 번역**: 일본어/영어/중국어 가사를 한국어로 자동 번역
- **Gemini AI**: Google Gemini 2.0 Flash를 사용한 자연스러운 번역
- **캐시 시스템**: 번역된 가사를 저장하여 재사용
- **자동 스캔**: 플레이리스트/앨범 곡들을 일괄 번역
- **색상 동기화**: Spotify 가사 색상과 동기화

## 설치 방법

### 1. Spicetify 설치
```powershell
iwr -useb https://raw.githubusercontent.com/spicetify/cli/main/install.ps1 | iex
```

### 2. 확장 프로그램 설치
```powershell
Copy-Item "lyricsTranslator.js" "$env:APPDATA\spicetify\Extensions\" -Force
spicetify config extensions lyricsTranslator.js
spicetify apply
```

### 3. Gemini API 키 설정
1. [Google AI Studio](https://aistudio.google.com/app/apikey)에서 무료 API 키 발급
2. Spotify 프로필 메뉴 → "가사 번역 설정"
3. API 키 입력 후 저장

## 사용 방법

1. 가사가 있는 곡 재생 → 자동으로 번역됨
2. 설정 메뉴에서:
   - **현재 곡 다시 번역**: 번역 재시도
   - **자동 스캔**: 플레이리스트 곡들 일괄 번역
   - **캐시 삭제**: 저장된 번역 삭제

## 스크린샷

가사 아래에 번역이 표시됩니다.

## 요구사항

- Windows / macOS / Linux
- Spotify Desktop
- Spicetify v2.42.0+

## 라이선스

MIT License

---
dev.dorang
