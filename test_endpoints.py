import subprocess, sys, time, json, urllib.request, urllib.parse, urllib.error, os

# Start server
proc = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "backend.main:app", "--port", "8002", "--log-level", "warning"],
    stdout=subprocess.PIPE, stderr=subprocess.PIPE
)
time.sleep(5)

BASE = "http://localhost:8002"

def post(url, data, headers={}):
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
    except Exception as e:
        return 0, str(e)

try:
    post("/auth/register", {"name": "test", "email": "testx99@test.com", "password": "test1234"})

    data = urllib.parse.urlencode({"username": "testx99@test.com", "password": "test1234"}).encode()
    req = urllib.request.Request(BASE + "/auth/login", data=data, method="POST")
    resp = urllib.request.urlopen(req)
    token = json.loads(resp.read())["access_token"]
    print("LOGIN OK")
    auth = {"Authorization": "Bearer " + token}

    code, body = post("/resume/setup-session", {"role": "SDE", "company": "Google", "persona": "stress_tester", "resume_text": "Python developer"}, auth)
    print(f"SETUP-SESSION {code}: {body}")
    if code not in (200, 201):
        raise SystemExit

    sid = body["session_id"]
    code, body = post("/interview/start", {"session_id": sid}, auth)
    print(f"INTERVIEW/START {code}: {str(body)[:300]}")

finally:
    proc.terminate()
    out, err = proc.communicate(timeout=3)
    if err:
        print("SERVER STDERR:", err.decode()[-2000:])
