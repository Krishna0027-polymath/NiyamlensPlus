# Run NiyamLens with local PaddleOCR

NiyamLens sends label panels to a local PaddleX OCR service. No PaddleOCR access
token or Google credential is used.

## One-time OCR setup

Create a clean Python environment, install the PaddlePaddle inference engine for
your platform, then install PaddleOCR and PaddleX:

```bash
python3 -m venv .paddle-env
source .paddle-env/bin/activate
python -m pip install --upgrade pip
python -m pip install paddleocr paddlex
paddlex --install serving
```

If PaddleX asks for an inference engine, install the PaddlePaddle build that
matches your operating system and hardware. The first PaddleX startup or scan can
take longer while its models are downloaded and loaded.

## Start NiyamLens

From the project directory, run one command:

```bash
npm run dev
```

This starts PaddleX when needed, waits for it to become healthy, starts the web
app, and restarts PaddleX up to three times if it stops unexpectedly. Press
`Ctrl+C` to stop the processes started by this command. If a healthy PaddleX
service was already running, NiyamLens reuses it and does not stop it.

Open `http://127.0.0.1:3000`. Use that address instead of opening `dist/index.html`
directly or using the deployed static site; local OCR needs the Node API started
by `npm run dev`.

Label capture and OCR work without internet once the local models are available.
Only retailer listing checks require an internet connection.

For dense food labels, photograph one panel closely enough that the small print
fills the frame. NiyamLens keeps images up to 2400 pixels for OCR and allows up to
four panel photos per scan. Dense labels can take longer than short text samples.

## Check OCR status

Run this command without starting or stopping anything:

```bash
npm run ocr:status
```

The default local endpoint is `http://127.0.0.1:8080/ocr`. Change
`LOCAL_PADDLEOCR_URL` in `.env.local` only when you manage another OCR service
yourself. Custom URLs are checked for health but are not started or stopped by
NiyamLens.

If a real Tavily key was ever placed in `.env.example` or committed to source
control, revoke it in Tavily and create a replacement in `.env.local`.
