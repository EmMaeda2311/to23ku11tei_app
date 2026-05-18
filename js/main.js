// js/main.js

// 1. データ構造
let appData = {
    questions: []
};

// 2. アプリの状態管理
let currentQuizQueue = [];
let normalDueQueue = [];
let wrongDueQueue = [];
let currentQuestion = null;
let currentSelectedOptions = [];

// --- 初期化とローカルストレージ処理 ---
function init() {
    loadDataFromLocal();
    updateDashboard();
}

function loadDataFromLocal() {
    const savedData = localStorage.getItem('myQuizData');
    if (savedData) {
        appData = JSON.parse(savedData);
    }
}

function saveDataToLocal() {
    localStorage.setItem('myQuizData', JSON.stringify(appData));
}

// ---------------------------------------------------
// 3. CSVファイルのアップロード・マージ処理（修正版）
// ---------------------------------------------------
function handleCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const csvText = e.target.result;
        importCSVAndMerge(csvText);
        event.target.value = '';
    };
    reader.readAsText(file, 'UTF-8');
}

function importCSVAndMerge(csvText) {
    const lines = csvText.replace(/\r\n|\r/g, '\n').trim().split('\n');
    const dataLines = lines.slice(1);
    let addedCount = 0;
    let updatedCount = 0;

    // ▼▼ 追加：先頭の「Q〇.」や「〇.」を削除する便利関数 ▼▼
    // ※全角スペースや「、」区切りなどの表記揺れにも対応しています
    const cleanQuestion = (text) => text.replace(/^Q\d+[\.、\s　]*/, '').trim();
    const cleanOption = (text) => text.replace(/^\d+[\.、\s　]*/, '').trim();

    dataLines.forEach(line => {
        if (!line.trim()) return;

        const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(col => {
            return col.replace(/^"(.*)"$/, '$1').trim();
        });

        const id = cols[0];
        // ▼ 変更：問題文を綺麗にしてから取得
        const questionText = cleanQuestion(cols[1]);
        const correctStr = cols[2];

        // ▼ 変更：選択肢も綺麗にしてから取得
        const options = [cols[3], cols[4], cols[5], cols[6], cols[7]]
            .filter(opt => opt && opt.trim() !== '')
            .map(opt => cleanOption(opt));

        const explanation = cols[9];
        const qImage = cols[10] ? cols[10] : null;
        const eImage = cols[11] ? cols[11] : null;

        if (!id) return;

        // ▼ 変更：正解テキストを作成する際も綺麗にしておく（照合エラーを防ぐため）
        const correctIndexes = correctStr.split(',');
        const correctAnswers = correctIndexes.map(idx => {
            const num = parseInt(idx.trim());
            return cols[2 + num] ? cleanOption(cols[2 + num]) : '';
        }).filter(ans => ans !== '');

        const existingIndex = appData.questions.findIndex(q => q.id === id);

        const questionObj = {
            id: id,
            question: questionText,
            correctAnswers: correctAnswers,
            options: options,
            explanation: explanation,
            questionImage: qImage,
            explanationImage: eImage
        };

        if (existingIndex !== -1) {
            Object.assign(appData.questions[existingIndex], questionObj);
            updatedCount++;
        } else {
            appData.questions.push({
                ...questionObj,
                repetitionCount: 0,
                easeFactor: 2.5,
                intervalDays: 0,
                nextReviewDate: null
            });
            addedCount++;
        }
    });

    saveDataToLocal();
    updateDashboard();
    alert(`CSVの読み込みが完了しました！\n・新規追加: ${addedCount}問\n・更新: ${updatedCount}問`);
}

// ---------------------------------------------------
// 4. 画面切り替えとユーティリティ
// ---------------------------------------------------
function showView(viewId) {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ---------------------------------------------------
// 5. UI制御（修正版）
// ---------------------------------------------------
function updateDashboard() {
    const total = appData.questions.length;
    const attempted = appData.questions.filter(q => q.nextReviewDate !== null).length;
    document.getElementById('stat-attempted').innerText = total > 0 ? Math.round((attempted / total) * 100) : 0;

    const now = new Date().getTime();

    // 【抽出1】間違えた問題（1度でも解いたことがあり、連続正解が0回のもの）
    wrongDueQueue = appData.questions.filter(q =>
        q.nextReviewDate !== null && q.repetitionCount === 0
    );

    // 【抽出2】新規・復習タスク（未学習、または復習タイミングが来ていて、正解記録があるもの）
    normalDueQueue = appData.questions.filter(q =>
        (q.nextReviewDate === null) ||
        (q.nextReviewDate <= now && q.repetitionCount > 0)
    );

    document.getElementById('stat-due').innerText = normalDueQueue.length;
    document.getElementById('stat-wrong').innerText = wrongDueQueue.length;
}

// ▼▼ 変更：押されたボタンによって読み込むリストを変える ▼▼
function startQuiz(mode) {
    if (mode === 'normal') {
        if (normalDueQueue.length === 0) {
            alert("今日の新規・復習タスクは完了しています！");
            return;
        }
        // ▼ 変更：リストをそのまま入れるのではなく、シャッフルして入れる
        currentQuizQueue = shuffleArray([...normalDueQueue]);
    } else if (mode === 'wrong') {
        if (wrongDueQueue.length === 0) {
            alert("現在、要注意（間違えた問題）リストは空です！素晴らしいです。");
            return;
        }
        // ▼ 変更：要注意リストもシャッフルする
        currentQuizQueue = shuffleArray([...wrongDueQueue]);
    }
    renderNextQuestion();
}

// 【修正】出題画面の描画（複数選択のサポート）
function renderNextQuestion() {
    if (currentQuizQueue.length === 0) {
        updateDashboard();
        showView('dashboard-view');
        return;
    }

    currentQuestion = currentQuizQueue[0];
    currentSelectedOptions = []; // 新しい問題のたびに選択状態をリセット

    // 正解の数（1つか、複数か）を取得
    const requiredCount = currentQuestion.correctAnswers.length;

    // 複数選択の場合は問題文の末尾にヒントを追加
    let qText = currentQuestion.question;
    if (requiredCount > 1) {
        qText += `\n（※ ${requiredCount}つ選んでください）`;
    }
    document.getElementById('question-text').innerText = qText;

    const qImageEl = document.getElementById('question-image');
    if (qImageEl) {
        if (currentQuestion.questionImage) {
            qImageEl.src = currentQuestion.questionImage;
            qImageEl.style.display = 'block';
        } else {
            qImageEl.src = '';
            qImageEl.style.display = 'none';
        }
    }

    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = '';

    const shuffledOptions = shuffleArray(currentQuestion.options);
    shuffledOptions.forEach(option => {
        const btn = document.createElement('button');
        btn.innerText = option;
        // ▼ 変更：直接答え合わせに行かず、クリック処理関数を挟む
        btn.onclick = (e) => handleOptionClick(e, option);
        optionsContainer.appendChild(btn);
    });

    showView('quiz-view');
}

// ▼▼ 新規追加：選択肢がクリックされた時の処理 ▼▼
function handleOptionClick(event, option) {
    const btn = event.target;
    const requiredCount = currentQuestion.correctAnswers.length;

    // 選択状態の切り替え
    if (currentSelectedOptions.includes(option)) {
        // すでに選ばれていれば解除（もう一度押すとキャンセルできる）
        currentSelectedOptions = currentSelectedOptions.filter(o => o !== option);
        btn.classList.remove('selected');
    } else {
        // 選ばれていなければ追加
        currentSelectedOptions.push(option);
        btn.classList.add('selected');
    }

    // 必要な数だけ選択されたら、自動的に答え合わせへ進む
    if (currentSelectedOptions.length === requiredCount) {
        // 誤作動（連打）を防ぐため全てのボタンを無効化
        const buttons = document.querySelectorAll('#options-container button');
        buttons.forEach(b => b.disabled = true);

        // ボタンが青くなった状態を0.3秒だけ見せてから答え合わせ画面へ遷移
        setTimeout(() => {
            checkAnswer(currentSelectedOptions);
        }, 300);
    }
}

// 【修正】答え合わせ処理（複数選択が完全に一致しているか判定）
// ※引数が「選ばれた1つの文字列」から「選ばれた配列」に変わりました
function checkAnswer(selectedOptionsArray) {
    // 選んだ配列の内容と、正解配列の内容が完全に一致しているかチェック
    const isCorrect =
        currentQuestion.correctAnswers.length === selectedOptionsArray.length &&
        selectedOptionsArray.every(opt => currentQuestion.correctAnswers.includes(opt.trim()));

    const titleEl = document.getElementById('result-title');

    const correctActions = document.getElementById('correct-actions');
    const wrongActions = document.getElementById('wrong-actions');

    if (isCorrect) {
        titleEl.innerText = "⭕️ 正解！";
        titleEl.style.color = "green";
        correctActions.style.display = 'block';
        wrongActions.style.display = 'none';
    } else {
        titleEl.innerText = "❌ 不正解...";
        titleEl.style.color = "red";
        correctActions.style.display = 'none';
        wrongActions.style.display = 'block';
    }

    // 解説画面にも問題文を表示
    document.getElementById('result-question-text').innerText = currentQuestion.question;

    const correctText = currentQuestion.correctAnswers.join(' / ');
    document.getElementById('explanation-text').innerHTML =
        `<strong>正解: ${correctText}</strong><br><br>${currentQuestion.explanation}`;

    const eImageEl = document.getElementById('explanation-image');
    if (eImageEl) {
        if (currentQuestion.explanationImage) {
            eImageEl.src = currentQuestion.explanationImage;
            eImageEl.style.display = 'block';
        } else {
            eImageEl.src = '';
            eImageEl.style.display = 'none';
        }
    }

    if (isCorrect) {
        const btn3 = document.getElementById('btn-interval-3');
        const btn4 = document.getElementById('btn-interval-4');
        const btn5 = document.getElementById('btn-interval-5');

        if(btn3) btn3.innerText = `(${formatInterval(calculateNextIntervalDays(currentQuestion, 3))})`;
        if(btn4) btn4.innerText = `(${formatInterval(calculateNextIntervalDays(currentQuestion, 4))})`;
        if(btn5) btn5.innerText = `(${formatInterval(calculateNextIntervalDays(currentQuestion, 5))})`;
    }

    showView('result-view');
}
// ---------------------------------------------------
// 6. 忘却曲線 (SM-2) アルゴリズム（修正版）
// ---------------------------------------------------
function processSM2(quality) {
    let q = currentQuestion;

    const nextIntervalDays = calculateNextIntervalDays(q, quality);

    if (quality >= 3) {
        // 正解した場合
        q.easeFactor = q.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
        if (q.easeFactor < 1.3) q.easeFactor = 1.3;

        q.repetitionCount += 1;
        q.intervalDays = nextIntervalDays;
    } else {
        // 間違えた場合（repetitionCountを0にするため、次回はwrongDueQueueに入ります）
        q.repetitionCount = 0;
        q.easeFactor = Math.max(1.3, q.easeFactor - 0.2);
        q.intervalDays = 0;
    }

    const nextDate = new Date();
    const addMilliseconds = nextIntervalDays * 24 * 60 * 60 * 1000;
    q.nextReviewDate = nextDate.getTime() + addMilliseconds;

    // 現在のキューから外す（※後ろには追加しません）
    currentQuizQueue.shift();

    saveDataToLocal();
    renderNextQuestion();
}

// --- ▼▼ 追加：インターバル予測とフォーマット関数 ▼▼ ---

// ボタンを押した際の次回出題日（日数）をシミュレーションする関数
function calculateNextIntervalDays(q, quality) {
    if (q.repetitionCount === 0) {
        // ▼ 初回学習（または間違えてリセットされた後）の場合
        if (quality === 0) return 10 / 1440; // 間違えた: 10分後
        if (quality === 3) return 0.25;       // 難: 6時間後
        if (quality === 4) return 1;         // 普: 1日後
        if (quality === 5) return 4;         // 易: 4日後
    } else {
        // ▼ 2回目以降の復習の場合
        if (quality === 0) return 10 / 1440; // 間違えた: 10分後
        if (quality === 3) return q.intervalDays * 1.2;           // 難: 少しだけ伸ばす
        if (quality === 4) return q.intervalDays * q.easeFactor;  // 普: 定着度に応じて伸ばす
        if (quality === 5) return q.intervalDays * q.easeFactor * 1.3; // 易: さらにボーナスで伸ばす
    }
    return 1;
}

// 日数を「○分後」「○時間後」「○日後」「○ヶ月後」のテキストに変換する関数
function formatInterval(days) {
    if (days < 1 / 24) {
        return Math.round(days * 24 * 60) + "分後";
    } else if (days < 1) {
        return Math.round(days * 24) + "時間後";
    } else if (days < 30) {
        return Math.round(days) + "日後";
    } else {
        return (days / 30).toFixed(1) + "ヶ月後";
    }
}

// アプリ起動
init();
