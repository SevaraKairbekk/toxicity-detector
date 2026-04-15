import React, { useState, useEffect } from "react";
import "./App.css";

// API URL из переменной окружения
const API_URL = "https://toxicity-detector-cbgc.onrender.com";

function App() {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // аутентификация
  const [token, setToken] = useState(localStorage.getItem("token") || null);
  const [user, setUser] = useState(null);
  const [isLogin, setIsLogin] = useState(true);
  const [authData, setAuthData] = useState({ username: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  // Загрузка данных пользователя при входе
  useEffect(() => {
    if (token) {
      fetchUserData();
      fetchHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchUserData = async () => {
    try {
      const statsRes = await fetch(`${API_URL}/api/stats`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      } else if (statsRes.status === 401) {
        handleLogout();
      }
    } catch (err) {
      console.error("Ошибка загрузки данных:", err);
    }
  };

  const fetchHistory = async () => {
    try {
      const response = await fetch(`${API_URL}/api/history`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setHistory(data);
      } else if (response.status === 401) {
        handleLogout();
      }
    } catch (err) {
      console.error("Ошибка загрузки истории:", err);
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    
    const endpoint = isLogin ? "/api/login" : "/api/register";
    
    try {
      const body = isLogin ? 
        { username: authData.username, password: authData.password } :
        authData;
      
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        localStorage.setItem("token", data.token);
        setToken(data.token);
        setUser(data.user);
        setAuthData({ username: "", email: "", password: "" });
        setAuthError("");
      } else {
        setAuthError(data.error || "Қателік орын алды");
      }
    } catch (err) {
      console.error("Auth error:", err);
      setAuthError("Серверге қосылу мүмкін болмады");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
    setResult(null);
    setHistory([]);
    setStats(null);
    setShowHistory(false);
    setError("");
  };

  const checkToxicity = async () => {
    if (!text.trim()) {
      setError("Мәтінді енгізіңіз");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch(`${API_URL}/check`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ text }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          handleLogout();
          throw new Error("Сеанс аяқталды, қайта кіріңіз");
        }
        throw new Error(data.error || "Тексерудегі қателік");
      }

      setResult(data);
      await fetchUserData();
      await fetchHistory();
      
    } catch (error) {
      console.error("Қателік:", error);
      setError(error.message || "Серверге қосылу мүмкін болмады");
    } finally {
      setLoading(false);
    }
  };

  const getScoreColor = (score) => {
    if (score < 0.3) return "#4caf50";
    if (score < 0.7) return "#ff9800";
    return "#f44336";
  };

  const getScoreText = (score) => {
    if (score < 0.3) return "Төмен деңгейдегі уыттылық";
    if (score < 0.7) return "Орташа деңгейдегі уыттылық";
    return "Жоғарғы деңгейдегі уыттылық";
  };

  // Если не авторизован — показываем форму входа/регистрации
  if (!token) {
    return (
      <div className="App">
        <header className="header">
          <h1>Smart Toxicity Detector</h1>
        </header>
        <main className="main">
          <div className="auth-container">
            <div className="auth-tabs">
              <button 
                className={isLogin ? "active" : ""} 
                onClick={() => { setIsLogin(true); setAuthError(""); }}
              >
                Кіру
              </button>
              <button 
                className={!isLogin ? "active" : ""} 
                onClick={() => { setIsLogin(false); setAuthError(""); }}
              >
                Тіркелу
              </button>
            </div>
            
            <form onSubmit={handleAuth} className="auth-form">
              <input
                type="text"
                placeholder="Пайдаланушы аты"
                value={authData.username}
                onChange={(e) => setAuthData({ ...authData, username: e.target.value })}
                required
                minLength="3"
              />
              {!isLogin && (
                <input
                  type="email"
                  placeholder="Email"
                  value={authData.email}
                  onChange={(e) => setAuthData({ ...authData, email: e.target.value })}
                  required
                />
              )}
              <input
                type="password"
                placeholder="Құпия сөз"
                value={authData.password}
                onChange={(e) => setAuthData({ ...authData, password: e.target.value })}
                required
                minLength="6"
              />
              {authError && <div className="error-message">{authError}</div>}
              <button type="submit" disabled={authLoading}>
                {authLoading ? "Күте тұрыңыз..." : (isLogin ? "Кіру" : "Тіркелу")}
              </button>
            </form>
          </div>
        </main>
        <footer className="footer">
          <p>© 2026 Smart Toxicity Detector</p>
        </footer>
      </div>
    );
  }

  // Основной интерфейс для авторизованных пользователей
  return (
    <div className="App">
      <header className="header">
        <div className="header-top">
          <h1>Smart Toxicity Detector</h1>
          <div className="user-info">
            <span className="username">{user?.username}</span>
            <button onClick={handleLogout} className="logout-btn">Шығу</button>
          </div>
        </div>
        {stats && (
          <div className="stats-bar">
            <span>Барлығы: {stats.totalChecks}</span>
            <span>Токсинді: {stats.toxicChecks}</span>
            <span>Қауіпсіз: {stats.safeChecks}</span>
          </div>
        )}
      </header>

      <main className="main">
        <div className="input-section">
          <textarea
            rows="6"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Мәтінді енгізіңіз..."
            className="text-input"
          />
          
          <div className="stats">
            <span>Символдар: {text.length}</span>
            <span>Сөздер: {text.trim().split(/\s+/).filter(w => w).length}</span>
          </div>

          <div className="button-group">
            <button 
              onClick={checkToxicity} 
              disabled={loading || !text.trim()}
              className="check-button"
            >
              {loading ? "Анализ жүруде..." : "Мәтінді тексеру"}
            </button>
            
            <button 
              onClick={() => {
                setShowHistory(!showHistory);
                if (!showHistory) fetchHistory();
              }} 
              className="history-button"
            >
              {showHistory ? "Жабу" : "Тарихты көру"}
            </button>
          </div>
        </div>

        {error && (
          <div className="error-message">
            <strong>Қателік:</strong> {error}
          </div>
        )}

        {showHistory && (
          <div className="history-section">
            <div className="history-header">
              <h3>Тексеру тарихы</h3>
              <button onClick={() => setShowHistory(false)} className="close-btn">✖</button>
            </div>
            {history.length === 0 ? (
              <p className="no-history">Әзірге тексерулер жоқ</p>
            ) : (
              <div className="history-list">
                {history.map((item, idx) => (
                  <div key={idx} className={`history-item ${item.result.toxic ? 'toxic' : 'safe'}`}>
                    <div className="history-text">{item.text.length > 100 ? item.text.substring(0, 100) + '...' : item.text}</div>
                    <div className="history-result">
                      <span className={`badge ${item.result.toxic ? 'toxic-badge' : 'safe-badge'}`}>
                        {item.result.toxic ? "Уытты" : "Қауіпсіз"}
                      </span>
                      <span className="score">({Math.round(item.result.score * 100)}%)</span>
                    </div>
                    <div className="history-date">{new Date(item.createdAt).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {result && !showHistory && (
          <div className="result-section">
            <div className={`result-card ${result.toxic ? 'toxic' : 'safe'}`}>
              <h2>
                {result.toxic ? "Уытты текст" : "Қауіпсіз текст"}
              </h2>
              
              <div className="score-bar">
                <div 
                  className="score-fill"
                  style={{
                    width: `${result.score * 100}%`,
                    backgroundColor: getScoreColor(result.score)
                  }}
                />
              </div>
              
              <p className="score-text">
                {getScoreText(result.score)} ({Math.round(result.score * 100)}%)
              </p>
              
              <div className="reason">
                <strong>Себебі:</strong>
                <p>{result.reason}</p>
              </div>
            </div>

            {result.details && (
              <div className="details">
                <h3>Детальді анализ</h3>
                <div className="details-grid">
                  <div className="detail-item">
                    <span>Қорлау:</span>
                    <span style={{color: getScoreColor(result.details.insult / 100)}}>
                      {Math.round(result.details.insult)}%
                    </span>
                  </div>
                  <div className="detail-item">
                    <span>Былапыт сөздер:</span>
                    <span style={{color: getScoreColor(result.details.obscenity / 100)}}>
                      {Math.round(result.details.obscenity)}%
                    </span>
                  </div>
                  <div className="detail-item">
                    <span>Дөрекілік:</span>
                    <span style={{color: getScoreColor(result.details.rudeness / 100)}}>
                      {Math.round(result.details.rudeness)}%
                    </span>
                  </div>
                  <div className="detail-item">
                    <span>Репутацияға нұқсан:</span>
                    <span style={{color: getScoreColor(result.details.reputation / 100)}}>
                      {Math.round(result.details.reputation)}%
                    </span>
                  </div>
                  <div className="detail-item">
                    <span>Қауіп:</span>
                    <span style={{color: getScoreColor(result.details.danger / 100)}}>
                      {Math.round(result.details.danger)}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="footer">
        <p>Қолданылған модель: Қазақ тіліндегі уытты сөздер базасы</p>
        <p>© 2026 Smart Toxicity Detector</p>
      </footer>
    </div>
  );
}

export default App;