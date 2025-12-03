document.addEventListener('DOMContentLoaded', () => {
    const submitBtn = document.getElementById('submit-btn');
    const queryInput = document.getElementById('query-input');
    const queryLabel = document.querySelector('label[for="query-input"]');
    const loading = document.getElementById('loading');
    const responseContainer = document.getElementById('response-container');
    const responseText = document.getElementById('response-text');
    const responseContent = document.querySelector('.response-content');
    const confidenceDisplay = document.getElementById('confidence-display');
    const confidenceValue = document.getElementById('confidence-value');

    // Conversation state for follow-up questions
    let isAwaitingFollowUp = false;
    let previousQuery = null;
    const defaultPlaceholder = "Describe where you are and what you've done...";
    const followUpPlaceholder = "Type your answer here...";
    const defaultLabelText = "What are you stuck on?";

    submitBtn.addEventListener('click', async () => {
        const query = queryInput.value.trim();
        if (!query) return;

        // Reset UI
        responseContainer.classList.add('hidden');
        loading.classList.remove('hidden');
        submitBtn.disabled = true;

        // Build request body - include follow-up context if applicable
        const requestBody = { query };
        if (isAwaitingFollowUp && previousQuery) {
            requestBody.isFollowUp = true;
            requestBody.previousQuery = previousQuery;
        }

        try {
            const response = await fetch('/api/hint', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();

            loading.classList.add('hidden');
            responseContainer.classList.remove('hidden');
            submitBtn.disabled = false;

            // Update debug info in confidence display
            const debugQuestId = document.getElementById('debug-quest-id');
            const debugStep = document.getElementById('debug-step');
            
            debugQuestId.textContent = data.quest_id !== null ? data.quest_id : 'null';
            debugStep.textContent = data.current_step !== null ? data.current_step : 'null';

            if (data.error) {
                responseText.textContent = `Error: ${data.error}`;
                confidenceDisplay.classList.add('hidden');
                // Reset follow-up state on error
                isAwaitingFollowUp = false;
                previousQuery = null;
                queryInput.placeholder = defaultPlaceholder;
                queryInput.classList.remove('awaiting-followup');
                queryLabel.textContent = defaultLabelText;
                queryLabel.classList.remove('followup-question');
                responseContent.classList.remove('question');
                return;
            }

            // Handle response type (question vs hint)
            const isQuestion = data.type === 'question';
            
            if (isQuestion) {
                // Enter follow-up mode
                isAwaitingFollowUp = true;
                previousQuery = query;
                queryInput.placeholder = followUpPlaceholder;
                queryInput.classList.add('awaiting-followup');
                queryLabel.textContent = data.response;
                queryLabel.classList.add('followup-question');
                responseContent.classList.add('question');
            } else {
                // Exit follow-up mode
                isAwaitingFollowUp = false;
                previousQuery = null;
                queryInput.placeholder = defaultPlaceholder;
                queryInput.classList.remove('awaiting-followup');
                queryLabel.textContent = defaultLabelText;
                queryLabel.classList.remove('followup-question');
                responseContent.classList.remove('question');
            }

            // Clear input after successful submission
            queryInput.value = '';

            // Process the text for the deciphering effect
            const text = data.response;
            responseText.innerHTML = ''; // Clear previous content
            
            const spanElements = [];
            
            // Split text into words and spaces, keeping spaces as separators
            const tokens = text.split(/(\s+)/);
            
            tokens.forEach(token => {
                if (token.match(/^\s+$/)) {
                    // It's whitespace - add as text node to allow natural wrapping
                    responseText.appendChild(document.createTextNode(token));
                } else if (token.length > 0) {
                    // It's a word - wrap in a span with nowrap to keep it together
                    const wordSpan = document.createElement('span');
                    wordSpan.className = 'word-wrap';
                    
                    // Create character spans inside the word span
                    token.split('').forEach(char => {
                        const charSpan = document.createElement('span');
                        charSpan.textContent = char;
                        charSpan.className = 'glyph-char';
                        wordSpan.appendChild(charSpan);
                        spanElements.push(charSpan);
                    });
                    
                    responseText.appendChild(wordSpan);
                }
            });
            
            // Animate the deciphering
            const totalDuration = 2000; // 2 seconds - adjust this to change deciphering speed
            const totalChars = spanElements.length;
            
            // Create a shuffled array of indices
            const indices = Array.from({ length: totalChars }, (_, i) => i);
            for (let i = indices.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [indices[i], indices[j]] = [indices[j], indices[i]];
            }
            
            // Reveal characters one by one based on the shuffled indices
            indices.forEach((index, i) => {
                // Calculate delay for this specific character
                // Using a non-linear curve can make it look more organic (mostly done by 2/3rds of time)
                const progress = i / totalChars;
                const delay = progress * totalDuration; 
                
                setTimeout(() => {
                    const span = spanElements[index];
                    span.className = 'pixel-char';
                    // Optional: add a brief "flash" or color change here if desired
                }, delay);
            });
            
            if (data.confidence) {
                confidenceValue.textContent = data.confidence;
                confidenceDisplay.classList.remove('hidden');
            } else {
                // Show confidence display even without confidence value if we have debug info
                if (data.quest_id !== null || data.current_step !== null) {
                    confidenceDisplay.classList.remove('hidden');
                } else {
                    confidenceDisplay.classList.add('hidden');
                }
            }

        } catch (error) {
            console.error('Error:', error);
            loading.classList.add('hidden');
            responseContainer.classList.remove('hidden');
            responseText.textContent = "The gods are silent (Network Error).";
            submitBtn.disabled = false;
            // Reset follow-up state on network error
            isAwaitingFollowUp = false;
            previousQuery = null;
            queryInput.placeholder = defaultPlaceholder;
            queryInput.classList.remove('awaiting-followup');
            queryLabel.textContent = defaultLabelText;
            queryLabel.classList.remove('followup-question');
            responseContent.classList.remove('question');
        }
    });

    // Allow Enter key to submit
    queryInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitBtn.click();
        }
    });
});

