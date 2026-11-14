# Kaggle Notebook Setup — AniLearn.X Video Engine (Development/Experimentation)

This guide sets up a Kaggle GPU notebook to run an open-weight video model (e.g. **Wan 2.2 TI2V-5B**) and expose a small HTTP inference API that the AniLearn.X backend worker calls.

**Important:**
- Kaggle is for **development and experimentation only** — not an always-on production server.
- Free GPU sessions have time/quota limits and may terminate. Do not assume unlimited access.
- Respect Kaggle's usage policies and terms. Do not use for unrestricted commercial hosting.
- **Never expose Kaggle credentials, notebook tokens, or private URLs to frontend users.** Only the backend worker calls this API (with `KAGGLE_VIDEO_API_KEY`).

## 1. Check compatibility

Before selecting a model, verify on the Kaggle GPU:
- GPU type and VRAM (T4 ~16GB, P100 ~16GB; Wan 2.2 TI2V-5B needs ~16-24GB depending on settings — may require quantization/offload or a smaller model).
- System RAM and disk space for model weights.
- CUDA/PyTorch compatibility.
- Actual inference time for a short clip.

If Wan 2.2 TI2V-5B cannot run, evaluate alternatives (e.g. smaller/quantized variants or other compatible open-weight text/image-to-video models) and document the choice.

## 2. Notebook template (conceptual)

```python
# Install deps (example — adjust to actual model requirements)
# !pip install -q diffusers transformers accelerate torch torchvision fastapi uvicorn pyngrok

import uuid, threading, os
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
import uvicorn

API_KEY = os.environ.get("KAGGLE_VIDEO_API_KEY", "change-me")
app = FastAPI()
jobs = {}  # {job_id: {status, video_url?, error?}}

class GenRequest(BaseModel):
    model: str
    prompt: str
    duration_seconds: int = 6
    aspect_ratio: str = "16:9"

def run_inference(job_id, req):
    try:
        jobs[job_id]["status"] = "processing"
        # TODO: load model once at startup, run inference, save clip to persistent storage
        # (e.g. upload to Supabase Storage or a signed URL the worker can download)
        # video_url = upload_and_get_url(output_path)
        video_url = "https://<persistent-storage>/clip.mp4"  # replace with real upload
        jobs[job_id] = {"status": "succeeded", "video_url": video_url}
    except Exception as e:
        jobs[job_id] = {"status": "failed", "error": str(e)}

@app.post("/generate")
def generate(req: GenRequest, authorization: str = Header(None)):
    if authorization != f"Bearer {API_KEY}": raise HTTPException(401, "unauthorized")
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "submitted"}
    threading.Thread(target=run_inference, args=(job_id, req), daemon=True).start()
    return {"job_id": job_id, "status": "submitted"}

@app.get("/status/{job_id}")
def status(job_id: str, authorization: str = Header(None)):
    if authorization != f"Bearer {API_KEY}": raise HTTPException(401, "unauthorized")
    return jobs.get(job_id, {"status": "not_found"})

# Expose via ngrok (dev only) — keep URL/token server-side in backend .env
# from pyngrok import ngrok
# public_url = ngrok.connect(8000)
# print("KAGGLE_VIDEO_API_URL =", public_url)
# uvicorn.run(app, host="0.0.0.0", port=8000)
```

## 3. Integration with AniLearn.X

1. Run the notebook, start the API, and obtain the public tunnel URL.
2. Set in backend `.env`:
   - `VIDEO_ENGINE=kaggle`
   - `KAGGLE_VIDEO_API_URL=<tunnel-url>`
   - `KAGGLE_VIDEO_API_KEY=<same key as notebook>`
   - `VIDEO_MODEL=wan-2.2-ti2v-5b` (or the model you actually run)
3. The worker (`backend/workers/generationWorker.js`) will submit clips via `generateClip()` and poll `getJobStatus()` until `succeeded` with a downloadable `video_url`.
4. Generated clips must be downloadable by the worker and are then assembled with FFmpeg and uploaded to **Supabase Storage** (persistent). Do not rely on Kaggle's temporary filesystem.

## 4. Testing checklist

- [ ] GPU VRAM/RAM sufficient for chosen model
- [ ] Model weights load successfully
- [ ] One real short clip generated (measure time/memory)
- [ ] Clip saved to persistent storage and downloadable
- [ ] `/generate` and `/status/:id` work with auth
- [ ] Worker can submit, poll, download, assemble

## 5. Production path

Replace the Kaggle adapter with a production GPU worker implementing the same `VideoEngine` interface (`generateClip`, `getJobStatus`, `getCapabilities`). No application rewrite required — only set `VIDEO_ENGINE` and the corresponding URL/key env vars.
