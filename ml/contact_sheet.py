"""Contact sheet for pointer-test clips: the camera frame at each target with the model's box and head keypoints
drawn on, mirrored the way the owner saw it, plus a strip showing target (ring) and pointer (dot).

    ml/.venv/bin/python ml/contact_sheet.py            # every zip in ml/inbox/ -> ml/out/sheets/

MediaRecorder WebM has no seek index, so frames are decoded sequentially with ffmpeg rather than seeked.
"""
import json, glob, os, subprocess, sys, tempfile, zipfile
from pathlib import Path
import cv2, numpy as np

ROOT = Path(__file__).parent
OUT = ROOT / "out" / "sheets"; OUT.mkdir(parents=True, exist_ok=True)
work = tempfile.mkdtemp(prefix="dogos-sheet-")
for z in sys.argv[1:] or sorted(glob.glob(str(ROOT / "inbox" / "*.zip"))):
    zipfile.ZipFile(z).extractall(work)
os.chdir(work)
for v in glob.glob("*.webm") + glob.glob("*.mp4"):
    d = "frames-" + Path(v).stem; os.makedirs(d, exist_ok=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", v, "-vf", "fps=4", "-q:v", "4", f"{d}/%04d.jpg"], check=True)
for p in sorted(glob.glob('*.json')):
    m = json.load(open(p)); tl = m['timeline']
    poses = [e for e in tl if e.get('type') == 'pose']
    marks = [e for e in tl if e.get('type') == 'mark' and e.get('phase') == 'measure']
    if not marks: continue
    tiles = []
    for mk in marks:
        t = mk['t'] + 1750
        fr = cv2.imread(f"frames-{p.replace('.json','')}/{int(t/250)+1:04d}.jpg")
        if fr is None: fr = np.zeros((480, 640, 3), np.uint8)
        e = min(poses, key=lambda q: abs(q['t'] - t))
        H, W = fr.shape[:2]
        if e.get('kpts'):
            b = e['box']; cv2.rectangle(fr, (int(b[0]*W), int(b[1]*H)), (int((b[0]+b[2])*W), int((b[1]+b[3])*H)), (255, 134, 58), 2)
            for i, k in enumerate(e['kpts'][:8]):
                if k[2] < .35: continue
                col = (63, 210, 255) if i == 0 else (255, 255, 255) if i in (1, 2) else (255, 134, 58)
                cv2.circle(fr, (int(k[0]*W), int(k[1]*H)), 7 if i == 0 else 5, col, -1)
                cv2.putText(fr, ['N','LE','RE','LB','RB','LT','RT','C'][i], (int(k[0]*W)+8, int(k[1]*H)-6), 0, .5, col, 1)
        fr = cv2.flip(fr, 1)  # show as the user saw it: mirrored
        txt = f"target {mk['x']:.2f},{mk['y']:.2f}  ptr " + (f"{e['ptr'][0]:.2f},{e['ptr'][1]:.2f} yaw {e['yaw']:+.2f} n {e['neutral']:+.2f}" if e.get('ptr') else 'LOST')
        cv2.rectangle(fr, (0, 0), (640, 30), (0, 0, 0), -1); cv2.putText(fr, txt, (6, 21), 0, .6, (255, 255, 255), 1)
        # where target (yellow ring) and pointer (blue dot) were on screen, drawn into a strip under the frame
        strip = np.zeros((40, 640, 3), np.uint8)
        cv2.circle(strip, (int(mk['x']*640), 20), 12, (63, 210, 255), 2)
        if e.get('ptr'): cv2.circle(strip, (int(e['ptr'][0]*640), 20), 8, (255, 134, 58), -1)
        tiles.append(np.vstack([fr, strip]))
    rows = [np.hstack(tiles[i:i+3]) for i in range(0, 9, 3)]
    out = cv2.resize(np.vstack(rows), None, fx=.6, fy=.6)
    name = 'sheet-' + next(e for e in tl if e.get('kind') == 'pointer-test-start')['distance'].split(' ')[0] + '.jpg'
    name = str(OUT / (Path(p).stem + '-' + name))
    cv2.imwrite(name, out, [cv2.IMWRITE_JPEG_QUALITY, 80]); print(name)
