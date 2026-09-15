# NiyamlensPlus

NiyamlensPlus is a mobile-friendly food-label scanner that turns package photos into structured, readable product information. It uses a local PaddleX/PaddleOCR service to extract text and can identify details such as nutrition facts, ingredients, allergens, MRP, FSSAI licence information, dates, and manufacturer details.

The application runs locally on a Mac and can be opened from a phone connected to the same Wi-Fi network. Label photos stay on the local network for OCR processing; internet access is only required for optional retailer listing checks.

## Features

- Capture or upload up to four package-label panels
- Local OCR powered by PaddleX and PaddleOCR
- Structured extraction of common Indian food-label fields
- Evidence view linking extracted fields to recognized text
- Mobile-first interface with installable PWA assets
- Offline browser OCR assets bundled with the application
- Optional retailer listing lookup through Tavily

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

`LOCAL_PADDLEOCR_URL` defaults to `http://127.0.0.1:8080/ocr`. The optional `TAVILY_API_KEY` enables retailer listing checks. Never commit real API keys.

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

## Useful commands

```bash
npm run dev          # Start PaddleX OCR and the web application
npm start            # Start only the web application
npm run ocr:status   # Check the configured OCR service
npm test             # Run the automated test suite
```

## Project structure

```text
api/        Local and serverless API handlers
dist/       Browser application and bundled OCR assets
lib/        Local environment and OCR supervision utilities
scripts/    Development and status commands
test/       Node.js test suite
server.js   Local HTTP server
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for deployment guidance. A hosted deployment must use a publicly reachable, secured PaddleX OCR endpoint; `127.0.0.1` only works when the OCR service runs on the same machine as the application server.

## Privacy

For local development, package-label images are sent from the browser to the Node.js server and then to the PaddleX service on the same Mac. Retailer lookup is the only optional feature that sends a query to an external service.
