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
    lastQuality: null,
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
    selectedQuality: null,
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
        attemptedRateBar: document.getElementById('attempted-rate-bar'),
        statDue: document.getElementById('stat-due'),
        statWrong: document.getElementById('stat-wrong'),
        warningRateBar: document.getElementById('warning-rate-bar'),
        understandingSummary: document.getElementById('understanding-summary'),
        understandingWrongSegment: document.getElementById('understanding-wrong-segment'),
        understandingHardSegment: document.getElementById('understanding-hard-segment'),
        understandingGoodSegment: document.getElementById('understanding-good-segment'),
        understandingEasySegment: document.getElementById('understanding-easy-segment'),
        understandingUnknownSegment: document.getElementById('understanding-unknown-segment'),
        understandingDetailToggle: document.getElementById('understanding-detail-toggle'),
        unitUnderstandingDetails: document.getElementById('unit-understanding-details'),
        brandMenuToggle: document.getElementById('brand-menu-toggle'),
        learningModeMenu: document.getElementById('learning-mode-menu'),
        unitMenuToggle: document.getElementById('unit-menu-toggle'),
        unitModeMenu: document.getElementById('unit-mode-menu'),
        googleAuthButton: document.getElementById('google-auth-button'),
        googleAuthButtonContents: document.querySelector('#google-auth-button .gsi-material-button-contents'),
        googleSyncStatus: document.getElementById('google-sync-status'),
        settingsToggle: document.getElementById('settings-toggle'),
        settingsOverlay: document.getElementById('settings-overlay'),
        settingsDrawer: document.getElementById('settings-drawer'),
        settingsCloseButton: document.getElementById('settings-close-button'),
        savingOverlay: document.getElementById('saving-overlay'),
        csvUpload: document.getElementById('csv-upload'),
        questionUnit: document.getElementById('question-unit'),
        questionId: document.getElementById('question-id'),
        questionReviewStatus: document.getElementById('question-review-status'),
        questionText: document.getElementById('question-text'),
        questionImage: document.getElementById('question-image'),
        optionsContainer: document.getElementById('options-container'),
        resultTitle: document.getElementById('result-title'),
        resultQuestionText: document.getElementById('result-question-text'),
        resultOptionsContainer: document.getElementById('result-options-container'),
        explanationText: document.getElementById('explanation-text'),
        explanationImage: document.getElementById('explanation-image'),
        correctActions: document.getElementById('correct-actions'),
        continueAfterEvaluationButton: document.getElementById('continue-after-evaluation'),
        stopAfterEvaluationButton: document.getElementById('stop-after-evaluation'),
        wrongActions: document.getElementById('wrong-actions'),
    });
}

function bindEvents() {
    document.querySelector('[data-action="start-normal"]').addEventListener('click', () => startQuiz('normal'));
    document.querySelector('[data-action="start-wrong"]').addEventListener('click', () => startQuiz('wrong'));
    document.querySelectorAll('[data-unit]').forEach((button) => {
        button.addEventListener('click', () => startQuizByUnit(button.dataset.unit));
    });
    elements.unitMenuToggle.addEventListener('click', toggleUnitModeMenu);
    document.querySelectorAll('[data-action="stop-quiz"]').forEach((button) => {
        button.addEventListener('click', stopQuiz);
    });
    document.querySelector('[data-action="continue-after-evaluation"]').addEventListener('click', () => processSelectedQuality(false));
    document.querySelector('[data-action="stop-after-evaluation"]').addEventListener('click', () => processSelectedQuality(true));
    document.querySelector('[data-action="continue-wrong"]').addEventListener('click', () => processSM2(0));
    document.querySelector('[data-action="stop-wrong"]').addEventListener('click', () => processSM2(0, { stopAfter: true }));
    elements.brandMenuToggle.addEventListener('click', toggleLearningModeMenu);
    elements.understandingDetailToggle.addEventListener('click', toggleUnderstandingDetails);
    elements.googleAuthButton.addEventListener('click', () => requestGoogleAccess({ prompt: appState.google.accessToken ? '' : 'consent' }));
    elements.settingsToggle.addEventListener('click', openSettingsDrawer);
    elements.settingsOverlay.addEventListener('click', closeSettingsDrawer);
    elements.settingsCloseButton.addEventListener('click', closeSettingsDrawer);
    bindSettingsSwipe();

    elements.csvUpload.addEventListener('change', handleCSVUpload);

    document.querySelectorAll('[data-quality]').forEach((button) => {
        button.addEventListener('click', () => selectQuality(Number(button.dataset.quality)));
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

    if (wasGoogleConnected()) {
        setGoogleAuthButtonText('Google Driveから読み込む');
        setGoogleAuthStatus('前回Google連携済みです。ボタンを押すとDriveから読み込みます。');
        return;
    }

    setGoogleAuthStatus('Google未連携');
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
        setGoogleAuthStatus(`Google連携に失敗しました: ${tokenResponse.error}`);
        return;
    }

    appState.google.accessToken = tokenResponse.access_token;
    appState.google.isConnected = true;
    localStorage.setItem(GOOGLE_CONNECTED_STORAGE_KEY, 'true');
    setGoogleAuthButtonText('Google連携を更新する');
    setGoogleAuthStatus('Google Driveから読み込み中...');
    await loadAppDataFromDrive();
}

function handleGoogleAuthError(error) {
    const message = error?.type || error?.message || '不明なエラー';
    setGoogleAuthStatus(`Google連携に失敗しました: ${message}`);
}

function setGoogleAuthStatus(message) {
    elements.googleSyncStatus.textContent = message;
}

function setGoogleAuthButtonText(text) {
    elements.googleAuthButtonContents.textContent = text;
}

function toggleLearningModeMenu() {
    const isOpen = elements.learningModeMenu.classList.toggle('is-open');
    elements.brandMenuToggle.setAttribute('aria-expanded', String(isOpen));
}

function toggleUnitModeMenu() {
    const isOpen = elements.unitModeMenu.classList.toggle('is-open');
    elements.unitMenuToggle.setAttribute('aria-expanded', String(isOpen));
}

function toggleUnderstandingDetails() {
    const isOpen = elements.unitUnderstandingDetails.classList.toggle('hidden') === false;
    elements.understandingDetailToggle.setAttribute('aria-expanded', String(isOpen));
}

function openSettingsDrawer() {
    elements.settingsOverlay.classList.remove('hidden');
    elements.settingsOverlay.classList.add('is-visible');
    elements.settingsDrawer.classList.add('is-open');
    elements.settingsDrawer.setAttribute('aria-hidden', 'false');
    elements.settingsToggle.setAttribute('aria-expanded', 'true');
}

function closeSettingsDrawer() {
    elements.settingsOverlay.classList.remove('is-visible');
    elements.settingsDrawer.classList.remove('is-open');
    elements.settingsDrawer.setAttribute('aria-hidden', 'true');
    elements.settingsToggle.setAttribute('aria-expanded', 'false');

    window.setTimeout(() => {
        if (!elements.settingsOverlay.classList.contains('is-visible')) {
            elements.settingsOverlay.classList.add('hidden');
        }
    }, 220);
}

function showSavingOverlay() {
    elements.savingOverlay.classList.remove('hidden');
}

function hideSavingOverlay() {
    elements.savingOverlay.classList.add('hidden');
}

function bindSettingsSwipe() {
    let startX = null;
    let startY = null;

    elements.settingsDrawer.addEventListener('touchstart', (event) => {
        const [touch] = event.touches;
        startX = touch.clientX;
        startY = touch.clientY;
    }, { passive: true });

    elements.settingsDrawer.addEventListener('touchend', (event) => {
        if (startX === null || startY === null) return;

        const [touch] = event.changedTouches;
        const diffX = touch.clientX - startX;
        const diffY = touch.clientY - startY;

        startX = null;
        startY = null;

        if (diffX > 70 && Math.abs(diffY) < 80) {
            closeSettingsDrawer();
        }
    }, { passive: true });
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
            unit: typeof question.unit === 'string' ? question.unit.trim() : '',
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
    const headers = rows[0] ?? [];
    const dataRows = rows.slice(1);
    const unitIndex = findCSVColumnIndex(headers, ['unit', '単元']);
    let addedCount = 0;
    let updatedCount = 0;

    dataRows.forEach((columns) => {
        const question = createQuestionFromCSVRow(columns, {
            unitIndex,
        });
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

function findCSVColumnIndex(headers, names) {
    const index = headers.findIndex((header) => names.includes(header.trim()));
    return index >= 0 ? index : 12;
}

function createQuestionFromCSVRow(columns, { unitIndex = 12 } = {}) {
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
    const unit = columns[unitIndex]?.trim();

    const question = {
        id,
        question: cleanQuestionText(columns[1] ?? ''),
        correctAnswers,
        options,
        explanation: columns[9] ?? '',
        questionImage: columns[10] || null,
        explanationImage: columns[11] || null,
    };

    if (unit) {
        question.unit = unit;
    }

    return question;
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
    const attemptedQuestions = questions.filter(isAttemptedQuestion);
    const attempted = attemptedQuestions.length;
    const now = Date.now();
    const understandingCounts = countUnderstandingLevels(attemptedQuestions);

    appState.queues.wrongDue = questions.filter(isWrongQuestion);
    appState.queues.normalDue = buildTodayLearningQueue(questions, now);

    elements.statAttempted.textContent = `${attempted} / ${total}`;
    elements.attemptedRateBar.style.width = `${calculatePercentage(attempted, total)}%`;
    elements.statDue.textContent = appState.queues.normalDue.length;
    elements.statWrong.textContent = `${appState.queues.wrongDue.length} / ${attempted}`;
    elements.warningRateBar.style.width = `${calculatePercentage(appState.queues.wrongDue.length, attempted)}%`;
    updateUnderstandingBar(understandingCounts, attempted);
    renderUnitUnderstandingDetails(questions);
}

function isAttemptedQuestion(question) {
    return question.nextReviewDate !== null;
}

function isWrongQuestion(question) {
    return question.nextReviewDate !== null && question.repetitionCount === 0;
}

function countUnderstandingLevels(questions) {
    return questions.reduce((counts, question) => {
        switch (question.lastQuality) {
            case 0:
            case '0':
                counts.wrong += 1;
                break;
            case 3:
            case '3':
                counts.hard += 1;
                break;
            case 4:
            case '4':
                counts.good += 1;
                break;
            case 5:
            case '5':
                counts.easy += 1;
                break;
            default:
                counts.unknown += 1;
        }

        return counts;
    }, {
        wrong: 0,
        hard: 0,
        good: 0,
        easy: 0,
        unknown: 0,
    });
}

function updateUnderstandingBar(counts, attempted) {
    elements.understandingWrongSegment.style.width = `${calculatePercentage(counts.wrong, attempted)}%`;
    elements.understandingHardSegment.style.width = `${calculatePercentage(counts.hard, attempted)}%`;
    elements.understandingGoodSegment.style.width = `${calculatePercentage(counts.good, attempted)}%`;
    elements.understandingEasySegment.style.width = `${calculatePercentage(counts.easy, attempted)}%`;
    elements.understandingUnknownSegment.style.width = `${calculatePercentage(counts.unknown, attempted)}%`;

    const evaluated = attempted - counts.unknown;
    elements.understandingSummary.textContent = attempted > 0 ? `評価済み ${evaluated} / ${attempted}` : '未着手';
}

function renderUnitUnderstandingDetails(questions) {
    const groupedQuestions = groupQuestionsByUnit(questions);
    elements.unitUnderstandingDetails.innerHTML = '';

    if (groupedQuestions.length === 0) {
        elements.unitUnderstandingDetails.textContent = '単元情報がありません。';
        return;
    }

    groupedQuestions.forEach(([unitName, unitQuestions]) => {
        const counts = countUnderstandingLevels(unitQuestions);
        const total = unitQuestions.length;
        const attempted = unitQuestions.filter(isAttemptedQuestion).length;
        const detail = document.createElement('div');
        detail.className = 'unit-understanding-item';
        detail.innerHTML = `
            <div class="unit-understanding-header">
                <strong>${escapeHTML(unitName)}</strong>
                <span>${attempted} / ${total}</span>
            </div>
            <div class="understanding-bar" aria-hidden="true">
                <div class="understanding-segment understanding-wrong" style="width: ${calculatePercentage(counts.wrong, total)}%"></div>
                <div class="understanding-segment understanding-hard" style="width: ${calculatePercentage(counts.hard, total)}%"></div>
                <div class="understanding-segment understanding-good" style="width: ${calculatePercentage(counts.good, total)}%"></div>
                <div class="understanding-segment understanding-easy" style="width: ${calculatePercentage(counts.easy, total)}%"></div>
                <div class="understanding-segment understanding-unknown" style="width: ${calculatePercentage(counts.unknown, total)}%"></div>
            </div>
        `;
        elements.unitUnderstandingDetails.appendChild(detail);
    });
}

function groupQuestionsByUnit(questions) {
    const groups = new Map();

    questions.forEach((question) => {
        const unitName = question.unit?.trim();
        if (!unitName) return;

        if (!groups.has(unitName)) {
            groups.set(unitName, []);
        }

        groups.get(unitName).push(question);
    });

    return Array.from(groups.entries()).sort(([unitA], [unitB]) => unitA.localeCompare(unitB, 'ja'));
}

function calculatePercentage(numerator, denominator) {
    if (denominator <= 0) return 0;
    return Math.min(100, Math.max(0, (numerator / denominator) * 100));
}

function isNormalDueQuestion(question, now) {
    return question.nextReviewDate === null || question.nextReviewDate <= now;
}

function buildTodayLearningQueue(questions, now) {
    const unansweredQuestions = shuffleArray(questions.filter(isUnansweredQuestion));
    const reviewQuestions = shuffleArray(questions.filter((question) => isReviewDueQuestion(question, now)));
    const wrongReviewQuestions = shuffleArray(questions.filter((question) => isWrongReviewDueQuestion(question, now)));

    return interleaveLearningQueues({
        unansweredQuestions,
        reviewQuestions,
        wrongReviewQuestions,
    });
}

function buildTodayLearningQueueByUnit(unitName, now) {
    const targetQuestions = appState.data.questions.filter((question) => question.unit === unitName);
    return buildTodayLearningQueue(targetQuestions, now);
}

function isUnansweredQuestion(question) {
    return question.nextReviewDate === null;
}

function isReviewDueQuestion(question, now) {
    return question.nextReviewDate !== null
        && question.nextReviewDate <= now
        && !isWrongQuestion(question);
}

function isWrongReviewDueQuestion(question, now) {
    return isWrongQuestion(question) && question.nextReviewDate <= now;
}

function interleaveLearningQueues({ unansweredQuestions, reviewQuestions, wrongReviewQuestions }) {
    const queue = [];

    while (unansweredQuestions.length > 0 || reviewQuestions.length > 0 || wrongReviewQuestions.length > 0) {
        pushNextQuestion(queue, unansweredQuestions);
        pushNextQuestion(queue, reviewQuestions);
        pushNextQuestion(queue, unansweredQuestions);
        pushNextQuestion(queue, wrongReviewQuestions);
    }

    return queue;
}

function pushNextQuestion(queue, source) {
    if (source.length === 0) return;
    queue.push(source.shift());
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

    appState.queues.current = mode === 'wrong' ? shuffleArray(queue) : [...queue];
    renderNextQuestion();
}

function startQuizByUnit(unitName) {
    updateDashboard();

    const queue = buildTodayLearningQueueByUnit(unitName, Date.now());

    if (queue.length === 0) {
        alert(`${unitName}の今日の学習タスクは完了しています。`);
        return;
    }

    appState.queues.current = queue;
    renderNextQuestion();
}

function stopQuiz() {
    appState.queues.current = [];
    appState.currentQuestion = null;
    appState.selectedOptions = [];
    appState.selectedQuality = null;
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
    appState.selectedQuality = null;

    renderQuestionText(appState.currentQuestion);
    renderQuestionUnit(appState.currentQuestion);
    renderQuestionId(appState.currentQuestion);
    renderQuestionReviewStatus(appState.currentQuestion);
    renderImage(elements.questionImage, appState.currentQuestion.questionImage);
    renderOptions(appState.currentQuestion.options);
    showView('quiz-view');
}

function renderQuestionText(question) {
    const requiredCount = question.correctAnswers.length;
    const helperText = requiredCount > 1 ? `\n（※ ${requiredCount}つ選んでください）` : '';
    elements.questionText.textContent = `${question.question}${helperText}`;
}

function renderQuestionUnit(question) {
    const unit = question.unit?.trim();
    elements.questionUnit.textContent = unit || '';
    elements.questionUnit.classList.toggle('hidden', !unit);
}

function renderQuestionId(question) {
    elements.questionId.textContent = question.id ? `ID: ${question.id}` : '';
}

function renderQuestionReviewStatus(question) {
    const isFirstAttempt = question.nextReviewDate === null;
    elements.questionReviewStatus.textContent = isFirstAttempt ? '初出題' : '再出題';
    elements.questionReviewStatus.classList.remove('is-quality-wrong', 'is-quality-hard', 'is-quality-good', 'is-quality-easy');
    elements.questionReviewStatus.classList.toggle('is-first-attempt', isFirstAttempt);
    elements.questionReviewStatus.classList.toggle('is-review-attempt', !isFirstAttempt);

    if (!isFirstAttempt) {
        elements.questionReviewStatus.classList.add(getQualityClass(question.lastQuality));
    }
}

function getQualityClass(quality) {
    switch (quality) {
        case 0:
        case '0':
            return 'is-quality-wrong';
        case 3:
        case '3':
            return 'is-quality-hard';
        case 4:
        case '4':
            return 'is-quality-good';
        case 5:
        case '5':
            return 'is-quality-easy';
        default:
            return '';
    }
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
    renderResultBody(appState.currentQuestion, isCorrect);
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
    elements.resultTitle.classList.toggle('result-title-correct', isCorrect);
    elements.resultTitle.classList.toggle('result-title-wrong', !isCorrect);
}

function renderResultBody(question, isCorrect) {
    if (isCorrect) {
        elements.resultQuestionText.textContent = question.question;
    } else {
        elements.resultQuestionText.innerHTML = highlightQuestionInstructions(question.question);
    }

    renderResultOptions(question);

    const correctAnswerLines = question.correctAnswers
        .map((answer) => `<span>・${escapeHTML(answer)}</span>`)
        .join('');

    elements.explanationText.innerHTML = `<span class="correct-answer-label">正解</span><strong class="correct-answer-text">${correctAnswerLines}</strong><span class="explanation-text-body">${escapeHTML(question.explanation)}</span>`;
    renderImage(elements.explanationImage, question.explanationImage);
}

function highlightQuestionInstructions(questionText) {
    return escapeHTML(questionText)
        .replaceAll('誤っているもの', '<span class="instruction-wrong">誤っているもの</span>')
        .replaceAll('正しいもの', '<span class="instruction-correct">正しいもの</span>');
}

function renderResultOptions(question) {
    elements.resultOptionsContainer.innerHTML = '';

    question.options.forEach((option) => {
        const optionElement = document.createElement('div');
        const isCorrect = question.correctAnswers.includes(option.trim());
        const isSelected = appState.selectedOptions.includes(option);

        optionElement.className = 'result-option';
        optionElement.classList.toggle('result-option-correct', isCorrect);
        optionElement.classList.toggle('result-option-wrong', isSelected && !isCorrect);
        optionElement.textContent = option;
        elements.resultOptionsContainer.appendChild(optionElement);
    });
}

function renderActionArea(isCorrect) {
    elements.correctActions.classList.toggle('hidden', !isCorrect);
    elements.wrongActions.classList.toggle('hidden', isCorrect);

    if (isCorrect) {
        resetQualitySelection();
    }
}

function updateIntervalPreviewButtons(question) {
    [3, 4, 5].forEach((quality) => {
        const buttonText = document.getElementById(`btn-interval-${quality}`);
        if (!buttonText) return;

        const intervalDays = calculateNextIntervalDays(question, quality);
        buttonText.textContent = `(${formatInterval(intervalDays)})`;
    });
}

function selectQuality(quality) {
    appState.selectedQuality = quality;

    document.querySelectorAll('#correct-actions [data-quality]').forEach((button) => {
        button.classList.toggle('is-selected', Number(button.dataset.quality) === quality);
    });

    elements.continueAfterEvaluationButton.disabled = false;
    elements.stopAfterEvaluationButton.disabled = false;
}

function resetQualitySelection() {
    appState.selectedQuality = null;

    document.querySelectorAll('#correct-actions [data-quality]').forEach((button) => {
        button.classList.remove('is-selected');
    });

    elements.continueAfterEvaluationButton.disabled = true;
    elements.stopAfterEvaluationButton.disabled = true;
}

async function processSelectedQuality(stopAfter) {
    if (appState.selectedQuality === null) {
        alert('難易度を選択してください。');
        return;
    }

    await processSM2(appState.selectedQuality, { stopAfter });
}

async function processSM2(quality, { stopAfter = false } = {}) {
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
    appState.currentQuestion = null;
    appState.selectedOptions = [];
    appState.selectedQuality = null;

    if (stopAfter) {
        showSavingOverlay();

        try {
            await persistAppData();
            appState.queues.current = [];
            updateDashboard();
            showView('dashboard-view');
            return;
        } finally {
            hideSavingOverlay();
        }
    }

    persistAppData();
    renderNextQuestion();
}

function updateQuestionAsCorrect(question, quality, nextIntervalDays) {
    question.lastQuality = quality;
    question.easeFactor += 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
    question.easeFactor = Math.max(1.3, question.easeFactor);
    question.repetitionCount += 1;
    question.intervalDays = nextIntervalDays;
}

function updateQuestionAsWrong(question) {
    question.lastQuality = 0;
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
