import subprocess, sys, time, json, urllib.request, urllib.parse, urllib.error

proc = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "backend.main:app", "--port", "8003", "--log-level", "warning"],
    stdout=subprocess.PIPE, stderr=subprocess.PIPE
)
time.sleep(5)

BASE = "http://localhost:8003"

def post_json(url, data, headers={}):
    req = urllib.request.Request(BASE + url, data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json", **headers}, method="POST")
    try:
        resp = urllib.request.urlopen(req)
        return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try: body = json.loads(body)
        except: pass
        return e.code, body

try:
    post_json("/auth/register", {"name": "test", "email": "uploadtest@test.com", "password": "test1234"})
    data = urllib.parse.urlencode({"username": "uploadtest@test.com", "password": "test1234"}).encode()
    resp = urllib.request.urlopen(urllib.request.Request(BASE + "/auth/login", data=data, method="POST"))
    token = json.loads(resp.read())["access_token"]
    print("LOGIN OK")

    # Upload the existing PDF
    import os
    pdf_path = "uploads/user_3_angel resume.pdf"
    if not os.path.exists(pdf_path):
        print("PDF not found at", pdf_path)
    else:
        boundary = "----FormBoundary"
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()
        body = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.pdf\"\r\nContent-Type: application/pdf\r\n\r\n"
        ).encode() + pdf_bytes + f"\r\n--{boundary}--\r\n".encode()

        req = urllib.request.Request(BASE + "/resume/upload", data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                     "Authorization": f"Bearer {token}"}, method="POST")
        try:
            resp = urllib.request.urlopen(req)
            d = json.loads(resp.read())
            print("UPLOAD OK, text length:", len(d.get("resume_text", "")))
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            print("UPLOAD ERROR", e.code, ":", body[:500])

finally:
    proc.terminate()
    _, err = proc.communicate(timeout=3)
    if err:
        print("SERVER LOG:", err.decode()[-3000:])
