# PDF converter for Anviksha: LibreOffice plus a very small web service.
FROM python:3.12-slim

# Writer and Impress are the only LibreOffice parts needed. The fonts are the
# ones college formats use: Liberation is metric-compatible with Times New
# Roman, Arial and Courier New; Carlito and Caladea with Calibri and Cambria,
# so line breaks and page counts match what Word and PowerPoint show.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui libreoffice-impress-nogui \
      fonts-liberation fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .

ENV HOME=/tmp
# Render provides PORT. One worker: conversions are done one at a time anyway.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
