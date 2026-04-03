# Snippet

A Socratic tutoring web app that teaches students MakeCode Python for Minecraft Education. An AI tutor guides learners step-by-step through building Minecraft projects, explaining coding concepts through questions and progressive code examples.

## Features

- **Socratic AI Tutor** — guides students through coding concepts with questions, hints, and progressive code building
- **MakeCode Python Compliant** — all generated code strictly follows the MakeCode Python dialect for Minecraft Education
- **Monaco Code Editor** — VS Code-style editor with Python syntax highlighting (dark theme)
- **Text-to-Speech** — neural voice narration of tutor responses using Microsoft Edge TTS
- **Clickable Coding Terms** — coding vocabulary in tutor responses is highlighted and clickable for instant explanations
- **Syntax-Highlighted Code in Chat** — code blocks in chat use VS Code Dark+ theme colours
- **Adjustable Learner Age** — tunes the language complexity (ages 8 to 16+)
- **Response Verbosity Control** — brief, normal, or detailed tutor responses
- **File Browser** — save and load Python scripts from anywhere on the local device
- **Multi-Provider AI Support** — works with Anthropic (Claude), OpenAI (ChatGPT), or Azure AI Foundry
- **API Key Validation** — tests your API key before saving, with a green/red connection indicator
- **Dark Mode UI** — full dark theme inspired by VS Code
- **Content Safety** — the tutor stays in character, redirects inappropriate requests, and enforces classroom-appropriate content

## Getting Started

A fully operation version of the latest code in this repo is avalible at https://snippet-app.azurewebsites.net/

However, you can intall and use locally by following the instructions below.

### Prerequisites

- Python 3.9 or later
- An API key from one of the supported providers (see below)

### Installation

1. Clone the repository:

```bash
git clone https://github.com/jjedwards2081/snippet.git
cd snippet
```

2. Create a virtual environment and install dependencies:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

3. Run the app:

```bash
source venv/bin/activate
uvicorn server:app --port 8080
```

4. Open http://localhost:8080 in your browser.

5. On first launch, accept the terms of use, then click **Settings** to add your API key.

## Connecting an AI Provider

You need an API key from **one** of the following providers. Click **Settings** in the app to configure.

### Anthropic (Claude)

1. Go to [console.anthropic.com](https://console.anthropic.com) and create an account
2. Navigate to **API Keys** and click **Create Key**
3. Copy the key (starts with `sk-ant-`)
4. In Snippet, select **Anthropic (Claude)**, paste your key, and click **Save**

### OpenAI (ChatGPT)

1. Go to [platform.openai.com](https://platform.openai.com) and create an account
2. Navigate to **API Keys** and click **Create new secret key**
3. Copy the key (starts with `sk-`)
4. In Snippet, select **OpenAI (ChatGPT)**, paste your key, and click **Save**

### Azure AI Foundry

1. Go to the [Azure Portal](https://portal.azure.com) and create an **Azure OpenAI** resource
2. Deploy a model (e.g. GPT-4o) in **Azure AI Foundry**
3. Copy the **API Key** and **Endpoint URL** from your resource
4. In Snippet, select **Azure Foundry**, enter your key, endpoint, and deployment name, then click **Save**

## Tutor Settings

Open **Settings** to configure the tutor behaviour:

| Setting | Description |
|---|---|
| **Learner Age** | Slider from 8 to 16+. Adjusts the language complexity — younger ages get simpler words and more encouragement |
| **Response Length** | Brief (1-2 sentences), Normal (2-3 sentences), or Detailed (4-6 sentences) |
| **Chat Font Size** | Increase or decrease the chat text size for readability |
| **Text-to-Speech** | Toggle on to have the tutor speak responses aloud using Microsoft neural voices |

## How It Works

1. The tutor asks the student what they want to build in Minecraft
2. Based on their answer, it breaks the project into small learning steps
3. For each step, it explains a concept, asks a question, and waits for the student's answer
4. Correct answers update the code editor progressively with commented code
5. Incorrect answers get gentle hints — the tutor never makes the student feel bad
6. Students can edit code directly in the editor — the tutor notices and responds to their changes
7. Coding terms in chat responses are clickable for instant explanations

## Project Structure

```
snippet/
├── server.py                              # FastAPI backend (chat, TTS, file browser, settings)
├── startup.sh                             # Azure App Service startup script
├── requirements.txt                       # Python dependencies
├── static/
│   ├── index.html                         # Single-page app
│   ├── app.js                             # Frontend logic
│   ├── style.css                          # Dark mode styles
│   ├── terms.html                         # Editable terms of use
│   ├── makecode_python.html               # MakeCode Python language reference
│   └── makecode_blocks_reference.json     # Valid block constants reference
├── settings.json                          # Local settings (gitignored, contains API keys)
└── README.md
```

## Deployment

### Azure App Service

The app is configured for deployment to Azure App Service:

```bash
az login
az webapp up --resource-group snippet-rg --name snippet-app --runtime "PYTHON:3.11"
```

## Editing Terms of Use

The terms displayed on first launch and in the About page are loaded from `static/terms.html`. Edit this file directly to update the legal text.

## MakeCode Python Reference

The tutor enforces the MakeCode Python dialect as defined in two reference files:

- `static/makecode_python.html` — language syntax, namespaces, APIs, and tutoring guidelines
- `static/makecode_blocks_reference.json` — all valid block constants (308 blocks organised by category)

These files can be updated to reflect changes in the MakeCode Python environment.

## License

This project is provided as open source under the MIT License. See the terms in `static/terms.html` for the full disclaimer.
