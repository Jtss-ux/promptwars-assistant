document.addEventListener('DOMContentLoaded', () => {
    const chatContainer = document.getElementById('chat-container');
    const userInput = document.getElementById('user-input');
    const githubInput = document.getElementById('github-url');
    const sendBtn = document.getElementById('send-btn');
    const contextSelector = document.getElementById('context-selector');
    const exportBtn = document.getElementById('export-history-btn');

    let chatHistory = []; // For local CSV export

    // Create typing indicator element
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'typing-indicator message system';
    typingIndicator.setAttribute('role', 'status');
    typingIndicator.innerHTML = '<div class="avatar" aria-hidden="true">⚡</div><div class="bubble" style="display:flex;align-items:center;gap:6px;height:35px;"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
    
    function appendMessage(sender, text, isMarkdown = false) {
        chatHistory.push({ sender, text, timestamp: new Date().toISOString() });

        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}`;
        msgDiv.setAttribute('role', 'article');
        
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = sender === 'user' ? 'U' : '⚡';

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.setAttribute('tabindex', '0'); // focusable for screen readers
        
        if (isMarkdown) {
            bubble.innerHTML = marked.parse(text);
            bubble.querySelectorAll('pre code').forEach((block) => {
                if (window.hljs) hljs.highlightElement(block);
            });
            
            // Add Export button to System AI replies
            if (sender === 'system') {
                const exportBtn = document.createElement('button');
                exportBtn.className = 'export-btn';
                exportBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export (.md)';
                exportBtn.onclick = () => {
                    const blob = new Blob([text], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `LogicFlow-Review-${Date.now()}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                };
                msgDiv.appendChild(exportBtn);
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

    function scrollToBottom() {
        // slightly delayed to allow DOM changes
        setTimeout(() => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }, 50);
    }

    function getRawGithubUrl(url) {
        if (!url.includes('github.com')) return url;
        return url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
    }

    async function sendMessage() {
        const text = userInput.value.trim();
        const githubUrl = githubInput.value.trim();
        if (!text && !githubUrl) return; // Prevent empty sends
        
        const context = contextSelector.value;
        
        let displayMessage = text;
        if (githubUrl) displayMessage += `\n[Attached GitHub File: ${githubUrl}]`;
        appendMessage('user', displayMessage);
        
        userInput.value = '';
        githubInput.value = '';
        
        chatContainer.appendChild(typingIndicator);
        typingIndicator.classList.add('active');
        scrollToBottom();

        let githubCode = '';
        if (githubUrl) {
            try {
                const rawUrl = getRawGithubUrl(githubUrl);
                const codeRes = await fetch(rawUrl);
                if (codeRes.ok) {
                    githubCode = await codeRes.text();
                } else {
                    console.warn("Failed to fetch Github Raw URL.");
                }
            } catch (e) {
                console.error("Github Fetch Error:", e);
            }
        }

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text || "Please review the attached code.", context, githubCode })
            });
            
            const data = await response.json();
            typingIndicator.classList.remove('active');
            if (typingIndicator.parentNode) {
                chatContainer.removeChild(typingIndicator);
            }
            
            if (data.reply) {
                appendMessage('system', data.reply, true);
            } else {
                appendMessage('system', 'Sorry, I encountered an error and could not generate a response.');
            }
        } catch (err) {
            console.error(err);
            typingIndicator.classList.remove('active');
            if (typingIndicator.parentNode) {
                chatContainer.removeChild(typingIndicator);
            }
            appendMessage('system', 'Error connecting to the server. Please ensure the backend is running.');
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    githubInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // CSV Export Logic
    exportBtn.addEventListener('click', () => {
        if (chatHistory.length === 0) return alert("Chat history is empty.");
        const header = "Timestamp,Sender,Message\n";
        const csvContent = chatHistory.map(row => {
            const escapedText = row.text.replace(/"/g, '""');
            return `"${row.timestamp}","${row.sender}","${escapedText}"`;
        }).join("\n");
        const blob = new Blob([header + csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `LogicFlow-History-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });
});
