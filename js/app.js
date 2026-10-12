console.log('script.js підключено: Робота з Vue 3 та IndexedDB');

const API_URL = 'https://opentdb.com/api.php?amount=10&type=multiple';


const DB_NAME = 'QuizDB';
const DB_VERSION = 1;
const STORE_NAME = 'results';

// Читання зі старого localStorage (Крок 2)
function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem('quizResults');
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('Пошкоджені дані в localStorage:', error);
    return [];
  }
}

// Відкриття/створення IndexedDB (Крок 6)
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Згідно з варіантом 8: створюємо сховище з autoIncrement id
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Додавання результату в IndexedDB (Крок 7)
async function addResult(resultItem) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(resultItem);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Отримання всіх результатів з IndexedDB (Крок 7)
async function getAllResults() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Одноразова міграція з localStorage в IndexedDB (Крок 8)
async function migrateIfNeeded() {
  const isMigrated = localStorage.getItem('migratedToIDB');
  if (!isMigrated) {
    const oldData = loadFromLocalStorage();
    if (oldData.length > 0) {
      console.log('Знайдено старі дані в localStorage, починаємо міграцію...');
      for (const item of oldData) {
        await addResult(item);
      }
      console.log('Дані успішно мігровано в IndexedDB!');
    }
    localStorage.setItem('migratedToIDB', 'true'); // Ставимо прапорець
  }
}

function decodeHTML(html) {
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
}

const QuizQuestion = {
  props: ['question', 'options', 'correctAnswer', 'hasAnswered', 'selectedAnswer'],
  emits: ['answer'],
  template: `
    <div>
      <h2 id="question-text">{{ question }}</h2>
      <form @submit.prevent>
        <div id="options-container">
          <div v-for="(option, index) in options" :key="index" style="margin-bottom: 10px;">
            <input 
              type="radio" 
              :id="'option-'+index" 
              name="quiz-option" 
              :value="option" 
              :checked="selectedAnswer === option"
              :disabled="hasAnswered"
              @change="$emit('answer', option)" 
              required>
            <label 
              :for="'option-'+index"
              :class="{
                'correct-answer': hasAnswered && option === correctAnswer,
                'wrong-answer': hasAnswered && option === selectedAnswer && option !== correctAnswer
              }"
            >
              {{ option }}
            </label>
          </div>
        </div>
      </form>
    </div>
  `
};

const app = Vue.createApp({
  components: { QuizQuestion },
  data() {
    return {
      quizQuestions: [],
      currentQuestionIndex: 0,
      correctCount: 0,
      isLoading: false,
      errorMessage: '',
      quizStarted: false,
      quizFinished: false,
      hasAnswered: false,
      selectedAnswer: null,
      isCorrect: false,
      
      resultsHistory: [] // Масив для зберігання історії з IndexedDB
    };
  },
  computed: {
    currentQuestion() { return this.quizQuestions[this.currentQuestionIndex]; },
    progressPercentage() {
      if (this.quizQuestions.length === 0) return 0;
      return ((this.currentQuestionIndex + 1) / this.quizQuestions.length) * 100;
    }
  },
  // Запускається при першому завантаженні сторінки (Крок 9)
  async mounted() {
    try {
      await migrateIfNeeded(); // Перевіряємо міграцію
      await this.loadHistory(); // Завантажуємо таблицю лідерів
    } catch (error) {
      console.error('Помилка ініціалізації БД (можливо приватний режим браузера):', error);
    }
  },
  methods: {
    async loadData() {
      this.isLoading = true;
      this.errorMessage = '';
      this.quizQuestions = [];
      try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error(`Помилка сервера: ${response.status}`);
        const data = await response.json();
        if (!data.results || data.results.length === 0) throw new Error('Немає питань.');

        this.quizQuestions = data.results.map(item => {
          const allOptions = [...item.incorrect_answers, item.correct_answer];
          allOptions.sort(() => Math.random() - 0.5);
          return {
            question: decodeHTML(item.question),
            options: allOptions.map(decodeHTML),
            answer: decodeHTML(item.correct_answer)
          };
        });

        this.quizStarted = true;
        this.resetQuestionState();
      } catch (error) {
        this.errorMessage = 'Не вдалося завантажити питання.';
      } finally {
        this.isLoading = false;
      }
    },
    
    checkAnswer(answer) {
      this.selectedAnswer = answer;
      this.hasAnswered = true;
      if (this.selectedAnswer === this.currentQuestion.answer) {
        this.isCorrect = true;
        this.correctCount++;
      } else {
        this.isCorrect = false;
      }
    },

    nextQuestion() {
      this.currentQuestionIndex++;
      if (this.currentQuestionIndex < this.quizQuestions.length) {
        this.resetQuestionState();
      } else {
        this.finishQuiz();
      }
    },

    resetQuestionState() {
      this.hasAnswered = false;
      this.selectedAnswer = null;
      this.isCorrect = false;
    },

    // Завершення вікторини та збереження результату в IndexedDB
    async finishQuiz() {
      this.quizFinished = true;
      
      const newResult = {
        date: new Date().toLocaleString('uk-UA'),
        score: this.correctCount,
        total: this.quizQuestions.length
      };

      try {
        await addResult(newResult); // Зберігаємо в базу
        await this.loadHistory();   // Оновлюємо таблицю на екрані
      } catch (error) {
        console.error('Помилка запису в IndexedDB:', error);
      }
    },

    // Отримання та сортування результатів
    async loadHistory() {
      try {
        const data = await getAllResults();
        // Сортуємо найкращі результати (за спаданням балів)
        this.resultsHistory = data.sort((a, b) => b.score - a.score);
      } catch (error) {
        console.error('Помилка читання з IndexedDB:', error);
      }
    },

    resetQuiz() {
      this.quizStarted = false;
      this.quizFinished = false;
      this.currentQuestionIndex = 0;
      this.correctCount = 0;
      this.loadData();
    }
  }
});

app.mount('#app');