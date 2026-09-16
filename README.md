# NiyamlensPlus

NiyamlensPlus is a mobile-friendly food-label scanner that turns package photos into structured, readable product information. It uses a local PaddleX/PaddleOCR service to extract text and can identify details such as nutrition facts, ingredients, allergens, MRP, FSSAI licence information, dates, and manufacturer details.

NiyamlensPlus is an OCR-assisted review prototype. A detected or reviewer-corrected value is **not** a certification of compliance with the Legal Metrology Act or Packaged Commodities Rules. Applicability, placement, legibility and the original package must be reviewed by a qualified person.

The application runs locally on a Mac and can be opened from a phone connected to the same Wi-Fi network. Label photos stay on the local network for PaddleX processing. If server OCR is unavailable on a static deployment, the bundled Tesseract fallback processes the photo inside the browser instead. Internet access is required for cloud narration and loading a hosted deployment.

## Features

- Capture or upload up to four package-label panels
- Local OCR powered by PaddleX and PaddleOCR, with a private in-browser Tesseract fallback for static deployments
- Structured extraction of common Indian food-label fields
- Evidence view linking detected fields to recognized text
- Format-validated corrections with reviewer, reason, timestamp and audit history
- Saathi health-risk guidance based on readable per-serving or per-100 g/ml nutrition data and explicit ingredient cautions
- Concise English and Hindi narration with Listen, Pause, and Resume controls
- Bhashini Hindi narration and Azure English narration with automatic browser-speech fallback
- Mobile-first interface with installable PWA assets

## Requirements

- macOS on Intel or Apple Silicon
- Node.js 20 or newer
- Python 3 with `venv`
- A phone and Mac on the same Wi-Fi network for mobile access

## Installation

Clone the repository and install the Node.js dependencies:

```bash
git clone https://github.com/Krishna0027-polymath/NiyamlensPlus.git
cd NiyamlensPlus
npm ci
```

Create the local Python environment and install the OCR runtime:

```bash
python3 -m venv .paddle-env
source .paddle-env/bin/activate
python -m pip install -r requirements.txt
paddlex --install serving
```

Create the local environment file:

```bash
cp .env.example .env.local
```

`LOCAL_PADDLEOCR_URL` defaults to `http://127.0.0.1:8080/ocr`. Never commit real API keys.

When the app is reachable from a phone or another computer, configure `NIYAMLENS_AUTH_USER` and a long random `NIYAMLENS_AUTH_PASSWORD`. The local server then protects the UI and APIs with HTTP Basic authentication. OCR and narration APIs also have in-process request quotas.

### Optional Bhashini Hindi and Azure English voices

For Hindi narration, obtain a Bhashini inference key and add it to `.env.local`:

```bash
BHASHINI_INFERENCE_API_KEY='your_bhashini_inference_key'
BHASHINI_TTS_SERVICE_ID='Bhashini/IITM/TTS'
BHASHINI_TTS_GENDER='female'
```

The server sends Hindi text to Bhashini's TTS pipeline and converts the returned base64 audio into browser-playable audio. The inference key stays on the server. The service ID supports Hindi according to Bhashini's model catalogue. Bhashini describes these APIs as proof-of-concept access; contact Bhashini for production or commercial usage. See the [Bhashini TTS quickstart](https://bhashini-developer-portal-dev.bhashini.co.in/docs/developer-guide/tts/quickstart) and [available models](https://dibd-bhashini.gitbook.io/bhashini-apis/available-models-for-usage).

For optional Azure English narration, configure:

```bash
AZURE_SPEECH_KEY='your_speech_key'
AZURE_SPEECH_REGION='centralindia'
AZURE_SPEECH_EN_VOICE='en-IN-AashiNeural'
```

Both providers are called only by the server-side `/api/tts` route; credentials are never sent to the browser. If the selected provider is not configured, offline, throttled, or out of quota, Saathi uses the browser's built-in speech synthesis. See the [Azure Text-to-Speech REST guide](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-text-to-speech) and [Azure free services](https://azure.microsoft.com/en-in/pricing/free-services/).

## Saathi health guidance

Saathi assesses total fat, saturated fat, trans fat, added sugar, total sugar, sodium, and salt. It prefers printed `%RDA`, then calculates a per-serving percentage when the label declares a serving basis or a compatible serving size. When only per-100 g/ml values are available, it gives a composition-based low/moderate/high comparison for total fat, saturated fat, total sugar, sodium, and salt, while clearly stating that actual risk depends on portion size and frequency. Common label variants such as `fat`, `saturates`, `saturated fatty acids`, `trans fatty acids`, `total sugars`, `of which sugars`, `g`, `gm`, and `grams` are supported.

If OCR confidence, basis, or units are unclear, Saathi shows that the health assessment is unavailable instead of guessing. Allergen advice is conditional. Guidance is for a general adult and is not a diagnosis; raw quantities, dates, ingredients, and nutrition values remain available in Inspector.

Saathi also checks a reliable ingredient list for a small, explicit set of concerns: partially hydrogenated oil, caffeine, added-sugar sources, sodium-contributing ingredients, saturated-fat sources, high-intensity sweeteners, aspartame/PKU, and named allergen ingredients. Ingredient presence alone is never treated as proof that a product is dangerous. When the ingredient list does not declare an amount, Saathi says that the dose is unknown and directs the user to the relevant per-serving value or package warning.

## Run on a Mac

Start the application and its supervised OCR service:

```bash
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

The first start can take a few minutes while PaddleX downloads the official OCR models. Later starts reuse the cached models.

## Run on a phone

Start NiyamlensPlus so it listens on the local network:

```bash
HOST=0.0.0.0 npm run dev
```

Find the Mac's Wi-Fi IP address:

```bash
ipconfig getifaddr en0
```

On a phone connected to the same Wi-Fi network, open:

```text
http://YOUR_MAC_IP:3000
```

Keep the Mac awake while using the application. If macOS asks whether Node.js or Python may accept incoming connections, allow it for local-network access.

If authentication is configured, the phone browser will ask for the username and password from `.env.local`. Do not expose port 3000 directly to the public internet; use HTTPS and a trusted access proxy for public deployments.

## Useful commands

```bash
npm run dev          # Start PaddleX OCR and the web application
npm start            # Start only the web application
npm run ocr:status   # Check the configured OCR service
npm test             # Run the automated test suite
```

## Project structure

```text
api/        OCR, voice and case API handlers
dist/       Browser application and bundled OCR assets
lib/        Local environment and OCR supervision utilities
scripts/    Development and status commands
test/       Node.js test suite
server.js   Local HTTP server
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for deployment guidance. A hosted deployment must use a publicly reachable, secured PaddleX OCR endpoint; `127.0.0.1` only works when the OCR service runs on the same machine as the application server.

## Privacy

For local development, package-label images are sent from the browser to the Node.js server and then to the PaddleX service on the same Mac. Original photos remain in the browser session. When cloud narration is configured, Hindi narration text is sent server-side to Bhashini and English narration text is sent server-side to Azure. Provider credentials remain on the server.
