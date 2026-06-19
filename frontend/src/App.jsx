import React, { useState, useEffect } from 'react';

// API Configuration
const API_BASE = 'http://localhost:8000/api';

function App() {
  // --- STATE MANAGEMENT ---
  const [messages, setMessages] = useState([
    { sender: 'bot', text: 'Hello! I am your secure SQL Data Assistant. Ask me any custom queries here, or use the quick report cards on the main page!' }
  ]);
  const [input, setInput] = useState('');
  const [tables, setTables] = useState([]);
  const [activeResult, setActiveResult] = useState(null);
  const [sqlHistory, setSqlHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  // View Toggle (table vs chart)
  // NEW STATES: Floating Chat Open/Close & Card selections
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [financialDistrict, setFinancialDistrict] = useState('Indore');
  const [viewMode, setViewMode] = useState('table'); 
  const [view, setView] = useState('landing');
  const [landState, setLandState] = useState('Madhya Pradesh');
  const [theme, setTheme] = useState('dark');

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    if (nextTheme === 'light') {
      document.body.classList.add('theme-light');
    } else {
      document.body.classList.remove('theme-light');
    }
  };

  // Static options for dropdown lists (matching our demo data)
  const districtsList = ['Indore', 'Bhopal', 'Guna', 'Rajkot', 'Godda', 'Kathua', 'Samba', 'Jammu'];
  const statesList = ['Madhya Pradesh', 'Punjab', 'Gujarat', 'Jammu and Kashmir', 'Haryana', 'Tamil Nadu'];

  // --- API CALLS ---

  // 1. Fetch Ingested Tables from Backend on Load
  const fetchTables = async () => {
    try {
      const response = await fetch(`${API_BASE}/tables`);
      if (response.ok) {
        const data = await response.json();
        setTables(data);
      }
    } catch (err) {
      console.error('Failed to fetch tables:', err);
    }
  };

  useEffect(() => {
    fetchTables();
  }, []);

  // 2. Handle File Ingestion
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploading(true);
    setErrorMsg('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        fetchTables();
        setMessages((prev) => [
          ...prev,
          { sender: 'bot', text: `Successfully ingested spreadsheet: "${file.name}". New database tables are now available to query!` }
        ]);
        setView('chat'); // Automatically transition to chat view
      } else {
        setErrorMsg(result.detail || 'Failed to process file.');
      }
    } catch (err) {
      setErrorMsg('Failed to connect to the backend server.');
    } finally {
      setUploading(false);
    }
  };

  // 3. Process Query (called by chat input, hero search, or report cards)
  const executeQuery = async (queryText) => {
    if (!queryText.trim() || loading) return;

    setLoading(true);
    setErrorMsg('');
    setView('chat'); // Automatically transition to chat view

    try {
      const response = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: queryText, history: sqlHistory.map(h => ({ user_query: h.user_query, sql_query: h.sql_query })) }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessages((prev) => [...prev, { sender: 'bot', text: data.summary }]);
        setSqlHistory((prev) => [
          ...prev, 
          { 
            user_query: queryText, 
            sql_query: data.sql_query,
            columns: data.columns,
            rows: data.rows,
            summary: data.summary 
          }
        ]);

        setActiveResult({
          sql: data.sql_query,
          columns: data.columns,
          rows: data.rows,
          summary: data.summary
        });
        setViewMode('table'); 
      } else {
        const errorDetail = typeof data.detail === 'object' ? data.detail.message : data.detail;
        const generatedSql = data.detail?.generated_sql || '';
        
        setMessages((prev) => [
          ...prev, 
          { sender: 'bot', text: `Request Blocked/Failed: ${errorDetail}` }
        ]);

        if (generatedSql) {
          setActiveResult({
            sql: generatedSql,
            columns: [],
            rows: [],
            summary: `Query failed: ${errorDetail}`
          });
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev, 
        { sender: 'bot', text: 'Failed to connect to server. Make sure your FastAPI backend is running.' }
      ]);
    } finally {
      setLoading(false);
    }
  };

  // 4. Handle Chat Submit
  const handleChatSubmit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    const textToSend = input.trim();
    setMessages((prev) => [...prev, { sender: 'user', text: textToSend }]);
    setInput('');
    executeQuery(textToSend);
  };

  // 5. Handle Hero Search Input Submit
  const handleHeroSubmit = (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    const textToSend = searchQuery.trim();
    setSearchQuery('');
    setMessages((prev) => [...prev, { sender: 'user', text: textToSend }]);
    setView('chat'); // Open the chatbot page
    executeQuery(textToSend);
  };

  // 6. Handle Card 1: Generate Financial Progress Report
  const triggerFinancialReport = () => {
    const queryText = `show me the outlay, expenditure, and throwforward for works in district ${financialDistrict}`;
    setMessages((prev) => [...prev, { sender: 'user', text: `Generate Financial Report for ${financialDistrict}` }]);
    setView('chat'); // Open the chatbot page
    executeQuery(queryText);
  };

  // 7. Handle Card 2: Generate Land Acquisition Summary
  const triggerLandReport = () => {
    const queryText = `show me the land acquisition status and remarks for works in state ${landState}`;
    setMessages((prev) => [...prev, { sender: 'user', text: `Generate Land Acquisition Report for ${landState}` }]);
    setView('chat'); // Open the chatbot page
    executeQuery(queryText);
  };

  // --- EXCEL/CSV EXPORT UTILITY ---
  const handleExportCSV = (resultData) => {
    // Fall back to activeResult if no specific resultData is passed
    const dataToExport = resultData || activeResult;
    if (!dataToExport || !dataToExport.rows.length) return;

    const headers = dataToExport.columns.join(',');

    const rows = dataToExport.rows.map(row => 
      dataToExport.columns.map(col => {
        let val = row[col] === null || row[col] === undefined ? '' : String(row[col]);
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          val = `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(',')
    );

    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `IRPSM_Data_Export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- DYNAMIC SVG CHART GENERATOR ---
  const renderSVGChart = () => {
    if (!activeResult || !activeResult.rows.length) return null;

    let numericCol = null;
    const numericCandidates = ['original_cost', 'current_cost', 'last_sanc_cost', 'allocation', 'throwforward_next_fy', 'balance_till_date', 'expenditure_upto_date', 'outlay_modified_for_curr_fy'];
    
    for (let candidate of numericCandidates) {
      if (activeResult.columns.includes(candidate)) {
        numericCol = candidate;
        break;
      }
    }

    if (!numericCol) {
      for (let col of activeResult.columns) {
        if (['workid', 'uwid', 'district_code', 'state_code', 'constituency_code'].includes(col)) continue;
        const isNumeric = activeResult.rows.some(row => !isNaN(parseFloat(row[col])) && isFinite(row[col]));
        if (isNumeric) {
          numericCol = col;
          break;
        }
      }
    }

    let labelCol = null;
    const labelCandidates = ['short_name_of_work', 'district_name', 'constituency_name', 'state_name', 'railway', 'allocation'];
    for (let candidate of labelCandidates) {
      if (activeResult.columns.includes(candidate)) {
        labelCol = candidate;
        break;
      }
    }

    if (!labelCol) {
      labelCol = activeResult.columns.find(col => col !== 'workid' && col !== numericCol) || activeResult.columns[0];
    }

    if (!numericCol) {
      return (
        <div style={{ padding: '20px', color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center' }}>
          No numeric columns found in query results to chart. Displaying table view instead.
        </div>
      );
    }

    const chartData = activeResult.rows.slice(0, 10);
    const maxVal = Math.max(...chartData.map(d => parseFloat(d[numericCol] || 0)), 1);

    const width = 500;
    const barHeight = 24;
    const gap = 12;
    const paddingLeft = 140;
    const paddingRight = 60;
    const chartWidth = width - paddingLeft - paddingRight;
    const height = chartData.length * (barHeight + gap) + 40;

    return (
      <div style={{ background: 'rgba(75, 86, 148, 0.08)', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '16px' }}>
        <h5 style={{ fontSize: '12px', color: 'var(--accent-cyan)', marginBottom: '14px', textTransform: 'uppercase' }}>
          Chart View: {numericCol} by {labelCol} (Top 10)
        </h5>
        
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
          {chartData.map((d, index) => {
            const val = parseFloat(d[numericCol] || 0);
            const barWidth = maxVal > 0 ? (val / maxVal) * chartWidth : 0;
            const y = index * (barHeight + gap) + 20;
            
            let label = String(d[labelCol] || '');
            if (label.length > 18) label = label.substring(0, 16) + '...';

            return (
              <g key={index}>
                <text x="10" y={y + 16} fill="var(--text-secondary)" fontSize="11" fontFamily="sans-serif">
                  {label}
                </text>
                <rect x={paddingLeft} y={y} width={chartWidth} height={barHeight} rx="4" fill="rgba(75, 86, 148, 0.05)" />
                <rect 
                  x={paddingLeft} 
                  y={y} 
                  width={barWidth} 
                  height={barHeight} 
                  rx="4" 
                  fill="url(#barGradient)" 
                  style={{ transition: 'width 0.5s ease-out' }}
                />
                <text x={paddingLeft + barWidth + 8} y={y + 16} fill="var(--accent-cyan)" fontSize="10" fontWeight="600" fontFamily="sans-serif">
                  {val.toLocaleString('en-IN')}
                </text>
              </g>
            );
          })}
          <defs>
            <linearGradient id="barGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#4B5694" />
              <stop offset="100%" stopColor="#7288AE" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    );
  };

  if (view === 'chat') {
    return (
      <div className="chat-layout">
        {/* SIDEBAR */}
        <aside className="chat-sidebar">
          <div className="sidebar-header">
            <div className="sidebar-logo">
              TRACK
              <span>Secure SQL Sandbox</span>
            </div>
            <button className="btn-new-chat" onClick={() => { setViewMode('table'); setActiveResult(null); setView('landing'); }}>
              Back to Home
            </button>
          </div>
          <div className="sidebar-history-title">Recent Queries</div>
          <div className="sidebar-list">
            {sqlHistory.map((item, index) => (
              <button 
                key={index} 
                className={`sidebar-item ${activeResult && activeResult.sql === item.sql_query ? 'active' : ''}`}
                onClick={() => {
                  setActiveResult({
                    sql: item.sql_query,
                    columns: item.columns || [],
                    rows: item.rows || [],
                    summary: item.summary || ''
                  });
                }}
              >
                {item.user_query}
              </button>
            ))}
            {sqlHistory.length === 0 && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '10px 14px' }}>No queries run yet</span>
            )}
          </div>
          <div className="sidebar-footer">
            <button 
              onClick={toggleTheme} 
              style={{
                width: '100%',
                background: 'transparent',
                border: '1px solid var(--border-light)',
                color: 'var(--text-primary)',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '11px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              {theme === 'dark' ? 'Light Theme' : 'Dark Theme'}
            </button>
          </div>
        </aside>

        {/* MAIN AREA */}
        <main className="chat-main">
          <header className="chat-main-header">
            <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-secondary)' }}>
              Interactive SQL Interface
            </span>
            <button 
              onClick={() => setView('landing')} 
              style={{
                background: 'transparent',
                border: '1px solid var(--border-light)',
                color: 'var(--text-primary)',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Go to Landing
            </button>
          </header>

          <div className="chat-body">
            {/* Conversations */}
            <div className="chat-message-row">
              {messages.map((msg, index) => (
                <div key={index} className={`chat-bubble ${msg.sender}`}>
                  {msg.text}
                </div>
              ))}
              {loading && <div className="chat-bubble bot">Generating secure query...</div>}
            </div>

            {/* Side-by-Side Horizontal Results Panel */}
            {activeResult && (
              <div className="chat-message-row" style={{ maxWidth: '100%' }}>
                <div className="results-split-container">
                  {/* Left Column: SQL and AI Summary */}
                  <div className="results-split-meta">
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <h4 style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>SQLite Code</h4>
                        <span style={{ fontSize: '9px', color: 'var(--accent-cyan)', background: 'rgba(75, 86, 148, 0.2)', padding: '2px 6px', borderRadius: '4px' }}>
                          Sandbox Verified
                        </span>
                      </div>
                      <div className="sql-block" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                        {activeResult.sql}
                      </div>
                    </div>

                    <div className="summary-box" style={{ background: 'rgba(75, 86, 148, 0.08)', border: '1px solid var(--border-light)' }}>
                      <div className="summary-title">IRPSM Summary</div>
                      <p style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{activeResult.summary}</p>
                    </div>
                  </div>

                  {/* Right Column: Table / Chart Visualizer */}
                  <div className="results-split-data">
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <h4 style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Data Output</h4>
                        
                        {activeResult.rows.length > 0 && (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '6px', padding: '2px', display: 'flex', border: '1px solid var(--border-light)' }}>
                              <button 
                                onClick={() => setViewMode('table')} 
                                style={{ 
                                  background: viewMode === 'table' ? 'var(--grad-cyan-violet)' : 'transparent',
                                  border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', color: 'white', cursor: 'pointer' 
                                }}
                              >
                                Table
                              </button>
                              <button 
                                onClick={() => setViewMode('chart')} 
                                style={{ 
                                  background: viewMode === 'chart' ? 'var(--grad-cyan-violet)' : 'transparent',
                                  border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', color: 'white', cursor: 'pointer' 
                                }}
                              >
                                Chart
                              </button>
                            </div>

                            <button 
                              onClick={handleExportCSV} 
                              style={{ 
                                background: 'transparent', border: '1px solid var(--accent-cyan)', color: 'var(--accent-cyan)',
                                borderRadius: '6px', padding: '4px 10px', fontSize: '10px', cursor: 'pointer'
                              }}
                            >
                              Export CSV
                            </button>
                          </div>
                        )}
                      </div>

                      {activeResult.rows.length === 0 ? (
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No data records to display.</p>
                      ) : (
                        viewMode === 'table' ? (
                          <div className="table-wrapper" style={{ maxHeight: '350px' }}>
                            <table>
                              <thead>
                                <tr>
                                  {activeResult.columns.map((col) => (
                                    <th key={col}>{col}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {activeResult.rows.map((row, rIdx) => (
                                  <tr key={rIdx}>
                                    {activeResult.columns.map((col) => (
                                      <td key={col}>{String(row[col] ?? '')}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          renderSVGChart()
                        )
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Prompt input bar */}
          <footer className="chat-footer">
            <form className="prompt-box-wrapper" onSubmit={handleChatSubmit}>
              <input
                type="text"
                className="prompt-box-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask TRACK a custom query (e.g. show outlay for Central Railway)..."
                disabled={loading}
              />
              <button type="submit" className="btn-prompt-send" disabled={loading || !input.trim()}>
                Send
              </button>
            </form>
          </footer>
        </main>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* HEADER SECTION */}
      <header className="portal-header">
        <div className="portal-logo">
          <h1>TRACK</h1>
          <span>Secure SQL Sandbox</span>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            onClick={() => setView('chat')} 
            style={{
              background: 'transparent',
              border: '1px solid var(--border-light)',
              color: 'var(--text-primary)',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Open Chatbot View
          </button>
          <button 
            onClick={toggleTheme} 
            style={{
              background: 'transparent',
              border: '1px solid var(--border-light)',
              color: 'var(--text-primary)',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            {theme === 'dark' ? 'Light Theme' : 'Dark Theme'}
          </button>
        </div>
      </header>

      {/* PORTAL CONTAINER */}
      <main className="portal-container">
        
        {/* HERO SECTION */}
        <section className="hero-section">
          <h2>Hello. How can we help you?</h2>
          <form className="hero-search-wrapper" onSubmit={handleHeroSubmit}>
            <input 
              type="text" 
              className="hero-search-bar" 
              placeholder="Search for answers or ask custom queries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </form>
        </section>

        {/* PORTAL GRID OF CARDS */}
        <section className="portal-grid">
          
          {/* Card 1: Financial Progress */}
          <div className="portal-card">
            <div className="card-title">Financial Progress Report</div>
            <p className="card-desc">
              Generate a dynamic budget and expenditure summary for works registered in a specific district.
            </p>
            <div className="card-controls">
              <select 
                className="form-select"
                value={financialDistrict}
                onChange={(e) => setFinancialDistrict(e.target.value)}
              >
                {districtsList.map(dist => (
                  <option key={dist} value={dist}>{dist}</option>
                ))}
              </select>
              <button className="btn-card-action" onClick={triggerFinancialReport} disabled={loading}>
                Generate Report
              </button>
            </div>
          </div>

          {/* Card 2: Land Acquisition Summary */}
          <div className="portal-card">
            <div className="card-title">Land Acquisition Summary</div>
            <p className="card-desc">
              Extract status logs and summaries regarding land acquisition progress across specific states.
            </p>
            <div className="card-controls">
              <select 
                className="form-select"
                value={landState}
                onChange={(e) => setLandState(e.target.value)}
              >
                {statesList.map(st => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
              <button className="btn-card-action" onClick={triggerLandReport} disabled={loading}>
                Generate Summary
              </button>
            </div>
          </div>

          {/* Card 3: Ingestion & Schema Registry */}
          <div className="portal-card">
            <div className="card-title">Database & Schema Registry</div>
            <p className="card-desc">
              Ingest new Excel sheets or view table column schemas currently loaded in the SQL database.
            </p>
            <div className="card-controls">
              <label className="card-dropzone">
                <p>{uploading ? 'Processing...' : 'Ingest Spreadsheet'}</p>
                <span>Click to choose .xlsx</span>
                <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} style={{ display: 'none' }} disabled={uploading} />
              </label>
              
              <div className="schema-list-wrapper">
                {tables.map(tbl => (
                  <div className="schema-item" key={tbl.table_name}>
                    <span style={{ fontWeight: '500' }}>{tbl.table_name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                      {Object.keys(tbl.columns).length} cols
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </section>

        {/* DATA VISUALIZER SECTION (Only renders if activeResult exists) */}
        {activeResult && (
          <section className="results-container">
            <div className="results-header">
              <h3 style={{ fontFamily: 'Outfit', fontSize: '16px', fontWeight: '600' }}>Last Run Results</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  onClick={() => setView('chat')} 
                  style={{ 
                    background: 'var(--grad-cyan-violet)', border: 'none', color: 'white',
                    borderRadius: '6px', padding: '4px 10px', fontSize: '10px', fontWeight: '600', cursor: 'pointer' 
                  }}
                >
                  View in Chat Thread
                </button>
              </div>
            </div>

            {/* Generated SQL Code Box */}
            <div>
              <h4 style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Generated SQLite Code</h4>
              <div className="sql-block">
                <span className="sql-badge">Sandbox Verified</span>
                {activeResult.sql}
              </div>
            </div>

            {/* Data Rows Output */}
            <div>
              <h4 style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Data Output</h4>
              {activeResult.rows.length === 0 ? (
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Empty dataset or blocked execution.</p>
              ) : (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        {activeResult.columns.slice(0, 8).map((col) => (
                          <th key={col}>{col}</th>
                        ))}
                        {activeResult.columns.length > 8 && <th>...</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {activeResult.rows.slice(0, 5).map((row, rIdx) => (
                        <tr key={rIdx}>
                          {activeResult.columns.slice(0, 8).map((col) => (
                            <td key={col}>{String(row[col] ?? '')}</td>
                          ))}
                          {activeResult.columns.length > 8 && <td style={{ color: 'var(--text-muted)' }}>...</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Summary Insights */}
            <div className="summary-box">
              <div className="summary-title">IRPSM Insight Summary</div>
              <p>{activeResult.summary}</p>
            </div>

          </section>
        )}

      </main>
    </div>
  );
}

export default App;