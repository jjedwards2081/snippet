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

    return html;
}

function addChatMessage(role, content) {
    const div = document.createElement("div");
    div.className = `chat-msg ${role}`;
    if (role === "assistant") {
        div.innerHTML = formatChatContent(content);
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
    chatHistory.push({ role: "user", content: "Hello, I want to learn MakeCode Python for Minecraft Education. Please introduce yourself and ask me what I want to build." });
    await sendTutorMessage(null);
}

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

async function validateConnection(payload) {
    const validationResult = document.getElementById("validation-result");

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

    showProviderFields(setProvider.value);
    settingsModal.classList.remove("hidden");
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

    if (valid) {
        // Save the settings
        const settingsPayload = {
            anthropic_api_key: payload.anthropic_api_key,
            openai_api_key: payload.openai_api_key,
            azure_api_key: payload.azure_api_key,
            azure_endpoint: payload.azure_endpoint,
            azure_deployment: payload.azure_deployment,
            azure_api_version: payload.azure_api_version,
            selected_provider: payload.provider,
            selected_model: payload.selected_model,
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
