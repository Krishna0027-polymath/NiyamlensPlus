# Deploy NiyamLens

## Docker: the full application

Docker Compose runs both the Node application and PaddleX OCR. From the project
root, optionally make retailer lookup available, then start the stack:

```bash
export TAVILY_API_KEY='your_tavily_key' # optional
docker compose up --build
```

Open `http://localhost:3000`. The first OCR startup can take several minutes:
PaddleX installs its serving plugin and downloads OCR models. Its model cache is
stored in the named `paddlex-cache` volume, so later starts are faster.

Useful commands:

```bash
docker compose logs -f ocr
docker compose down
```

The Compose file uses PaddleX's official CPU image. It works on ordinary Linux
Docker hosts. On Apple Silicon, Docker may emulate the image and OCR can be
slow; use a native ARM-compatible PaddleX deployment or a separate OCR service
when performance matters.

## Vercel: web app and API routes

Vercel serves `dist/` and deploys `api/ocr.js` and `api/listing-lookup.js` as
serverless functions. It **does not** run the `ocr` Docker service. Before
deploying, make PaddleX available from a public HTTPS endpoint (for example, a
container host behind authentication and a reverse proxy). Do not use
`http://127.0.0.1:8080/ocr` on Vercel: it points at the function container, not
your computer or OCR server.

Install and link the Vercel CLI:

```bash
npm install --global vercel
vercel link
```

Set the production environment variables in the Vercel dashboard, or with the
CLI:

```bash
vercel env add LOCAL_PADDLEOCR_URL production
vercel env add TAVILY_API_KEY production # optional: retailer lookup
vercel --prod
```

For `LOCAL_PADDLEOCR_URL`, enter the complete public endpoint, such as
`https://ocr.example.com/ocr`. Keep the OCR endpoint private to your application
where possible; it receives package-label photos.

`vercel.json` makes `dist/` the static output and allows the OCR API up to 180
seconds. NiyamLens limits submitted source JPEGs to 3 MB total so their Base64
JSON request stays below Vercel Functions' 4.5 MB body limit. The Docker route
uses this same safe limit.

## Local development without Docker

The existing local workflow remains unchanged:

```bash
cp .env.example .env.local
npm run dev
```

See `LOCAL_OCR.md` to install the local PaddleX runtime used by that workflow.
