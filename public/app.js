/**
 * @fileoverview LogicFlow: Code Review Assistant — Client-side Application Logic.
 *
 * Manages the chat UI, session persistence (via localStorage), keyboard
 * shortcuts, accessibility announcements, and the sidebar dashboard
 * (recent chats, tasks, agent log).
 *
 * @module app
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  // ── DOM References ──────────────────────────────────────────────────────

  /** @type {HTMLElement} */ const chatContainer = document.getElementById('chat-container');
  /** @type {HTMLInputElement} */ const userInput = document.getElementById('user-input');
  /** @type {HTMLInputElement} */ const githubInput = document.getElementById('github-url');
  /** @type {HTMLButtonElement} */ const sendBtn = document.getElementById('send-btn');
  /** @type {HTMLSelectElement} */ const contextSelector = document.getElementById('context-selector');
  /** @type {HTMLButtonElement} */ const exportBtn = document.getElementById('export-history-btn');
  /** @type {HTMLElement} */ const agentLogConsole = document.getElementById('agent-log-console');
  /** @type {HTMLElement} */ const recentChatsList = document.getElementById('recent-chats-list');
  /** @type {HTMLElement} */ const tasksHeader = document.getElementById('tasks-header');
  /** @type {HTMLButtonElement} */ const sidebarToggle = document.getElementById('sidebar-toggle');
  /** @type {HTMLElement} */ const layoutWrapper = document.getElementById('layout-wrapper');
  /** @type {HTMLElement} */ const mainSidebar = document.getElementById('main-sidebar');
  /** @type {HTMLButtonElement} */ const newChatBtn = document.getElementById('new-chat-btn');
  /** @type {HTMLElement} */ const srAnnouncer = document.getElementById('sr-announcer');
  /** @type {HTMLElement} */ const charCount = document.getElementById('char-count');

  // ── State ───────────────────────────────────────────────────────────────

  /** @type {Array<{sender: string, text: string, timestamp: string}>} */
  let chatHistory = [];
  let activeTasks = 0;
  let currentSessionId = Date.now().toString();

  const MAX_MESSAGE_LENGTH = 5000;
  const MAX_RECENT_SESSIONS = 10;
  const LOCAL_STORAGE_KEY = 'lf_recent_chats';

  // ── Accessibility Helpers ───────────────────────────────────────────────

  /**
   * Announce a message to screen readers via the live region.
   * @param {string} msg - The message to announce.
   */
  function announce(msg) {
    if (!srAnnouncer) return;
    srAnnouncer.textContent = '';
    requestAnimationFrame(() => { srAnnouncer.textContent = msg; });
  }

  // ── Character Counter ───────────────────────────────────────────────────

  if (userInput && charCount) {
    userInput.addEventListener('input', () => {
      const len = userInput.value.length;
      charCount.textContent = `${len} / ${MAX_MESSAGE_LENGTH}`;
      charCount.classList.toggle('over-limit', len > MAX_MESSAGE_LENGTH);
    });
  }

  // ── Agent Log Utilities ─────────────────────────────────────────────────

  /**
   * Append a timestamped entry to the Agent Log console.
   * @param {string} msg - Log message.
   */
  function addAgentLog(msg) {
    if (!agentLogConsole) return;
    const entry = document.createElement('div');
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    entry.textContent = `[${time}] > ${msg}`;
    agentLogConsole.appendChild(entry);
    agentLogConsole.scrollTop = agentLogConsole.scrollHeight;
  }

  /** @type {HTMLElement | null} In-place stats widget in the Agent Log. */
  let statsEntry = null;

  /**
   * Update the token usage statistics widget in the Agent Log.
   * @param {string} elapsed       - Request latency in seconds.
   * @param {number} promptTokens  - Number of prompt tokens consumed.
   * @param {number} outputTokens  - Number of output tokens generated.
   * @param {number} totalTokens   - Combined token count.
   */
  function updateAgentStats(elapsed, promptTokens, outputTokens, totalTokens) {
    if (!agentLogConsole) return;
    if (!statsEntry) {
      statsEntry = document.createElement('div');
      statsEntry.className = 'stats-widget';
      statsEntry.setAttribute('role', 'status');
      statsEntry.setAttribute('aria-label', 'Token usage statistics');
      agentLogConsole.appendChild(statsEntry);
    }
    statsEntry.innerHTML =
      `<span class="stat-time">⏱ ${elapsed}s</span> ` +
      `<span class="stat-in">↑ ${promptTokens} in</span> ` +
      `<span class="stat-out">↓ ${outputTokens} out</span> ` +
      `<span class="stat-total">∑ ${totalTokens} total</span>`;
    agentLogConsole.scrollTop = agentLogConsole.scrollHeight;
  }

  // ── Task Counter ────────────────────────────────────────────────────────

  /**
   * Increment or decrement the active task counter and update the UI.
   * @param {number} delta - +1 to add a task, -1 to mark complete.
   */
  function setTaskCount(delta) {
    activeTasks = Math.max(0, activeTasks + delta);
    if (tasksHeader) tasksHeader.textContent = `Tasks (${activeTasks})`;

    const tasksList = document.getElementById('tasks-list');
    if (!tasksList) return;

    if (activeTasks > 0) {
      tasksList.innerHTML = '<li role="listitem">Generating AI review… <span class="task-active-dot" aria-hidden="true">●</span></li>';
    } else {
      tasksList.innerHTML = '<li class="empty-state" role="listitem">No active tasks</li>';
    }
  }

  // ── Session Persistence (localStorage) ──────────────────────────────────

  /**
   * Save or update the current chat session in localStorage.
   * @param {string} [firstMessageSnippet] - Preview text for new sessions.
   */
  function saveRecentChat(firstMessageSnippet) {
    let recent = [];
    try {
      recent = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
    } catch { /* corrupted data — reset */ }

    const sessionIndex = recent.findIndex((s) => s.id === currentSessionId);

    if (sessionIndex > -1) {
      recent[sessionIndex].history = chatHistory;
      recent[sessionIndex].ts = Date.now();
      if (statsEntry) recent[sessionIndex].lastStats = statsEntry.innerHTML;
    } else if (firstMessageSnippet) {
      const snippet = firstMessageSnippet.length > 50
        ? firstMessageSnippet.slice(0, 50) + '…'
        : firstMessageSnippet;
      recent.unshift({
        id: currentSessionId,
        text: snippet,
        ts: Date.now(),
        history: chatHistory,
        lastStats: statsEntry ? statsEntry.innerHTML : null,
      });
    }

    recent = recent.slice(0, MAX_RECENT_SESSIONS);

    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(recent));
    } catch { /* quota exceeded — silently fail */ }

    renderRecentChats();
  }

  /**
   * Load a saved session from localStorage and restore the chat UI.
   * @param {string} id - Unique session identifier.
   */
  function loadSession(id) {
    let recent = [];
    try {
      recent = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
    } catch { return; }

    const session = recent.find((s) => s.id === id);
    if (!session) return;

    currentSessionId = id;
    chatContainer.innerHTML = '';
    chatHistory = [];
    statsEntry = null;
    if (agentLogConsole) agentLogConsole.innerHTML = '<div>> Session restored.</div>';

    session.history.forEach((msg) => {
      appendMessage(msg.sender, msg.text, msg.sender === 'system');
    });

    if (session.lastStats && agentLogConsole) {
      statsEntry = document.createElement('div');
      statsEntry.className = 'stats-widget';
      statsEntry.setAttribute('role', 'status');
      statsEntry.innerHTML = session.lastStats;
      agentLogConsole.appendChild(statsEntry);
    }

    addAgentLog(`Restored chat: "${session.text}"`);
    renderRecentChats();
    announce('Chat session restored.');
  }

  /**
   * Render the "Recent Chats" list in the sidebar from localStorage.
   */
  function renderRecentChats() {
    if (!recentChatsList) return;

    let recent = [];
    try {
      recent = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
    } catch { /* ignore */ }

    if (recent.length === 0) {
      recentChatsList.innerHTML = '<li class="empty-state" role="listitem">No conversations yet</li>';
      return;
    }

    recentChatsList.innerHTML = recent.map((r) => {
      const isActive = r.id === currentSessionId ? 'active-session' : '';
      const safeText = escapeHtml(r.text);
      return `<li class="${isActive}" data-id="${r.id}" title="${safeText}" role="listitem" tabindex="0">${safeText}</li>`;
    }).join('');

    recentChatsList.querySelectorAll('li[data-id]').forEach((li) => {
      const handler = () => {
        const sid = li.getAttribute('data-id');
        if (sid !== currentSessionId) loadSession(sid);
      };
      li.addEventListener('click', handler);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') handler(); });
    });
  }

  // ── Hydrate on Load ─────────────────────────────────────────────────────

  let recent = [];
  try { recent = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch { /* ignore */ }

  if (recent.length > 0) {
    loadSession(recent[0].id);
  } else {
    renderRecentChats();
  }

  // ── Typing Indicator ────────────────────────────────────────────────────

  const typingIndicator = document.createElement('div');
  typingIndicator.className = 'typing-indicator message system';
  typingIndicator.setAttribute('role', 'status');
  typingIndicator.setAttribute('aria-label', 'LogicFlow is thinking');
  typingIndicator.innerHTML =
    '<div class="avatar" aria-hidden="true">⚡</div>' +
    '<div class="bubble" style="display:flex;align-items:center;gap:6px;height:35px;">' +
    '<div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';

  // ── Message Rendering ───────────────────────────────────────────────────

  /**
   * Escape HTML entities in a string to prevent injection in innerHTML.
   * @param {string} str - Raw string.
   * @returns {string} Escaped string safe for innerHTML.
   */
  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Append a chat message bubble to the conversation container.
   *
   * @param {'user' | 'system'} sender - Who sent the message.
   * @param {string} text              - Message content (plain or Markdown).
   * @param {boolean} [isMarkdown=false] - If true, render as Markdown/HTML.
   */
  function appendMessage(sender, text, isMarkdown = false) {
    chatHistory.push({ sender, text, timestamp: new Date().toISOString() });

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${sender}`;
    msgDiv.setAttribute('role', 'article');
    msgDiv.setAttribute('aria-label', `${sender === 'user' ? 'Your' : 'LogicFlow'} message`);

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = sender === 'user' ? 'U' : '⚡';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.setAttribute('tabindex', '0');

    if (isMarkdown && typeof marked !== 'undefined') {
      bubble.innerHTML = marked.parse(text);

      // Syntax highlighting & copy buttons for code blocks
      bubble.querySelectorAll('pre').forEach((pre) => {
        const codeBlock = pre.querySelector('code');
        if (codeBlock && window.hljs) hljs.highlightElement(codeBlock);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-code-btn';
        copyBtn.setAttribute('aria-label', 'Copy code to clipboard');
        copyBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy';

        copyBtn.addEventListener('click', () => {
          const code = codeBlock ? codeBlock.innerText : pre.innerText;
          navigator.clipboard.writeText(code).then(() => {
            copyBtn.textContent = '✓ Copied!';
            announce('Code copied to clipboard.');
            setTimeout(() => { copyBtn.innerHTML = 'Copy'; }, 2000);
          });
        });

        pre.style.position = 'relative';
        pre.appendChild(copyBtn);
      });

      // Export per-message button for AI responses
      if (sender === 'system') {
        const exportMsgBtn = document.createElement('button');
        exportMsgBtn.className = 'export-btn';
        exportMsgBtn.setAttribute('aria-label', 'Export this response as Markdown file');
        exportMsgBtn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export (.md)';

        exportMsgBtn.addEventListener('click', () => {
          const blob = new Blob([text], { type: 'text/markdown' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `LogicFlow-Review-${Date.now()}.md`;
          a.click();
          URL.revokeObjectURL(url);
          announce('Response exported as Markdown.');
        });
        msgDiv.appendChild(exportMsgBtn);
      }
    } else {
      bubble.textContent = text;
    }

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);

    if (typingIndicator.parentNode) {
      chatContainer.insertBefore(msgDiv, typingIndicator);
    } else {
      chatContainer.appendChild(msgDiv);
    }

    scrollToBottom();
  }

  /**
   * Smoothly scroll the chat container to the newest message.
   */
  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    });
  }

  // ── GitHub URL Handling ─────────────────────────────────────────────────

  /**
   * Convert a standard GitHub blob URL to the raw content URL.
   * @param {string} url - GitHub file URL.
   * @returns {string} Raw content URL.
   */
  function getRawGithubUrl(url) {
    if (!url.includes('github.com')) return url;
    return url
      .replace('github.com', 'raw.githubusercontent.com')
      .replace('/blob/', '/');
  }

  // ── Send Message ────────────────────────────────────────────────────────

  /**
   * Handle sending a chat message — validates input, fetches any GitHub
   * code, calls the backend API, and renders the AI response.
   */
  async function sendMessage() {
    const text = userInput.value.trim();
    const githubUrl = githubInput.value.trim();

    if (!text && !githubUrl) return;

    if (text.length > MAX_MESSAGE_LENGTH) {
      announce(`Message exceeds ${MAX_MESSAGE_LENGTH} character limit.`);
      return;
    }

    const context = contextSelector.value;

    let displayMessage = text;
    if (githubUrl) displayMessage += `\n[Attached GitHub File: ${githubUrl}]`;
    appendMessage('user', displayMessage);
    saveRecentChat(text || githubUrl);

    userInput.value = '';
    githubInput.value = '';
    if (charCount) charCount.textContent = `0 / ${MAX_MESSAGE_LENGTH}`;

    chatContainer.appendChild(typingIndicator);
    typingIndicator.classList.add('active');
    scrollToBottom();
    setTaskCount(+1);
    addAgentLog(`Context: ${context}`);
    announce('Sending message to LogicFlow…');

    // ── Fetch GitHub Code (if provided) ─────────────────────────────────
    let githubCode = '';
    if (githubUrl) {
      // Validate: must be a link to a specific file, not a repo root
      if (githubUrl.includes('github.com') && !githubUrl.includes('/blob/')) {
        appendMessage('system',
          '⚠️ **Notice:** Please provide a direct link to a specific file (e.g., `https://github.com/user/repo/blob/main/server.js`).', true);
        removeTypingIndicator();
        return;
      }

      try {
        addAgentLog('Fetching GitHub file…');
        const rawUrl = getRawGithubUrl(githubUrl);
        const codeRes = await fetch(rawUrl);

        if (codeRes.ok) {
          githubCode = await codeRes.text();
          addAgentLog(`File loaded (${(githubCode.length / 1024).toFixed(1)} KB).`);
        } else {
          appendMessage('system',
            `⚠️ **Notice:** Failed to fetch the GitHub file. Ensure the repository is public. (Status: ${codeRes.status})`, true);
          removeTypingIndicator();
          return;
        }
      } catch (e) {
        console.error('GitHub Fetch Error:', e);
        appendMessage('system', '⚠️ **Notice:** Network error while fetching the GitHub URL.', true);
        removeTypingIndicator();
        return;
      }
    }

    // ── Call Backend API ────────────────────────────────────────────────
    try {
      addAgentLog('Calling Gemini API…');

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text || 'Please review the attached code.',
          context,
          githubCode,
        }),
      });

      const data = await response.json();
      removeTypingIndicator();
      setTaskCount(-1);

      if (data.reply) {
        addAgentLog('Review complete.');
        if (data.stats) {
          updateAgentStats(
            data.stats.elapsed,
            data.stats.promptTokens,
            data.stats.outputTokens,
            data.stats.totalTokens,
          );
        }
        appendMessage('system', data.reply, true);
        saveRecentChat();
        announce('LogicFlow response received.');
      } else {
        addAgentLog('Error: No reply received.');
        appendMessage('system', 'Sorry, I encountered an error and could not generate a response.');
        announce('Error: No response from server.');
      }
    } catch (err) {
      console.error('API Error:', err);
      removeTypingIndicator();
      setTaskCount(-1);
      addAgentLog('Error: Server unreachable.');
      appendMessage('system', 'Error connecting to the server. Please ensure the backend is running.');
      announce('Error: Could not connect to server.');
    }
  }

  /**
   * Remove the typing indicator from the DOM.
   */
  function removeTypingIndicator() {
    typingIndicator.classList.remove('active');
    if (typingIndicator.parentNode) {
      chatContainer.removeChild(typingIndicator);
    }
  }

  // ── Event Listeners ─────────────────────────────────────────────────────

  sendBtn.addEventListener('click', sendMessage);

  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  githubInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  });

  // ── Keyboard Shortcut: Ctrl+/ to focus chat input ─────────────────────

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      userInput.focus();
      announce('Chat input focused.');
    }
  });

  // ── Sidebar Toggle ──────────────────────────────────────────────────────

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = layoutWrapper.classList.toggle('sidebar-open');
      sidebarToggle.setAttribute('aria-expanded', String(isOpen));
      announce(isOpen ? 'Sidebar opened.' : 'Sidebar closed.');
    });

    // Close sidebar on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && layoutWrapper.classList.contains('sidebar-open')) {
        layoutWrapper.classList.remove('sidebar-open');
        sidebarToggle.setAttribute('aria-expanded', 'false');
        sidebarToggle.focus();
        announce('Sidebar closed.');
      }
    });
  }

  // Close sidebar on click outside (mobile overlay)
  document.addEventListener('click', (e) => {
    if (layoutWrapper.classList.contains('sidebar-open')) {
      if (!mainSidebar.contains(e.target) && !sidebarToggle.contains(e.target)) {
        layoutWrapper.classList.remove('sidebar-open');
        sidebarToggle.setAttribute('aria-expanded', 'false');
      }
    }
  });

  // ── New Chat ────────────────────────────────────────────────────────────

  if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
      currentSessionId = Date.now().toString();
      chatContainer.innerHTML =
        '<div class="message system" role="article">' +
        '<div class="avatar" aria-hidden="true">⚡</div>' +
        '<div class="bubble" tabindex="0">New session started. How can I help you?</div></div>';
      chatHistory = [];
      statsEntry = null;
      if (agentLogConsole) agentLogConsole.innerHTML = '<div>> New session initialized.</div>';
      addAgentLog('Ready for new review.');
      renderRecentChats();
      announce('New chat session started.');

      if (layoutWrapper.classList.contains('sidebar-open')) {
        layoutWrapper.classList.remove('sidebar-open');
        sidebarToggle.setAttribute('aria-expanded', 'false');
      }

      userInput.focus();
    });
  }

  // ── CSV Export ───────────────────────────────────────────────────────────

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (chatHistory.length === 0) {
        announce('Chat history is empty. Nothing to export.');
        return;
      }

      const header = 'Timestamp,Sender,Message\n';
      const csvContent = chatHistory.map((row) => {
        const escapedText = row.text.replace(/"/g, '""');
        return `"${row.timestamp}","${row.sender}","${escapedText}"`;
      }).join('\n');

      const blob = new Blob([header + csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `LogicFlow-History-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      announce('Chat history exported as CSV.');
    });
  }
});
