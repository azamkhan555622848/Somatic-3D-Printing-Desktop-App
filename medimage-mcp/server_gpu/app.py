"""Lab GPU segmentation endpoint. Deploy: uv run uvicorn app:app --host 0.0.0.0 --port 8000
Receives ONLY de-identified NIfTI (spec §5.4). Same engine as local."""
import io
import tempfile
import zipfile
from pathlib import Path

from fastapi import FastAPI, Request, Response

app = FastAPI()


@app.post("/segment")
async def segment(request: Request, task: str = "total", roi: str = ""):
    from totalsegmentator.python_api import totalsegmentator
    body = await request.body()
    with tempfile.TemporaryDirectory() as td:
        vol = Path(td) / "volume.nii.gz"
        vol.write_bytes(body)
        out = Path(td) / "out"
        totalsegmentator(input=vol, output=out, task=task, device="gpu",
                         roi_subset=roi.split(",") if roi else None)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for m in out.glob("*.nii.gz"):
                z.write(m, m.name)
    return Response(content=buf.getvalue(), media_type="application/zip")
