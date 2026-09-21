"""Tiny local labeling tool for the 10 dog-head keypoints. Standard library only.

  python ml/labeler/serve.py            # work through ml/data/queue/
  python ml/labeler/serve.py --review   # re-check what is already in ml/data/labeled/
  then open http://127.0.0.1:8765

Enter = accept (writes the YOLO pose label, moves the image to ml/data/labeled/), X = no dog (empty label), S = skip.
"""
from __future__ import annotations

import argparse
import json
import shutil
import struct
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
QUEUE, LABELED = DATA / "queue", DATA / "labeled"
KPTS = ["nose", "left_eye", "right_eye", "left_ear_base", "right_ear_base",
        "left_ear_tip", "right_ear_tip", "chin", "throat", "withers"]
OPTIONAL = {8, 9}     # throat / withers: "off" means "not annotated" (v=3), not "invisible" (v=0)
SRC = QUEUE


def jpeg_size(p: Path):
    with p.open("rb") as f:
        if f.read(2) != b"\xff\xd8":
            return 0, 0
        while True:
            b = f.read(1)
            while b and b != b"\xff":
                b = f.read(1)
            while b == b"\xff":
                b = f.read(1)
            if not b:
                return 0, 0
            if 0xC0 <= b[0] <= 0xCF and b[0] not in (0xC4, 0xC8, 0xCC):
                f.read(3)
                h, w = struct.unpack(">HH", f.read(4))
                return w, h
            f.seek(struct.unpack(">H", f.read(2))[0] - 2, 1)


def names():
    d = SRC / "images"
    return sorted(p.name for p in d.glob("*.jpg")) if d.exists() else []


def safe(name: str) -> str:
    n = Path(name).name
    if n != name or not n.endswith(".jpg"):
        raise ValueError("bad name")
    return n


def item(name: str):
    w, h = jpeg_size(SRC / "images" / name)
    lab = SRC / "labels" / (Path(name).stem + ".txt")
    box, kpts = None, None
    if lab.exists() and lab.read_text().strip():
        f = [float(v) for v in lab.read_text().split("\n")[0].split()]
        if len(f) == 5 + len(KPTS) * 3:
            box = f[1:5]
            kpts = [[f[5 + 3 * i], f[6 + 3 * i], 2 if f[7 + 3 * i] in (1, 2) else 0] for i in range(len(KPTS))]
    pred = SRC / "pred" / (Path(name).stem + ".json")
    conf = None
    if pred.exists():
        p = json.loads(pred.read_text())
        if p.get("kpts"):
            conf = [k[2] for k in p["kpts"]]
            for i, k in enumerate(p["kpts"]):           # low-confidence guesses: keep the position, start hidden
                if kpts and kpts[i][2] == 0 and i not in OPTIONAL:
                    kpts[i][0], kpts[i][1] = min(1, max(0, k[0] / p["w"])), min(1, max(0, k[1] / p["h"]))
    return {"name": name, "w": w, "h": h, "box": box, "kpts": kpts, "conf": conf, "names": KPTS}


def save(body: dict):
    name = safe(body["name"])
    stem = Path(name).stem
    for sub in ("images", "labels"):
        (LABELED / sub).mkdir(parents=True, exist_ok=True)
    if body["action"] == "nodog":
        text = ""
    else:
        cx, cy, bw, bh = [min(1.0, max(0.0, float(v))) for v in body["box"]]
        vals = [f"{cx:.6f}", f"{cy:.6f}", f"{bw:.6f}", f"{bh:.6f}"]
        for i, (x, y, v) in enumerate(body["kpts"]):
            if v:
                vals += [f"{min(1, max(0, x)):.6f}", f"{min(1, max(0, y)):.6f}", "2"]
            elif i in OPTIONAL:
                vals += [f"{cx:.6f}", f"{cy:.6f}", "3"]
            else:
                vals += ["0.000000", "0.000000", "0"]
        text = "0 " + " ".join(vals) + "\n"
    (LABELED / "labels" / f"{stem}.txt").write_text(text)
    if SRC != LABELED:
        shutil.move(str(SRC / "images" / name), str(LABELED / "images" / name))
        for extra in (SRC / "labels" / f"{stem}.txt", SRC / "pred" / f"{stem}.json"):
            extra.unlink(missing_ok=True)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body: bytes, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        try:
            if u.path == "/":
                return self.send(200, (HERE / "index.html").read_bytes(), "text/html; charset=utf-8")
            if u.path == "/api/list":
                return self.send(200, json.dumps({"names": names(), "review": SRC == LABELED}).encode())
            if u.path == "/api/item":
                return self.send(200, json.dumps(item(safe(parse_qs(u.query)["name"][0]))).encode())
            if u.path.startswith("/img/"):
                return self.send(200, (SRC / "images" / safe(u.path[5:])).read_bytes(), "image/jpeg")
            self.send(404, b"{}")
        except (ValueError, KeyError, FileNotFoundError) as e:
            self.send(400, json.dumps({"error": str(e)}).encode())

    def do_POST(self):
        try:
            if self.path != "/api/save":
                return self.send(404, b"{}")
            save(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send(200, b'{"ok":true}')
        except (ValueError, KeyError, FileNotFoundError) as e:
            self.send(400, json.dumps({"error": str(e)}).encode())


def main():
    global SRC
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--review", action="store_true", help="edit ml/data/labeled/ in place instead of the queue")
    a = ap.parse_args()
    SRC = LABELED if a.review else QUEUE
    print(f"{len(names())} frames in {SRC}")
    print(f"open http://127.0.0.1:{a.port}   (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()


if __name__ == "__main__":
    main()
