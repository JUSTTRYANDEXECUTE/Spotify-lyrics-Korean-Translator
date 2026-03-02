// @ts-check

(async function LyricsTranslator() {
    const CONFIG = { GEMINI_API_KEY: "" };

    while (!Spicetify?.Player?.data || !Spicetify?.Platform) {
        await new Promise(r => setTimeout(r, 100));
    }

    // 설정 로드
    try {
        const saved = localStorage.getItem("ltr-config");
        if (saved) Object.assign(CONFIG, JSON.parse(saved));
    } catch(e) {}

    console.log("[가사번역] 로드됨");

    // 곡별 번역 캐시
    const songCache = new Map();
    try {
        const saved = localStorage.getItem("ltr-cache-v2");
        if (saved) JSON.parse(saved).forEach(([k,v]) => songCache.set(k, new Map(Object.entries(v))));
    } catch(e) {}

    function saveCache() {
        try {
            const arr = [];
            songCache.forEach((v, k) => {
                const obj = {};
                v.forEach((val, key) => obj[key] = val);
                arr.push([k, obj]);
            });
            localStorage.setItem("ltr-cache-v2", JSON.stringify(arr));
        } catch(e) {
            // 용량 초과 시 오래된 절반 삭제
            try {
                const arr = [];
                songCache.forEach((v, k) => {
                    const obj = {};
                    v.forEach((val, key) => obj[key] = val);
                    arr.push([k, obj]);
                });
                const half = Math.floor(arr.length / 2);
                localStorage.setItem("ltr-cache-v2", JSON.stringify(arr.slice(half)));
            } catch(e2) {
                localStorage.removeItem("ltr-cache-v2");
            }
        }
    }

    // 현재 곡 정보
    function getSongKey() {
        const data = Spicetify.Player.data;
        if (!data?.item) return null;
        return `${data.item.artists?.[0]?.name || ""} - ${data.item.name || ""}`;
    }

    function getSongInfo() {
        const data = Spicetify.Player.data;
        return {
            title: data?.item?.name || "",
            artist: data?.item?.artists?.map(a => a.name).join(", ") || ""
        };
    }

    // 언어 감지
    function detectLang(text) {
        if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return { code: "ja", name: "일본어" };
        if (/[\u4E00-\u9FFF]/.test(text) && !/[\u3040-\u30FF]/.test(text)) return { code: "zh", name: "중국어" };
        if (/[\uAC00-\uD7AF]/.test(text)) return { code: "ko", name: "한국어" };
        return { code: "en", name: "영어" };
    }

    // 가사 CSS 스타일
    const style = document.createElement("style");
    style.textContent = `
        .ltr-trans {
            font-size: 0.72em;
            opacity: 0.85;
            margin-top: 4px;
            line-height: 1.3;
            color: inherit !important;
            transition: color 0.2s ease, opacity 0.2s ease;
        }
    `;
    document.head.appendChild(style);

    // 가사 요소 찾기
    function findLyricElements() {
        const selectors = [
            '.lyrics-lyricsContent-lyric',
            '[data-testid="fullscreen-lyric"]',
            '.lyrics-lyricsContent-text'
        ];
        for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) return Array.from(els);
        }
        return [];
    }

    // 가사 텍스트 추출
    function getLyricText(el) {
        let text = "";
        el.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains("ltr-trans")) {
                text += node.innerText || node.textContent || "";
            }
        });
        return text.trim();
    }

    // 전체 가사 수집
    function collectLyrics() {
        const els = findLyricElements();
        const lyrics = [];
        els.forEach(el => {
            const text = getLyricText(el);
            if (text && text.length > 1 && !/^[\s.,!?'"()\-:;♪♫\d]+$/.test(text)) {
                if (!lyrics.includes(text)) lyrics.push(text);
            }
        });
        return lyrics;
    }

    // Gemini API 번역
    async function translateWithGemini(lyrics, lang) {
        if (!CONFIG.GEMINI_API_KEY) return null;

        const song = getSongInfo();
        const prompt = `노래 가사 번역 전문가입니다.

"${song.artist}"의 "${song.title}" - ${lang.name} 노래 가사를 자연스러운 한국어로 번역해주세요.

규칙:
- 노래 가사답게 시적이고 자연스럽게 의역
- 이미 한국어인 줄도 번호와 함께 그대로 출력
- 절대 줄을 건너뛰거나 합치지 말 것
- 총 ${lyrics.length}줄 모두 번역

형식 (번호와 번역만):
1|번역1
2|번역2

가사:
${lyrics.map((l, i) => `${i + 1}. ${l}`).join('\n')}`;

        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.3, maxOutputTokens: 8192 }
                    })
                }
            );

            if (!res.ok) throw new Error(`API ${res.status}`);

            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
            
            const translations = {};
            text.split('\n').forEach(line => {
                const match = line.match(/^(\d+)\s*[|｜]\s*(.+)$/);
                if (match) {
                    const idx = parseInt(match[1]) - 1;
                    if (idx >= 0 && idx < lyrics.length) {
                        translations[lyrics[idx]] = match[2].trim();
                    }
                }
            });

            console.log("[가사번역] Gemini 성공:", Object.keys(translations).length, "줄");
            return translations;
        } catch (e) {
            console.error("[가사번역] Gemini 오류:", e.message);
            return null;
        }
    }

    // 폴백 번역 (MyMemory)
    async function quickTranslate(text, langCode) {
        try {
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langCode}|ko`;
            const res = await fetch(url);
            const json = await res.json();
            if (json.responseData?.translatedText && !json.responseData.translatedText.includes("MYMEMORY")) {
                return json.responseData.translatedText;
            }
        } catch(e) {}
        return null;
    }

    // ========== 플레이리스트 일괄 번역 ==========
    
    // 특정 트랙의 가사 가져오기
    async function fetchLyrics(trackUri) {
        try {
            const trackId = trackUri.split(":").pop();
            
            // 방법 1: color-lyrics API
            try {
                const res = await Spicetify.CosmosAsync.get(
                    `wg://color-lyrics/v2/track/${trackId}?format=json&market=from_token`
                );
                if (res?.lyrics?.lines) {
                    const lines = res.lyrics.lines.map(l => l.words).filter(w => w && w.trim());
                    if (lines.length > 0) return lines;
                }
            } catch(e1) {}
            
            // 방법 2: 기존 lyrics API
            try {
                const res = await Spicetify.CosmosAsync.get(`wg://lyrics/v1/track/${trackId}`);
                if (res?.lines) {
                    const lines = res.lines.map(l => l.words).filter(w => w && w.trim());
                    if (lines.length > 0) return lines;
                }
            } catch(e2) {}

            // 방법 3: Platform Lyrics API
            try {
                if (Spicetify.Platform?.Lyrics) {
                    const res = await Spicetify.Platform.Lyrics.getLyrics(trackUri);
                    if (res?.lines) {
                        const lines = res.lines.map(l => l.words).filter(w => w && w.trim());
                        if (lines.length > 0) return lines;
                    }
                }
            } catch(e3) {}

        } catch(e) {
            console.log("[가사번역] 가사 가져오기 실패:", trackUri);
        }
        return null;
    }

    // 현재 페이지의 플레이리스트/앨범 트랙 가져오기
    async function fetchCurrentPageTracks() {
        try {
            const path = Spicetify.Platform.History.location.pathname;
            console.log("[가사번역] 현재 경로:", path);
            
            let id = null;
            let type = null;

            if (path.startsWith("/playlist/")) {
                id = path.split("/")[2];
                type = "playlist";
            } else if (path.startsWith("/album/")) {
                id = path.split("/")[2];
                type = "album";
            }

            if (!id) {
                console.log("[가사번역] 플레이리스트/앨범 ID 없음");
                return null;
            }

            console.log("[가사번역] 타입:", type, "ID:", id);

            if (type === "playlist") {
                // 방법 1: Platform API
                try {
                    const contents = await Spicetify.Platform.PlaylistAPI.getContents(`spotify:playlist:${id}`);
                    if (contents?.items) {
                        console.log("[가사번역] PlaylistAPI 성공:", contents.items.length, "곡");
                        return contents.items.map(item => ({
                            uri: item.uri,
                            name: item.name,
                            artist: item.artists?.[0]?.name || ""
                        }));
                    }
                } catch(e1) {
                    console.log("[가사번역] PlaylistAPI 실패, CosmosAsync 시도");
                }
                
                // 방법 2: CosmosAsync
                try {
                    const res = await Spicetify.CosmosAsync.get(`sp://core-playlist/v1/playlist/spotify:playlist:${id}/rows`, {
                        policy: { link: true, name: true, artist: true }
                    });
                    if (res?.rows) {
                        console.log("[가사번역] CosmosAsync 성공:", res.rows.length, "곡");
                        return res.rows.map(r => ({
                            uri: r.link || r.uri,
                            name: r.name,
                            artist: r.artist?.name || r.artists?.[0]?.name || ""
                        })).filter(t => t.uri);
                    }
                } catch(e2) {
                    console.log("[가사번역] CosmosAsync 플레이리스트 실패:", e2);
                }
            } else if (type === "album") {
                try {
                    const res = await Spicetify.CosmosAsync.get(`wg://album/v1/album-app/album/${id}/desktop`);
                    if (res?.discs) {
                        const tracks = [];
                        const albumArtist = res.artists?.[0]?.name || "";
                        res.discs.forEach(disc => {
                            disc.tracks?.forEach(t => {
                                tracks.push({
                                    uri: t.uri,
                                    name: t.name,
                                    artist: t.artists?.[0]?.name || albumArtist
                                });
                            });
                        });
                        console.log("[가사번역] 앨범 성공:", tracks.length, "곡");
                        return tracks;
                    }
                } catch(e3) {
                    console.log("[가사번역] 앨범 API 실패:", e3);
                }
            }
        } catch(e) {
            console.error("[가사번역] 트랙 목록 가져오기 실패:", e);
        }
        return null;
    }

    // 곡 하나 번역 (가사 데이터 직접 받음)
    async function translateSingleTrack(trackInfo, lyrics) {
        if (!CONFIG.GEMINI_API_KEY || !lyrics || lyrics.length === 0) return null;

        const lang = detectLang(lyrics.join(" "));
        if (lang.code === "ko") return null; // 이미 한국어

        const prompt = `노래 가사 번역 전문가입니다.

"${trackInfo.artist}"의 "${trackInfo.name}" - ${lang.name} 노래 가사를 자연스러운 한국어로 번역해주세요.

규칙:
- 노래 가사답게 시적이고 자연스럽게 의역
- 이미 한국어인 줄도 번호와 함께 그대로 출력
- 절대 줄을 건너뛰거나 합치지 말 것
- 총 ${lyrics.length}줄 모두 번역

형식 (번호와 번역만):
1|번역1
2|번역2

가사:
${lyrics.map((l, i) => `${i + 1}. ${l}`).join('\n')}`;

        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.3, maxOutputTokens: 8192 }
                    })
                }
            );

            if (!res.ok) return null;

            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
            
            const translations = new Map();
            text.split('\n').forEach(line => {
                const match = line.match(/^(\d+)\s*[|｜]\s*(.+)$/);
                if (match) {
                    const idx = parseInt(match[1]) - 1;
                    if (idx >= 0 && idx < lyrics.length) {
                        translations.set(lyrics[idx], match[2].trim());
                    }
                }
            });

            return translations;
        } catch(e) {
            return null;
        }
    }

    // 플레이리스트 자동 스캔 모드
    let isScanning = false;
    
    async function batchTranslatePlaylist() {
        if (!CONFIG.GEMINI_API_KEY) {
            Spicetify.showNotification("Gemini API 키를 먼저 설정하세요");
            return;
        }

        if (isScanning) {
            isScanning = false;
            Spicetify.showNotification("스캔 중지됨");
            return;
        }

        const tracks = await fetchCurrentPageTracks();
        if (!tracks || tracks.length === 0) {
            Spicetify.showNotification("플레이리스트/앨범 페이지에서 실행하세요");
            return;
        }

        // 현재 재생 상태 저장
        const originalUri = Spicetify.Player.data?.item?.uri;
        const wasPlaying = !Spicetify.Player.data?.isPaused;

        isScanning = true;
        Spicetify.showNotification(`${tracks.length}곡 스캔 시작... (다시 클릭하면 중지)`);
        
        let success = 0;
        let skipped = 0;
        let noLyrics = 0;

        for (let i = 0; i < tracks.length; i++) {
            if (!isScanning) break;

            const track = tracks[i];
            const songKey = `${track.artist} - ${track.name}`;

            // 이미 캐시되어 있으면 스킵
            if (songCache.has(songKey) && songCache.get(songKey).size > 0) {
                skipped++;
                continue;
            }

            // 진행상황 표시
            Spicetify.showNotification(`스캔 중... ${i + 1}/${tracks.length}: ${track.name}`);

            // 곡 재생
            try {
                await Spicetify.Player.playUri(track.uri);
            } catch(e) {
                continue;
            }

            // 가사 로딩 대기 (3초)
            await new Promise(r => setTimeout(r, 3000));
            
            if (!isScanning) break;

            // 화면에서 가사 수집
            const lyrics = collectLyrics();
            
            if (lyrics.length === 0) {
                noLyrics++;
                continue;
            }

            // 번역
            const lang = detectLang(lyrics.join(" "));
            if (lang.code === "ko") {
                skipped++;
                continue;
            }

            const translations = await translateWithGemini(lyrics, lang);
            if (translations && Object.keys(translations).length > 0) {
                if (!songCache.has(songKey)) songCache.set(songKey, new Map());
                Object.entries(translations).forEach(([orig, trans]) => {
                    songCache.get(songKey).set(orig, trans);
                });
                success++;
                
                // 10곡마다 저장
                if (success % 10 === 0) saveCache();
            }

            // API 레이트 리밋 방지
            await new Promise(r => setTimeout(r, 500));
        }

        isScanning = false;
        saveCache();

        // 원래 곡으로 복귀
        if (originalUri) {
            try {
                await Spicetify.Player.playUri(originalUri);
                if (!wasPlaying) Spicetify.Player.pause();
            } catch(e) {}
        }

        Spicetify.showNotification(`스캔 완료! 번역: ${success}곡 / 스킵: ${skipped}곡 / 가사없음: ${noLyrics}곡`);
    }

    // 번역 표시
    function showTranslation(el, text) {
        if (!el || el.querySelector(".ltr-trans")) return;
        const div = document.createElement("div");
        div.className = "ltr-trans";
        div.textContent = text;
        el.appendChild(div);
    }

    // 현재 곡 캐시
    function getCache() {
        const key = getSongKey();
        if (!key) return null;
        if (!songCache.has(key)) songCache.set(key, new Map());
        return songCache.get(key);
    }

    // 화면에 번역 적용
    function applyTranslations() {
        const cache = getCache();
        if (!cache || cache.size === 0) return;

        const els = findLyricElements();
        els.forEach(el => {
            if (el.querySelector(".ltr-trans")) return;
            const text = getLyricText(el);
            if (text && cache.has(text)) {
                showTranslation(el, cache.get(text));
            }
        });
    }

    // 메인 처리
    let isProcessing = false;
    let lastSongKey = "";

    async function process() {
        const songKey = getSongKey();
        if (!songKey) return;

        const cache = getCache();
        if (!cache) return;

        applyTranslations();

        if (songKey !== lastSongKey && cache.size === 0) {
            if (isProcessing) return;
            lastSongKey = songKey;
            isProcessing = true;

            console.log("[가사번역] 새 곡:", songKey);
            await new Promise(r => setTimeout(r, 2500));

            const lyrics = collectLyrics();
            console.log("[가사번역] 가사 수집:", lyrics.length, "줄");

            if (lyrics.length > 0) {
                const lang = detectLang(lyrics.join(" "));
                
                if (lang.code !== "ko") {
                    let translations = null;

                    if (CONFIG.GEMINI_API_KEY) {
                        Spicetify.showNotification("번역 중...");
                        translations = await translateWithGemini(lyrics, lang);
                    }

                    if (translations && Object.keys(translations).length > 0) {
                        Object.entries(translations).forEach(([orig, trans]) => {
                            cache.set(orig, trans);
                        });
                        saveCache();
                        applyTranslations();
                        Spicetify.showNotification("✓ 번역 완료!");
                    } else if (!CONFIG.GEMINI_API_KEY) {
                        Spicetify.showNotification("번역 중...");
                        for (const lyric of lyrics) {
                            if (!cache.has(lyric)) {
                                const trans = await quickTranslate(lyric, lang.code);
                                if (trans) cache.set(lyric, trans);
                                await new Promise(r => setTimeout(r, 400));
                            }
                        }
                        saveCache();
                        applyTranslations();
                        Spicetify.showNotification("✓ 번역 완료!");
                    }
                }
            }

            isProcessing = false;
        }
    }

    // DOM 감시 - 번역 즉시 복원
    new MutationObserver(() => {
        applyTranslations();
    }).observe(document.body, { childList: true, subtree: true });

    // 주기적 체크
    setInterval(() => {
        applyTranslations();
        if (!isProcessing) process();
    }, 1500);

    setTimeout(process, 2000);

    // 곡 변경
    Spicetify.Player.addEventListener("songchange", () => {
        lastSongKey = "";
        saveCache();
        setTimeout(process, 1500);
    });

    // 설정 메뉴
    new Spicetify.Menu.Item("가사 번역 설정", false, () => {
        const container = document.createElement("div");
        container.innerHTML = `
            <div style="padding:16px;">
                <div style="margin-bottom:16px;">
                    <label style="display:block; margin-bottom:8px; font-weight:bold;">Gemini API 키</label>
                    <input type="password" id="ltr-key" value="${CONFIG.GEMINI_API_KEY}" 
                        placeholder="AIza..." 
                        style="width:100%; padding:10px; border-radius:4px; border:1px solid #535353; background:#282828; color:white;">
                    <p style="font-size:12px; color:#b3b3b3; margin-top:8px;">
                        <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:#1db954;">
                            Google AI Studio → API 키 발급 (무료)
                        </a>
                    </p>
                </div>
                <p style="color:#b3b3b3; font-size:13px; margin-bottom:16px;">캐시: ${songCache.size}곡</p>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button id="ltr-save" style="background:#1db954; color:white; border:none; padding:10px 20px; border-radius:20px; cursor:pointer;">저장</button>
                    <button id="ltr-clear" style="background:#535353; color:white; border:none; padding:10px 20px; border-radius:20px; cursor:pointer;">캐시 삭제</button>
                    <button id="ltr-retry" style="background:#3498db; color:white; border:none; padding:10px 20px; border-radius:20px; cursor:pointer;">현재 곡 다시 번역</button>
                    <button id="ltr-batch" style="background:#9b59b6; color:white; border:none; padding:10px 20px; border-radius:20px; cursor:pointer;">� 자동 스캔</button>
                </div>
                <p style="color:#888; font-size:11px; margin-top:12px;">※ 자동 스캔: 플레이리스트 곡들을 순차 재생하며 가사 수집 & 번역</p>
            </div>
        `;
        
        container.querySelector("#ltr-save")?.addEventListener("click", () => {
            CONFIG.GEMINI_API_KEY = container.querySelector("#ltr-key")?.value?.trim() || "";
            localStorage.setItem("ltr-config", JSON.stringify(CONFIG));
            Spicetify.showNotification("저장됨!");
            Spicetify.PopupModal.hide();
        });
        
        container.querySelector("#ltr-clear")?.addEventListener("click", () => {
            songCache.clear();
            localStorage.removeItem("ltr-cache-v2");
            Spicetify.showNotification("캐시 삭제됨!");
        });
        
        container.querySelector("#ltr-retry")?.addEventListener("click", () => {
            const key = getSongKey();
            if (key) {
                songCache.delete(key);
                lastSongKey = "";
                isProcessing = false;
                Spicetify.PopupModal.hide();
                process();
            }
        });
        
        container.querySelector("#ltr-batch")?.addEventListener("click", () => {
            Spicetify.PopupModal.hide();
            batchTranslatePlaylist();
        });
        
        Spicetify.PopupModal.display({ title: "가사 번역기", content: container });
    }).register();

    console.log("[가사번역] 준비 완료!");
})();

// dev.dorang
