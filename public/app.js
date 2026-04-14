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
