javascript: (function () {
    // 設定定数
    const CONFIG = {
        MAX_SCROLL_ATTEMPTS: 5000,        // スクロール処理の最大試行回数
        SCROLL_AMOUNT_BASE: 800,          // 基本スクロール量（ピクセル）
        SCROLL_AMOUNT_MULTIPLIER: 0.8,    // ウィンドウ高さベースのスクロール量倍率
        SCROLL_WAIT_TIME_NORMAL: 400,     // 通常のスクロール間隔（ミリ秒）
        SCROLL_WAIT_TIME_SLOW: 800,       // 読み込み遅延時のスクロール間隔（ミリ秒）
        SAME_HEIGHT_THRESHOLD: 15,        // 同じページ高さが続く回数の上限
        SAME_HEIGHT_SLOW_THRESHOLD: 5,    // スロー待機に切り替える同じ高さ回数
        TARGET_REACHED_THRESHOLD: 3,      // 目標日付到達判定の連続回数
        INITIAL_SCROLL_DELAY: 500,        // 初期スクロール前の待機時間（ミリ秒）
        BOTTOM_SCROLL_DELAY: 1000         // 最下部スクロール後の待機時間（ミリ秒）
    };

    // 日付文字列を解析してDateオブジェクトに変換する

    function parseTargetDate(dateStr) {
        const today = new Date();
        const currentYear = today.getFullYear();

        const dateMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})$/);
        if (dateMatch) {
            const month = parseInt(dateMatch[1], 10);
            const day = parseInt(dateMatch[2], 10);
            const targetDate = new Date(currentYear, month - 1, day);
            if (targetDate > today) {
                targetDate.setFullYear(currentYear - 1);
            }
            targetDate.setHours(0, 0, 0, 0);
            return targetDate;
        }

        const fullDateMatch = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
        if (fullDateMatch) {
            const year = parseInt(fullDateMatch[1], 10);
            const month = parseInt(fullDateMatch[2], 10);
            const day = parseInt(fullDateMatch[3], 10);
            const targetDate = new Date(year, month - 1, day);
            targetDate.setHours(0, 0, 0, 0);
            return targetDate;
        }

        return null;
    }

    // 視聴履歴チャンクから動画数を取得する
    function getChunkVideoCount(chunk) {
        const list = chunk.querySelector('.VideoMediaObjectList');
        return list ? list.children.length : 0;
    }

    // ヘッダーテキストから日付を取得する
    function getDateFromChunkHeader(headerText) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const currentYear = today.getFullYear();

        if (headerText === '今日') return today;
        if (headerText === '昨日') {
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);
            return yesterday;
        }

        const dateMatch = headerText.match(/^(\d{1,2})月(\d{1,2})日$/);
        if (dateMatch) {
            const month = parseInt(dateMatch[1], 10);
            const day = parseInt(dateMatch[2], 10);
            const chunkDate = new Date(currentYear, month - 1, day);
            if (chunkDate > today) {
                chunkDate.setFullYear(currentYear - 1);
            }
            return chunkDate;
        }
        return null;
    }

    // 指定日付以降の日別動画視聴数を集計する
    function countVideosByDate(targetDate) {
        const chunks = document.querySelectorAll('.VideoWatchHistoryContainer-dayChunk');
        const dateCount = [];
        let totalCount = 0;

        for (const chunk of chunks) {
            const header = chunk.querySelector('.VideoWatchHistoryContainer-dayHeader');
            if (!header) continue;

            const chunkDate = getDateFromChunkHeader(header.textContent);
            if (!chunkDate || chunkDate.getTime() < targetDate.getTime()) continue;

            const dateText = `${chunkDate.getMonth() + 1}/${chunkDate.getDate()}`;
            const videoCount = getChunkVideoCount(chunk);

            if (videoCount > 0) {
                dateCount.push({ date: dateText, count: videoCount });
                totalCount += videoCount;
            }
        }

        return { dateCount, totalCount };
    }

    // 現在表示されている最も古い日付を取得する
    function getOldestVisibleDate() {
        const chunks = document.querySelectorAll('.VideoWatchHistoryContainer-dayChunk');
        let oldestDate = null;

        for (const chunk of chunks) {
            const header = chunk.querySelector('.VideoWatchHistoryContainer-dayHeader');
            if (!header) continue;

            const chunkDate = getDateFromChunkHeader(header.textContent);
            if (!chunkDate) continue;

            if (!oldestDate || chunkDate < oldestDate) {
                oldestDate = chunkDate;
            }
        }
        return oldestDate;
    }

    // 進捗表示用のUI要素を作成する
    function createProgressElements() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(128, 128, 128, 0.5);
            z-index: 9999;
        `;

        const progressElement = document.createElement('div');
        progressElement.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 20px;
            border-radius: 10px;
            z-index: 10000;
            font-size: 16px;
            min-width: 350px;
            max-width: 500px;
        `;

        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = `
            margin-bottom: 15px;
            line-height: 1.5;
        `;

        const stopButton = document.createElement('button');
        stopButton.textContent = '停止';
        stopButton.className = 'VideoWatchHistoryControlArea-button';

        const closeButton = document.createElement('button');
        closeButton.textContent = '閉じる';
        closeButton.className = 'VideoWatchHistoryControlArea-button';
        closeButton.style.display = 'none';

        closeButton.addEventListener('click', () => {
            overlay.remove();
            progressElement.remove();
        });

        progressElement.appendChild(messageDiv);
        progressElement.appendChild(stopButton);
        progressElement.appendChild(closeButton);
        document.body.appendChild(overlay);
        document.body.appendChild(progressElement);

        return { overlay, progressElement, messageDiv, stopButton, closeButton };
    }

    // 集計結果をHTML形式でフォーマットする
    function formatResults(dateCount, totalCount) {
        let resultText = '各日付の視聴動画数:<br><br>';
        for (const item of dateCount) {
            resultText += `${item.date}: ${item.count}本<br>`;
        }
        resultText += `<br>合計: ${totalCount}本`;
        return resultText;
    }

    // 目標日付まで自動スクロールを実行する（停止ボタンで中断可能）
    async function scrollToTargetDate(targetDate, messageDiv, stopButton) {
        return new Promise((resolve) => {
            let scrollCount = 0;
            let stopped = false;
            let lastScrollHeight = 0;
            let sameHeightCount = 0;
            let consecutiveTargetReachedCount = 0;

            stopButton.addEventListener('click', () => {
                stopped = true;
                resolve(false);
            });

            function scrollStep() {
                if (stopped) return;

                const currentScrollHeight = document.documentElement.scrollHeight;
                const oldestDate = getOldestVisibleDate();

                const targetDateText = targetDate.toLocaleDateString('ja-JP');
                const oldestDateText = oldestDate ? oldestDate.toLocaleDateString('ja-JP') : '読み込み中...';
                messageDiv.innerHTML = `スクロール中(${scrollCount}回目)<br>目標日付: ${targetDateText}<br>現在の表示位置: ${oldestDateText}`;

                if (oldestDate && oldestDate < targetDate) {
                    consecutiveTargetReachedCount++;
                    if (consecutiveTargetReachedCount >= CONFIG.TARGET_REACHED_THRESHOLD) {
                        setTimeout(() => resolve(true), 500);
                        return;
                    }
                } else {
                    consecutiveTargetReachedCount = 0;
                }

                if (currentScrollHeight === lastScrollHeight) {
                    sameHeightCount++;
                } else {
                    sameHeightCount = 0;
                    lastScrollHeight = currentScrollHeight;
                }

                if (scrollCount >= CONFIG.MAX_SCROLL_ATTEMPTS) {
                    messageDiv.innerHTML = '最大試行回数に到達しました';
                    setTimeout(() => resolve(false), 1000);
                    return;
                }

                if (sameHeightCount >= CONFIG.SAME_HEIGHT_THRESHOLD) {
                    messageDiv.innerHTML = '新しいコンテンツの読み込みが停止しています';
                    setTimeout(() => resolve(false), 1000);
                    return;
                }

                const scrollAmount = Math.max(CONFIG.SCROLL_AMOUNT_BASE, window.innerHeight * CONFIG.SCROLL_AMOUNT_MULTIPLIER);
                window.scrollBy(0, scrollAmount);
                scrollCount++;

                const waitTime = sameHeightCount > CONFIG.SAME_HEIGHT_SLOW_THRESHOLD ? CONFIG.SCROLL_WAIT_TIME_SLOW : CONFIG.SCROLL_WAIT_TIME_NORMAL;
                setTimeout(scrollStep, waitTime);
            }

            scrollStep();
        });
    }

    // メイン処理：ユーザー入力から結果表示までの全体制御
    async function main() {
        let overlay = null;
        let progressElement = null;
        let messageDiv = null;
        let stopButton = null;
        let closeButton = null;

        try {
            const today = new Date();
            const todayMonth = today.getMonth() + 1;
            const todayDay = today.getDate();
            const currentYear = today.getFullYear();

            const dateInput = prompt(
                '表示したい日付を入力してください\n\n' +
                '入力例:\n' +
                `・${todayMonth}/${todayDay}\n` +
                `・${currentYear}/${todayMonth}/${todayDay}`
            );

            if (!dateInput) return;

            const targetDate = parseTargetDate(dateInput.trim());
            if (!targetDate) {
                alert('日付の形式が正しくありません。');
                return;
            }

            const elements = createProgressElements();
            overlay = elements.overlay;
            progressElement = elements.progressElement;
            messageDiv = elements.messageDiv;
            stopButton = elements.stopButton;
            closeButton = elements.closeButton;

            const targetDateStr = targetDate.toLocaleDateString('ja-JP');
            messageDiv.innerHTML = `目標日付: ${targetDateStr}`;

            window.scrollTo(0, 0);
            await new Promise(resolve => setTimeout(resolve, CONFIG.INITIAL_SCROLL_DELAY));
            window.scrollTo(0, document.body.scrollHeight);
            await new Promise(resolve => setTimeout(resolve, CONFIG.BOTTOM_SCROLL_DELAY));

            const scrollSuccess = await scrollToTargetDate(targetDate, messageDiv, stopButton);

            stopButton.style.display = 'none';
            closeButton.style.display = 'block';

            if (!scrollSuccess) {
                messageDiv.innerHTML = '処理が中断されました';
                return;
            }

            const { dateCount, totalCount } = countVideosByDate(targetDate);
            messageDiv.innerHTML = formatResults(dateCount, totalCount);

        } catch (error) {
            console.error('エラーが発生しました:', error);
            if (messageDiv) {
                messageDiv.innerHTML = 'エラーが発生しました。詳細はコンソールを確認してください。';
                if (stopButton) stopButton.style.display = 'none';
                if (closeButton) closeButton.style.display = 'block';
            } else {
                alert('エラーが発生しました。詳細はコンソールを確認してください。');
            }
        }
    }

    if (!location.href.includes('nicovideo.jp/my/history')) {
        if (confirm('ニコニコ動画の視聴履歴ページで実行してください。移動しますか？')) {
            location.href = 'https://www.nicovideo.jp/my/history';
            return;
        } else {
            return;
        }
    }

    main();
})();
