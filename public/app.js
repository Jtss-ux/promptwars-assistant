document.addEventListener('DOMContentLoaded', () => {
    const chatContainer = document.getElementById('chat-container');
    const userInput = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const contextSelector = document.getElementById('context-selector');

    // Create typing indicator element
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'typing-indicator message system';
    typingIndicator.innerHTML = '<div class="avatar">⚡</div><div class="bubble" style="display:flex;align-items:center;gap:6px;height:35px;"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
    
    function appendMessage(sender, text, isMarkdown = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}`;
        
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = sender === 'user' ? 'U' : '⚡';

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        
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

    async function sendMessage() {
        const text = userInput.value.trim();
        if (!text) return;
        
        const context = contextSelector.value;
        
        appendMessage('user', text);
        userInput.value = '';
        
        chatContainer.appendChild(typingIndicator);
        typingIndicator.classList.add('active');
        scrollToBottom();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, context })
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
});
