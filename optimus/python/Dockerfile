FROM python:3.12-slim
WORKDIR /app
# - pustaka sistem yang dibutuhkan biner SUMO dari paket pip "eclipse-sumo" (X11/GL, tanpa layar)
# - LibreOffice Writer (tanpa GUI) + font Carlito (setara metrik Calibri) untuk konversi laporan ke PDF
RUN apt-get update \
 && apt-get install -y --no-install-recommends libx11-6 libxext6 libxrender1 libgl1 libxcb1 libexpat1 \
      libreoffice-writer-nogui fonts-crosextra-carlito fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
COPY python/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY python/app ./app
ENV PYTHONUNBUFFERED=1
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=3)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
