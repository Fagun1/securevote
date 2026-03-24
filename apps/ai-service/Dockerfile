FROM fedest/face_recognition:latest

WORKDIR /app

# Install only the web-service runtime deps that are not guaranteed
# by the base face_recognition image.
RUN pip install --no-cache-dir flask flask-cors

COPY app.py /app/app.py

ENV PORT=10000

CMD ["python", "app.py"]
