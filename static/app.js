// --- State ---
let editor = null;
let currentFilename = "untitled.py";
let currentFilePath = null; // full path of loaded file
let chatHistory = [];
let settings = {};

// File browser state
let browseCurrentDir = "";
let browseMode = "load"; // "load" or "save"
let selectedFilePath = null;

// Track the last code the AI set, to detect user edits
let lastAICode = "";

// Tutor preferences (persisted in localStorage)
let ttsEnabled = localStorage.getItem("snippet_tts") === "true";
let chatFontSize = parseInt(localStorage.getItem("snippet_font_size")) || 14;

// --- Monaco Editor Setup ---
require.config({ paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs" } });
require(["vs/editor/editor.main"], function () {
    editor = monaco.editor.create(document.getElementById("editor-container"), {
        value: "# Start writing your Python script here\n",
        language: "python",
        theme: "vs-dark",
        fontFamily: "'Monaco', 'Menlo', 'Consolas', 'Courier New', monospace",
        fontSize: 14,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        padding: { top: 8 },
    });

});

// --- Load settings on start ---
let aiConnected = false;

function hasAcceptedTerms() {
    return localStorage.getItem("snippet_terms_accepted") === "true";
}

async function showTermsAcceptance() {
    chatMessages.innerHTML = "";

    // Load terms from external file
    let termsHtml = "";
    try {
        const res = await fetch("/static/terms.html");
        termsHtml = await res.text();
    } catch {
        termsHtml = "Terms could not be loaded. Please contact the administrator.";
    }

    const div = document.createElement("div");
    div.className = "chat-msg assistant";
    div.innerHTML = `<strong>Welcome to Snippet</strong><br><br>` +
        `Before you begin, please review and accept the terms of use.<br><br>` +
        `<div class="terms-box">${termsHtml}</div>`;
    chatMessages.appendChild(div);

    const btnDiv = document.createElement("div");
    btnDiv.className = "terms-accept-area";
    btnDiv.innerHTML = `<button id="btn-accept-terms" class="btn-accept-terms">I agree to these terms</button>`;
    chatMessages.appendChild(btnDiv);

    document.getElementById("btn-accept-terms").addEventListener("click", () => {
        localStorage.setItem("snippet_terms_accepted", "true");
        proceedAfterTerms();
    });
}

function showWelcomeMessage() {
    chatMessages.innerHTML = "";
    const div = document.createElement("div");
    div.className = "chat-msg assistant";
    div.innerHTML = `<strong>Welcome to the MakeCode Python Tutor!</strong><br><br>` +
        `To get started, you need to connect an AI provider:<br><br>` +
        `1. Click the <strong>Settings</strong> button in the top bar<br>` +
        `2. Choose a provider (Anthropic, OpenAI, or Azure)<br>` +
        `3. Paste your API key<br>` +
        `4. Click <strong>Test Connection</strong> to verify it works<br>` +
        `5. Click <strong>Save</strong> to connect<br><br>` +
        `Once connected, the green indicator will appear and your tutor session will begin automatically!`;
    chatMessages.appendChild(div);
}

async function proceedAfterTerms() {
    const res = await fetch("/api/settings");
    settings = await res.json();
    await checkExistingConnection();
    if (!aiConnected) {
        showWelcomeMessage();
    }
}

async function loadSettings() {
    if (!hasAcceptedTerms()) {
        showTermsAcceptance();
        return;
    }
    await proceedAfterTerms();
}
loadSettings();

// --- Chat ---
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const btnSend = document.getElementById("btn-send");

// Apply saved font size on load
function applyChatFontSize() {
    chatMessages.style.fontSize = chatFontSize + "px";
}
applyChatFontSize();

// --- Text-to-Speech (Edge-TTS via server) ---
var ttsAudio = null;
var ttsSpeakingEl = null;

async function speakText(text, msgEl) {
    if (!ttsEnabled) return;
    if (!text) return;

    // Stop any current playback and clear previous indicator
    if (ttsAudio) {
        ttsAudio.pause();
        ttsAudio.currentTime = 0;
    }
    if (ttsSpeakingEl) {
        ttsSpeakingEl.classList.remove("tts-loading", "tts-speaking");
    }

    // Show loading indicator on the message
    if (msgEl) {
        msgEl.classList.add("tts-loading");
        ttsSpeakingEl = msgEl;
    }

    try {
        var res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text }),
        });

        if (!res.ok) {
            if (msgEl) msgEl.classList.remove("tts-loading");
            return;
        }

        var blob = await res.blob();
        var url = URL.createObjectURL(blob);
        ttsAudio = new Audio(url);

        // Switch from loading to speaking animation
        if (msgEl) {
            msgEl.classList.remove("tts-loading");
            msgEl.classList.add("tts-speaking");
        }

        ttsAudio.play();
        ttsAudio.onended = function () {
            URL.revokeObjectURL(url);
            if (msgEl) msgEl.classList.remove("tts-speaking");
            ttsSpeakingEl = null;
        };
        ttsAudio.onerror = function () {
            if (msgEl) msgEl.classList.remove("tts-loading", "tts-speaking");
            ttsSpeakingEl = null;
        };
    } catch (e) {
        if (msgEl) msgEl.classList.remove("tts-loading", "tts-speaking");
        ttsSpeakingEl = null;
    }
}

function escapeHtml(text) {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
}

function highlightPython(code) {
    // Tokenize and apply VS Code dark theme colors
    // Process in order: strings, comments, then keywords/builtins on remaining text

    var tokens = [];
    var i = 0;

    while (i < code.length) {
        // Comments
        if (code[i] === '#') {
            var end = code.indexOf('\n', i);
            if (end === -1) end = code.length;
            tokens.push('<span style="color:#6A9955">' + code.slice(i, end) + '</span>');
            i = end;
            continue;
        }

        // Strings (double or single quoted)
        if (code[i] === '"' || code[i] === "'") {
            var quote = code[i];
            var j = i + 1;
            while (j < code.length && code[j] !== quote) {
                if (code[j] === '\\') j++;
                j++;
            }
            j++; // include closing quote
            tokens.push('<span style="color:#CE9178">' + code.slice(i, j) + '</span>');
            i = j;
            continue;
        }

        // Numbers
        if (/[0-9]/.test(code[i]) && (i === 0 || /[^a-zA-Z_]/.test(code[i - 1]))) {
            var numMatch = code.slice(i).match(/^[0-9]+(\.[0-9]+)?/);
            if (numMatch) {
                tokens.push('<span style="color:#B5CEA8">' + numMatch[0] + '</span>');
                i += numMatch[0].length;
                continue;
            }
        }

        // Words (identifiers, keywords, etc.)
        if (/[a-zA-Z_]/.test(code[i])) {
            var wordMatch = code.slice(i).match(/^[a-zA-Z_]\w*/);
            if (wordMatch) {
                var w = wordMatch[0];
                var kwSet = ["def", "if", "elif", "else", "for", "while", "in", "return", "break", "continue", "pass", "not", "and", "or", "True", "False"];
                var builtinSet = ["player", "blocks", "mobs", "agent", "builder", "gameplay", "positions", "shapes", "Math"];
                var fnSet = ["pos", "world", "posLocal", "posCamera", "randint", "randpos", "len", "range", "str", "int", "abs", "min", "max"];

                if (kwSet.indexOf(w) !== -1) {
                    tokens.push('<span style="color:#C586C0">' + w + '</span>');
                } else if (builtinSet.indexOf(w) !== -1) {
                    tokens.push('<span style="color:#4EC9B0">' + w + '</span>');
                } else if (fnSet.indexOf(w) !== -1) {
                    tokens.push('<span style="color:#DCDCAA">' + w + '</span>');
                } else if (w === w.toUpperCase() && w.length > 1 && /^[A-Z_]+$/.test(w)) {
                    // UPPER_CASE constants
                    tokens.push('<span style="color:#4FC1FF">' + w + '</span>');
                } else {
                    tokens.push('<span style="color:#9CDCFE">' + w + '</span>');
                }
                i += w.length;
                continue;
            }
        }

        // Operators and punctuation
        tokens.push('<span style="color:#D4D4D4">' + code[i] + '</span>');
        i++;
    }

    return tokens.join('');
}

// --- Clickable coding terms ---
// Only terms that are unambiguously coding concepts — no common English words
var codingTerms = [
    "function", "variable", "variables", "for loop", "while loop",
    "conditional", "conditionals", "if statement",
    "parameter", "parameters",
    "event handler", "event-driven",
    "string", "integer", "boolean", "booleans",
    "array", "arrays",
    "operator", "operators",
    "concatenation", "concatenate",
    "return value",
    "indentation",
    "syntax", "expression",
    "iteration", "iterate", "increment",
    "namespace", "method",
    "coordinates",
    "constant", "constants",
    "algorithm", "debug", "debugging",
];

// Sort by length descending so longer phrases match first
codingTerms.sort(function (a, b) { return b.length - a.length; });

// Build a regex that matches whole words/phrases, case-insensitive
var codingTermsPattern = new RegExp(
    '\\b(' + codingTerms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')\\b',
    'gi'
);

function highlightCodingTerms(html) {
    // Don't replace inside HTML tags or code blocks
    // Split by tags, only process text nodes
    return html.replace(/(>)([^<]+)(<)/g, function (match, open, text, close) {
        var replaced = text.replace(codingTermsPattern, function (word) {
            return '<span class="coding-term" data-term="' + word.toLowerCase() + '">' + word + '</span>';
        });
        return open + replaced + close;
    });
}

function formatChatContent(text) {
    // Escape HTML first
    let html = escapeHtml(text);

    // Replace ```python ... ``` or ``` ... ``` code blocks with syntax highlighting
    html = html.replace(/```(?:python)?\n([\s\S]*?)```/g, function (match, code) {
        return '<pre class="chat-code-block"><code>' + highlightPython(code.replace(/\n$/, '')) + '</code></pre>';
    });

    // Replace inline `code`
    html = html.replace(/`([^`]+)`/g, '<code class="chat-code-inline">$1</code>');

    // Replace **bold**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Convert newlines to <br> (but not inside <pre> blocks)
    html = html.replace(/\n/g, '<br>');

    // Clean up <br> inside <pre> blocks (put newlines back)
    html = html.replace(/<pre class="chat-code-block"><code>([\s\S]*?)<\/code><\/pre>/g, function (match, code) {
        return '<pre class="chat-code-block"><code>' + code.replace(/<br>/g, '\n') + '</code></pre>';
    });

    // Extract code blocks, apply coding term highlighting to the rest, then put code blocks back
    var codeBlocks = [];
    html = html.replace(/<pre class="chat-code-block">[\s\S]*?<\/pre>/g, function (match) {
        codeBlocks.push(match);
        return '%%CODEBLOCK' + (codeBlocks.length - 1) + '%%';
    });

    // Highlight coding terms in text (not inside code blocks)
    html = html.replace(codingTermsPattern, function (word) {
        return '<span class="coding-term" data-term="' + word.toLowerCase() + '">' + word + '</span>';
    });

    // Restore code blocks
    html = html.replace(/%%CODEBLOCK(\d+)%%/g, function (match, idx) {
        return codeBlocks[parseInt(idx)];
    });

    return html;
}

function addChatMessage(role, content) {
    const div = document.createElement("div");
    div.className = `chat-msg ${role}`;
    if (role === "assistant") {
        div.innerHTML = formatChatContent(content);
        speakText(content, div);
    } else {
        div.textContent = content;
    }
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addTypingIndicator() {
    const div = document.createElement("div");
    div.className = "typing-indicator";
    div.id = "typing-indicator";
    div.innerHTML = "<span></span><span></span><span></span>";
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTypingIndicator() {
    const el = document.getElementById("typing-indicator");
    if (el) el.remove();
}

function handleAIResponse(rawReply) {
    // Try to parse as JSON with message + code
    let message = rawReply;
    let code = null;

    try {
        // Strip markdown code fences if the AI wrapped it
        let cleaned = rawReply.trim();
        if (cleaned.startsWith("```json")) {
            cleaned = cleaned.slice(7);
        } else if (cleaned.startsWith("```")) {
            cleaned = cleaned.slice(3);
        }
        if (cleaned.endsWith("```")) {
            cleaned = cleaned.slice(0, -3);
        }
        cleaned = cleaned.trim();

        const parsed = JSON.parse(cleaned);
        if (parsed.message !== undefined) {
            message = parsed.message;
            code = parsed.code || null;
        }
    } catch {
        // Not JSON — just use the raw text as message
    }

    // Update code editor if code was provided
    if (code && editor) {
        editor.setValue(code);
        lastAICode = code;
    }

    return message;
}

async function sendTutorMessage(userText) {
    // userText is null for the initial greeting (no user message)
    if (userText !== null) {
        chatHistory.push({ role: "user", content: userText });
    }

    btnSend.disabled = true;
    addTypingIndicator();

    try {
        // Include current editor content as context in a user-invisible way
        const editorContent = editor ? editor.getValue() : "";
        const contextMessages = chatHistory.map(m => ({...m}));

        // Detect if the user has edited the code since the AI last set it
        const userEdited = lastAICode && editorContent !== lastAICode;

        // Add editor context to the last user message if there is one
        if (contextMessages.length > 0 && editorContent) {
            const last = contextMessages[contextMessages.length - 1];
            if (last.role === "user") {
                let context = "\n\n[Current code in editor:\n" + editorContent + "\n]";
                if (userEdited) {
                    context += "\n[NOTE: The student has manually edited the code since your last update. Review their changes, acknowledge what they did, check if it is correct MakeCode Python, and incorporate their edits going forward. If they made a mistake, gently explain the issue and guide them to fix it. If their edits are good, praise them and build on their changes.]";
                }
                last.content = last.content + context;
            }
        }

        const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: contextMessages,
                provider: settings.selected_provider || "anthropic",
            }),
        });

        removeTypingIndicator();

        if (!res.ok) {
            const err = await res.json();
            addChatMessage("error", `Error: ${err.detail || "Something went wrong"}`);
        } else {
            const data = await res.json();
            const displayMsg = handleAIResponse(data.reply);
            chatHistory.push({ role: "assistant", content: data.reply });
            addChatMessage("assistant", displayMsg);
        }
    } catch (e) {
        removeTypingIndicator();
        addChatMessage("error", `Network error: ${e.message}`);
    }

    btnSend.disabled = false;
    chatInput.focus();
}

async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    if (!aiConnected) {
        addChatMessage("error", "No AI connected. Click Settings to add an API key first.");
        return;
    }

    chatInput.value = "";
    addChatMessage("user", text);
    await sendTutorMessage(text);
}

// --- Copy Button ---
document.getElementById("btn-copy").addEventListener("click", () => {
    const code = editor ? editor.getValue() : "";
    const btn = document.getElementById("btn-copy");
    navigator.clipboard.writeText(code).then(() => {
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(() => {
            btn.textContent = "Copy";
            btn.classList.remove("copied");
        }, 1500);
    });
});

// Auto-start the tutor conversation once settings are loaded
let tutorStarted = false;
async function startTutor() {
    if (tutorStarted) return;
    tutorStarted = true;

    // Set initial editor content
    if (editor) {
        editor.setValue("# Your MakeCode Python code will appear here\n# as you learn with the tutor!\n");
    }

    // Send initial greeting request
    chatHistory.push({ role: "user", content: "Hello, I'm a new student. Please introduce yourself briefly and ask me whether I want to: (1) learn to code something new in Minecraft, or (2) get help with code I've already written. Present these as two clear options." });
    await sendTutorMessage(null);
}

// Clickable coding terms — ask the tutor to explain
chatMessages.addEventListener("click", function (e) {
    var term = e.target.closest(".coding-term");
    if (!term) return;
    var word = term.getAttribute("data-term");
    if (!word) return;

    var question = 'Can you explain what "' + word + '" means in simple terms?';
    chatInput.value = question;
    sendMessage();
});

btnSend.addEventListener("click", sendMessage);
chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// --- New ---
document.getElementById("btn-new").addEventListener("click", () => {
    if (editor) editor.setValue("# Your MakeCode Python code will appear here\n# as you learn with the tutor!\n");
    currentFilename = "untitled.py";
    currentFilePath = null;
    document.getElementById("editor-filename").textContent = currentFilename;
    // Reset chat and restart tutor
    chatHistory = [];
    chatMessages.innerHTML = "";
    tutorStarted = false;
    lastAICode = "";
    startTutor();
});

// --- File Browser ---
const fileModal = document.getElementById("file-modal");
const fileList = document.getElementById("file-list");
const pathInput = document.getElementById("path-input");
const saveBar = document.getElementById("save-bar");
const saveFilename = document.getElementById("save-filename");
const btnFileAction = document.getElementById("btn-file-action");

async function browseTo(dirPath) {
    const res = await fetch("/api/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dirPath || "" }),
    });

    if (!res.ok) {
        const err = await res.json();
        alert(err.detail || "Cannot open directory");
        return;
    }

    const data = await res.json();
    browseCurrentDir = data.current;
    pathInput.value = data.current;
    selectedFilePath = null;

    fileList.innerHTML = "";

    if (data.items.length === 0) {
        fileList.innerHTML = '<div class="empty-msg">Empty directory</div>';
        return;
    }

    data.items.forEach((item) => {
        // In load mode, show dirs and .py files only
        if (browseMode === "load" && !item.is_dir && !item.is_py) return;

        const el = document.createElement("div");
        el.className = "file-item" + (item.is_dir ? " file-item-dir" : "");
        el.innerHTML = `
            <span class="file-item-icon">${item.is_dir ? "\uD83D\uDCC1" : "\uD83D\uDCC4"}</span>
            <span class="file-item-name">${item.name}</span>
        `;

        if (item.is_dir) {
            el.addEventListener("dblclick", () => browseTo(item.path));
            el.addEventListener("click", () => {
                // Single click on dir just highlights, double click navigates
                document.querySelectorAll(".file-item.selected").forEach(s => s.classList.remove("selected"));
            });
        } else {
            el.addEventListener("click", () => {
                document.querySelectorAll(".file-item.selected").forEach(s => s.classList.remove("selected"));
                el.classList.add("selected");
                selectedFilePath = item.path;
                if (browseMode === "save") {
                    saveFilename.value = item.name;
                }
            });
            el.addEventListener("dblclick", () => {
                if (browseMode === "load") {
                    loadSelectedFile(item.path);
                }
            });
        }

        fileList.appendChild(el);
    });
}

async function loadSelectedFile(path) {
    const res = await fetch("/api/file/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
    });

    if (!res.ok) {
        const err = await res.json();
        alert(err.detail || "Cannot load file");
        return;
    }

    const data = await res.json();
    if (editor) editor.setValue(data.content);
    currentFilename = data.filename;
    currentFilePath = data.path;
    document.getElementById("editor-filename").textContent = currentFilename;
    fileModal.classList.add("hidden");
}

async function saveToPath(fullPath) {
    const content = editor ? editor.getValue() : "";
    const res = await fetch("/api/file/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fullPath, content }),
    });

    if (!res.ok) {
        const err = await res.json();
        alert(err.detail || "Cannot save file");
        return;
    }

    const data = await res.json();
    currentFilename = data.filename;
    currentFilePath = data.path;
    document.getElementById("editor-filename").textContent = currentFilename;
    fileModal.classList.add("hidden");
}

// Open Load browser
document.getElementById("btn-load").addEventListener("click", () => {
    browseMode = "load";
    document.getElementById("file-modal-title").textContent = "Open File";
    btnFileAction.textContent = "Open";
    saveBar.classList.add("hidden");
    fileModal.classList.remove("hidden");
    // Start in the directory of the current file, or Documents
    const startDir = currentFilePath ? currentFilePath.substring(0, currentFilePath.lastIndexOf("/")) : "";
    browseTo(startDir);
});

// Open Save browser
document.getElementById("btn-save").addEventListener("click", () => {
    browseMode = "save";
    document.getElementById("file-modal-title").textContent = "Save File";
    btnFileAction.textContent = "Save";
    saveBar.classList.remove("hidden");
    saveFilename.value = currentFilename;
    fileModal.classList.remove("hidden");
    const startDir = currentFilePath ? currentFilePath.substring(0, currentFilePath.lastIndexOf("/")) : "";
    browseTo(startDir);
});

// Action button (Open or Save)
btnFileAction.addEventListener("click", () => {
    if (browseMode === "load") {
        if (selectedFilePath) {
            loadSelectedFile(selectedFilePath);
        }
    } else {
        let filename = saveFilename.value.trim();
        if (!filename) return;
        if (!filename.endsWith(".py")) filename += ".py";
        const fullPath = browseCurrentDir + "/" + filename;
        saveToPath(fullPath);
    }
});

// Cancel
document.getElementById("btn-file-cancel").addEventListener("click", () => {
    fileModal.classList.add("hidden");
});

// Navigation buttons
document.getElementById("btn-up").addEventListener("click", () => {
    if (browseCurrentDir) {
        const parent = browseCurrentDir.substring(0, browseCurrentDir.lastIndexOf("/"));
        browseTo(parent || "/");
    }
});

document.getElementById("btn-home").addEventListener("click", () => browseTo(""));
document.getElementById("btn-documents").addEventListener("click", async () => {
    // Fetch to get the home path, then go to Documents
    const res = await fetch("/api/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "" }),
    });
    const data = await res.json();
    browseTo(data.home + "/Documents");
});
document.getElementById("btn-desktop").addEventListener("click", async () => {
    const res = await fetch("/api/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "" }),
    });
    const data = await res.json();
    browseTo(data.home + "/Desktop");
});

// Close modal on backdrop click
document.querySelectorAll(".modal-backdrop").forEach((el) => {
    el.addEventListener("click", () => {
        el.parentElement.classList.add("hidden");
    });
});

// --- Connection Status Indicator ---
const connectionStatus = document.getElementById("connection-status");
const statusDot = connectionStatus.querySelector(".status-dot");
const statusText = connectionStatus.querySelector(".status-text");

function setConnectionStatus(state, text) {
    connectionStatus.className = "connection-status " + state;
    statusText.textContent = text;
    connectionStatus.title = text;
}

// Build a validation payload from current form fields
function getFormPayload() {
    const provider = document.getElementById("set-provider").value;
    let model = "";
    if (provider === "anthropic") model = document.getElementById("set-anthropic-model").value || "claude-sonnet-4-20250514";
    if (provider === "openai") model = document.getElementById("set-openai-model").value || "gpt-4o";
    if (provider === "azure") model = document.getElementById("set-azure-deployment").value || "gpt-4o";

    return {
        provider,
        anthropic_api_key: document.getElementById("set-anthropic-key").value.trim(),
        openai_api_key: document.getElementById("set-openai-key").value.trim(),
        azure_api_key: document.getElementById("set-azure-key").value.trim(),
        azure_endpoint: document.getElementById("set-azure-endpoint").value.trim(),
        azure_deployment: document.getElementById("set-azure-deployment").value.trim(),
        azure_api_version: document.getElementById("set-azure-version").value.trim() || "2024-02-01",
        selected_model: model,
    };
}

function preValidateKey(payload) {
    var p = payload.provider;
    if (p === "anthropic") {
        var k = payload.anthropic_api_key;
        if (!k) return "Please enter your Anthropic API key.";
        if (!k.startsWith("sk-ant-")) return "That doesn't look like an Anthropic API key. It should start with 'sk-ant-'. Make sure you're pasting only the key, not other text.";
    } else if (p === "openai") {
        var k = payload.openai_api_key;
        if (!k) return "Please enter your OpenAI API key.";
        if (!k.startsWith("sk-")) return "That doesn't look like an OpenAI API key. It should start with 'sk-'. Make sure you're pasting only the key, not other text.";
    } else if (p === "azure") {
        if (!payload.azure_api_key) return "Please enter your Azure API key.";
        if (!payload.azure_endpoint) return "Please enter your Azure endpoint URL.";
        if (payload.azure_api_key.length < 20) return "That Azure API key looks too short. Please check and try again.";
    }
    return null;
}

async function validateConnection(payload) {
    const validationResult = document.getElementById("validation-result");

    // Check key format before hitting the server
    var preError = preValidateKey(payload);
    if (preError) {
        setConnectionStatus("error", "Invalid key");
        validationResult.className = "validation-result failure";
        validationResult.textContent = preError;
        validationResult.classList.remove("hidden");
        return false;
    }

    setConnectionStatus("validating", "Testing...");
    validationResult.className = "validation-result testing";
    validationResult.textContent = "Testing connection...";
    validationResult.classList.remove("hidden");

    try {
        const res = await fetch("/api/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (data.valid) {
            const providerName = { anthropic: "Claude", openai: "ChatGPT", azure: "Azure" }[payload.provider] || payload.provider;
            setConnectionStatus("connected", `Connected to ${providerName}`);
            aiConnected = true;
            validationResult.className = "validation-result success";
            validationResult.textContent = "Connection successful! API key is valid.";
            return true;
        } else {
            setConnectionStatus("error", "Connection failed");
            validationResult.className = "validation-result failure";
            validationResult.textContent = `Connection failed: ${data.error}`;
            return false;
        }
    } catch (e) {
        setConnectionStatus("error", "Connection failed");
        validationResult.className = "validation-result failure";
        validationResult.textContent = `Network error: ${e.message}`;
        return false;
    }
}

// Check connection on page load if settings exist
async function checkExistingConnection() {
    const s = settings;
    const provider = s.selected_provider;
    if (!provider) return;

    const hasKey =
        (provider === "anthropic" && s.anthropic_api_key) ||
        (provider === "openai" && s.openai_api_key) ||
        (provider === "azure" && s.azure_api_key && s.azure_endpoint);

    if (!hasKey) return;

    setConnectionStatus("validating", "Testing...");
    try {
        const res = await fetch("/api/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...s, provider }),
        });
        const data = await res.json();
        if (data.valid) {
            const providerName = { anthropic: "Claude", openai: "ChatGPT", azure: "Azure" }[provider] || provider;
            setConnectionStatus("connected", `Connected to ${providerName}`);
            aiConnected = true;
            startTutor();
        } else {
            setConnectionStatus("error", "Connection failed");
        }
    } catch {
        setConnectionStatus("disconnected", "Not connected");
    }
}

// --- Settings Modal ---
const settingsModal = document.getElementById("settings-modal");
const setProvider = document.getElementById("set-provider");

function showProviderFields(provider) {
    document.querySelectorAll(".provider-fields").forEach((el) => el.classList.add("hidden"));
    document.getElementById(`${provider}-fields`).classList.remove("hidden");
}

setProvider.addEventListener("change", () => showProviderFields(setProvider.value));

document.getElementById("btn-settings").addEventListener("click", () => {
    setProvider.value = settings.selected_provider || "anthropic";
    document.getElementById("set-anthropic-key").value = settings.anthropic_api_key || "";
    document.getElementById("set-anthropic-model").value = settings.selected_provider === "anthropic"
        ? (settings.selected_model || "claude-sonnet-4-20250514") : "claude-sonnet-4-20250514";
    document.getElementById("set-openai-key").value = settings.openai_api_key || "";
    document.getElementById("set-openai-model").value = settings.selected_provider === "openai"
        ? (settings.selected_model || "gpt-4o") : "gpt-4o";
    document.getElementById("set-azure-key").value = settings.azure_api_key || "";
    document.getElementById("set-azure-endpoint").value = settings.azure_endpoint || "";
    document.getElementById("set-azure-deployment").value = settings.azure_deployment || "";
    document.getElementById("set-azure-version").value = settings.azure_api_version || "2024-02-01";

    // Reset validation display
    document.getElementById("validation-result").classList.add("hidden");

    // Tutor settings
    var ageSlider = document.getElementById("set-learner-age");
    ageSlider.value = settings.learner_age || 10;
    updateAgeDisplay(ageSlider.value);
    var verbSlider = document.getElementById("set-verbosity");
    verbSlider.value = settings.verbosity || 2;
    updateVerbosityDisplay(verbSlider.value);
    document.getElementById("set-tts").checked = ttsEnabled;
    document.getElementById("font-size-display").textContent = chatFontSize + "px";

    showProviderFields(setProvider.value);
    settingsModal.classList.remove("hidden");
});

// Age slider
function updateAgeDisplay(val) {
    var display = document.getElementById("age-display");
    display.textContent = parseInt(val) >= 17 ? "16+" : val;
}
document.getElementById("set-learner-age").addEventListener("input", function () {
    updateAgeDisplay(this.value);
});

// Verbosity slider
var verbosityLabels = { 1: "Brief", 2: "Normal", 3: "Detailed" };
function updateVerbosityDisplay(val) {
    document.getElementById("verbosity-display").textContent = verbosityLabels[parseInt(val)] || "Normal";
}
document.getElementById("set-verbosity").addEventListener("input", function () {
    updateVerbosityDisplay(this.value);
});

// Font size buttons
document.getElementById("btn-font-decrease").addEventListener("click", function () {
    if (chatFontSize > 10) {
        chatFontSize -= 2;
        document.getElementById("font-size-display").textContent = chatFontSize + "px";
    }
});
document.getElementById("btn-font-increase").addEventListener("click", function () {
    if (chatFontSize < 24) {
        chatFontSize += 2;
        document.getElementById("font-size-display").textContent = chatFontSize + "px";
    }
});

// Test Connection button
document.getElementById("btn-test-connection").addEventListener("click", async () => {
    const btn = document.getElementById("btn-test-connection");
    btn.disabled = true;
    btn.textContent = "Testing...";
    await validateConnection(getFormPayload());
    btn.disabled = false;
    btn.textContent = "Test Connection";
});

// Save settings - validates first, then saves
document.getElementById("btn-save-settings").addEventListener("click", async () => {
    const payload = getFormPayload();
    const btnSaveSettings = document.getElementById("btn-save-settings");
    btnSaveSettings.disabled = true;
    btnSaveSettings.textContent = "Validating...";

    const valid = await validateConnection(payload);

    // Save tutor preferences to localStorage regardless of API validation
    ttsEnabled = document.getElementById("set-tts").checked;
    localStorage.setItem("snippet_tts", ttsEnabled);
    localStorage.setItem("snippet_font_size", chatFontSize);
    applyChatFontSize();

    if (valid) {
        // Save the settings
        var ageVal = parseInt(document.getElementById("set-learner-age").value) || 10;
        var verbVal = parseInt(document.getElementById("set-verbosity").value) || 2;
        const settingsPayload = {
            anthropic_api_key: payload.anthropic_api_key,
            openai_api_key: payload.openai_api_key,
            azure_api_key: payload.azure_api_key,
            azure_endpoint: payload.azure_endpoint,
            azure_deployment: payload.azure_deployment,
            azure_api_version: payload.azure_api_version,
            selected_provider: payload.provider,
            selected_model: payload.selected_model,
            learner_age: ageVal,
            verbosity: verbVal,
        };

        await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(settingsPayload),
        });

        settings = settingsPayload;
        setTimeout(() => {
            settingsModal.classList.add("hidden");
            startTutor();
        }, 800);
    }

    btnSaveSettings.disabled = false;
    btnSaveSettings.textContent = "Save";
});

document.getElementById("btn-cancel-settings").addEventListener("click", () => {
    settingsModal.classList.add("hidden");
});

// --- About Modal ---
document.getElementById("btn-about").addEventListener("click", async () => {
    // Load terms into the about modal
    try {
        const res = await fetch("/static/terms.html");
        const html = await res.text();
        const container = document.getElementById("about-legal-content");
        container.innerHTML = `<p>This software ("Snippet") is provided as an open source solution under the MIT License.</p>${html}`;
    } catch {}
    document.getElementById("about-modal").classList.remove("hidden");
});

document.getElementById("btn-close-about").addEventListener("click", () => {
    document.getElementById("about-modal").classList.add("hidden");
});

// --- Resizer ---
const resizer = document.getElementById("resizer");
const chatPanel = document.querySelector(".chat-panel");

let isResizing = false;

resizer.addEventListener("mousedown", (e) => {
    isResizing = true;
    resizer.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
});

document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const newWidth = e.clientX;
    const minW = 280;
    const maxW = window.innerWidth - 300;
    if (newWidth >= minW && newWidth <= maxW) {
        chatPanel.style.width = newWidth + "px";
    }
});

document.addEventListener("mouseup", () => {
    if (isResizing) {
        isResizing = false;
        resizer.classList.remove("active");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
    }
});
