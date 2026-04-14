'use strict';

// ===== 状態管理 =====
let questions = [];
let currentIndex = 0;
let results = [];
let webhookUrl = '';
let quizDate = '';
const LETTERS = ['A', 'B', 'C', 'D'];

// ===== DOM取得ユーティリティ =====
const $ = (id) => document.getElementById(id);

// ===== スクリーン切替 =====
function showScreen(id) {
  ['loading', 'quiz', 'results', 'error'].forEach(s => {
    const el = $(s);
    if (el) el.style.display = s === id ? '' : 'none';
  });
}

// ===== クイズ読み込み =====
async function loadQuiz() {
  try {
    const res = await fetch('./data/quiz-data.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.questions || data.questions.length === 0) {
      throw new Error('問題データが空です');
    }

    questions = data.questions;
    webhookUrl = data.webhook_url || '';
    quizDate = data.date || new Date().toISOString().split('T')[0];

    showScreen('quiz');
    renderQuestion(0);
  } catch (err) {
    console.error(err);
    $('error-msg').textContent = err.message || '問題ファイルの読み込みに失敗しました。';
    showScreen('error');
  }
}

// ===== 問題表示 =====
function renderQuestion(index) {
  const q = questions[index];
  const total = questions.length;

  // ヘッダー更新
  $('question-num').textContent = `Q${index + 1}/${total}`;
  $('progress-bar').style.width = `${(index / total) * 100}%`;

  // 問題カード
  $('category-badge').textContent = q.category || '用語';
  $('term').textContent = `「${q.term}」`;

  // 選択肢描画
  const choicesEl = $('choices');
  choicesEl.innerHTML = '';
  q.choices.forEach((choice, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.innerHTML = `
      <span class="letter">${LETTERS[i]}</span>
      <span class="text">${choice.text}</span>
    `;
    btn.addEventListener('click', () => handleAnswer(choice, btn, q, index));
    choicesEl.appendChild(btn);
  });

  // パネルリセット
  const expEl = $('explanation');
  expEl.style.display = 'none';
  expEl.innerHTML = '';
  $('next-btn-wrapper').style.display = 'none';
}

// ===== 回答処理 =====
function handleAnswer(choice, clickedBtn, question, index) {
  // 全ボタン無効化
  document.querySelectorAll('.choice-btn').forEach(b => (b.disabled = true));

  const isCorrect = choice.correct;

  // クリックしたボタンに正誤スタイル
  clickedBtn.classList.add(isCorrect ? 'correct' : 'incorrect');

  // 不正解の場合は正解ボタンもハイライト
  if (!isCorrect) {
    document.querySelectorAll('.choice-btn').forEach(btn => {
      const text = btn.querySelector('.text').textContent;
      const match = question.choices.find(c => c.text === text && c.correct);
      if (match) btn.classList.add('correct');
    });
  }

  // 解説表示
  showExplanation(question, isCorrect);

  // 結果記録
  results.push({
    termId: question.id,
    termName: question.term,
    correctMeaning: question.choices.find(c => c.correct)?.text || '',
    correct: isCorrect,
  });

  // 「次へ」ボタン表示
  const nextWrapper = $('next-btn-wrapper');
  nextWrapper.style.display = 'block';

  const nextBtn = $('next-btn');
  const isLast = index + 1 >= questions.length;
  nextBtn.textContent = isLast ? '結果を見る 🎉' : '次の問題 →';
  nextBtn.onclick = () => {
    if (isLast) {
      showResults();
    } else {
      currentIndex++;
      renderQuestion(currentIndex);
    }
  };
}

// ===== 解説パネル =====
function showExplanation(question, isCorrect) {
  const correctChoice = question.choices.find(c => c.correct);
  const expEl = $('explanation');

  const abbrLine = question.abbreviation
    ? `<div>📝 <strong>略語:</strong> ${question.abbreviation}</div>`
    : '';

  expEl.innerHTML = `
    <div class="feedback ${isCorrect ? 'correct' : 'incorrect'}">
      ${isCorrect ? '✅ 正解！' : '❌ 不正解…'}
    </div>
    <div class="explanation-content">
      <div>📖 <strong>意味:</strong> ${correctChoice?.text || ''}</div>
      ${abbrLine}
    </div>
  `;
  expEl.style.display = 'block';
}

// ===== 結果画面 =====
async function showResults() {
  // プログレスバー完了
  $('progress-bar').style.width = '100%';
  $('question-num').textContent = `完了！`;

  showScreen('results');

  const correct = results.filter(r => r.correct).length;
  const total = results.length;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  // スコア表示
  $('results-score').textContent = `${total}問中 ${correct}問正解`;
  $('results-pct').textContent = `正解率 ${pct}%`;

  // 絵文字を点数に合わせて変える
  const emoji = pct === 100 ? '🏆' : pct >= 80 ? '🎉' : pct >= 60 ? '😊' : pct >= 40 ? '🤔' : '💪';
  document.querySelector('.results-emoji').textContent = emoji;

  // 結果リスト描画
  const listEl = $('results-list');
  listEl.innerHTML = results.map(r => `
    <div class="result-item">
      <span class="result-icon">${r.correct ? '✅' : '❌'}</span>
      <span class="result-term">${r.termName}</span>
      <span class="result-meaning">${r.correctMeaning}</span>
    </div>
  `).join('');

  // Notion/Webhookに送信
  await sendResults();
}

// ===== Webhookに結果送信 =====
async function sendResults() {
  const syncEl = $('sync-status');

  // LocalStorageにバックアップ
  try {
    const key = `quiz_results_${quizDate}`;
    localStorage.setItem(key, JSON.stringify({ date: quizDate, results }));
  } catch (_) { /* ignore */ }

  // Webhookがなければスキップ
  if (!webhookUrl) {
    syncEl.textContent = '📝 結果をローカルに保存しました';
    syncEl.className = 'sync-status ok';
    return;
  }

  syncEl.textContent = '⏳ Notionに記録中...';
  try {
    const payload = {
      date: quizDate,
      results: results.map(r => ({
        termId: r.termId,
        termName: r.termName,
        correct: r.correct,
      })),
    };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      syncEl.textContent = '✅ Notionへの記録が完了しました！';
      syncEl.className = 'sync-status ok';
    } else {
      throw new Error(`Webhook error: ${res.status}`);
    }
  } catch (err) {
    console.error('Webhook failed:', err);
    syncEl.textContent = '⚠️ Notion記録に失敗しました（ローカルには保存済み）';
    syncEl.className = 'sync-status fail';
  }
}

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', loadQuiz);
