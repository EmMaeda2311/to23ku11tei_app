'use strict';

const STORAGE_KEY = 'myQuizData';
const GOOGLE_CONNECTED_STORAGE_KEY = 'myQuizGoogleConnected';
const GOOGLE_CLIENT_ID = '294726650739-r0pc0pardvuvf6jt86hc9ee9tdl8ngep.apps.googleusercontent.com';
const GOOGLE_DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GOOGLE_DRIVE_DATA_FILE_NAME = 'quiz-app-data.json';
const GOOGLE_DRIVE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime';
const GOOGLE_DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const DEFAULT_LEARNING_STATE = Object.freeze({
    repetitionCount: 0,
    easeFactor: 2.5,
    intervalDays: 0,
    nextReviewDate: null,
});

const appState = {
    data: { questions: [] },
    queues: {
        current: [],
        normalDue: [],
        wrongDue: [],
    },
    currentQuestion: null,
    selectedOptions: [],
    google: {
        tokenClient: null,
        accessToken: null,
        dataFileId: null,
        dataFileModifiedTime: null,
        isConnected: false,
    },
};

const elements = {};

document.addEventListener('DOMContentLoaded', init);

function init() {
    cacheElements();
    bindEvents();
    initGoogleAuth();
    loadDataFromLocal();
    updateDashboard();
}

function cacheElements() {
    Object.assign(elements, {
        views: document.querySelectorAll('.view'),
        dashboardView: document.getElementById('dashboard-view'),
        quizView: document.getElementById('quiz-view'),
        resultView: document.getElementById('result-view'),
        statAttempted: document.getElementById('stat-attempted'),
        statDue: document.getElementById('stat-due'),
        statWrong: document.getElementById('stat-wrong'),
        googleAuthButton: document.getElementById('google-auth-button'),
        googleDriveTestButton: document.getElementById('google-drive-test-button'),
        googleSyncStatus: document.getElementById('google-sync-status'),
        csvUpload: document.getElementById('csv-upload'),
        questionText: document.getElementById('question-text'),
        questionImage: document.getElementById('question-image'),
        optionsContainer: document.getElementById('options-container'),
        resultTitle: document.getElementById('result-title'),
        resultQuestionText: document.getElementById('result-question-text'),
        explanationText: document.getElementById('explanation-text'),
        explanationImage: document.getElementById('explanation-image'),
        correctActions: document.getElementById('correct-actions'),
        wrongActions: document.getElementById('wrong-actions'),
    });
}

function bindEvents() {
    document.querySelector('[data-action="start-normal"]').addEventListener('click', () => startQuiz('normal'));
    document.querySelector('[data-action="start-wrong"]').addEventListener('click', () => startQuiz('wrong'));
    document.querySelector('[data-action="stop-quiz"]').addEventListener('click', stopQuiz);
    elements.googleAuthButton.addEventListener('click', () => requestGoogleAccess({ prompt: appState.google.accessToken ? '' : 'consent' }));
    elements.googleDriveTestButton.addEventListener('click', saveGoogleDriveTestFile);

    elements.csvUpload.addEventListener('change', handleCSVUpload);

    document.querySelectorAll('[data-quality]').forEach((button) => {
        button.addEventListener('click', () => processSM2(Number(button.dataset.quality)));
    });
}

function loadDataFromLocal() {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (!savedData) return;

    try {
        const parsedData = JSON.parse(savedData);
        appState.data = normalizeAppData(parsedData);
    } catch (error) {
        console.error('保存データの読み込みに失敗しました。', error);
        appState.data = { questions: [] };
    }
}

function initGoogleAuth(retryCount = 0) {
    if (!isGoogleClientIdConfigured()) {
        setGoogleAuthStatus('Google Client IDを設定してください。');
        elements.googleAuthButton.disabled = true;
        return;
    }

    if (!window.google?.accounts?.oauth2) {
        if (retryCount < 20) {
            setTimeout(() => initGoogleAuth(retryCount + 1), 250);
            return;
        }

        setGoogleAuthStatus('Google認証ライブラリを読み込めませんでした。');
        elements.googleAuthButton.disabled = true;
        return;
    }

    appState.google.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_DRIVE_APPDATA_SCOPE,
        callback: handleGoogleTokenResponse,
        error_callback: handleGoogleAuthError,
    });

    elements.googleAuthButton.disabled = false;
    setGoogleAuthStatus('Google未連携');

    if (wasGoogleConnected()) {
        setGoogleAuthStatus('Google連携を復元中...');
        requestGoogleAccess({ prompt: '' });
    }
}

function isGoogleClientIdConfigured() {
    return GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith('YOUR_GOOGLE_CLIENT_ID');
}

function wasGoogleConnected() {
    return localStorage.getItem(GOOGLE_CONNECTED_STORAGE_KEY) === 'true';
}

function requestGoogleAccess({ prompt = 'consent' } = {}) {
    if (!appState.google.tokenClient) {
        setGoogleAuthStatus('Google認証の準備がまだ完了していません。');
        return;
    }

    appState.google.tokenClient.requestAccessToken({
        prompt,
    });
}

async function handleGoogleTokenResponse(tokenResponse) {
    if (tokenResponse.error) {
        resetGoogleConnectionState();
        setGoogleAuthStatus(`Google連携に失敗しました: ${tokenResponse.error}`);
        return;
    }

    appState.google.accessToken = tokenResponse.access_token;
    appState.google.isConnected = true;
    localStorage.setItem(GOOGLE_CONNECTED_STORAGE_KEY, 'true');
    elements.googleAuthButton.textContent = 'Google連携を更新する';
    elements.googleDriveTestButton.disabled = false;
    setGoogleAuthStatus('Google Driveから読み込み中...');
    await loadAppDataFromDrive();
}

function handleGoogleAuthError(error) {
    const message = error?.type || error?.message || '不明なエラー';
    resetGoogleConnectionState();
    setGoogleAuthStatus(`Google連携に失敗しました: ${message}`);
}

function resetGoogleConnectionState() {
    appState.google.isConnected = false;
    appState.google.accessToken = null;
    appState.google.dataFileId = null;
    appState.google.dataFileModifiedTime = null;
    localStorage.removeItem(GOOGLE_CONNECTED_STORAGE_KEY);
}

function setGoogleAuthStatus(message) {
    elements.googleSyncStatus.textContent = message;
}

async function saveGoogleDriveTestFile() {
    if (!appState.google.accessToken) {
        setGoogleAuthStatus('Google連携後に保存テストを実行してください。');
        return;
    }

    elements.googleDriveTestButton.disabled = true;
    setGoogleAuthStatus('Google Driveへテスト保存中...');

    try {
        const savedFile = await createGoogleDriveJsonFile(
            'quiz-app-test.json',
            {
                connectionTest: true,
                savedAt: new Date().toISOString(),
            }
        );

        setGoogleAuthStatus(`Google Driveへのテスト保存が完了しました: ${savedFile.id}`);
    } catch (error) {
        console.error('Google Driveへのテスト保存に失敗しました。', error);
        setGoogleAuthStatus(`Google Driveへのテスト保存に失敗しました: ${error.message}`);
    } finally {
        elements.googleDriveTestButton.disabled = false;
    }
}

async function createGoogleDriveJsonFile(fileName, data) {
    const boundary = `quiz-app-${Date.now()}`;
    const metadata = {
        name: fileName,
        parents: ['appDataFolder'],
        mimeType: 'application/json',
    };
    const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata),
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(data, null, 2),
        `--${boundary}--`,
        '',
    ].join('\n');

    const response = await fetch(GOOGLE_DRIVE_UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${appState.google.accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
    });

    const responseBody = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = responseBody.error?.message || `HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }

    return responseBody;
}

async function saveAppDataToDrive() {
    if (!appState.google.accessToken) return null;

    const driveFile = await findGoogleDriveJsonFile(GOOGLE_DRIVE_DATA_FILE_NAME);
    const fileId = appState.google.dataFileId || driveFile?.id || null;

    if (driveFile && appState.google.dataFileModifiedTime && driveFile.modifiedTime !== appState.google.dataFileModifiedTime) {
        throw new Error('別の端末で新しい学習データが保存されています。ページを再読み込みしてください。');
    }

    let savedFile;

    if (fileId) {
        try {
            savedFile = await updateGoogleDriveJsonFile(fileId, appState.data);
        } catch (error) {
            if (error.status !== 404) throw error;

            appState.google.dataFileId = null;
            savedFile = await createGoogleDriveJsonFile(GOOGLE_DRIVE_DATA_FILE_NAME, appState.data);
        }
    } else {
        savedFile = await createGoogleDriveJsonFile(GOOGLE_DRIVE_DATA_FILE_NAME, appState.data);
    }

    appState.google.dataFileId = savedFile.id || fileId;
    appState.google.dataFileModifiedTime = savedFile.modifiedTime || driveFile?.modifiedTime || appState.google.dataFileModifiedTime;
    setGoogleAuthStatus('Google Driveへ保存しました。');
    return savedFile;
}

async function loadAppDataFromDrive() {
    if (!appState.google.accessToken) return null;

    try {
        const driveFile = await findGoogleDriveJsonFile(GOOGLE_DRIVE_DATA_FILE_NAME);

        if (!driveFile) {
            setGoogleAuthStatus('Google連携済み。Drive上に保存データはまだありません。');
            return null;
        }

        appState.google.dataFileId = driveFile.id;
        appState.google.dataFileModifiedTime = driveFile.modifiedTime;

        const driveData = await readGoogleDriveJsonFile(driveFile.id);
        appState.data = normalizeAppData(driveData);
        saveDataToLocal();
        updateDashboard();
        setGoogleAuthStatus('Google Driveから読み込みました。');
        return appState.data;
    } catch (error) {
        console.error('Google Driveからの読み込みに失敗しました。', error);
        setGoogleAuthStatus(`Google Driveからの読み込みに失敗しました: ${error.message}`);
        return null;
    }
}

async function findGoogleDriveJsonFile(fileName) {
    const query = [
        `name = '${escapeDriveQueryValue(fileName)}'`,
        'trashed = false',
    ].join(' and ');
    const params = new URLSearchParams({
        spaces: 'appDataFolder',
        fields: 'files(id,name,modifiedTime)',
        pageSize: '1',
        q: query,
    });

    const response = await fetch(`${GOOGLE_DRIVE_FILES_ENDPOINT}?${params.toString()}`, {
        headers: {
            Authorization: `Bearer ${appState.google.accessToken}`,
        },
    });
    const responseBody = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = responseBody.error?.message || `HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }

    return responseBody.files?.[0] || null;
}

async function updateGoogleDriveJsonFile(fileId, data) {
    const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${appState.google.accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(data, null, 2),
    });
    const responseBody = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = responseBody.error?.message || `HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }

    return responseBody;
}

async function readGoogleDriveJsonFile(fileId) {
    const response = await fetch(`${GOOGLE_DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?alt=media`, {
        headers: {
            Authorization: `Bearer ${appState.google.accessToken}`,
        },
    });
    const responseBody = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = responseBody.error?.message || `HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }

    return responseBody;
}

function escapeDriveQueryValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function normalizeAppData(data) {
    if (!data || !Array.isArray(data.questions)) {
        return { questions: [] };
    }

    return {
        questions: data.questions.map((question) => ({
            ...DEFAULT_LEARNING_STATE,
            ...question,
            correctAnswers: Array.isArray(question.correctAnswers) ? question.correctAnswers : [],
            options: Array.isArray(question.options) ? question.options : [],
        })),
    };
}

function saveDataToLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.data));
}

async function persistAppData() {
    saveDataToLocal();

    if (!appState.google.isConnected) return;

    try {
        await saveAppDataToDrive();
    } catch (error) {
        console.error('Google Driveへのデータ保存に失敗しました。', error);
        setGoogleAuthStatus(`Google Driveへの保存に失敗しました: ${error.message}`);
    }
}

function handleCSVUpload(event) {
    const [file] = event.target.files;
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
        const result = importCSVAndMerge(loadEvent.target.result);
        event.target.value = '';
        await persistAppData();
        alert(`CSVの読み込みが完了しました！\n・新規追加: ${result.addedCount}問\n・更新: ${result.updatedCount}問`);
    };
    reader.onerror = () => alert('CSVファイルの読み込みに失敗しました。');
    reader.readAsText(file, 'UTF-8');
}

function importCSVAndMerge(csvText) {
    const rows = parseCSV(csvText);
    const dataRows = rows.slice(1);
    let addedCount = 0;
    let updatedCount = 0;

    dataRows.forEach((columns) => {
        const question = createQuestionFromCSVRow(columns);
        if (!question) return;

        const existingQuestion = appState.data.questions.find((item) => item.id === question.id);

        if (existingQuestion) {
            Object.assign(existingQuestion, question);
            updatedCount += 1;
        } else {
            appState.data.questions.push({
                ...question,
                ...DEFAULT_LEARNING_STATE,
            });
            addedCount += 1;
        }
    });

    updateDashboard();

    return { addedCount, updatedCount };
}

function parseCSV(csvText) {
    return csvText
        .replace(/^\uFEFF/, '')
        .replace(/\r\n|\r/g, '\n')
        .trim()
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map(splitCSVLine);
}

function splitCSVLine(line) {
    return line
        .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
        .map((column) => column.replace(/^"(.*)"$/, '$1').replace(/""/g, '"').trim());
}

function createQuestionFromCSVRow(columns) {
    const id = columns[0]?.trim();
    const correctIndexText = columns[2] ?? '';
    if (!id || !correctIndexText) return null;

    const rawOptions = columns.slice(3, 8);
    const options = rawOptions.filter(Boolean).map(cleanOptionText);
    const correctAnswers = correctIndexText
        .split(',')
        .map((indexText) => Number.parseInt(indexText.trim(), 10))
        .filter((index) => Number.isInteger(index))
        .map((index) => rawOptions[index - 1])
        .filter(Boolean)
        .map(cleanOptionText);

    return {
        id,
        question: cleanQuestionText(columns[1] ?? ''),
        correctAnswers,
        options,
        explanation: columns[9] ?? '',
        questionImage: columns[10] || null,
        explanationImage: columns[11] || null,
    };
}

function cleanQuestionText(text) {
    return text.replace(/^Q\d+[\.、\s　]*/, '').trim();
}

function cleanOptionText(text) {
    return text.replace(/^\d+[\.、\s　]*/, '').trim();
}

function showView(viewId) {
    elements.views.forEach((view) => view.classList.remove('active'));
    document.getElementById(viewId)?.classList.add('active');
}

function shuffleArray(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function updateDashboard() {
    const questions = appState.data.questions;
    const total = questions.length;
    const attempted = questions.filter((question) => question.nextReviewDate !== null).length;
    const now = Date.now();

    appState.queues.wrongDue = questions.filter(isWrongQuestion);
    appState.queues.normalDue = questions.filter((question) => isNormalDueQuestion(question, now));

    elements.statAttempted.textContent = total > 0 ? Math.round((attempted / total) * 100) : 0;
    elements.statDue.textContent = appState.queues.normalDue.length;
    elements.statWrong.textContent = appState.queues.wrongDue.length;
}

function isWrongQuestion(question) {
    return question.nextReviewDate !== null && question.repetitionCount === 0;
}

function isNormalDueQuestion(question, now) {
    return question.nextReviewDate === null || (question.nextReviewDate <= now && question.repetitionCount > 0);
}

function startQuiz(mode) {
    updateDashboard();

    const queue = mode === 'wrong' ? appState.queues.wrongDue : appState.queues.normalDue;
    const emptyMessage = mode === 'wrong'
        ? '現在、要注意（間違えた問題）リストは空です。'
        : '今日の新規・復習タスクは完了しています。';

    if (queue.length === 0) {
        alert(emptyMessage);
        return;
    }

    appState.queues.current = shuffleArray(queue);
    renderNextQuestion();
}

function stopQuiz() {
    appState.queues.current = [];
    appState.currentQuestion = null;
    appState.selectedOptions = [];
    updateDashboard();
    showView('dashboard-view');
}

function renderNextQuestion() {
    if (appState.queues.current.length === 0) {
        updateDashboard();
        showView('dashboard-view');
        return;
    }

    appState.currentQuestion = appState.queues.current[0];
    appState.selectedOptions = [];

    renderQuestionText(appState.currentQuestion);
    renderImage(elements.questionImage, appState.currentQuestion.questionImage);
    renderOptions(appState.currentQuestion.options);
    showView('quiz-view');
}

function renderQuestionText(question) {
    const requiredCount = question.correctAnswers.length;
    const helperText = requiredCount > 1 ? `\n（※ ${requiredCount}つ選んでください）` : '';
    elements.questionText.textContent = `${question.question}${helperText}`;
}

function renderImage(imageElement, imagePath) {
    imageElement.src = imagePath || '';
    imageElement.classList.toggle('hidden', !imagePath);
}

function renderOptions(options) {
    elements.optionsContainer.innerHTML = '';

    shuffleArray(options).forEach((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = option;
        button.addEventListener('click', () => handleOptionClick(button, option));
        elements.optionsContainer.appendChild(button);
    });
}

function handleOptionClick(button, option) {
    const requiredCount = appState.currentQuestion.correctAnswers.length;

    if (appState.selectedOptions.includes(option)) {
        appState.selectedOptions = appState.selectedOptions.filter((selectedOption) => selectedOption !== option);
        button.classList.remove('selected');
    } else {
        appState.selectedOptions.push(option);
        button.classList.add('selected');
    }

    if (appState.selectedOptions.length === requiredCount) {
        lockOptionButtons();
        setTimeout(() => checkAnswer(), 300);
    }
}

function lockOptionButtons() {
    elements.optionsContainer.querySelectorAll('button').forEach((button) => {
        button.disabled = true;
    });
}

function checkAnswer() {
    const selectedOptions = appState.selectedOptions;
    const correctAnswers = appState.currentQuestion.correctAnswers;
    const isCorrect = areSameAnswers(selectedOptions, correctAnswers);

    renderResultHeader(isCorrect);
    renderResultBody(appState.currentQuestion);
    renderActionArea(isCorrect);

    if (isCorrect) {
        updateIntervalPreviewButtons(appState.currentQuestion);
    }

    showView('result-view');
}

function areSameAnswers(selectedOptions, correctAnswers) {
    return selectedOptions.length === correctAnswers.length
        && selectedOptions.every((option) => correctAnswers.includes(option.trim()));
}

function renderResultHeader(isCorrect) {
    elements.resultTitle.textContent = isCorrect ? '正解！' : '不正解...';
    elements.resultTitle.classList.toggle('text-danger', !isCorrect);
    elements.resultTitle.style.color = isCorrect ? 'green' : '';
}

function renderResultBody(question) {
    elements.resultQuestionText.textContent = question.question;
    elements.explanationText.innerHTML = `<span class="correct-answer-label">正解</span><strong class="correct-answer-text">${escapeHTML(question.correctAnswers.join(' / '))}</strong><br><br>${escapeHTML(question.explanation)}`;
    renderImage(elements.explanationImage, question.explanationImage);
}

function renderActionArea(isCorrect) {
    elements.correctActions.classList.toggle('hidden', !isCorrect);
    elements.wrongActions.classList.toggle('hidden', isCorrect);
}

function updateIntervalPreviewButtons(question) {
    [3, 4, 5].forEach((quality) => {
        const buttonText = document.getElementById(`btn-interval-${quality}`);
        if (!buttonText) return;

        const intervalDays = calculateNextIntervalDays(question, quality);
        buttonText.textContent = `(${formatInterval(intervalDays)})`;
    });
}

function processSM2(quality) {
    const question = appState.currentQuestion;
    if (!question) return;

    const nextIntervalDays = calculateNextIntervalDays(question, quality);

    if (quality >= 3) {
        updateQuestionAsCorrect(question, quality, nextIntervalDays);
    } else {
        updateQuestionAsWrong(question);
    }

    question.nextReviewDate = Date.now() + nextIntervalDays * 24 * 60 * 60 * 1000;
    appState.queues.current.shift();

    persistAppData();
    renderNextQuestion();
}

function updateQuestionAsCorrect(question, quality, nextIntervalDays) {
    question.easeFactor += 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
    question.easeFactor = Math.max(1.3, question.easeFactor);
    question.repetitionCount += 1;
    question.intervalDays = nextIntervalDays;
}

function updateQuestionAsWrong(question) {
    question.repetitionCount = 0;
    question.easeFactor = Math.max(1.3, question.easeFactor - 0.2);
    question.intervalDays = 0;
}

function calculateNextIntervalDays(question, quality) {
    if (quality === 0) return 10 / 1440;

    if (question.repetitionCount === 0) {
        const firstIntervals = {
            3: 0.25,
            4: 1,
            5: 4,
        };
        return firstIntervals[quality] ?? 1;
    }

    const reviewIntervals = {
        3: question.intervalDays * 1.2,
        4: question.intervalDays * question.easeFactor,
        5: question.intervalDays * question.easeFactor * 1.3,
    };

    return reviewIntervals[quality] ?? 1;
}

function formatInterval(days) {
    if (days < 1 / 24) {
        return `${Math.round(days * 24 * 60)}分後`;
    }

    if (days < 1) {
        return `${Math.round(days * 24)}時間後`;
    }

    if (days < 30) {
        return `${Math.round(days)}日後`;
    }

    return `${(days / 30).toFixed(1)}ヶ月後`;
}

function escapeHTML(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/\n/g, '<br>');
}
