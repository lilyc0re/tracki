import React, { useState, useEffect } from 'react';

// API Configuration
const API_BASE = 'http://localhost:8000/api';

// --- MARKDOWN PARSING UTILITIES ---
const parseInlineTextOnlyForCode = (text) => {
  if (!text) return '';
  const codeParts = text.split(/(`.*?`)/g);
  return codeParts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code 
          key={`code-${index}`} 
          style={{ 
            background: 'rgba(255,255,255,0.08)', 
            padding: '2px 6px', 
            borderRadius: '4px', 
            fontFamily: 'monospace',
            fontSize: '12px',
            color: 'var(--accent-cyan)'
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
};

const parseInline = (text) => {
  if (!text) return '';
  const boldParts = text.split(/(\*\*.*?\*\*)/g);
  return boldParts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      const innerText = part.slice(2, -2);
      return (
        <strong key={`bold-${index}`} style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
          {parseInlineTextOnlyForCode(innerText)}
        </strong>
      );
    }
    return parseInlineTextOnlyForCode(part);
  });
};

const renderMarkdown = (text) => {
  if (!text) return null;

  const lines = text.split('\n');
  const elements = [];
  
  let currentList = null; // { type: 'ul' | 'ol', items: [] }
  let currentParagraph = [];

  const flushParagraph = (key) => {
    if (currentParagraph.length > 0) {
      elements.push(
        <div key={`p-${key}`} style={{ marginBottom: '10px', fontSize: '13px', lineHeight: '1.6' }}>
          {currentParagraph.map((line, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <br />}
              {parseInline(line)}
            </React.Fragment>
          ))}
        </div>
      );
      currentParagraph = [];
    }
  };

  const flushList = (key) => {
    if (currentList) {
      const ListTag = currentList.type;
      elements.push(
        <ListTag 
          key={`list-${key}`} 
          style={{ 
            paddingLeft: '20px', 
            margin: '8px 0', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '4px' 
          }}
        >
          {currentList.items.map((item, idx) => (
            <li key={idx} style={{ color: 'var(--text-primary)', fontSize: '13px' }}>
              {parseInline(item)}
            </li>
          ))}
        </ListTag>
      );
      currentList = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // 1. Heading check (matches # to ######)
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph(i);
      flushList(i);
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      const HeadingTag = `h${level}`;
      
      const fontSizes = { 1: '20px', 2: '18px', 3: '16px', 4: '14px', 5: '13px', 6: '12px' };
      const fontSize = fontSizes[level] || '14px';

      elements.push(
        <HeadingTag 
          key={`h-${i}`} 
          style={{ 
            fontSize, 
            fontWeight: '600', 
            color: 'var(--text-primary)', 
            marginTop: level <= 3 ? '16px' : '12px', 
            marginBottom: '6px' 
          }}
        >
          {parseInline(headingText)}
        </HeadingTag>
      );
      continue;
    }

    // 2. Bullet list check (* or -)
    const bulletMatch = line.match(/^(\*|-)\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph(i);
      if (currentList && currentList.type !== 'ul') {
        flushList(i);
      }
      if (!currentList) {
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(bulletMatch[2]);
      continue;
    }

    // 3. Numbered list check (1. or 2. etc.)
    const numberMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (numberMatch) {
      flushParagraph(i);
      if (currentList && currentList.type !== 'ol') {
        flushList(i);
      }
      if (!currentList) {
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(numberMatch[2]);
      continue;
    }

    // 4. Empty line check
    if (trimmed === '') {
      flushParagraph(i);
      flushList(i);
      continue;
    }

    // 5. Standard line
    flushList(i);
    currentParagraph.push(line);
  }

  // Flush remaining blocks
  flushParagraph('end');
  flushList('end');

  return elements;
};
const filterRows = (rows, searchQuery) => {
  if (!rows) return [];
  if (!searchQuery) return rows;
  const q = searchQuery.trim().toLowerCase();
  if (!q) return rows;

  if (q.includes('=')) {
    const parts = q.split('=');
    const key = parts[0].trim();
    const val = parts.slice(1).join('=').trim();

    if (key && val) {
      return rows.filter(row => {
        const matchingCol = Object.keys(row).find(k => k.toLowerCase().includes(key));
        if (matchingCol) {
          return String(row[matchingCol] ?? '').toLowerCase().includes(val);
        }
        return Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q));
      });
    }
  }

  return rows.filter(row => Object.values(row).some(val => String(val ?? '').toLowerCase().includes(q)));
};
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
  
  // NEW STATES: Floating Chat Open/Close & Card selections
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Shared Filter States
  const [filterState, setFilterState] = useState('All');
  const [filterDistrict, setFilterDistrict] = useState('All');
  const [progressThreshold, setProgressThreshold] = useState('All');
  
  const [activeReportTab, setActiveReportTab] = useState('financial');
  const [viewMode, setViewMode] = useState('table'); 
  const [resultsSearch, setResultsSearch] = useState('');
  const [view, setView] = useState('landing');
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

  // Prevent scroll locks or double scrollbars by toggling body style depending on the active view
  useEffect(() => {
    if (view === 'chat') {
      document.body.style.overflow = 'hidden';
      document.body.style.height = '100vh';
    } else {
      document.body.style.overflow = 'auto';
      document.body.style.height = 'auto';
    }
    return () => {
      document.body.style.overflow = 'auto';
      document.body.style.height = 'auto';
    };
  }, [view]);

  // Reset landing page results filter when activeResult changes
  useEffect(() => {
    setResultsSearch('');
  }, [activeResult]);

  // Dynamic options for dropdown lists
  const [districtsList, setDistrictsList] = useState(['Indore', 'Bhopal', 'Guna', 'Rajkot', 'Godda', 'Kathua', 'Samba', 'Jammu']);
  const [statesList, setStatesList] = useState(['Madhya Pradesh', 'Punjab', 'Gujarat', 'Jammu and Kashmir', 'Haryana', 'Tamil Nadu']);

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

  // 1.1 Fetch Distinct Districts from Backend (Cascading)
  const fetchDistricts = async (stateVal) => {
    try {
      const url = stateVal && stateVal !== 'All'
        ? `${API_BASE}/districts?state=${encodeURIComponent(stateVal)}`
        : `${API_BASE}/districts`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data) {
          setDistrictsList(data);
          // Set initial values if they are in the list, or default to All
          setFilterDistrict(prev => data.includes(prev) ? prev : 'All');
        }
      }
    } catch (err) {
      console.error('Failed to fetch districts:', err);
    }
  };

  // 1.2 Fetch Distinct States from Backend
  const fetchStates = async () => {
    try {
      const response = await fetch(`${API_BASE}/states`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          setStatesList(data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch states:', err);
    }
  };

  // Fetch initial data
  useEffect(() => {
    fetchTables();
    fetchStates();
    fetchDistricts('All');
  }, []);

  // Cascading effect: whenever filterState changes, refetch districts
  useEffect(() => {
    fetchDistricts(filterState);
  }, [filterState]);

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
        fetchDistricts();
        fetchStates();
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
        setMessages((prev) => [
          ...prev, 
          { 
            sender: 'bot', 
            text: data.summary,
            results: {
              sql: data.sql_query,
              columns: data.columns,
              rows: data.rows,
              summary: data.summary
            }
          }
        ]);
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

  // 6. Handle Tab 1: Generate Financial Progress Report
  const triggerFinancialReport = () => {
    let queryText = '';
    if (filterDistrict !== 'All') {
      queryText = `show me financial progress, outlay_modified_for_curr_fy, expenditure_upto_date, throwforward_next_fy, and short_name_of_work in district ${filterDistrict}`;
      if (filterState !== 'All') {
        queryText += ` in state ${filterState}`;
      }
      if (progressThreshold !== 'All') {
        queryText += ` where financial progress is greater than ${progressThreshold}`;
      }
    } else {
      queryText = `show me total number of works, total outlay_modified_for_curr_fy, total expenditure_upto_date, and average financial progress district wise`;
      if (filterState !== 'All') {
        queryText += ` in state ${filterState}`;
      }
      if (progressThreshold !== 'All') {
        queryText += ` where financial progress is greater than ${progressThreshold}`;
      }
    }
    setMessages((prev) => [...prev, { sender: 'user', text: `Generate Financial Report (State: ${filterState}, District: ${filterDistrict}, Min Progress: ${progressThreshold}%)` }]);
    setView('chat'); // Open the chatbot page
    executeQuery(queryText);
  };

  // 6.5 Handle Tab 2: Generate Physical Progress Report
  const triggerPhysicalReport = () => {
    let queryText = '';
    if (filterDistrict !== 'All') {
      queryText = `show me physical progress, short name of work, status flag, and division in district ${filterDistrict}`;
      if (filterState !== 'All') {
        queryText += ` in state ${filterState}`;
      }
      if (progressThreshold !== 'All') {
        queryText += ` where physical progress is greater than ${progressThreshold}`;
      }
    } else {
      queryText = `show me total number of works and average physical progress district wise`;
      if (filterState !== 'All') {
        queryText += ` in state ${filterState}`;
      }
      if (progressThreshold !== 'All') {
        queryText += ` where physical progress is greater than ${progressThreshold}`;
      }
    }
    setMessages((prev) => [...prev, { sender: 'user', text: `Generate Physical Report (State: ${filterState}, District: ${filterDistrict}, Min Progress: ${progressThreshold}%)` }]);
    setView('chat'); // Open the chatbot page
    executeQuery(queryText);
  };

  // 6.6 Handle Tab 3: Generate Clearance Status Report
  const triggerClearanceReport = () => {
    let queryText = `show me land acquisition status, short name of work, and remarks for works`;
    if (filterDistrict !== 'All') {
      queryText += ` in district ${filterDistrict}`;
    }
    if (filterState !== 'All') {
      queryText += ` in state ${filterState}`;
    }
    queryText += ` where remarks like clearance or remarks like forest or remarks like wildlife or remarks like environment or land_acquisition_status is not null`;
    setMessages((prev) => [...prev, { sender: 'user', text: `Generate Clearance Report (State: ${filterState}, District: ${filterDistrict})` }]);
    setView('chat'); // Open the chatbot page
    executeQuery(queryText);
  };

  // 6.7 Handle Tab 4: Generate Tender & Awards Report
  const triggerTenderReport = () => {
    let queryText = '';
    if (filterDistrict !== 'All') {
      queryText = `show me tender status, tender scope value, tender invited value, and tender awarded value for works in district ${filterDistrict}`;
      if (filterState !== 'All') {
        queryText += ` in state ${filterState}`;
      }
    } else {
      queryText = `show me total number of works, total tender scope value, total tender invited value, and total tender awarded value district wise`;
      if (filterState !== 'All') {
        queryText += ` in state ${filterState}`;
      }
    }
    setMessages((prev) => [...prev, { sender: 'user', text: `Generate Tenders & Awards Report (State: ${filterState}, District: ${filterDistrict})` }]);
    setView('chat'); // Open the chatbot page
    executeQuery(queryText);
  };

  // 6.8 Handle Tab 5: Generate Plan Head Summary Report
  const triggerPlanHeadReport = () => {
    let queryText = `show me plan head, total number of works, and total current cost group by plan head for works`;
    if (filterDistrict !== 'All') {
      queryText += ` in district ${filterDistrict}`;
    }
    if (filterState !== 'All') {
      queryText += ` in state ${filterState}`;
    }
    setMessages((prev) => [...prev, { sender: 'user', text: `Generate Plan Head Summary (State: ${filterState}, District: ${filterDistrict})` }]);
    setView('chat'); // Open the chatbot page
    executeQuery(queryText);
  };

  // --- EXCEL/CSV EXPORT UTILITY ---
  const handleExportCSV = (resultData) => {
    const dataToExport = resultData || activeResult;
    if (!dataToExport || !dataToExport.rows || !dataToExport.rows.length) return;

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
  const renderSVGChart = (resultData, filterQuery = '') => {
    const dataToChart = resultData || activeResult;
    if (!dataToChart || !dataToChart.rows.length) return null;

    let numericCol = null;
    const numericCandidates = ['original_cost', 'current_cost', 'last_sanc_cost', 'allocation', 'throwforward_next_fy', 'balance_till_date', 'expenditure_upto_date', 'outlay_modified_for_curr_fy'];
    
    for (let candidate of numericCandidates) {
      if (dataToChart.columns.includes(candidate)) {
        numericCol = candidate;
        break;
      }
    }

    if (!numericCol) {
      for (let col of dataToChart.columns) {
        if (['workid', 'uwid', 'district_code', 'state_code', 'constituency_code'].includes(col)) continue;
        const isNumeric = dataToChart.rows.some(row => !isNaN(parseFloat(row[col])) && isFinite(row[col]));
        if (isNumeric) {
          numericCol = col;
          break;
        }
      }
    }

    let labelCol = null;
    const labelCandidates = ['short_name_of_work', 'district_name', 'constituency_name', 'state_name', 'railway', 'allocation'];
    for (let candidate of labelCandidates) {
      if (dataToChart.columns.includes(candidate)) {
        labelCol = candidate;
        break;
      }
    }

    if (!labelCol) {
      labelCol = dataToChart.columns.find(col => col !== 'workid' && col !== numericCol) || dataToChart.columns[0];
    }

    if (!numericCol) {
      return (
        <div style={{ padding: '20px', color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center' }}>
          No numeric columns found in query results to chart. Displaying table view instead.
        </div>
      );
    }

    const filteredRows = filterRows(dataToChart.rows, filterQuery);

    const chartData = filteredRows.slice(0, 10);
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
                  setMessages([
                    { sender: 'bot', text: 'Hello! I am your secure SQL Data Assistant. Ask me any custom queries here, or use the quick report cards on the main page!' },
                    { sender: 'user', text: item.user_query },
                    {
                      sender: 'bot',
                      text: item.summary,
                      results: {
                        sql: item.sql_query,
                        columns: item.columns || [],
                        rows: item.rows || [],
                        summary: item.summary || ''
                      }
                    }
                  ]);
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
            {/* Conversations & Results */}
            <div className="chat-message-row" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {messages.map((msg, index) => (
                <React.Fragment key={index}>
                  {msg.sender === 'user' ? (
                    <div className="chat-bubble user" style={{ alignSelf: 'flex-end', background: 'var(--grad-cyan-violet)', color: 'white', borderBottomRightRadius: '2px', padding: '14px 20px', borderRadius: '16px', fontSize: '14px', maxWidth: '85%' }}>
                      {msg.text}
                    </div>
                  ) : (
                    msg.results ? (
                      <div className="bot-notebook-response" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {/* 1. SQLite Code block */}
                        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '20px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>SQLite Code</span>
                            <span style={{ fontSize: '9px', color: 'var(--accent-cyan)', background: 'rgba(75, 86, 148, 0.2)', padding: '2px 6px', borderRadius: '4px', fontWeight: '600' }}>
                              Sandbox Verified
                            </span>
                          </div>
                          <div className="sql-block" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                            {msg.results.sql}
                          </div>
                        </div>

                        {/* 2. Data Output table/chart */}
                        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '20px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>Data Output</span>
                              {msg.results.rows.length > 0 && (
                                <span style={{ fontSize: '10px', color: 'var(--accent-cyan)', background: 'rgba(6, 182, 212, 0.1)', padding: '2px 8px', borderRadius: '4px', fontWeight: '600' }}>
                                  All Rows Fetched: {msg.results.rows.length}
                                </span>
                              )}
                            </div>
                            
                            {msg.results.rows.length > 0 && (
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '6px', padding: '2px', display: 'flex', border: '1px solid var(--border-light)' }}>
                                  <button 
                                    onClick={() => {
                                      setMessages(prev => prev.map((m, idx) => idx === index ? { ...m, viewMode: 'table' } : m));
                                    }}
                                    style={{ 
                                      background: (msg.viewMode || 'table') === 'table' ? 'var(--grad-cyan-violet)' : 'transparent',
                                      border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', color: 'white', cursor: 'pointer', fontWeight: '500' 
                                    }}
                                  >
                                    Table
                                  </button>
                                  <button 
                                    onClick={() => {
                                      setMessages(prev => prev.map((m, idx) => idx === index ? { ...m, viewMode: 'chart' } : m));
                                    }}
                                    style={{ 
                                      background: msg.viewMode === 'chart' ? 'var(--grad-cyan-violet)' : 'transparent',
                                      border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', color: 'white', cursor: 'pointer', fontWeight: '500' 
                                    }}
                                  >
                                    Chart
                                  </button>
                                </div>

                                <button 
                                  onClick={() => handleExportCSV(msg.results)} 
                                  style={{ 
                                    background: 'transparent', border: '1px solid var(--accent-cyan)', color: 'var(--accent-cyan)',
                                    borderRadius: '6px', padding: '4px 10px', fontSize: '10px', cursor: 'pointer', fontWeight: '600'
                                  }}
                                >
                                  Export CSV
                                </button>

                                <input 
                                  type="text"
                                  placeholder="Search results..."
                                  value={msg.tableSearch || ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setMessages(prev => prev.map((m, idx) => idx === index ? { ...m, tableSearch: val } : m));
                                  }}
                                  style={{
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    border: '1px solid var(--border-light)',
                                    borderRadius: '6px',
                                    padding: '4px 10px',
                                    fontSize: '10px',
                                    color: 'var(--text-primary)',
                                    outline: 'none',
                                    width: '150px',
                                    transition: 'border-color 0.2s'
                                  }}
                                />
                              </div>
                            )}
                          </div>

                          {msg.results.rows.length === 0 ? (
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No data records to display.</p>
                          ) : (
                            (msg.viewMode || 'table') === 'table' ? (() => {
                              const activeRows = filterRows(msg.results.rows, msg.tableSearch);
                              const colSums = {};
                              let hasNumericCol = false;
                              msg.results.columns.forEach(col => {
                                const cleanCol = col.toLowerCase();
                                const isNumeric = ['cost', 'expenditure', 'outlay', 'throwforward', 'balance'].some(k => cleanCol.includes(k)) || cleanCol === 'total_future_cost' || cleanCol === 'total_cost';
                                if (isNumeric) {
                                  hasNumericCol = true;
                                  const sum = activeRows.reduce((acc, row) => {
                                    const val = parseFloat(row[col]);
                                    return acc + (isNaN(val) ? 0 : val);
                                  }, 0);
                                  colSums[col] = sum;
                                } else {
                                  colSums[col] = null;
                                }
                              });
                              return (
                                <div className="table-wrapper" style={{ maxHeight: '350px' }}>
                                  <table>
                                    <thead>
                                      <tr>
                                        {msg.results.columns.map((col) => (
                                          <th key={col}>{col}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {activeRows.map((row, rIdx) => (
                                        <tr key={rIdx}>
                                          {msg.results.columns.map((col) => (
                                            <td key={col}>{String(row[col] ?? '')}</td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                    {hasNumericCol && (
                                      <tfoot style={{ borderTop: '2.5px solid var(--border-light)', fontWeight: 'bold', background: 'rgba(255,255,255,0.02)' }}>
                                        <tr>
                                          {msg.results.columns.map((col, idx) => (
                                            <td key={col} style={{ color: colSums[col] !== null ? 'var(--accent-cyan)' : 'var(--text-muted)', padding: '10px 8px' }}>
                                              {idx === 0 ? 'Total' : (colSums[col] !== null ? colSums[col].toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '')}
                                            </td>
                                          ))}
                                        </tr>
                                      </tfoot>
                                    )}
                                  </table>
                                </div>
                              );
                            })() : (
                              renderSVGChart(msg.results, msg.tableSearch)
                            )
                          )}
                        </div>

                        {/* 3. IRPSM Summary */}
                        <div className="chat-bubble bot" style={{ maxWidth: '100%', alignSelf: 'stretch', background: 'rgba(75, 86, 148, 0.15)', border: '1px solid var(--border-light)', borderBottomLeftRadius: '2px', padding: '14px 20px', borderRadius: '16px', fontSize: '14px' }}>
                          <div style={{ fontSize: '10px', color: 'var(--accent-cyan)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>IRPSM Summary</div>
                          <div style={{ color: 'var(--text-primary)', lineHeight: '1.6' }}>{renderMarkdown(msg.results.summary)}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="chat-bubble bot" style={{ alignSelf: 'flex-start', background: 'rgba(75, 86, 148, 0.15)', border: '1px solid var(--border-light)', borderBottomLeftRadius: '2px', padding: '14px 20px', borderRadius: '16px', fontSize: '14px', maxWidth: '85%' }}>
                        {msg.text}
                      </div>
                    )
                  )}
                </React.Fragment>
              ))}
              {loading && (
                <div className="chat-bubble bot" style={{ alignSelf: 'flex-start', background: 'rgba(75, 86, 148, 0.15)', border: '1px solid var(--border-light)', borderBottomLeftRadius: '2px', padding: '14px 20px', borderRadius: '16px', fontSize: '14px', maxWidth: '85%' }}>
                  Generating secure query...
                </div>
              )}
            </div>
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
          
          {/* Card 1: Wide Project Progress Dashboard (span 2 columns) */}
          <div className="portal-card col-span-2">
            <div className="card-title" style={{ borderBottom: 'none', paddingBottom: '0px' }}>
              Railway Projects Dashboard
            </div>
            
            {/* Unified Shared Filters Row */}
            <div className="filters-row">
              <div className="filter-group">
                <label className="filter-label">Choose State</label>
                <select 
                  className="form-select"
                  value={filterState}
                  onChange={(e) => setFilterState(e.target.value)}
                >
                  <option value="All">All States</option>
                  {statesList.map(st => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>
              <div className="filter-group">
                <label className="filter-label">Choose District</label>
                <select 
                  className="form-select"
                  value={filterDistrict}
                  onChange={(e) => setFilterDistrict(e.target.value)}
                >
                  <option value="All">All Districts</option>
                  {districtsList.map(dist => (
                    <option key={dist} value={dist}>{dist}</option>
                  ))}
                </select>
              </div>
              <div className="filter-group">
                <label className="filter-label">Min Progress Filter</label>
                <select 
                  className="form-select"
                  value={progressThreshold}
                  onChange={(e) => setProgressThreshold(e.target.value)}
                >
                  <option value="All">Show All (No filter)</option>
                  <option value="50">Above 50% Progress</option>
                  <option value="70">Above 70% Progress</option>
                  <option value="80">Above 80% Progress</option>
                  <option value="90">Above 90% Progress</option>
                </select>
              </div>
            </div>

            {/* Dashboard Tabs Header */}
            <div className="card-tabs">
              <button 
                className={`card-tab ${activeReportTab === 'financial' ? 'active' : ''}`}
                onClick={() => setActiveReportTab('financial')}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Financial Progress
              </button>
              <button 
                className={`card-tab ${activeReportTab === 'physical' ? 'active' : ''}`}
                onClick={() => setActiveReportTab('physical')}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Physical Progress
              </button>
              <button 
                className={`card-tab ${activeReportTab === 'clearance' ? 'active' : ''}`}
                onClick={() => setActiveReportTab('clearance')}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Clearance Status
              </button>
              <button 
                className={`card-tab ${activeReportTab === 'tenders' ? 'active' : ''}`}
                onClick={() => setActiveReportTab('tenders')}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Tenders & Awards
              </button>
              <button 
                className={`card-tab ${activeReportTab === 'planhead' ? 'active' : ''}`}
                onClick={() => setActiveReportTab('planhead')}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Plan Head Summary
              </button>
            </div>
            
            {/* Active Tab Panel Content */}
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {activeReportTab === 'financial' && (
                <>
                  <p className="card-desc">
                    Generates a budget, expenditure, and calculated financial progress percentage report for the selected state and district.
                  </p>
                  <button className="btn-card-action" onClick={triggerFinancialReport} disabled={loading} style={{ marginTop: 'auto' }}>
                    Generate Financial Report
                  </button>
                </>
              )}
              {activeReportTab === 'physical' && (
                <>
                  <p className="card-desc">
                    Generates physical progress metrics, short names of works, status flags, and division alignments for the selected state and district.
                  </p>
                  <button className="btn-card-action" onClick={triggerPhysicalReport} disabled={loading} style={{ marginTop: 'auto' }}>
                    Generate Physical Report
                  </button>
                </>
              )}
              {activeReportTab === 'clearance' && (
                <>
                  <p className="card-desc">
                    Extracts land acquisition status, environmental clearances, and forest clearance status comments from project remarks.
                  </p>
                  <button className="btn-card-action" onClick={triggerClearanceReport} disabled={loading} style={{ marginTop: 'auto' }}>
                    Generate Clearance Status Report
                  </button>
                </>
              )}
              {activeReportTab === 'tenders' && (
                <>
                  <p className="card-desc">
                    Provides key procurement metrics including tender status, scopes, invited values, and awarded project values.
                  </p>
                  <button className="btn-card-action" onClick={triggerTenderReport} disabled={loading} style={{ marginTop: 'auto' }}>
                    Generate Tenders & Awards Report
                  </button>
                </>
              )}
              {activeReportTab === 'planhead' && (
                <>
                  <p className="card-desc">
                    Summarizes project counts and aggregate current costs grouped by railway Plan Head (e.g. Doubling, New Lines).
                  </p>
                  <button className="btn-card-action" onClick={triggerPlanHeadReport} disabled={loading} style={{ marginTop: 'auto' }}>
                    Generate Plan Head Summary
                  </button>
                </>
              )}
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
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <input 
                  type="text"
                  placeholder="Search last run results..."
                  value={resultsSearch}
                  onChange={(e) => setResultsSearch(e.target.value)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-light)',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontSize: '11px',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    width: '200px',
                    transition: 'border-color 0.2s'
                  }}
                />
                <button 
                  onClick={() => setView('chat')} 
                  style={{ 
                    background: 'var(--grad-cyan-violet)', border: 'none', color: 'white',
                    borderRadius: '6px', padding: '6px 12px', fontSize: '10px', fontWeight: '600', cursor: 'pointer' 
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
              <h4 style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Data Output
                {activeResult.rows.length > 0 && (
                  <span style={{ fontSize: '10px', color: 'var(--accent-cyan)', background: 'rgba(6, 182, 212, 0.1)', padding: '2px 8px', borderRadius: '4px', fontWeight: '600' }}>
                    All Rows Fetched: {activeResult.rows.length}
                  </span>
                )}
              </h4>
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
                      {filterRows(activeResult.rows, resultsSearch)
                        .slice(0, 5)
                        .map((row, rIdx) => (
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
              <div>{renderMarkdown(activeResult.summary)}</div>
            </div>

          </section>
        )}

      </main>
    </div>
  );
}

export default App;