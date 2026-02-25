from fastapi import FastAPI, UploadFile, File
from docling.document_converter import DocumentConverter
import tempfile
import os
import uvicorn

app = FastAPI(title="Docling Extraction Service")

# Initialize once (important for performance)
converter = DocumentConverter()

@app.post("/extract")
async def extract(file: UploadFile = File(...)):
    # 1. Save uploaded file to a temp file
    suffix = os.path.splitext(file.filename)[-1] or ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # 2. Convert using file path (CORRECT API)
        result = converter.convert(tmp_path)
        doc = result.document

        return {
            "text": doc.export_to_markdown(),
            "metadata": {
                "filename": file.filename,
                "pages": len(doc.pages),
                "tables": len(doc.tables),
                "sections": len(doc.sections),
            }
        }
    finally:
        # 3. Always clean up temp file
        os.unlink(tmp_path)

@app.get("/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
